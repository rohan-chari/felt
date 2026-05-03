import type { ServerMessage } from "@felt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { type Effect, RoomManager } from "./manager.js";

type EffectArr = Effect[];
type Outcome = EffectArr | { error: { code: string; message: string } };

function isError(o: Outcome): o is { error: { code: string; message: string } } {
  return !Array.isArray(o);
}

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

    it("first joiner gets a snapshot showing themselves as host", () => {
      const roomId = mgr.createRoom();
      const result = mgr.handleJoin({
        sessionId: "s1",
        roomId,
        playerId: "p1",
        displayName: "Alice",
      });
      const effects = result as EffectArr;
      expect(effects).toHaveLength(1);
      expect(effects[0]?.message).toMatchObject({
        type: "room.snapshot",
        snapshot: {
          roomId,
          hostId: "p1",
          players: [{ id: "p1", displayName: "Alice" }],
          gameStarted: false,
        },
      });
    });

    it("snapshot includes empty seats and chat array", () => {
      const roomId = mgr.createRoom();
      const out = mgr.handleJoin({
        sessionId: "s1",
        roomId,
        playerId: "p1",
        displayName: "Alice",
      }) as EffectArr;
      const msg = out[0]?.message as Extract<ServerMessage, { type: "room.snapshot" }>;
      expect(msg.snapshot.seats).toHaveLength(8);
      expect(msg.snapshot.seats.every((s) => s.kind === "empty")).toBe(true);
      expect(msg.snapshot.chat).toEqual([]);
      expect(msg.snapshot.config).toEqual({ maxSeats: 8, minBuyIn: 100, maxBuyIn: 500 });
    });

    it("rejects a join when displayName collides with another player in the room", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "asd" });
      const result = mgr.handleJoin({
        sessionId: "s2",
        roomId,
        playerId: "p2",
        displayName: "asd",
      });
      expect(result).toEqual({ error: { code: "name_taken", message: expect.any(String) } });
    });

    it("treats names case-insensitively and trim-equivalently for collision detection", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      const r1 = mgr.handleJoin({
        sessionId: "s2",
        roomId,
        playerId: "p2",
        displayName: "ALICE",
      });
      expect(r1).toEqual({ error: { code: "name_taken", message: expect.any(String) } });
      const r2 = mgr.handleJoin({
        sessionId: "s3",
        roomId,
        playerId: "p3",
        displayName: " alice ",
      });
      expect(r2).toEqual({ error: { code: "name_taken", message: expect.any(String) } });
    });

    it("allows the same playerId to rejoin under the same name (multi-tab)", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "asd" });
      const r = mgr.handleJoin({
        sessionId: "s2",
        roomId,
        playerId: "p1",
        displayName: "asd",
      });
      expect(Array.isArray(r)).toBe(true);
    });

    it("second joiner triggers playerJoined delta to first", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      const out = mgr.handleJoin({
        sessionId: "s2",
        roomId,
        playerId: "p2",
        displayName: "Bob",
      }) as EffectArr;
      const delta = out.find((e) => e.sessionId === "s1");
      expect(delta?.message).toEqual({
        type: "room.delta",
        roomId,
        delta: { kind: "playerJoined", player: { id: "p2", displayName: "Bob" } },
      });
    });
  });

  describe("handleLeave", () => {
    it("emits playerLeft when a player disconnects", () => {
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

    it("vacates the seat and broadcasts seatLeft if the leaver was seated", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      mgr.handleSeatTake("s1", { seatIndex: 3, buyIn: 200 });
      const effects = mgr.handleLeave("s1");
      const messages = effects.filter((e) => e.sessionId === "s2").map((e) => e.message);
      expect(messages).toEqual(
        expect.arrayContaining([
          { type: "room.delta", roomId, delta: { kind: "seatLeft", seatIndex: 3, playerId: "p1" } },
          { type: "room.delta", roomId, delta: { kind: "playerLeft", playerId: "p1" } },
        ]),
      );
    });

    it("does not emit playerLeft or seatLeft when other sessions for the same player remain", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1a", roomId, playerId: "p1", displayName: "Alice" });
      mgr.handleJoin({ sessionId: "s1b", roomId, playerId: "p1", displayName: "Alice" });
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      mgr.handleSeatTake("s1a", { seatIndex: 0, buyIn: 200 });
      const effects = mgr.handleLeave("s1a");
      expect(effects).toEqual([]);
    });
  });

  describe("handleSeatTake", () => {
    function setupRoomWithTwo() {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      return roomId;
    }

    it("broadcasts seatTaken to all sessions in room (including the actor)", () => {
      const roomId = setupRoomWithTwo();
      const out = mgr.handleSeatTake("s1", { seatIndex: 2, buyIn: 200 }) as EffectArr;
      const sessionIds = out.map((e) => e.sessionId).sort();
      expect(sessionIds).toEqual(["s1", "s2"]);
      for (const e of out) {
        expect(e.message).toEqual({
          type: "room.delta",
          roomId,
          delta: { kind: "seatTaken", seatIndex: 2, playerId: "p1", stack: 200 },
        });
      }
    });

    it("returns an error for an invalid take", () => {
      setupRoomWithTwo();
      mgr.handleSeatTake("s1", { seatIndex: 0, buyIn: 200 });
      const out = mgr.handleSeatTake("s2", { seatIndex: 0, buyIn: 200 });
      expect(isError(out)).toBe(true);
      if (!isError(out)) return;
      expect(out.error.code).toBe("seat_taken");
    });

    it("returns an error if the session has not joined a room", () => {
      const out = mgr.handleSeatTake("orphan", { seatIndex: 0, buyIn: 200 });
      expect(out).toEqual({ error: { code: "no_session", message: expect.any(String) } });
    });
  });

  describe("handleSeatLeave", () => {
    it("broadcasts seatLeft to all sessions in room", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      mgr.handleSeatTake("s1", { seatIndex: 4, buyIn: 200 });
      const out = mgr.handleSeatLeave("s1") as EffectArr;
      expect(out).toEqual(
        expect.arrayContaining([
          {
            sessionId: "s1",
            message: {
              type: "room.delta",
              roomId,
              delta: { kind: "seatLeft", seatIndex: 4, playerId: "p1" },
            },
          },
          {
            sessionId: "s2",
            message: {
              type: "room.delta",
              roomId,
              delta: { kind: "seatLeft", seatIndex: 4, playerId: "p1" },
            },
          },
        ]),
      );
    });
  });

  describe("handleGameStart", () => {
    it("broadcasts gameStarted when host starts with 2 seated", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      mgr.handleSeatTake("s1", { seatIndex: 0, buyIn: 200 });
      mgr.handleSeatTake("s2", { seatIndex: 1, buyIn: 200 });
      const out = mgr.handleGameStart("s1") as EffectArr;
      // Each session should receive a gameStarted delta (engine snapshot + hole cards land too).
      const gameStartedRecipients = out
        .filter(
          (e) => e.message.type === "room.delta" && e.message.delta.kind === "gameStarted",
        )
        .map((e) => e.sessionId)
        .sort();
      expect(gameStartedRecipients).toEqual(["s1", "s2"]);
    });

    it("non-host triggering game.start gets not_host", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      mgr.handleSeatTake("s1", { seatIndex: 0, buyIn: 200 });
      mgr.handleSeatTake("s2", { seatIndex: 1, buyIn: 200 });
      const out = mgr.handleGameStart("s2");
      expect(isError(out)).toBe(true);
      if (!isError(out)) return;
      expect(out.error.code).toBe("not_host");
    });
  });

  describe("handleGameStart with engine wired", () => {
    function setupHandReady() {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      mgr.handleSeatTake("s1", { seatIndex: 0, buyIn: 200 });
      mgr.handleSeatTake("s2", { seatIndex: 1, buyIn: 200 });
      return roomId;
    }

    it("emits gameStarted, hand.snapshot to all, and hand.holeCards privately to each seat owner", () => {
      const roomId = setupHandReady();
      const out = mgr.handleGameStart("s1") as EffectArr;

      const messagesBySession = new Map<string, ServerMessage[]>();
      for (const e of out) {
        const arr = messagesBySession.get(e.sessionId) ?? [];
        arr.push(e.message);
        messagesBySession.set(e.sessionId, arr);
      }

      // Both sessions should get gameStarted delta
      for (const sid of ["s1", "s2"]) {
        const msgs = messagesBySession.get(sid) ?? [];
        const gameStarted = msgs.find(
          (m) => m.type === "room.delta" && m.delta.kind === "gameStarted",
        );
        expect(gameStarted).toBeDefined();
        const handSnapshot = msgs.find(
          (m) => m.type === "room.delta" && m.delta.kind === "hand.snapshot",
        );
        expect(handSnapshot).toBeDefined();
      }

      // Each seat owner should get exactly one hand.holeCards
      for (const sid of ["s1", "s2"]) {
        const msgs = messagesBySession.get(sid) ?? [];
        const holeCards = msgs.filter((m) => m.type === "hand.holeCards");
        expect(holeCards).toHaveLength(1);
      }
    });

    it("hand snapshot includes both seated players, currentPlayerId, board=[]", () => {
      const roomId = setupHandReady();
      const out = mgr.handleGameStart("s1") as EffectArr;
      const snap = out
        .map((e) => e.message)
        .find(
          (m): m is Extract<ServerMessage, { type: "room.delta" }> =>
            m.type === "room.delta" && m.delta.kind === "hand.snapshot",
        );
      expect(snap).toBeDefined();
      if (!snap || snap.delta.kind !== "hand.snapshot") return;
      const view = snap.delta.hand;
      expect(view.street).toBe("preflop");
      expect(view.board).toEqual([]);
      expect(view.seats).toHaveLength(2);
      expect(view.currentPlayerId).toBe("p1"); // heads-up: dealer (SB) acts first
    });
  });

  describe("handleHandAction", () => {
    function setupActiveHand() {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      mgr.handleSeatTake("s1", { seatIndex: 0, buyIn: 200 });
      mgr.handleSeatTake("s2", { seatIndex: 1, buyIn: 200 });
      mgr.handleGameStart("s1");
      return roomId;
    }

    it("rejects when no hand is active", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      const out = mgr.handleHandAction("s1", { kind: "fold" });
      expect(isError(out)).toBe(true);
      if (!isError(out)) return;
      expect(out.error.code).toBe("no_hand");
    });

    it("rejects when not the current player's turn", () => {
      setupActiveHand();
      // Heads-up: p1 (SB, dealer) acts first preflop. p2 trying is wrong.
      const out = mgr.handleHandAction("s2", { kind: "fold" });
      expect(isError(out)).toBe(true);
      if (!isError(out)) return;
      expect(out.error.code).toBe("not_your_turn");
    });

    it("fold preflop ends the hand and broadcasts a final hand.snapshot with result", () => {
      setupActiveHand();
      const out = mgr.handleHandAction("s1", { kind: "fold" }) as EffectArr;
      // Both clients get hand.action + hand.snapshot
      for (const sid of ["s1", "s2"]) {
        const msgs = out.filter((e) => e.sessionId === sid).map((e) => e.message);
        const action = msgs.find((m) => m.type === "room.delta" && m.delta.kind === "hand.action");
        const snap = msgs.find((m) => m.type === "room.delta" && m.delta.kind === "hand.snapshot");
        expect(action).toBeDefined();
        expect(snap).toBeDefined();
        if (snap && snap.type === "room.delta" && snap.delta.kind === "hand.snapshot") {
          expect(snap.delta.hand.street).toBe("complete");
          expect(snap.delta.hand.result).not.toBeNull();
        }
      }
    });
  });

  describe("handleChat", () => {
    it("broadcasts chat delta with server-assigned id and ts", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      const before = Date.now();
      const out = mgr.handleChat("s1", { text: "hi all" }) as EffectArr;
      const after = Date.now();
      expect(out).toHaveLength(2);
      const sample = out[0]?.message as Extract<ServerMessage, { type: "room.delta" }>;
      expect(sample.delta.kind).toBe("chat");
      if (sample.delta.kind !== "chat") return;
      expect(sample.delta.message).toMatchObject({
        playerId: "p1",
        displayName: "Alice",
        text: "hi all",
      });
      expect(typeof sample.delta.message.id).toBe("string");
      expect(sample.delta.message.id.length).toBeGreaterThan(0);
      expect(sample.delta.message.ts).toBeGreaterThanOrEqual(before);
      expect(sample.delta.message.ts).toBeLessThanOrEqual(after);
    });

    it("returns an error for empty text", () => {
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "s1", roomId, playerId: "p1", displayName: "Alice" });
      const out = mgr.handleChat("s1", { text: "  " });
      expect(isError(out)).toBe(true);
      if (!isError(out)) return;
      expect(out.error.code).toBe("empty_chat");
    });
  });
});
