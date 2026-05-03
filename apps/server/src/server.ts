import { randomUUID } from "node:crypto";
import type { ClientMessage } from "@felt/shared";
import uWS, { type HttpResponse, type us_listen_socket, type WebSocket } from "uWebSockets.js";
import { type Effect, RoomManager, type SessionId } from "./rooms/manager.js";

type WsUserData = {
  sessionId: SessionId;
};

export type ServerHandle = {
  port: number;
  manager: RoomManager;
  close: () => void;
};

type CreateServerOptions = {
  port: number;
  corsOrigin?: string;
};

export async function createServer(opts: CreateServerOptions): Promise<ServerHandle> {
  const manager = new RoomManager();
  const sockets = new Map<SessionId, WebSocket<WsUserData>>();
  const corsOrigin = opts.corsOrigin ?? "*";

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
    res.onAborted(() => {});
    const roomId = manager.createRoom();
    res.cork(() => {
      writeCors(res);
      res.writeHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ roomId }));
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

      if (parsed.type === "room.join") {
        if (
          typeof parsed.roomId !== "string" ||
          typeof parsed.playerId !== "string" ||
          typeof parsed.displayName !== "string"
        ) {
          sendError(sessionId, "bad_message", "room.join missing fields");
          return;
        }
        const result = manager.handleJoin({
          sessionId,
          roomId: parsed.roomId,
          playerId: parsed.playerId,
          displayName: parsed.displayName,
        });
        if ("error" in result) {
          sendError(sessionId, result.error.code, result.error.message);
          return;
        }
        dispatch(result);
        return;
      }

      sendError(sessionId, "unknown_message", `Unknown message type`);
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

  return {
    port: boundPort,
    manager,
    close: () => {
      uWS.us_listen_socket_close(listenSocket);
      for (const ws of sockets.values()) {
        try {
          ws.end(1001, "server shutting down");
        } catch {
          // ignore
        }
      }
      sockets.clear();
    },
  };
}
