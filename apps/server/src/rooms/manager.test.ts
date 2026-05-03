import type { ServerMessage } from "@felt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { RoomManager } from "./manager.js";

describe("RoomManager", () => {
  let mgr: RoomManager;
  beforeEach(() => {
    mgr = new RoomManager();
  });

  describe("createRoom", () => {
    it("returns a non-empty roomId", () => {
      const id = mgr.createRoom();
      expect(id).toMatch(/^[A-Z0-9]+$/);
      expect(id.length).toBeGreaterThan(3);
    });

    it("returns unique ids", () => {
      const ids = new Set(Array.from({ length: 20 }, () => mgr.createRoom()));
      expect(ids.size).toBe(20);
    });

    it("hasRoom is true for created rooms", () => {
      const id = mgr.createRoom();
      expect(mgr.hasRoom(id)).toBe(true);
      expect(mgr.hasRoom("nope")).toBe(false);
    });
  });

  describe("handleJoin", () => {
    it("returns an error for unknown room", () => {
      const result = mgr.handleJoin({
        sessionId: "s1",
        roomId: "GHOST",
        playerId: "p1",
        displayName: "Alice",
      });
      expect(result).toEqual({ error: { code: "room_not_found", message: expect.any(String) } });
    });

    it("first joiner gets a snapshot containing themselves; no broadcast", () => {
      const roomId = mgr.createRoom();
      const result = mgr.handleJoin({
        sessionId: "s1",
        roomId,
        playerId: "p1",
        displayName: "Alice",
      });
      expect(Array.isArray(result)).toBe(true);
      const effects = result as { sessionId: string; message: ServerMessage }[];
      expect(effects).toHaveLength(1);
      expect(effects[0]?.sessionId).toBe("s1");
      expect(effects[0]?.message).toEqual({
        type: "room.snapshot",
        snapshot: {
          roomId,
          players: [{ id: "p1", displayName: "Alice" }],
        },
      });
    });

    it("second joiner gets a snapshot; first joiner gets a delta", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      const result = mgr.handleJoin({
        sessionId: "s2",
        roomId,
        playerId: "p2",
        displayName: "Bob",
      });
      const effects = result as { sessionId: string; message: ServerMessage }[];
      expect(effects).toHaveLength(2);
      const snapshot = effects.find((e) => e.sessionId === "s2");
      const delta = effects.find((e) => e.sessionId === "s1");
      expect(snapshot?.message).toMatchObject({
        type: "room.snapshot",
        snapshot: { roomId, players: expect.arrayContaining([{ id: "p1", displayName: "Alice" }]) },
      });
      expect(delta?.message).toEqual({
        type: "room.delta",
        roomId,
        delta: { kind: "playerJoined", player: { id: "p2", displayName: "Bob" } },
      });
    });

    it("same playerId joining a second time updates name without broadcasting playerJoined twice", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      // Same player p1 joins again from a different session with new name
      const result = mgr.handleJoin({
        sessionId: "s3",
        roomId,
        playerId: "p1",
        displayName: "Alicia",
      });
      const effects = result as { sessionId: string; message: ServerMessage }[];
      // s3 should get a snapshot with Alicia (not Alice)
      const snap = effects.find((e) => e.sessionId === "s3");
      expect(snap?.message).toMatchObject({
        type: "room.snapshot",
        snapshot: { players: expect.arrayContaining([{ id: "p1", displayName: "Alicia" }]) },
      });
    });
  });

  describe("handleLeave", () => {
    it("emits playerLeft delta to remaining sessions when a player disconnects", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      const effects = mgr.handleLeave("s1");
      expect(effects).toEqual([
        {
          sessionId: "s2",
          message: { type: "room.delta", roomId, delta: { kind: "playerLeft", playerId: "p1" } },
        },
      ]);
    });

    it("does not emit playerLeft when other sessions for the same player remain", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1a", roomId, playerId: "p1", displayName: "Alice" });
      mgr.handleJoin({ sessionId: "s1b", roomId, playerId: "p1", displayName: "Alice" });
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      const effects = mgr.handleLeave("s1a");
      expect(effects).toEqual([]);
    });

    it("returns [] for unknown session", () => {
      expect(mgr.handleLeave("ghost")).toEqual([]);
    });

    it("the last leaver triggers no broadcast (no one to broadcast to)", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      const effects = mgr.handleLeave("s1");
      expect(effects).toEqual([]);
    });
  });
});
