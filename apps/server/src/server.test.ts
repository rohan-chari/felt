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

  it("WS room.join returns a snapshot", async () => {
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
    expect(msg).toEqual({
      type: "room.snapshot",
      snapshot: { roomId, players: [{ id: "p1", displayName: "Alice" }] },
    });
    ws.close();
  });

  it("second joiner sees the first; first sees a delta", async () => {
    const roomId = handle.manager.createRoom();
    const wsA = await openSocket(handle.port);
    wsA.send(JSON.stringify({ type: "room.join", roomId, playerId: "pA", displayName: "Alice" }));
    await nextMessage(wsA); // snapshot for A

    const wsB = await openSocket(handle.port);
    const aDeltaPromise = nextMessage(wsA);
    wsB.send(JSON.stringify({ type: "room.join", roomId, playerId: "pB", displayName: "Bob" }));

    const [snapB, deltaA] = await Promise.all([nextMessage(wsB), aDeltaPromise]);
    expect(snapB).toMatchObject({
      type: "room.snapshot",
      snapshot: {
        roomId,
        players: expect.arrayContaining([
          { id: "pA", displayName: "Alice" },
          { id: "pB", displayName: "Bob" },
        ]),
      },
    });
    expect(deltaA).toEqual({
      type: "room.delta",
      roomId,
      delta: { kind: "playerJoined", player: { id: "pB", displayName: "Bob" } },
    });

    wsA.close();
    wsB.close();
  });

  it("disconnect broadcasts playerLeft to remaining clients", async () => {
    const roomId = handle.manager.createRoom();
    const wsA = await openSocket(handle.port);
    wsA.send(JSON.stringify({ type: "room.join", roomId, playerId: "pA", displayName: "Alice" }));
    await nextMessage(wsA);

    const wsB = await openSocket(handle.port);
    const aDelta1 = nextMessage(wsA);
    wsB.send(JSON.stringify({ type: "room.join", roomId, playerId: "pB", displayName: "Bob" }));
    await Promise.all([nextMessage(wsB), aDelta1]);

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
