import {
  applyAction,
  calculatePots,
  type HandState,
  startHand,
  type StartHandOptions,
} from "@felt/engine";
import type { Action, HandPotView, HandResultView, HandSeatView, HandView } from "@felt/shared";
import type { RoomState } from "./room.js";

export function toHandView(state: HandState): HandView {
  const reveal = state.street === "complete";
  const seats: HandSeatView[] = state.seats.map((s) => ({
    playerId: s.playerId,
    stack: s.stack,
    committedThisRound: s.committedThisRound,
    totalCommitted: s.totalCommitted,
    isFolded: s.isFolded,
    isAllIn: s.isAllIn,
    holeCards: reveal && !s.isFolded && s.holeCards ? s.holeCards : null,
  }));

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

export { applyAction, startHand, type HandState, type Action };
