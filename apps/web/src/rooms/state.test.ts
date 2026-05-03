import type { ServerMessage } from "@felt/shared";
import { describe, expect, it } from "vitest";
import { applyServerMessage, initialRoomViewState } from "./state";

const baseSnapshot = {
  type: "room.snapshot" as const,
  snapshot: {
    roomId: "R1",
    hostId: "p1",
    players: [{ id: "p1", displayName: "Alice" }],
    seats: Array.from({ length: 8 }, (_, index) => ({ kind: "empty" as const, index })),
    gameStarted: false,
    chat: [],
    config: { maxSeats: 8, minBuyIn: 100, maxBuyIn: 500 },
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
    expect(next.config).toEqual({ maxSeats: 8, minBuyIn: 100, maxBuyIn: 500 });
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
    expect(s1.seats[3]).toEqual({ kind: "taken", index: 3, playerId: "p1", stack: 200 });
  });

  it("seatLeft empties the seat", () => {
    const populated = {
      ...baseSnapshot,
      snapshot: {
        ...baseSnapshot.snapshot,
        seats: baseSnapshot.snapshot.seats.map((s) =>
          s.index === 2 ? { kind: "taken" as const, index: 2, playerId: "p1", stack: 200 } : s,
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

  it("error message sets status=error and stores message", () => {
    const next = applyServerMessage(initialRoomViewState, {
      type: "error",
      code: "room_not_found",
      message: "Room ABC123 does not exist",
    });
    expect(next.status).toBe("error");
    expect(next.error).toBe("Room ABC123 does not exist");
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
