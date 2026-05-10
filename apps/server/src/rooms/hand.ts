import { createHash } from "node:crypto";
import {
  applyAction,
  calculatePots,
  forceFold as engineForceFold,
  type HandState,
  markSittingOut as engineMarkSittingOut,
  startHand,
  type StartHandOptions,
} from "@felt/engine";
import type {
  Action,
  HandPotView,
  HandRecord,
  HandResultView,
  HandSeatView,
  HandView,
  PlayerId,
} from "@felt/shared";
import type { RoomState } from "./room.js";

/** SHA-256 hex digest. Used for provably-fair seed commitments. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function toHandView(
  state: HandState,
  currentTurnDeadline: number | null,
  /**
   * If provided, reveal hole cards for the seat owned by this player at every
   * frame (used by replay for the requester's seat). Other seats remain gated
   * by the standard "complete + not folded" rule.
   */
  revealForPlayer?: PlayerId | null,
): HandView {
  const reveal = state.street === "complete";
  const seats: HandSeatView[] = state.seats.map((s) => {
    const ownedByRequester =
      revealForPlayer != null && s.playerId === revealForPlayer;
    const showCards =
      ownedByRequester || (reveal && !s.isFolded);
    return {
      playerId: s.playerId,
      stack: s.stack,
      committedThisRound: s.committedThisRound,
      totalCommitted: s.totalCommitted,
      isFolded: s.isFolded,
      isAllIn: s.isAllIn,
      holeCards: showCards && s.holeCards ? s.holeCards : null,
      timeBankUsed: s.timeBankUsed,
      sittingOut: s.sittingOut,
    };
  });

  const folded = new Set<number>();
  for (const s of state.seats) if (s.isFolded) folded.add(s.idx);
  const commitments = state.seats.map((s) => s.totalCommitted);
  const enginePots = calculatePots(commitments, folded);
  const pots: HandPotView[] = enginePots.map((p) => ({
    amount: p.amount,
    eligiblePlayerIds: p.eligibleSeats
      .map((idx) => state.seats[idx]?.playerId)
      .filter((id): id is string => typeof id === "string"),
  }));

  const currentPlayerId =
    state.currentSeatIdx === null
      ? null
      : (state.seats[state.currentSeatIdx]?.playerId ?? null);

  let result: HandResultView | null = null;
  if (state.result) {
    result = {
      awards: state.result.awards.map((a) => ({
        amount: a.amount,
        winners: a.winners.map((w) => ({
          playerId: state.seats[w.seatIdx]?.playerId ?? "",
          amount: w.amount,
          handName: w.handName,
          handDescr: w.handDescr,
        })),
      })),
      finalStacks: state.seats.map((s) => ({ playerId: s.playerId, stack: s.stack })),
    };
  }

  // Blind/dealer positions: heads-up = dealer is SB; 3+ = SB is dealer+1, BB is dealer+2.
  const N = state.seats.length;
  const dealerSeatIdx = state.dealerIdx;
  const sbSeatIdx = N === 2 ? dealerSeatIdx : (dealerSeatIdx + 1) % N;
  const bbSeatIdx = N === 2 ? (dealerSeatIdx + 1) % N : (dealerSeatIdx + 2) % N;

  return {
    handId: state.handId,
    street: state.street,
    board: state.board.slice(),
    seats,
    currentPlayerId,
    toMatch: state.toMatch,
    lastRaiseSize: state.lastRaiseSize,
    result,
    dealerSeatIdx,
    sbSeatIdx,
    bbSeatIdx,
    currentTurnDeadline,
    seedHash: sha256Hex(state.seed),
    // Reveal the raw seed only after the hand completes — anyone can then
    // re-derive the deck and audit the shuffle against seedHash.
    revealedSeed: state.street === "complete" ? state.seed : null,
    pots,
  };
}

export type HandSeatMap = {
  playerToSeat: Map<string, number>;
};

export function buildHandFromRoom(
  room: RoomState,
  seed: string,
  dealerIdx: number,
): { startOpts: StartHandOptions; seatMap: HandSeatMap } {
  // Filter taken seats in slot order, mapping to engine seat indexes 0..N-1
  const seatedPlayers: Array<{ playerId: string; stack: number }> = [];
  const playerToSeat = new Map<string, number>();
  for (const seat of room.seats) {
    if (seat.kind === "taken") {
      const engineIdx = seatedPlayers.length;
      seatedPlayers.push({ playerId: seat.playerId, stack: seat.stack });
      playerToSeat.set(seat.playerId, engineIdx);
    }
  }
  // Map dealer from room slot to engine index. If room dealerIdx isn't seated,
  // pick the first seated as dealer for now (Phase 5 will refine rotation).
  let engineDealerIdx = 0;
  // Find the first seated player at-or-after the room's dealerIdx (round-robin)
  for (let step = 0; step < room.seats.length; step++) {
    const slot = (dealerIdx + step) % room.seats.length;
    const seat = room.seats[slot];
    if (seat?.kind === "taken") {
      engineDealerIdx = playerToSeat.get(seat.playerId) ?? 0;
      break;
    }
  }

  const startOpts: StartHandOptions = {
    handId: `${room.roomId}-${Date.now()}`,
    seats: seatedPlayers,
    dealerIdx: engineDealerIdx,
    blinds: { sb: 1, bb: 2 },
    seed,
  };
  return { startOpts, seatMap: { playerToSeat } };
}

/**
 * Reconstruct a frame-by-frame HandView sequence from a persisted HandRecord.
 * One frame per state: the initial dealt hand, then one after each entry in the
 * action log. The requester's own seat reveals hole cards at every frame; other
 * seats reveal only at the final showdown frame (and only if they didn't fold).
 *
 * Throws if the record's seed + actionLog don't replay cleanly under the engine
 * (would indicate a corrupted persisted record). Determinism of replay is
 * already covered by engine/replay.test.ts.
 */
export function replayHand(record: HandRecord, requesterId: PlayerId): HandView[] {
  const seats = [...record.seats]
    .sort((a, b) => a.seatIdx - b.seatIdx)
    .map((s) => ({ playerId: s.playerId, stack: s.startingStack }));

  const { state: initial } = startHand({
    handId: record.handId,
    seats,
    dealerIdx: record.dealerSeatIdx,
    blinds: record.blinds,
    seed: record.seed,
  });

  const frames: HandView[] = [toHandView(initial, null, requesterId)];
  let state: HandState = initial;
  for (const entry of record.actionLog) {
    let result: ReturnType<typeof applyAction>;
    if (entry.kind === "act") {
      result = applyAction(state, entry.seatIdx, entry.action);
    } else if (entry.kind === "forceFold") {
      result = engineForceFold(state, entry.seatIdx);
    } else {
      result = engineMarkSittingOut(state, entry.seatIdx);
    }
    if (!result.ok) {
      throw new Error(
        `replay diverged on entry ${entry.kind}/${entry.seatIdx}: ${result.code}`,
      );
    }
    state = result.state;
    frames.push(toHandView(state, null, requesterId));
  }
  return frames;
}

export { applyAction, startHand, type HandState, type Action };
