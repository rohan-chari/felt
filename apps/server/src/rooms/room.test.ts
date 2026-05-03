import { describe, expect, it } from "vitest";
import { applyEvent, createRoom, toSnapshot } from "./room.js";

describe("room (pure)", () => {
  it("creates an empty room", () => {
    const room = createRoom("R1");
    expect(room.roomId).toBe("R1");
    expect(room.players.size).toBe(0);
  });

  it("adds a player on playerJoined", () => {
    const r0 = createRoom("R1");
    const r1 = applyEvent(r0, {
      kind: "playerJoined",
      player: { id: "p1", displayName: "Alice" },
    });
    expect(r1.players.size).toBe(1);
    expect(r1.players.get("p1")).toEqual({ id: "p1", displayName: "Alice" });
  });

  it("does not mutate the input state", () => {
    const r0 = createRoom("R1");
    applyEvent(r0, {
      kind: "playerJoined",
      player: { id: "p1", displayName: "Alice" },
    });
    expect(r0.players.size).toBe(0);
  });

  it("replaces a player when the same id rejoins (e.g. name change)", () => {
    let r = createRoom("R1");
    r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
    r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alicia" } });
    expect(r.players.size).toBe(1);
    expect(r.players.get("p1")?.displayName).toBe("Alicia");
  });

  it("removes a player on playerLeft", () => {
    let r = createRoom("R1");
    r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
    r = applyEvent(r, { kind: "playerJoined", player: { id: "p2", displayName: "Bob" } });
    r = applyEvent(r, { kind: "playerLeft", playerId: "p1" });
    expect(r.players.size).toBe(1);
    expect(r.players.has("p1")).toBe(false);
    expect(r.players.has("p2")).toBe(true);
  });

  it("playerLeft is idempotent for unknown ids", () => {
    const r0 = createRoom("R1");
    const r1 = applyEvent(r0, { kind: "playerLeft", playerId: "ghost" });
    expect(r1.players.size).toBe(0);
  });

  it("toSnapshot returns serializable shape with sorted players", () => {
    let r = createRoom("R1");
    r = applyEvent(r, { kind: "playerJoined", player: { id: "p2", displayName: "Bob" } });
    r = applyEvent(r, { kind: "playerJoined", player: { id: "p1", displayName: "Alice" } });
    const snap = toSnapshot(r);
    expect(snap).toEqual({
      roomId: "R1",
      players: [
        { id: "p1", displayName: "Alice" },
        { id: "p2", displayName: "Bob" },
      ],
    });
  });
});
