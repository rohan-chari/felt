import { DEFAULT_ROOM_CONFIG } from "@felt/shared";
import { describe, expect, it } from "vitest";
import { applyEvent, applyIntent, createRoom, toSnapshot } from "./room.js";

describe("room (pure)", () => {
  describe("createRoom", () => {
    it("creates an empty room with defaults", () => {
      const r = createRoom("R1");
      expect(r.roomId).toBe("R1");
      expect(r.players.size).toBe(0);
      expect(r.hostId).toBeNull();
      expect(r.gameStarted).toBe(false);
      expect(r.chat).toEqual([]);
      expect(r.seats).toHaveLength(8);
      expect(r.seats.every((s) => s.kind === "empty")).toBe(true);
      expect(r.config).toEqual({ ...DEFAULT_ROOM_CONFIG, chatLimit: 50 });
    });

    it("respects config overrides", () => {
      const r = createRoom("R1", { maxSeats: 6, minBuyIn: 50, maxBuyIn: 200 });
      expect(r.seats).toHaveLength(6);
      expect(r.config.minBuyIn).toBe(50);
    });
  });

  describe("applyEvent playerJoined", () => {
    it("adds player and sets hostId on first join", () => {
      const r = applyEvent(createRoom("R1"), {
        kind: "playerJoined",
        player: { id: "p1", displayName: "Alice" },
      });
      expect(r.players.get("p1")).toEqual({ id: "p1", displayName: "Alice" });
      expect(r.hostId).toBe("p1");
    });

    it("does not change hostId on subsequent joins", () => {
      let r = createRoom("R1");
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p2", displayName: "Bob" } });
      expect(r.hostId).toBe("p1");
    });

    it("does not change hostId when an existing player rejoins", () => {
      let r = createRoom("R1");
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p2", displayName: "Bob" } });
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alicia" } });
      expect(r.hostId).toBe("p1");
      expect(r.players.get("p1")?.displayName).toBe("Alicia");
    });
  });

  describe("applyEvent playerLeft", () => {
    it("removes the player but does not vacate their seat", () => {
      let r = createRoom("R1");
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      r = applyEvent(r, { kind: "seatTaken", seatIndex: 0, playerId: "p1", stack: 200 });
      r = applyEvent(r, { kind: "playerLeft", playerId: "p1" });
      expect(r.players.has("p1")).toBe(false);
      // seat vacancy is the manager's responsibility, not the pure event
      const seat = r.seats[0];
      expect(seat?.kind).toBe("taken");
    });

    it("does not change hostId even if host leaves", () => {
      let r = createRoom("R1");
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p2", displayName: "Bob" } });
      r = applyEvent(r, { kind: "playerLeft", playerId: "p1" });
      expect(r.hostId).toBe("p1");
    });
  });

  describe("applyEvent — seat/game/chat", () => {
    it("seatTaken sets the seat", () => {
      let r = createRoom("R1");
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      r = applyEvent(r, { kind: "seatTaken", seatIndex: 3, playerId: "p1", stack: 200 });
      expect(r.seats[3]).toEqual({ kind: "taken", index: 3, playerId: "p1", stack: 200, busted: false });
    });

    it("seatLeft empties the seat", () => {
      let r = createRoom("R1");
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      r = applyEvent(r, { kind: "seatTaken", seatIndex: 3, playerId: "p1", stack: 200 });
      r = applyEvent(r, { kind: "seatLeft", seatIndex: 3 });
      expect(r.seats[3]).toEqual({ kind: "empty", index: 3 });
    });

    it("gameStarted flips the flag", () => {
      const r0 = createRoom("R1");
      const r1 = applyEvent(r0, { kind: "gameStarted" });
      expect(r1.gameStarted).toBe(true);
    });

    it("chatMessage appends to chat", () => {
      const r0 = createRoom("R1");
      const r1 = applyEvent(r0, {
        kind: "chatMessage",
        message: { id: "c1", playerId: "p1", displayName: "Alice", text: "hi", ts: 1 },
      });
      expect(r1.chat).toHaveLength(1);
      expect(r1.chat[0]?.text).toBe("hi");
    });
  });

  describe("toSnapshot", () => {
    it("includes seats, host, chat, config, gameStarted", () => {
      let r = createRoom("R1");
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      r = applyEvent(r, { kind: "seatTaken", seatIndex: 2, playerId: "p1", stack: 200 });
      const snap = toSnapshot(r);
      expect(snap.hostId).toBe("p1");
      expect(snap.players).toEqual([{ id: "p1", displayName: "Alice" }]);
      expect(snap.seats).toHaveLength(8);
      expect(snap.seats[2]).toMatchObject({ kind: "taken", playerId: "p1", stack: 200, busted: false });
      expect(snap.gameStarted).toBe(false);
      expect(snap.chat).toEqual([]);
      expect(snap.config).toEqual(DEFAULT_ROOM_CONFIG);
    });
  });

  describe("applyIntent seatTake", () => {
    function setup() {
      let r = createRoom("R1");
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p2", displayName: "Bob" } });
      return r;
    }

    it("accepts a valid seat take", () => {
      const r = setup();
      const result = applyIntent(r, {
        kind: "seatTake",
        playerId: "p1",
        seatIndex: 0,
        buyIn: 200,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state.seats[0]).toEqual({
        kind: "taken",
        index: 0,
        playerId: "p1",
        stack: 200,
        busted: false,
      });
      expect(result.delta).toEqual({
        kind: "seatTaken",
        seatIndex: 0,
        playerId: "p1",
        stack: 200,
      });
    });

    it("rejects an out-of-range seat index", () => {
      const r = setup();
      const result = applyIntent(r, {
        kind: "seatTake",
        playerId: "p1",
        seatIndex: 99,
        buyIn: 200,
      });
      expect(result).toEqual({ ok: false, code: "bad_seat", message: expect.any(String) });
    });

    it("rejects taking an already-occupied seat", () => {
      let r = setup();
      r = applyEvent(r, { kind: "seatTaken", seatIndex: 0, playerId: "p2", stack: 200 });
      const result = applyIntent(r, {
        kind: "seatTake",
        playerId: "p1",
        seatIndex: 0,
        buyIn: 200,
      });
      expect(result).toEqual({ ok: false, code: "seat_taken", message: expect.any(String) });
    });

    it("rejects when player is not in the room", () => {
      const r = setup();
      const result = applyIntent(r, {
        kind: "seatTake",
        playerId: "ghost",
        seatIndex: 0,
        buyIn: 200,
      });
      expect(result).toEqual({ ok: false, code: "not_in_room", message: expect.any(String) });
    });

    it("rejects when player is already seated", () => {
      let r = setup();
      r = applyEvent(r, { kind: "seatTaken", seatIndex: 0, playerId: "p1", stack: 200 });
      const result = applyIntent(r, {
        kind: "seatTake",
        playerId: "p1",
        seatIndex: 1,
        buyIn: 200,
      });
      expect(result).toEqual({ ok: false, code: "already_seated", message: expect.any(String) });
    });

    it("rejects buyIn below min", () => {
      const r = setup();
      const result = applyIntent(r, {
        kind: "seatTake",
        playerId: "p1",
        seatIndex: 0,
        buyIn: 50,
      });
      expect(result).toEqual({ ok: false, code: "bad_buyin", message: expect.any(String) });
    });

    it("rejects buyIn above max", () => {
      const r = setup();
      const result = applyIntent(r, {
        kind: "seatTake",
        playerId: "p1",
        seatIndex: 0,
        buyIn: 9999,
      });
      expect(result).toEqual({ ok: false, code: "bad_buyin", message: expect.any(String) });
    });

    it("allows sitting after the game has started — joiner is dealt in next hand", () => {
      let r = setup();
      r = applyEvent(r, { kind: "gameStarted" });
      const result = applyIntent(r, {
        kind: "seatTake",
        playerId: "p1",
        seatIndex: 0,
        buyIn: 200,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("applyIntent seatLeave", () => {
    it("accepts a valid leave and emits seatLeft", () => {
      let r = createRoom("R1");
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      r = applyEvent(r, { kind: "seatTaken", seatIndex: 4, playerId: "p1", stack: 200 });
      const result = applyIntent(r, { kind: "seatLeave", playerId: "p1" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state.seats[4]).toEqual({ kind: "empty", index: 4 });
      expect(result.delta).toEqual({ kind: "seatLeft", seatIndex: 4, playerId: "p1" });
    });

    it("rejects when player is not seated", () => {
      let r = createRoom("R1");
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      const result = applyIntent(r, { kind: "seatLeave", playerId: "p1" });
      expect(result).toEqual({ ok: false, code: "not_seated", message: expect.any(String) });
    });
  });

  describe("applyIntent gameStart", () => {
    function withTwoSeated() {
      let r = createRoom("R1");
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p2", displayName: "Bob" } });
      r = applyEvent(r, { kind: "seatTaken", seatIndex: 0, playerId: "p1", stack: 200 });
      r = applyEvent(r, { kind: "seatTaken", seatIndex: 1, playerId: "p2", stack: 200 });
      return r;
    }

    it("accepts when host with 2+ seated", () => {
      const r = withTwoSeated();
      const result = applyIntent(r, { kind: "gameStart", playerId: "p1" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state.gameStarted).toBe(true);
      expect(result.delta).toEqual({ kind: "gameStarted" });
    });

    it("rejects when not host", () => {
      const r = withTwoSeated();
      const result = applyIntent(r, { kind: "gameStart", playerId: "p2" });
      expect(result).toEqual({ ok: false, code: "not_host", message: expect.any(String) });
    });

    it("rejects when fewer than 2 seated", () => {
      let r = createRoom("R1");
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      r = applyEvent(r, { kind: "seatTaken", seatIndex: 0, playerId: "p1", stack: 200 });
      const result = applyIntent(r, { kind: "gameStart", playerId: "p1" });
      expect(result).toEqual({ ok: false, code: "not_enough_players", message: expect.any(String) });
    });

    it("rejects when game already started", () => {
      let r = withTwoSeated();
      r = applyEvent(r, { kind: "gameStarted" });
      const result = applyIntent(r, { kind: "gameStart", playerId: "p1" });
      expect(result).toEqual({ ok: false, code: "already_started", message: expect.any(String) });
    });
  });

  describe("applyIntent chatSend", () => {
    function inRoom() {
      let r = createRoom("R1");
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      return r;
    }

    it("appends a chat message and emits delta", () => {
      const r = inRoom();
      const result = applyIntent(r, {
        kind: "chatSend",
        playerId: "p1",
        text: "hello",
        chatId: "c1",
        ts: 1234,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state.chat).toHaveLength(1);
      expect(result.state.chat[0]).toEqual({
        id: "c1",
        playerId: "p1",
        displayName: "Alice",
        text: "hello",
        ts: 1234,
      });
      expect(result.delta).toEqual({ kind: "chat", message: result.state.chat[0] });
    });

    it("rejects empty text", () => {
      const r = inRoom();
      const result = applyIntent(r, {
        kind: "chatSend",
        playerId: "p1",
        text: "   ",
        chatId: "c1",
        ts: 1,
      });
      expect(result).toEqual({ ok: false, code: "empty_chat", message: expect.any(String) });
    });

    it("rejects text over 500 chars", () => {
      const r = inRoom();
      const result = applyIntent(r, {
        kind: "chatSend",
        playerId: "p1",
        text: "x".repeat(501),
        chatId: "c1",
        ts: 1,
      });
      expect(result).toEqual({ ok: false, code: "chat_too_long", message: expect.any(String) });
    });

    it("rejects when player not in room", () => {
      const r = inRoom();
      const result = applyIntent(r, {
        kind: "chatSend",
        playerId: "ghost",
        text: "hi",
        chatId: "c1",
        ts: 1,
      });
      expect(result).toEqual({ ok: false, code: "not_in_room", message: expect.any(String) });
    });

    it("evicts oldest message past chat limit", () => {
      const small = createRoom("R1", { maxSeats: 8, minBuyIn: 100, maxBuyIn: 500, chatLimit: 3 });
      let r = applyEvent(small, {
        kind: "playerJoined",
        player: { id: "p1", displayName: "Alice" },
      });
      for (let i = 0; i < 5; i++) {
        const out = applyIntent(r, {
          kind: "chatSend",
          playerId: "p1",
          text: `m${i}`,
          chatId: `c${i}`,
          ts: i,
        });
        if (out.ok) r = out.state;
      }
      expect(r.chat).toHaveLength(3);
      expect(r.chat.map((m) => m.text)).toEqual(["m2", "m3", "m4"]);
    });
  });

  describe("immutability", () => {
    it("applyEvent does not mutate input", () => {
      const r0 = createRoom("R1");
      const before = JSON.stringify(toSnapshot(r0));
      applyEvent(r0, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      expect(JSON.stringify(toSnapshot(r0))).toBe(before);
    });

    it("applyIntent does not mutate input", () => {
      let r = createRoom("R1");
      r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
      const before = JSON.stringify(toSnapshot(r));
      applyIntent(r, { kind: "seatTake", playerId: "p1", seatIndex: 0, buyIn: 200 });
      expect(JSON.stringify(toSnapshot(r))).toBe(before);
    });
  });
});
