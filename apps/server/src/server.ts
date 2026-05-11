import { randomUUID } from "node:crypto";
import type { ClientMessage, HandRecord, PlayerId, RoomConfig } from "@felt/shared";
import uWS, { type HttpResponse, type us_listen_socket, type WebSocket } from "uWebSockets.js";
import { MemoryPersistence } from "./persistence/memory.js";
import type { Persistence } from "./persistence/types.js";
import { type Effect, RoomManager, type SessionId } from "./rooms/manager.js";
import { replayHand } from "./rooms/hand.js";
import { validateRoomSettings } from "./rooms/settings.js";

/**
 * Strip hole cards before sending a HandRecord to a specific player. The
 * requester always sees their own cards; opponents' cards are revealed only
 * for seats listed in revealedPlayerIds (showdown participants + fold-around
 * winners who opted in via seat.showCards).
 */
function filterHoleCardsFor(record: HandRecord, requesterId: PlayerId): HandRecord {
  const revealed = new Set(record.revealedPlayerIds);
  return {
    ...record,
    seats: record.seats.map((s) => ({
      ...s,
      holeCards:
        s.playerId === requesterId || revealed.has(s.playerId) ? s.holeCards : null,
    })),
  };
}

type WsUserData = {
  sessionId: SessionId;
};

export type ServerHandle = {
  port: number;
  manager: RoomManager;
  close: () => Promise<void>;
};

type CreateServerOptions = {
  port: number;
  corsOrigin?: string;
  /** Persistence backend. Defaults to in-memory (no durability across restarts). */
  persistence?: Persistence;
  /** How often to checkpoint live rooms to persistence. Default 10s. */
  snapshotIntervalMs?: number;
};

const DEFAULT_SNAPSHOT_INTERVAL_MS = 10_000;
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Read a JSON body from a µWS response stream. Resolves with the parsed value
 * (or `null` for an empty body). Rejects on malformed JSON, oversized payload,
 * or a connection abort. The caller is expected to handle the `null` case
 * (treat as "no settings supplied — use defaults").
 */
function readJsonBody(res: HttpResponse): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    res.onData((chunk, isLast) => {
      if (settled) return;
      const buf = Buffer.from(chunk);
      total += buf.byteLength;
      if (total > MAX_BODY_BYTES) {
        settled = true;
        reject(new Error("body too large"));
        return;
      }
      chunks.push(Buffer.from(buf));
      if (!isLast) return;
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw.length === 0) {
        settled = true;
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        settled = true;
        resolve(parsed);
      } catch {
        settled = true;
        reject(new Error("malformed JSON"));
      }
    });
  });
}

export async function createServer(opts: CreateServerOptions): Promise<ServerHandle> {
  const persistence = opts.persistence ?? new MemoryPersistence();
  const manager = new RoomManager();
  const sockets = new Map<SessionId, WebSocket<WsUserData>>();
  const corsOrigin = opts.corsOrigin ?? "*";

  // Hydrate from persistence before accepting connections. Each restored room
  // schedules an eviction timer for every player; reconnects cancel them.
  const restored = await persistence.loadAll();
  if (restored.length > 0) manager.restoreFromSnapshots(restored);

  const dispatch = (effects: Effect[]): void => {
    for (const effect of effects) {
      const ws = sockets.get(effect.sessionId);
      if (!ws) continue;
      try {
        ws.send(JSON.stringify(effect.message), false);
      } catch {
        // socket closed mid-dispatch; close handler will clean up
      }
    }
  };

  // Manager uses this for async-fired effects (e.g., the auto-advance timer).
  manager.setDispatcher(dispatch);

  // Persist completed hands to history. Errors are logged and swallowed —
  // a transient DB blip should not crash the game flow.
  manager.setHandSink((record) => {
    void persistence.saveHand(record).catch((e: unknown) => {
      console.error(`[persistence] saveHand failed for ${record.handId}:`, e);
    });
  });

  const sendError = (sessionId: SessionId, code: string, message: string): void => {
    dispatch([{ sessionId, message: { type: "error", code, message } }]);
  };

  const writeCors = (res: HttpResponse): void => {
    res.writeHeader("Access-Control-Allow-Origin", corsOrigin);
    res.writeHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.writeHeader("Access-Control-Allow-Headers", "Content-Type");
  };

  const app = uWS.App();

  app.options("/*", (res) => {
    res.onAborted(() => {});
    res.cork(() => {
      res.writeStatus("204 No Content");
      writeCors(res);
      res.end();
    });
  });

  app.post("/rooms", (res) => {
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });
    readJsonBody(res)
      .then((body) => {
        if (aborted) return;
        const validation = validateRoomSettings(body);
        if (!validation.ok) {
          res.cork(() => {
            res.writeStatus("400 Bad Request");
            writeCors(res);
            res.writeHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: validation.error }));
          });
          return;
        }
        const roomId = manager.createRoom(validation.settings);
        res.cork(() => {
          writeCors(res);
          res.writeHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ roomId }));
        });
      })
      .catch((err: unknown) => {
        if (aborted) return;
        const message = err instanceof Error ? err.message : "invalid body";
        res.cork(() => {
          res.writeStatus("400 Bad Request");
          writeCors(res);
          res.writeHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: message }));
        });
      });
  });

  app.get("/health", (res) => {
    res.onAborted(() => {});
    res.cork(() => {
      writeCors(res);
      res.writeHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  });

  app.ws<WsUserData>("/ws", {
    upgrade: (res, req, context) => {
      const secWsKey = req.getHeader("sec-websocket-key");
      const secWsProtocol = req.getHeader("sec-websocket-protocol");
      const secWsExtensions = req.getHeader("sec-websocket-extensions");
      res.upgrade<WsUserData>(
        { sessionId: randomUUID() },
        secWsKey,
        secWsProtocol,
        secWsExtensions,
        context,
      );
    },
    open: (ws) => {
      sockets.set(ws.getUserData().sessionId, ws);
    },
    message: (ws, message) => {
      const { sessionId } = ws.getUserData();
      let parsed: ClientMessage;
      try {
        parsed = JSON.parse(Buffer.from(message).toString("utf8")) as ClientMessage;
      } catch {
        sendError(sessionId, "bad_message", "Invalid JSON");
        return;
      }

      const handleResult = (result: Effect[] | { error: { code: string; message: string } }) => {
        if ("error" in result) sendError(sessionId, result.error.code, result.error.message);
        else dispatch(result);
      };

      switch (parsed.type) {
        case "room.join": {
          if (
            typeof parsed.roomId !== "string" ||
            typeof parsed.playerId !== "string" ||
            typeof parsed.displayName !== "string"
          ) {
            sendError(sessionId, "bad_message", "room.join missing fields");
            return;
          }
          handleResult(
            manager.handleJoin({
              sessionId,
              roomId: parsed.roomId,
              playerId: parsed.playerId,
              displayName: parsed.displayName,
            }),
          );
          return;
        }
        case "seat.take": {
          if (typeof parsed.seatIndex !== "number" || typeof parsed.buyIn !== "number") {
            sendError(sessionId, "bad_message", "seat.take missing fields");
            return;
          }
          handleResult(
            manager.handleSeatTake(sessionId, {
              seatIndex: parsed.seatIndex,
              buyIn: parsed.buyIn,
            }),
          );
          return;
        }
        case "seat.leave":
          handleResult(manager.handleSeatLeave(sessionId));
          return;
        case "game.start":
          handleResult(manager.handleGameStart(sessionId));
          return;
        case "chat.send": {
          if (typeof parsed.text !== "string") {
            sendError(sessionId, "bad_message", "chat.send missing text");
            return;
          }
          handleResult(manager.handleChat(sessionId, { text: parsed.text }));
          return;
        }
        case "hand.action": {
          if (!parsed.action || typeof parsed.action.kind !== "string") {
            sendError(sessionId, "bad_message", "hand.action missing action");
            return;
          }
          handleResult(manager.handleHandAction(sessionId, parsed.action));
          return;
        }
        case "seat.rebuy": {
          if (typeof parsed.amount !== "number") {
            sendError(sessionId, "bad_message", "seat.rebuy missing amount");
            return;
          }
          handleResult(manager.handleSeatRebuy(sessionId, { amount: parsed.amount }));
          return;
        }
        case "hand.useTimeBank":
          handleResult(manager.handleUseTimeBank(sessionId));
          return;
        case "hand.preAction": {
          if (!parsed.preAction || typeof parsed.preAction.kind !== "string") {
            sendError(sessionId, "bad_message", "hand.preAction missing preAction");
            return;
          }
          handleResult(manager.handlePreAction(sessionId, parsed.preAction));
          return;
        }
        case "hand.cancelPreAction":
          handleResult(manager.handleCancelPreAction(sessionId));
          return;
        case "seat.showCards":
          handleResult(manager.handleShowCards(sessionId));
          return;
        case "host.pause":
          handleResult(manager.handleHostPause(sessionId));
          return;
        case "host.resume":
          handleResult(manager.handleHostResume(sessionId));
          return;
        case "host.endSession":
          handleResult(manager.handleHostEndSession(sessionId));
          return;
        case "host.kick": {
          if (typeof parsed.playerId !== "string") {
            sendError(sessionId, "bad_message", "host.kick missing playerId");
            return;
          }
          handleResult(manager.handleHostKick(sessionId, { playerId: parsed.playerId }));
          return;
        }
        case "host.updateSettings": {
          if (!parsed.settings || typeof parsed.settings !== "object") {
            sendError(sessionId, "bad_message", "host.updateSettings missing settings");
            return;
          }
          handleResult(manager.handleHostUpdateSettings(sessionId, parsed.settings));
          return;
        }
        case "host.transfer": {
          if (typeof parsed.playerId !== "string") {
            sendError(sessionId, "bad_message", "host.transfer missing playerId");
            return;
          }
          handleResult(manager.handleHostTransfer(sessionId, { playerId: parsed.playerId }));
          return;
        }
        case "hand.history": {
          const info = manager.getSessionInfo(sessionId);
          if (!info) {
            sendError(sessionId, "no_session", "Session has not joined a room");
            return;
          }
          const { roomId, playerId } = info;
          void persistence
            .listHandsByRoom(roomId)
            .then((hands) => {
              const filtered = hands.map((h) => filterHoleCardsFor(h, playerId));
              dispatch([
                {
                  sessionId,
                  message: { type: "hand.history", roomId, hands: filtered },
                },
              ]);
            })
            .catch((e: unknown) => {
              console.error(`[persistence] listHandsByRoom failed for ${roomId}:`, e);
              sendError(sessionId, "history_unavailable", "Could not load hand history");
            });
          return;
        }
        case "hand.replay": {
          if (typeof parsed.handId !== "string") {
            sendError(sessionId, "bad_message", "hand.replay missing handId");
            return;
          }
          const info = manager.getSessionInfo(sessionId);
          if (!info) {
            sendError(sessionId, "no_session", "Session has not joined a room");
            return;
          }
          const requestedHandId = parsed.handId;
          const { roomId, playerId } = info;
          void persistence
            .listHandsByRoom(roomId)
            .then((hands) => {
              const record = hands.find((h) => h.handId === requestedHandId);
              if (!record) {
                sendError(sessionId, "hand_not_found", "That hand isn't in this room's history");
                return;
              }
              try {
                const frames = replayHand(record, playerId);
                dispatch([
                  {
                    sessionId,
                    message: { type: "hand.replay", handId: requestedHandId, frames },
                  },
                ]);
              } catch (e: unknown) {
                console.error(`[replay] reconstruction failed for ${requestedHandId}:`, e);
                sendError(sessionId, "replay_failed", "Could not replay that hand");
              }
            })
            .catch((e: unknown) => {
              console.error(`[persistence] listHandsByRoom failed for ${roomId}:`, e);
              sendError(sessionId, "replay_failed", "Could not load that hand");
            });
          return;
        }
        default:
          sendError(sessionId, "unknown_message", "Unknown message type");
      }
    },
    close: (ws) => {
      const { sessionId } = ws.getUserData();
      sockets.delete(sessionId);
      dispatch(manager.handleLeave(sessionId));
    },
  });

  const listenSocket = await new Promise<us_listen_socket | false>((resolve) => {
    app.listen(opts.port, (token) => resolve(token));
  });

  if (!listenSocket) {
    throw new Error(`Failed to listen on port ${opts.port}`);
  }

  const boundPort = uWS.us_socket_local_port(listenSocket);

  // Periodic snapshot loop. Saves every live room every N ms. Errors are
  // logged and swallowed — a transient DB blip should not crash the game.
  const snapshotIntervalMs = opts.snapshotIntervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS;
  const flushAll = async (): Promise<void> => {
    const blobs = manager.getAllSnapshotBlobs();
    await Promise.all(
      blobs.map((blob) =>
        persistence
          .saveSnapshot(blob.room.roomId, blob)
          .catch((e: unknown) => {
            console.error(`[persistence] saveSnapshot failed for ${blob.room.roomId}:`, e);
          }),
      ),
    );
  };
  const snapshotTimer = setInterval(() => {
    void flushAll();
  }, snapshotIntervalMs);
  // Keeping the snapshot loop unref'd so it doesn't block process exit during
  // tests. Real deployments call close() explicitly.
  snapshotTimer.unref?.();

  return {
    port: boundPort,
    manager,
    close: async () => {
      clearInterval(snapshotTimer);
      // Snapshot BEFORE closing client sockets — closing them fires handleLeave
      // for each, which marks the player sitting out and may end the active
      // hand. We want the persisted state to capture the live mid-hand snapshot.
      await flushAll();
      uWS.us_listen_socket_close(listenSocket);
      for (const ws of sockets.values()) {
        try {
          ws.end(1001, "server shutting down");
        } catch {
          // ignore
        }
      }
      sockets.clear();
      // Persistence ownership belongs to the caller — they decide when to close
      // the underlying pool/connection (especially important for tests that
      // restart the server against a shared persistence instance).
    },
  };
}
