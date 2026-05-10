import { startHand } from "@felt/engine";
import type { HandRecord } from "@felt/shared";
import { describe, expect, it } from "vitest";
import { createRoom } from "../rooms/room.js";
import type { Persistence, RoomSnapshotBlob } from "./types.js";

function sampleHandRecord(roomId: string, handId: string, completedAt: number): HandRecord {
  return {
    handId,
    roomId,
    completedAt,
    seed: "seed-xyz",
    seedHash: "deadbeef".repeat(8),
    blinds: { sb: 1, bb: 2 },
    dealerSeatIdx: 0,
    seats: [
      {
        seatIdx: 0,
        playerId: "p1",
        displayName: "Alice",
        startingStack: 200,
        holeCards: ["Ah", "Kd"],
        isFolded: false,
      },
      {
        seatIdx: 1,
        playerId: "p2",
        displayName: "Bob",
        startingStack: 200,
        holeCards: ["Qs", "Js"],
        isFolded: true,
      },
    ],
    board: ["2c", "5d", "9h"],
    actionLog: [
      { kind: "act", seatIdx: 0, action: { kind: "call" } },
      { kind: "act", seatIdx: 1, action: { kind: "fold" } },
    ],
    result: {
      awards: [
        {
          amount: 4,
          winners: [
            {
              playerId: "p1",
              amount: 4,
              handName: "(uncontested)",
              handDescr: "Won by fold",
            },
          ],
        },
      ],
      finalStacks: [
        { playerId: "p1", stack: 202 },
        { playerId: "p2", stack: 198 },
      ],
    },
  };
}

function sampleBlob(roomId: string): RoomSnapshotBlob {
  const room = createRoom(roomId);
  room.players.set("p1", { id: "p1", displayName: "Alice" });
  room.players.set("p2", { id: "p2", displayName: "Bob" });
  room.seats[0] = { kind: "taken", index: 0, playerId: "p1", stack: 200, busted: false };
  room.seats[1] = { kind: "taken", index: 1, playerId: "p2", stack: 200, busted: false };
  room.gameStarted = true;
  room.hostId = "p1";
  room.chat.push({ id: "c1", playerId: "p1", displayName: "Alice", text: "hi", ts: 1 });

  const { state: hand } = startHand({
    handId: "h1",
    seats: [
      { playerId: "p1", stack: 200 },
      { playerId: "p2", stack: 200 },
    ],
    dealerIdx: 0,
    blinds: { sb: 1, bb: 2 },
    seed: "seed-1",
  });

  return {
    version: 1,
    room,
    hand,
    currentTurnDeadline: 1_700_000_000_000,
    preActions: [
      ["p2", { kind: "checkFold" }],
    ],
  };
}

/**
 * Run the persistence contract against any implementation. The factory is async
 * so the postgres impl can spin up a container. The teardown lets it clean up.
 */
export function runPersistenceContract(
  name: string,
  factory: () => Promise<{ persistence: Persistence; teardown: () => Promise<void> }>,
): void {
  describe(`Persistence contract: ${name}`, () => {
    it("save then load round-trips the room state, hand, deadline, and pre-actions", async () => {
      const { persistence, teardown } = await factory();
      try {
        const blob = sampleBlob("ROOM-A");
        await persistence.saveSnapshot("ROOM-A", blob);
        const loaded = await persistence.loadSnapshot("ROOM-A");

        expect(loaded).not.toBeNull();
        if (!loaded) return;
        expect(loaded.version).toBe(1);
        expect(loaded.room.roomId).toBe("ROOM-A");
        expect(loaded.room.players.get("p1")).toEqual({ id: "p1", displayName: "Alice" });
        expect(loaded.room.players.get("p2")).toEqual({ id: "p2", displayName: "Bob" });
        expect(loaded.room.seats[0]).toEqual(blob.room.seats[0]);
        expect(loaded.room.gameStarted).toBe(true);
        expect(loaded.room.chat).toEqual(blob.room.chat);
        expect(loaded.hand?.handId).toBe("h1");
        expect(loaded.hand?.seats.length).toBe(2);
        expect(loaded.currentTurnDeadline).toBe(1_700_000_000_000);
        expect(loaded.preActions).toEqual([["p2", { kind: "checkFold" }]]);
      } finally {
        await persistence.close();
        await teardown();
      }
    });

    it("loadSnapshot returns null for unknown room", async () => {
      const { persistence, teardown } = await factory();
      try {
        expect(await persistence.loadSnapshot("GHOST")).toBeNull();
      } finally {
        await persistence.close();
        await teardown();
      }
    });

    it("loadAll returns every saved snapshot", async () => {
      const { persistence, teardown } = await factory();
      try {
        await persistence.saveSnapshot("ROOM-A", sampleBlob("ROOM-A"));
        await persistence.saveSnapshot("ROOM-B", sampleBlob("ROOM-B"));
        const all = await persistence.loadAll();
        const ids = all.map((b) => b.room.roomId).sort();
        expect(ids).toEqual(["ROOM-A", "ROOM-B"]);
      } finally {
        await persistence.close();
        await teardown();
      }
    });

    it("saveSnapshot upserts (second save replaces the first)", async () => {
      const { persistence, teardown } = await factory();
      try {
        const first = sampleBlob("ROOM-A");
        await persistence.saveSnapshot("ROOM-A", first);
        const second = sampleBlob("ROOM-A");
        second.room.gameStarted = false;
        second.room.chat = [];
        await persistence.saveSnapshot("ROOM-A", second);
        const loaded = await persistence.loadSnapshot("ROOM-A");
        expect(loaded?.room.gameStarted).toBe(false);
        expect(loaded?.room.chat).toEqual([]);
      } finally {
        await persistence.close();
        await teardown();
      }
    });

    it("deleteSnapshot removes the row", async () => {
      const { persistence, teardown } = await factory();
      try {
        await persistence.saveSnapshot("ROOM-A", sampleBlob("ROOM-A"));
        await persistence.deleteSnapshot("ROOM-A");
        expect(await persistence.loadSnapshot("ROOM-A")).toBeNull();
      } finally {
        await persistence.close();
        await teardown();
      }
    });

    it("saveHand + listHandsByRoom round-trips a complete hand record", async () => {
      const { persistence, teardown } = await factory();
      try {
        const rec = sampleHandRecord("ROOM-A", "hand-1", 1_700_000_000_000);
        await persistence.saveHand(rec);
        const list = await persistence.listHandsByRoom("ROOM-A");
        expect(list).toHaveLength(1);
        const got = list[0];
        expect(got).toBeDefined();
        if (!got) return;
        expect(got.handId).toBe("hand-1");
        expect(got.seed).toBe(rec.seed);
        expect(got.seedHash).toBe(rec.seedHash);
        expect(got.board).toEqual(rec.board);
        expect(got.actionLog).toEqual(rec.actionLog);
        expect(got.seats[0]?.holeCards).toEqual(["Ah", "Kd"]);
        expect(got.result.awards[0]?.winners[0]?.playerId).toBe("p1");
      } finally {
        await persistence.close();
        await teardown();
      }
    });

    it("listHandsByRoom returns hands ordered oldest-first and scoped to the room", async () => {
      const { persistence, teardown } = await factory();
      try {
        await persistence.saveHand(sampleHandRecord("ROOM-A", "h1", 1_000));
        await persistence.saveHand(sampleHandRecord("ROOM-A", "h3", 3_000));
        await persistence.saveHand(sampleHandRecord("ROOM-A", "h2", 2_000));
        await persistence.saveHand(sampleHandRecord("ROOM-B", "h-other", 1_500));

        const a = await persistence.listHandsByRoom("ROOM-A");
        expect(a.map((r) => r.handId)).toEqual(["h1", "h2", "h3"]);
        const b = await persistence.listHandsByRoom("ROOM-B");
        expect(b.map((r) => r.handId)).toEqual(["h-other"]);
      } finally {
        await persistence.close();
        await teardown();
      }
    });
  });
}
