import { createServer as createNetServer } from "node:net";
import type { ServerMessage } from "@felt/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { MemoryPersistence } from "./persistence/memory.js";
import { createServer, type ServerHandle } from "./server.js";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no port"));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

function openSocket(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString("utf8")) as ServerMessage);
      } catch (e) {
        reject(e);
      }
    });
    ws.once("error", reject);
  });
}

/** Buffered message reader — captures every message and lets you `take()` them in order. */
function bufferMessages(ws: WebSocket): {
  take: () => Promise<ServerMessage>;
  takeN: (n: number) => Promise<ServerMessage[]>;
} {
  const queue: ServerMessage[] = [];
  const waiters: Array<(m: ServerMessage) => void> = [];
  ws.on("message", (data) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data.toString("utf8")) as ServerMessage;
    } catch {
      return;
    }
    const w = waiters.shift();
    if (w) w(msg);
    else queue.push(msg);
  });
  const take = () => {
    const buffered = queue.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise<ServerMessage>((resolve) => waiters.push(resolve));
  };
  const takeN = async (n: number) => {
    const out: ServerMessage[] = [];
    for (let i = 0; i < n; i++) out.push(await take());
    return out;
  };
  return { take, takeN };
}

async function joinRoom(ws: WebSocket, roomId: string, playerId: string, name: string) {
  ws.send(JSON.stringify({ type: "room.join", roomId, playerId, displayName: name }));
  await nextMessage(ws); // consume snapshot
}

describe("server (integration)", () => {
  let handle: ServerHandle;

  beforeEach(async () => {
    const port = await freePort();
    handle = await createServer({ port });
    // Shrink the disconnect grace period so reconnect-deferred broadcasts arrive
    // within a test-friendly window. Default is 60s.
    handle.manager.disconnectGraceMs = 50;
  });

  afterEach(async () => {
    await handle.close();
  });

  it("POST /rooms returns a roomId", async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/rooms`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roomId: string };
    expect(body.roomId).toMatch(/^[A-Z2-9]+$/);
    expect(handle.manager.hasRoom(body.roomId)).toBe(true);
  });

  it("POST /rooms accepts settings in the body and applies them to the new room", async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        smallBlind: 5,
        bigBlind: 10,
        maxSeats: 4,
        autoDealEnabled: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roomId: string };
    const room = (handle.manager as unknown as {
      rooms: Map<string, import("./rooms/room.js").RoomState>;
    }).rooms.get(body.roomId);
    expect(room?.config.smallBlind).toBe(5);
    expect(room?.config.bigBlind).toBe(10);
    expect(room?.config.maxSeats).toBe(4);
    expect(room?.config.autoDealEnabled).toBe(false);
    // Untouched fields keep defaults.
    expect(room?.config.turnTimerMs).toBe(30_000);
  });

  it("POST /rooms rejects invalid settings with a 400", async () => {
    const cases: Array<{ name: string; body: Record<string, unknown> }> = [
      { name: "sb >= bb", body: { smallBlind: 10, bigBlind: 5 } },
      { name: "negative blind", body: { smallBlind: -1 } },
      { name: "maxSeats out of [2,9]", body: { maxSeats: 12 } },
      { name: "buyIn range inverted", body: { minBuyIn: 500, maxBuyIn: 100 } },
      { name: "non-numeric timer", body: { turnTimerMs: "thirty" } },
    ];
    for (const c of cases) {
      const res = await fetch(`http://127.0.0.1:${handle.port}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c.body),
      });
      expect(res.status, c.name).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error, c.name).toBeTruthy();
    }
  });

  it("POST /rooms rejects malformed JSON with a 400", async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("GET /health returns ok", async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("OPTIONS preflight responds with CORS headers", async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/rooms`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("WS room.join returns a snapshot with host=joiner and 8 empty seats", async () => {
    const roomId = handle.manager.createRoom();
    const ws = await openSocket(handle.port);
    ws.send(
      JSON.stringify({
        type: "room.join",
        roomId,
        playerId: "p1",
        displayName: "Alice",
      }),
    );
    const msg = await nextMessage(ws);
    expect(msg).toMatchObject({
      type: "room.snapshot",
      snapshot: {
        roomId,
        hostId: "p1",
        players: [{ id: "p1", displayName: "Alice" }],
        gameStarted: false,
        chat: [],
      },
    });
    if (msg.type === "room.snapshot") {
      expect(msg.snapshot.seats).toHaveLength(8);
    }
    ws.close();
  });

  it("disconnect broadcasts playerLeft to remaining clients", async () => {
    const roomId = handle.manager.createRoom();
    const wsA = await openSocket(handle.port);
    await joinRoom(wsA, roomId, "pA", "Alice");

    const wsB = await openSocket(handle.port);
    const aDelta1 = nextMessage(wsA);
    await joinRoom(wsB, roomId, "pB", "Bob");
    await aDelta1;

    const aDelta2 = nextMessage(wsA);
    wsB.close();
    const msg = await aDelta2;
    expect(msg).toEqual({
      type: "room.delta",
      roomId,
      delta: { kind: "playerLeft", playerId: "pB" },
    });
    wsA.close();
  });

  it("seat.take broadcasts seatTaken to all", async () => {
    const roomId = handle.manager.createRoom();
    const wsA = await openSocket(handle.port);
    await joinRoom(wsA, roomId, "pA", "Alice");
    const wsB = await openSocket(handle.port);
    const aJoinDelta = nextMessage(wsA);
    await joinRoom(wsB, roomId, "pB", "Bob");
    await aJoinDelta;

    const aDelta = nextMessage(wsA);
    const bDelta = nextMessage(wsB);
    wsA.send(JSON.stringify({ type: "seat.take", seatIndex: 2, buyIn: 200 }));
    const [da, db] = await Promise.all([aDelta, bDelta]);
    const expected = {
      type: "room.delta",
      roomId,
      delta: { kind: "seatTaken", seatIndex: 2, playerId: "pA", stack: 200 },
    };
    expect(da).toEqual(expected);
    expect(db).toEqual(expected);
    wsA.close();
    wsB.close();
  });

  it("seat.take with invalid buyIn returns an error to the actor", async () => {
    const roomId = handle.manager.createRoom();
    const ws = await openSocket(handle.port);
    await joinRoom(ws, roomId, "p1", "Alice");
    ws.send(JSON.stringify({ type: "seat.take", seatIndex: 0, buyIn: 5 }));
    const msg = await nextMessage(ws);
    expect(msg).toMatchObject({ type: "error", code: "bad_buyin" });
    ws.close();
  });

  it("game.start by host with 2 seated broadcasts gameStarted to all", async () => {
    const roomId = handle.manager.createRoom();
    const wsA = await openSocket(handle.port);
    await joinRoom(wsA, roomId, "pA", "Alice");
    const wsB = await openSocket(handle.port);
    const aJoinDelta = nextMessage(wsA);
    await joinRoom(wsB, roomId, "pB", "Bob");
    await aJoinDelta;

    // Both sit
    const aSeat = nextMessage(wsA);
    const bSeat = nextMessage(wsB);
    wsA.send(JSON.stringify({ type: "seat.take", seatIndex: 0, buyIn: 200 }));
    await Promise.all([aSeat, bSeat]);
    const aSeat2 = nextMessage(wsA);
    const bSeat2 = nextMessage(wsB);
    wsB.send(JSON.stringify({ type: "seat.take", seatIndex: 1, buyIn: 200 }));
    await Promise.all([aSeat2, bSeat2]);

    const aGame = nextMessage(wsA);
    const bGame = nextMessage(wsB);
    wsA.send(JSON.stringify({ type: "game.start" }));
    const [ga, gb] = await Promise.all([aGame, bGame]);
    expect(ga).toEqual({ type: "room.delta", roomId, delta: { kind: "gameStarted" } });
    expect(gb).toEqual(ga);
    wsA.close();
    wsB.close();
  });

  it("chat.send broadcasts chat delta with server-generated id", async () => {
    const roomId = handle.manager.createRoom();
    const wsA = await openSocket(handle.port);
    await joinRoom(wsA, roomId, "pA", "Alice");
    const wsB = await openSocket(handle.port);
    const aJoin = nextMessage(wsA);
    await joinRoom(wsB, roomId, "pB", "Bob");
    await aJoin;

    const aChat = nextMessage(wsA);
    const bChat = nextMessage(wsB);
    wsA.send(JSON.stringify({ type: "chat.send", text: "gg" }));
    const [ca, cb] = await Promise.all([aChat, bChat]);

    expect(ca).toMatchObject({
      type: "room.delta",
      roomId,
      delta: {
        kind: "chat",
        message: { playerId: "pA", displayName: "Alice", text: "gg" },
      },
    });
    expect(cb).toEqual(ca);
    wsA.close();
    wsB.close();
  });

  it("joining unknown room returns an error", async () => {
    const ws = await openSocket(handle.port);
    ws.send(
      JSON.stringify({ type: "room.join", roomId: "GHOST1", playerId: "p1", displayName: "X" }),
    );
    const msg = await nextMessage(ws);
    expect(msg).toMatchObject({ type: "error", code: "room_not_found" });
    ws.close();
  });

  it("game.start delivers hole cards privately to each seat owner", async () => {
    const roomId = handle.manager.createRoom();
    const wsA = await openSocket(handle.port);
    const aBuf = bufferMessages(wsA);
    wsA.send(
      JSON.stringify({ type: "room.join", roomId, playerId: "pA", displayName: "Alice" }),
    );
    await aBuf.take(); // pA snapshot
    const wsB = await openSocket(handle.port);
    const bBuf = bufferMessages(wsB);
    wsB.send(JSON.stringify({ type: "room.join", roomId, playerId: "pB", displayName: "Bob" }));
    await Promise.all([aBuf.take(), bBuf.take()]); // pA delta + pB snapshot

    wsA.send(JSON.stringify({ type: "seat.take", seatIndex: 0, buyIn: 200 }));
    // seat.take now emits two deltas: seatTaken + buyInsUpdated.
    await Promise.all([aBuf.takeN(2), bBuf.takeN(2)]);
    wsB.send(JSON.stringify({ type: "seat.take", seatIndex: 1, buyIn: 200 }));
    await Promise.all([aBuf.takeN(2), bBuf.takeN(2)]);

    wsA.send(JSON.stringify({ type: "game.start" }));
    const [a, b] = await Promise.all([aBuf.takeN(3), bBuf.takeN(3)]);

    const aHole = a.filter((m) => m.type === "hand.holeCards");
    const bHole = b.filter((m) => m.type === "hand.holeCards");
    expect(aHole).toHaveLength(1);
    expect(bHole).toHaveLength(1);
    if (aHole[0]?.type === "hand.holeCards" && bHole[0]?.type === "hand.holeCards") {
      expect(aHole[0].cards).not.toEqual(bHole[0].cards);
      expect(aHole[0].cards).toHaveLength(2);
    }
    wsA.close();
    wsB.close();
  });

  it("hand.action fold by SB ends the hand and broadcasts result", async () => {
    const roomId = handle.manager.createRoom();
    const wsA = await openSocket(handle.port);
    const aBuf = bufferMessages(wsA);
    wsA.send(JSON.stringify({ type: "room.join", roomId, playerId: "pA", displayName: "Alice" }));
    await aBuf.take();
    const wsB = await openSocket(handle.port);
    const bBuf = bufferMessages(wsB);
    wsB.send(JSON.stringify({ type: "room.join", roomId, playerId: "pB", displayName: "Bob" }));
    await Promise.all([aBuf.take(), bBuf.take()]);
    wsA.send(JSON.stringify({ type: "seat.take", seatIndex: 0, buyIn: 200 }));
    // seat.take now emits two deltas: seatTaken + buyInsUpdated.
    await Promise.all([aBuf.takeN(2), bBuf.takeN(2)]);
    wsB.send(JSON.stringify({ type: "seat.take", seatIndex: 1, buyIn: 200 }));
    await Promise.all([aBuf.takeN(2), bBuf.takeN(2)]);
    wsA.send(JSON.stringify({ type: "game.start" }));
    await Promise.all([aBuf.takeN(3), bBuf.takeN(3)]);
    // Heads-up: pA (dealer = SB) acts first preflop. Fold.
    wsA.send(JSON.stringify({ type: "hand.action", action: { kind: "fold" } }));
    const [aMsgs, bMsgs] = await Promise.all([aBuf.takeN(2), bBuf.takeN(2)]);
    const aSnap = aMsgs.find((m) => m.type === "room.delta" && m.delta.kind === "hand.snapshot");
    expect(aSnap).toBeDefined();
    if (aSnap && aSnap.type === "room.delta" && aSnap.delta.kind === "hand.snapshot") {
      expect(aSnap.delta.hand.street).toBe("complete");
      expect(aSnap.delta.hand.result).not.toBeNull();
    }
    const bSnap = bMsgs.find((m) => m.type === "room.delta" && m.delta.kind === "hand.snapshot");
    expect(bSnap).toBeDefined();
    if (bSnap && bSnap.type === "room.delta" && bSnap.delta.kind === "hand.snapshot") {
      expect(bSnap.delta.hand.result?.awards[0]?.winners[0]?.playerId).toBe("pB");
    }
    wsA.close();
    wsB.close();
  });
});

describe("server (restart restoration)", () => {
  it("restart restores hot rooms from persistence (mid-hand state included)", async () => {
    const persistence = new MemoryPersistence();
    const port1 = await freePort();
    const h1 = await createServer({ port: port1, persistence, snapshotIntervalMs: 50 });
    h1.manager.disconnectGraceMs = 60_000;

    let roomId = "";
    let h1HandId = "";
    try {
      roomId = h1.manager.createRoom();
      const wsA = await openSocket(h1.port);
      const aBuf = bufferMessages(wsA);
      wsA.send(JSON.stringify({ type: "room.join", roomId, playerId: "pA", displayName: "Alice" }));
      await aBuf.take();
      const wsB = await openSocket(h1.port);
      const bBuf = bufferMessages(wsB);
      wsB.send(JSON.stringify({ type: "room.join", roomId, playerId: "pB", displayName: "Bob" }));
      await Promise.all([aBuf.take(), bBuf.take()]);
      wsA.send(JSON.stringify({ type: "seat.take", seatIndex: 0, buyIn: 200 }));
      // seat.take now emits two deltas: seatTaken + buyInsUpdated.
      await Promise.all([aBuf.takeN(2), bBuf.takeN(2)]);
      wsB.send(JSON.stringify({ type: "seat.take", seatIndex: 1, buyIn: 200 }));
      await Promise.all([aBuf.takeN(2), bBuf.takeN(2)]);
      wsA.send(JSON.stringify({ type: "game.start" }));
      await Promise.all([aBuf.takeN(3), bBuf.takeN(3)]);

      h1HandId = h1.manager.getHand(roomId)?.handId ?? "";
      expect(h1HandId).not.toBe("");
      wsA.close();
      wsB.close();
    } finally {
      // close() runs flushAll, persistence now holds the snapshot.
      await h1.close();
    }

    const port2 = await freePort();
    const h2 = await createServer({ port: port2, persistence, snapshotIntervalMs: 50 });
    h2.manager.disconnectGraceMs = 60_000;
    try {
      expect(h2.manager.hasRoom(roomId)).toBe(true);
      const restoredHand = h2.manager.getHand(roomId);
      expect(restoredHand?.handId).toBe(h1HandId);
      expect(restoredHand?.street).toBe("preflop");

      // Alice reconnects on the new server and gets her seat back + hole cards.
      const wsA2 = await openSocket(h2.port);
      const a2Buf = bufferMessages(wsA2);
      wsA2.send(
        JSON.stringify({ type: "room.join", roomId, playerId: "pA", displayName: "Alice" }),
      );
      const restoredSnap = await a2Buf.take();
      expect(restoredSnap.type).toBe("room.snapshot");
      if (restoredSnap.type === "room.snapshot") {
        expect(restoredSnap.snapshot.hand?.handId).toBe(h1HandId);
      }
      const holeMsg = await a2Buf.take();
      expect(holeMsg.type).toBe("hand.holeCards");
      if (holeMsg.type === "hand.holeCards") {
        expect(holeMsg.handId).toBe(h1HandId);
        expect(holeMsg.cards).toHaveLength(2);
      }
      wsA2.close();
    } finally {
      await h2.close();
    }
  });
});
