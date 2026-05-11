import { DEFAULT_ROOM_CONFIG, type ServerMessage } from "@felt/shared";
import { describe, expect, it } from "vitest";
import { applyServerMessage, initialRoomViewState } from "./state";

const testConfig = { ...DEFAULT_ROOM_CONFIG, maxBuyIn: 500 };

const baseSnapshot = {
  type: "room.snapshot" as const,
  snapshot: {
    roomId: "R1",
    hostId: "p1",
    players: [{ id: "p1", displayName: "Alice" }],
    seats: Array.from({ length: 8 }, (_, index) => ({ kind: "empty" as const, index })),
    gameStarted: false,
    chat: [],
    config: testConfig,
    hand: null,
    nextHandAt: null,
    buyIns: [],
    paused: false,
    ended: false,
  },
};

describe("applyServerMessage", () => {
  it("snapshot transitions from connecting to joined and copies all fields", () => {
    const next = applyServerMessage(initialRoomViewState, baseSnapshot);
    expect(next.status).toBe("joined");
    expect(next.roomId).toBe("R1");
    expect(next.hostId).toBe("p1");
    expect(next.seats).toHaveLength(8);
    expect(next.gameStarted).toBe(false);
    expect(next.chat).toEqual([]);
    expect(next.config).toEqual(testConfig);
  });

  it("playerJoined delta appends and keeps sorted by id", () => {
    const s0 = applyServerMessage(initialRoomViewState, baseSnapshot);
    const s1 = applyServerMessage(s0, {
      type: "room.delta",
      roomId: "R1",
      delta: { kind: "playerJoined", player: { id: "p0", displayName: "Aaron" } },
    });
    expect(s1.players.map((p) => p.id)).toEqual(["p0", "p1"]);
  });

  it("playerLeft removes the player", () => {
    const s0 = applyServerMessage(initialRoomViewState, baseSnapshot);
    const s1 = applyServerMessage(s0, {
      type: "room.delta",
      roomId: "R1",
      delta: { kind: "playerLeft", playerId: "p1" },
    });
    expect(s1.players).toEqual([]);
  });

  it("seatTaken updates the seat", () => {
    const s0 = applyServerMessage(initialRoomViewState, baseSnapshot);
    const s1 = applyServerMessage(s0, {
      type: "room.delta",
      roomId: "R1",
      delta: { kind: "seatTaken", seatIndex: 3, playerId: "p1", stack: 200 },
    });
    expect(s1.seats[3]).toEqual({
      kind: "taken",
      index: 3,
      playerId: "p1",
      stack: 200,
      busted: false,
    });
  });

  it("seatLeft empties the seat", () => {
    const populated = {
      ...baseSnapshot,
      snapshot: {
        ...baseSnapshot.snapshot,
        seats: baseSnapshot.snapshot.seats.map((s) =>
          s.index === 2
            ? { kind: "taken" as const, index: 2, playerId: "p1", stack: 200, busted: false }
            : s,
        ),
      },
    };
    const s0 = applyServerMessage(initialRoomViewState, populated);
    const s1 = applyServerMessage(s0, {
      type: "room.delta",
      roomId: "R1",
      delta: { kind: "seatLeft", seatIndex: 2, playerId: "p1" },
    });
    expect(s1.seats[2]).toEqual({ kind: "empty", index: 2 });
  });

  it("gameStarted flips the flag", () => {
    const s0 = applyServerMessage(initialRoomViewState, baseSnapshot);
    const s1 = applyServerMessage(s0, {
      type: "room.delta",
      roomId: "R1",
      delta: { kind: "gameStarted" },
    });
    expect(s1.gameStarted).toBe(true);
  });

  it("chat delta appends to chat array", () => {
    const s0 = applyServerMessage(initialRoomViewState, baseSnapshot);
    const s1 = applyServerMessage(s0, {
      type: "room.delta",
      roomId: "R1",
      delta: {
        kind: "chat",
        message: { id: "c1", playerId: "p1", displayName: "Alice", text: "hi", ts: 1 },
      },
    });
    expect(s1.chat).toHaveLength(1);
    expect(s1.chat[0]?.text).toBe("hi");
  });

  it("hostChanged updates hostId", () => {
    const s0 = applyServerMessage(initialRoomViewState, baseSnapshot);
    const s1 = applyServerMessage(s0, {
      type: "room.delta",
      roomId: "R1",
      delta: { kind: "hostChanged", hostId: "p2" },
    });
    expect(s1.hostId).toBe("p2");
  });

  it("error before joined is fatal: sets status=error and stores a friendly message", () => {
    const next = applyServerMessage(initialRoomViewState, {
      type: "error",
      code: "room_not_found",
      message: "Room ABC123 does not exist",
    });
    expect(next.status).toBe("error");
    expect(next.error).toMatch(/Room not found/i);
    expect(next.transientError).toBeNull();
  });

  it("error after joined is transient: sets transientError, leaves status=joined", () => {
    const s0 = applyServerMessage(initialRoomViewState, baseSnapshot);
    expect(s0.status).toBe("joined");
    const s1 = applyServerMessage(s0, {
      type: "error",
      code: "seat_taken",
      message: "Seat 3 is taken",
    });
    expect(s1.status).toBe("joined");
    expect(s1.transientError).not.toBeNull();
    expect(s1.transientError?.code).toBe("seat_taken");
    expect(s1.transientError?.message).toMatch(/just taken/i);
    expect(s1.transientError?.seq).toBe(1);
  });

  it("transient errors increment seq so the toast re-fires on repeats", () => {
    const s0 = applyServerMessage(initialRoomViewState, baseSnapshot);
    const s1 = applyServerMessage(s0, {
      type: "error",
      code: "seat_taken",
      message: "x",
    });
    const s2 = applyServerMessage(s1, {
      type: "error",
      code: "seat_taken",
      message: "x",
    });
    expect(s1.transientError?.seq).toBe(1);
    expect(s2.transientError?.seq).toBe(2);
  });

  it("hand.snapshot delta replaces hand", () => {
    const s0 = applyServerMessage(initialRoomViewState, baseSnapshot);
    const handView = {
      handId: "h1",
      street: "preflop" as const,
      board: [],
      seats: [
        {
          playerId: "p1",
          stack: 198,
          committedThisRound: 2,
          totalCommitted: 2,
          isFolded: false,
          isAllIn: false,
          holeCards: null,
          timeBankUsed: false,
          sittingOut: false,
        },
      ],
      currentPlayerId: "p1",
      toMatch: 2,
      lastRaiseSize: 2,
      result: null,
      dealerSeatIdx: 0,
      sbSeatIdx: 0,
      bbSeatIdx: 1,
      currentTurnDeadline: null,
      seedHash: "0".repeat(64),
      revealedSeed: null,
      pots: [],
    };
    const s1 = applyServerMessage(s0, {
      type: "room.delta",
      roomId: "R1",
      delta: { kind: "hand.snapshot", hand: handView },
    });
    expect(s1.hand).toEqual(handView);
  });

  it("hand.holeCards stores private cards keyed by handId", () => {
    const s1 = applyServerMessage(initialRoomViewState, {
      type: "hand.holeCards",
      handId: "h1",
      cards: ["Ah", "Kd"],
    });
    expect(s1.myHoleCards).toEqual({ handId: "h1", cards: ["Ah", "Kd"] });
  });

  it("room.snapshot preserves myHoleCards across reconnect", () => {
    const withCards = applyServerMessage(initialRoomViewState, {
      type: "hand.holeCards",
      handId: "h1",
      cards: ["As", "Kc"],
    });
    const after = applyServerMessage(withCards, baseSnapshot);
    expect(after.myHoleCards).toEqual({ handId: "h1", cards: ["As", "Kc"] });
  });

  it("does not mutate the input state", () => {
    const s0 = applyServerMessage(initialRoomViewState, baseSnapshot);
    const before = JSON.stringify(s0);
    const msg: ServerMessage = {
      type: "room.delta",
      roomId: "R1",
      delta: { kind: "seatTaken", seatIndex: 0, playerId: "p1", stack: 200 },
    };
    applyServerMessage(s0, msg);
    expect(JSON.stringify(s0)).toBe(before);
  });
});
