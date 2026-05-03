import type { ServerMessage } from "@felt/shared";
import { describe, expect, it } from "vitest";
import { applyServerMessage, initialRoomViewState } from "./state";

describe("applyServerMessage", () => {
  it("snapshot transitions from connecting to joined", () => {
    const msg: ServerMessage = {
      type: "room.snapshot",
      snapshot: { roomId: "R1", players: [{ id: "p1", displayName: "Alice" }] },
    };
    const next = applyServerMessage(initialRoomViewState, msg);
    expect(next).toEqual({
      status: "joined",
      roomId: "R1",
      players: [{ id: "p1", displayName: "Alice" }],
      error: null,
    });
  });

  it("playerJoined delta appends and keeps sorted by id", () => {
    const s0 = applyServerMessage(initialRoomViewState, {
      type: "room.snapshot",
      snapshot: { roomId: "R1", players: [{ id: "p2", displayName: "Bob" }] },
    });
    const s1 = applyServerMessage(s0, {
      type: "room.delta",
      roomId: "R1",
      delta: { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } },
    });
    expect(s1.players).toEqual([
      { id: "p1", displayName: "Alice" },
      { id: "p2", displayName: "Bob" },
    ]);
  });

  it("playerJoined for an existing id replaces the entry (no duplicate)", () => {
    const s0 = applyServerMessage(initialRoomViewState, {
      type: "room.snapshot",
      snapshot: { roomId: "R1", players: [{ id: "p1", displayName: "Alice" }] },
    });
    const s1 = applyServerMessage(s0, {
      type: "room.delta",
      roomId: "R1",
      delta: { kind: "playerJoined", player: { id: "p1", displayName: "Alicia" } },
    });
    expect(s1.players).toEqual([{ id: "p1", displayName: "Alicia" }]);
  });

  it("playerLeft removes the player", () => {
    const s0 = applyServerMessage(initialRoomViewState, {
      type: "room.snapshot",
      snapshot: {
        roomId: "R1",
        players: [
          { id: "p1", displayName: "Alice" },
          { id: "p2", displayName: "Bob" },
        ],
      },
    });
    const s1 = applyServerMessage(s0, {
      type: "room.delta",
      roomId: "R1",
      delta: { kind: "playerLeft", playerId: "p1" },
    });
    expect(s1.players).toEqual([{ id: "p2", displayName: "Bob" }]);
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
    const s0 = applyServerMessage(initialRoomViewState, {
      type: "room.snapshot",
      snapshot: { roomId: "R1", players: [{ id: "p1", displayName: "Alice" }] },
    });
    const before = JSON.stringify(s0);
    applyServerMessage(s0, {
      type: "room.delta",
      roomId: "R1",
      delta: { kind: "playerLeft", playerId: "p1" },
    });
    expect(JSON.stringify(s0)).toBe(before);
  });
});
