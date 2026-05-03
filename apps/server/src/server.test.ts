import { createServer as createNetServer } from "node:net";
import type { ServerMessage } from "@felt/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
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

async function joinRoom(ws: WebSocket, roomId: string, playerId: string, name: string) {
  ws.send(JSON.stringify({ type: "room.join", roomId, playerId, displayName: name }));
  await nextMessage(ws); // consume snapshot
}

describe("server (integration)", () => {
  let handle: ServerHandle;

  beforeEach(async () => {
    const port = await freePort();
    handle = await createServer({ port });
  });

  afterEach(() => {
    handle.close();
  });

  it("POST /rooms returns a roomId", async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/rooms`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roomId: string };
    expect(body.roomId).toMatch(/^[A-Z2-9]+$/);
    expect(handle.manager.hasRoom(body.roomId)).toBe(true);
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
});
