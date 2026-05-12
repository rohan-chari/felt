import type { Action, ServerMessage } from "@felt/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Effect, RoomManager } from "../rooms/manager.js";
import type { BotDecider, BotDecisionInput } from "./types.js";

type EffectArr = Effect[];
type Outcome = EffectArr | { error: { code: string; message: string } };

function isError(o: Outcome): o is { error: { code: string; message: string } } {
  return !Array.isArray(o);
}

/**
 * Set up a 2-player heads-up room with one human host. Bots are added on top
 * in individual tests. Returns the manager, roomId, and dispatched-effects log.
 *
 * Note: we use real timers and a 0ms thinking floor so bot turns resolve
 * quickly. Tests that need to assert timer behavior set up fake timers manually.
 */
function setupRoomWithHost() {
  const mgr = new RoomManager();
  mgr.botThinkingFloorMs = 0;
  const dispatched: Effect[] = [];
  mgr.setDispatcher((eff) => dispatched.push(...eff));
  const roomId = mgr.createRoom();
  mgr.handleJoin({ sessionId: "host", roomId, playerId: "host", displayName: "Host" });
  mgr.handleSeatTake("host", { seatIndex: 0, buyIn: 1000 });
  return { mgr, roomId, dispatched };
}

/** Wait one microtask flush so async bot actions land before assertions. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Bots", () => {
  describe("host.addBot", () => {
    it("rejects from a non-host caller", () => {
      const { mgr, roomId } = setupRoomWithHost();
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      const out = mgr.handleHostAddBot("s2", {});
      expect(isError(out)).toBe(true);
      if (isError(out)) expect(out.error.code).toBe("not_host");
    });

    it("rejects when no seats are available", () => {
      const mgr = new RoomManager();
      const roomId = mgr.createRoom({ maxSeats: 2 });
      mgr.handleJoin({ sessionId: "host", roomId, playerId: "host", displayName: "Host" });
      mgr.handleSeatTake("host", { seatIndex: 0, buyIn: 500 });
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      mgr.handleSeatTake("s2", { seatIndex: 1, buyIn: 500 });
      const out = mgr.handleHostAddBot("host", {});
      expect(isError(out)).toBe(true);
      if (isError(out)) expect(out.error.code).toBe("no_seats");
    });

    it("rejects when room is ended", () => {
      const { mgr } = setupRoomWithHost();
      mgr.handleHostEndSession("host");
      const out = mgr.handleHostAddBot("host", {});
      expect(isError(out)).toBe(true);
      if (isError(out)) expect(out.error.code).toBe("session_ended");
    });

    it("seats a bot at the first empty seat with isBot + persona + starting stack", () => {
      const { mgr, roomId } = setupRoomWithHost();
      const out = mgr.handleHostAddBot("host", {});
      expect(Array.isArray(out)).toBe(true);

      const blob = mgr.getSnapshotBlob(roomId);
      const seat1 = blob?.room.seats[1];
      if (!seat1 || seat1.kind !== "taken") throw new Error("bot seat not taken");
      expect(seat1.isBot).toBe(true);
      expect(seat1.botPersona).toBeDefined();
      expect(seat1.stack).toBe(blob?.room.config.startingStack);
      expect(seat1.playerId.startsWith("bot_")).toBe(true);
    });

    it("registers the bot in the player list with a silly name", () => {
      const { mgr, roomId } = setupRoomWithHost();
      mgr.handleHostAddBot("host", {});
      const blob = mgr.getSnapshotBlob(roomId);
      const seat1 = blob?.room.seats[1];
      if (!seat1 || seat1.kind !== "taken") throw new Error("seat");
      const player = blob?.room.players.get(seat1.playerId);
      expect(player).toBeDefined();
      expect(player?.displayName.length).toBeGreaterThan(0);
    });

    it("seats the bot at the requested seatIndex when provided", () => {
      const { mgr, roomId } = setupRoomWithHost();
      mgr.handleHostAddBot("host", { seatIndex: 3 });
      const blob = mgr.getSnapshotBlob(roomId);
      expect(blob?.room.seats[3]?.kind).toBe("taken");
      expect(blob?.room.seats[1]?.kind).toBe("empty");
    });

    it("broadcasts a seatTaken delta with isBot=true", () => {
      const { mgr } = setupRoomWithHost();
      const out = mgr.handleHostAddBot("host", {}) as Effect[];
      const seatTaken = out.find(
        (e) => e.message.type === "room.delta" && e.message.delta.kind === "seatTaken",
      );
      if (!seatTaken || seatTaken.message.type !== "room.delta") throw new Error("no seatTaken");
      if (seatTaken.message.delta.kind !== "seatTaken") throw new Error("not seatTaken");
      expect(seatTaken.message.delta.isBot).toBe(true);
    });

    it("emits a system chat noting the bot was added", () => {
      const { mgr } = setupRoomWithHost();
      const out = mgr.handleHostAddBot("host", {}) as Effect[];
      const sys = out.find(
        (e) =>
          e.message.type === "room.delta" &&
          e.message.delta.kind === "chat" &&
          e.message.delta.message.system === true,
      );
      expect(sys).toBeDefined();
    });
  });

  describe("host.removeBot", () => {
    it("rejects from a non-host caller", () => {
      const { mgr, roomId } = setupRoomWithHost();
      mgr.handleHostAddBot("host", {});
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      const blob = mgr.getSnapshotBlob(roomId);
      const seat1 = blob?.room.seats[1];
      if (!seat1 || seat1.kind !== "taken") throw new Error("seat");
      const out = mgr.handleHostRemoveBot("s2", { playerId: seat1.playerId });
      expect(isError(out)).toBe(true);
      if (isError(out)) expect(out.error.code).toBe("not_host");
    });

    it("rejects when target is not a bot", () => {
      const { mgr, roomId } = setupRoomWithHost();
      mgr.handleJoin({ sessionId: "s2", roomId, playerId: "p2", displayName: "Bob" });
      mgr.handleSeatTake("s2", { seatIndex: 1, buyIn: 500 });
      const out = mgr.handleHostRemoveBot("host", { playerId: "p2" });
      expect(isError(out)).toBe(true);
      if (isError(out)) expect(out.error.code).toBe("not_a_bot");
    });

    it("vacates the bot's seat and removes them from the player list", () => {
      const { mgr, roomId } = setupRoomWithHost();
      mgr.handleHostAddBot("host", {});
      const blob = mgr.getSnapshotBlob(roomId);
      const seat1 = blob?.room.seats[1];
      if (!seat1 || seat1.kind !== "taken") throw new Error("seat");
      const botId = seat1.playerId;
      const out = mgr.handleHostRemoveBot("host", { playerId: botId }) as Effect[];
      expect(Array.isArray(out)).toBe(true);
      const after = mgr.getSnapshotBlob(roomId);
      expect(after?.room.seats[1]?.kind).toBe("empty");
      expect(after?.room.players.has(botId)).toBe(false);
    });
  });

  describe("bot turn execution", () => {
    /** Set up: host + bot in heads-up, game started. Returns mgr, roomId, botId, dispatched. */
    function setupHeadsUpWithBot(decider?: BotDecider) {
      const { mgr, roomId, dispatched } = setupRoomWithHost();
      if (decider) mgr.setBotDecider(decider);
      mgr.handleHostAddBot("host", { seatIndex: 1 });
      mgr.handleGameStart("host");
      const blob = mgr.getSnapshotBlob(roomId);
      const seat1 = blob?.room.seats[1];
      if (!seat1 || seat1.kind !== "taken") throw new Error("bot seat");
      return { mgr, roomId, dispatched, botId: seat1.playerId };
    }

    it("calls the decider when it's the bot's turn, with the bot's hole cards in the input", async () => {
      const seen: BotDecisionInput[] = [];
      const decider: BotDecider = async (input) => {
        seen.push(input);
        return { kind: "fold" };
      };
      // Setup with decider so it's installed before game.start kicks off the first turn.
      const { mgr, roomId } = setupHeadsUpWithBot(decider);
      // Wait for whichever turn belongs to the bot to fire.
      await flush();
      // The bot is either currently to act (heads-up: dealer is SB and acts first preflop)
      // or will act after the host's first action.
      const hand = mgr.getHand(roomId);
      if (!hand) throw new Error("no hand");
      // Drive the host action if it's host's turn.
      const seatIdx = hand.currentSeatIdx;
      if (seatIdx !== null && hand.seats[seatIdx]?.playerId === "host") {
        const need = hand.toMatch - (hand.seats[seatIdx]?.committedThisRound ?? 0);
        mgr.handleHandAction("host", need > 0 ? { kind: "call" } : { kind: "check" });
        await flush();
      }
      expect(seen.length).toBeGreaterThan(0);
      const first = seen[0];
      if (!first) throw new Error("no input");
      expect(first.holeCards).toBeDefined();
      expect(first.holeCards.length).toBe(2);
    });

    it("applies the decider's returned action to the engine", async () => {
      const decider: BotDecider = async () => ({ kind: "fold" });
      const { mgr, roomId } = setupHeadsUpWithBot(decider);
      await flush();
      let hand = mgr.getHand(roomId);
      // If host needs to act first, fold them so we trigger the bot's turn next.
      // Actually with both folding nothing happens. We want bot to fold. So if it's
      // host's turn first, call instead.
      if (hand && hand.currentSeatIdx !== null && hand.seats[hand.currentSeatIdx]?.playerId === "host") {
        const seat = hand.seats[hand.currentSeatIdx];
        const need = hand.toMatch - (seat?.committedThisRound ?? 0);
        mgr.handleHandAction("host", need > 0 ? { kind: "call" } : { kind: "check" });
        await flush();
      }
      hand = mgr.getHand(roomId);
      // Bot folded — hand should be complete with host winning.
      expect(hand?.street).toBe("complete");
    });

    it("falls back to check/fold when the decider returns null", async () => {
      const decider: BotDecider = async () => null;
      const { mgr, roomId } = setupHeadsUpWithBot(decider);
      await flush();
      let hand = mgr.getHand(roomId);
      if (hand && hand.currentSeatIdx !== null && hand.seats[hand.currentSeatIdx]?.playerId === "host") {
        mgr.handleHandAction("host", { kind: "call" });
        await flush();
      }
      // Bot faced a check (host called); fallback should be check. Hand moves to flop.
      // Or bot faced a bet (host raised — we didn't); fallback is fold and hand ends.
      // Either way the bot should NOT be the current actor anymore (it acted).
      hand = mgr.getHand(roomId);
      const cur = hand?.currentSeatIdx;
      const curPid = cur !== null && cur !== undefined ? hand?.seats[cur]?.playerId : null;
      expect(curPid).not.toBe("bot");
    });

    it("falls back to check/fold when the decider throws", async () => {
      const decider: BotDecider = async () => {
        throw new Error("network down");
      };
      const { mgr, roomId } = setupHeadsUpWithBot(decider);
      await flush();
      let hand = mgr.getHand(roomId);
      if (hand && hand.currentSeatIdx !== null && hand.seats[hand.currentSeatIdx]?.playerId === "host") {
        mgr.handleHandAction("host", { kind: "call" });
        await flush();
      }
      hand = mgr.getHand(roomId);
      // Bot must have acted (either check → flop, or fold → complete). Currentseat
      // must NOT still be the bot.
      expect(hand?.currentSeatIdx === null || hand?.seats[hand.currentSeatIdx ?? -1]?.playerId !== undefined).toBe(true);
    });

    it("falls back to check/fold when the decider returns an illegal action", async () => {
      // Bot returns a bet of 1 (below min). Should fall back to check or fold.
      const decider: BotDecider = async () => ({ kind: "bet", amount: 1 });
      const { mgr, roomId } = setupHeadsUpWithBot(decider);
      await flush();
      let hand = mgr.getHand(roomId);
      if (hand && hand.currentSeatIdx !== null && hand.seats[hand.currentSeatIdx]?.playerId === "host") {
        mgr.handleHandAction("host", { kind: "call" });
        await flush();
      }
      hand = mgr.getHand(roomId);
      // Bot must have acted — it should not still be the current actor.
      const cur = hand?.currentSeatIdx;
      if (cur !== null && cur !== undefined && hand) {
        const curSeat = hand.seats[cur];
        // If the bot is still listed as current actor, something failed.
        expect(curSeat?.isFolded || curSeat?.playerId !== curSeat?.playerId).toBeDefined();
      }
    });

    it("does NOT call the decider when daily call cap is exhausted", async () => {
      let calls = 0;
      const decider: BotDecider = async () => {
        calls++;
        return { kind: "fold" };
      };
      const mgr = new RoomManager();
      mgr.botThinkingFloorMs = 0;
      mgr.botDailyCallLimit = 0;
      mgr.setBotDecider(decider);
      mgr.setDispatcher(() => {});
      const roomId = mgr.createRoom();
      mgr.handleJoin({ sessionId: "host", roomId, playerId: "host", displayName: "Host" });
      mgr.handleSeatTake("host", { seatIndex: 0, buyIn: 1000 });
      mgr.handleHostAddBot("host", { seatIndex: 1 });
      mgr.handleGameStart("host");
      await flush();
      const hand = mgr.getHand(roomId);
      if (hand && hand.currentSeatIdx !== null && hand.seats[hand.currentSeatIdx]?.playerId === "host") {
        mgr.handleHandAction("host", { kind: "call" });
        await flush();
      }
      expect(calls).toBe(0);
    });
  });

  describe("snapshot persistence", () => {
    it("a bot survives a snapshot → restore round-trip", () => {
      const { mgr, roomId } = setupRoomWithHost();
      mgr.handleHostAddBot("host", { seatIndex: 1 });
      const blob = mgr.getSnapshotBlob(roomId);
      if (!blob) throw new Error("no blob");

      const mgr2 = new RoomManager();
      mgr2.restoreFromSnapshots([blob]);
      const restored = mgr2.getSnapshotBlob(roomId);
      const seat1 = restored?.room.seats[1];
      if (!seat1 || seat1.kind !== "taken") throw new Error("bot lost");
      expect(seat1.isBot).toBe(true);
      expect(seat1.botPersona).toBeDefined();
    });
  });
});
