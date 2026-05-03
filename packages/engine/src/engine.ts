import { type Card, freshDeck, hashSeed, mulberry32, shuffle } from "./cards.js";
import { winners as evalWinners, evaluate } from "./evaluator.js";
import { calculatePots, type Pot } from "./pots.js";
import type {
  Action,
  ApplyResult,
  Effect,
  HandResult,
  HandState,
  PotAward,
  SeatState,
  StartHandOptions,
  Street,
} from "./types.js";

const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river", "showdown", "complete"];

function cloneSeat(s: SeatState): SeatState {
  return {
    idx: s.idx,
    playerId: s.playerId,
    startingStack: s.startingStack,
    stack: s.stack,
    holeCards: s.holeCards,
    committedThisRound: s.committedThisRound,
    totalCommitted: s.totalCommitted,
    hasActed: s.hasActed,
    isFolded: s.isFolded,
    isAllIn: s.isAllIn,
  };
}

function cloneState(state: HandState): HandState {
  return {
    handId: state.handId,
    seed: state.seed,
    config: state.config,
    street: state.street,
    deck: state.deck.slice(),
    board: state.board.slice(),
    seats: state.seats.map(cloneSeat),
    dealerIdx: state.dealerIdx,
    currentSeatIdx: state.currentSeatIdx,
    toMatch: state.toMatch,
    lastRaiseSize: state.lastRaiseSize,
    result: state.result,
  };
}

function nextActiveSeat(state: HandState, fromIdx: number): number | null {
  const N = state.seats.length;
  for (let step = 1; step <= N; step++) {
    const idx = (fromIdx + step) % N;
    const seat = state.seats[idx];
    if (!seat) continue;
    if (seat.isFolded || seat.isAllIn) continue;
    if (seat.stack <= 0) continue;
    return idx;
  }
  return null;
}

function aliveSeats(state: HandState): SeatState[] {
  return state.seats.filter((s) => !s.isFolded);
}

function actionableSeats(state: HandState): SeatState[] {
  return state.seats.filter((s) => !s.isFolded && !s.isAllIn);
}

function bettingRoundComplete(state: HandState): boolean {
  const alive = aliveSeats(state);
  if (alive.length <= 1) return true;
  const actionable = actionableSeats(state);
  if (actionable.length === 0) return true;
  for (const s of actionable) {
    if (!s.hasActed) return false;
    if (s.committedThisRound !== state.toMatch) return false;
  }
  return true;
}

function postBlind(seat: SeatState, amount: number): { committed: number; allIn: boolean } {
  const pay = Math.min(amount, seat.stack);
  seat.stack -= pay;
  seat.committedThisRound += pay;
  seat.totalCommitted += pay;
  if (seat.stack === 0) seat.isAllIn = true;
  return { committed: pay, allIn: seat.isAllIn };
}

function dealHole(state: HandState): Effect[] {
  // Deal 1 card to each in seat order, twice (standard)
  const N = state.seats.length;
  const cards: Card[][] = state.seats.map(() => []);
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < N; i++) {
      const idx = (state.dealerIdx + 1 + i) % N;
      const card = state.deck.shift();
      if (!card) throw new Error("deck underflow during deal");
      cards[idx]?.push(card);
    }
  }
  const effects: Effect[] = [];
  for (let i = 0; i < N; i++) {
    const c = cards[i];
    const seat = state.seats[i];
    if (!seat || !c || c.length !== 2) continue;
    seat.holeCards = [c[0] as Card, c[1] as Card];
    effects.push({ kind: "holeCardsDealt", seatIdx: i, cards: seat.holeCards });
  }
  return effects;
}

function burnAndDeal(state: HandState, count: number): Card[] {
  // Burn one
  state.deck.shift();
  const out: Card[] = [];
  for (let i = 0; i < count; i++) {
    const c = state.deck.shift();
    if (!c) throw new Error("deck underflow");
    out.push(c);
  }
  return out;
}

function moveBetsIntoTotal(state: HandState): void {
  for (const s of state.seats) {
    s.committedThisRound = 0;
    s.hasActed = false;
  }
  state.toMatch = 0;
  state.lastRaiseSize = state.config.bb;
}

function firstToActPostflop(state: HandState): number | null {
  return nextActiveSeat(state, state.dealerIdx);
}

function dealRemainingCommunityCards(state: HandState): Effect[] {
  // Deal whatever is needed to get to 5 community cards (used when going all-in).
  const effects: Effect[] = [];
  while (state.board.length < 5) {
    const need = state.board.length === 0 ? 3 : 1;
    const cards = burnAndDeal(state, need);
    state.board.push(...cards);
    const street: Street =
      state.board.length === 3 ? "flop" : state.board.length === 4 ? "turn" : "river";
    state.street = street;
    effects.push({ kind: "streetAdvanced", street, cardsDealt: cards, board: state.board.slice() });
  }
  return effects;
}

function awardSinglePotToSole(state: HandState): HandResult {
  // Everyone except one player has folded — that player wins everything.
  const sole = aliveSeats(state)[0];
  if (!sole) throw new Error("no alive seats to award");
  const totalPot = state.seats.reduce((sum, s) => sum + s.totalCommitted, 0);
  sole.stack += totalPot;
  const contributions = new Map<number, number>();
  for (const s of state.seats) {
    if (s.totalCommitted > 0) contributions.set(s.idx, s.totalCommitted);
  }
  const pots: Pot[] = [{ amount: totalPot, eligibleSeats: [sole.idx], contributions }];
  const awards: PotAward[] = [
    {
      amount: totalPot,
      winners: [
        {
          seatIdx: sole.idx,
          amount: totalPot,
          handName: "(uncontested)",
          handDescr: "Won by fold",
        },
      ],
    },
  ];
  return { pots, awards, finalStacks: state.seats.map((s) => s.stack) };
}

function showdown(state: HandState): { result: HandResult; effects: Effect[] } {
  const commitments = state.seats.map((s) => s.totalCommitted);
  const folded = new Set<number>();
  for (const s of state.seats) if (s.isFolded) folded.add(s.idx);
  const pots = calculatePots(commitments, folded);

  const awards: PotAward[] = [];
  // Build hands for non-folded seats once
  const hands = new Map<number, ReturnType<typeof evaluate>>();
  for (const s of state.seats) {
    if (s.isFolded) continue;
    if (!s.holeCards) continue;
    hands.set(s.idx, evaluate([...s.holeCards, ...state.board]));
  }

  for (const pot of pots) {
    const eligible = pot.eligibleSeats.filter((i) => hands.has(i));
    if (eligible.length === 0) {
      // Orphaned pot: refund chips to contributors (per standard poker rule).
      const refundWinners: PotAward["winners"] = [];
      for (const [seatIdx, amount] of pot.contributions) {
        const seat = state.seats[seatIdx];
        if (seat) seat.stack += amount;
        refundWinners.push({
          seatIdx,
          amount,
          handName: "(refund)",
          handDescr: "Uncontested side pot returned",
        });
      }
      awards.push({ amount: pot.amount, winners: refundWinners });
      continue;
    }
    const holes = eligible.map((i) => state.seats[i]?.holeCards);
    if (holes.some((h) => !h)) throw new Error("missing hole cards at showdown");
    const winnerIdxs = evalWinners(
      holes.map((h) => [...(h as readonly [Card, Card])]),
      state.board,
    );
    const winningSeatIdxs = winnerIdxs.map((i) => eligible[i] as number);

    // split as evenly as possible; odd chip goes to first eligible after dealer
    const baseShare = Math.floor(pot.amount / winningSeatIdxs.length);
    let remainder = pot.amount - baseShare * winningSeatIdxs.length;

    // odd-chip distribution order: clockwise from dealer+1
    const N = state.seats.length;
    const distOrder: number[] = [];
    for (let step = 1; step <= N; step++) {
      const idx = (state.dealerIdx + step) % N;
      if (winningSeatIdxs.includes(idx)) distOrder.push(idx);
    }

    const winnerInfo: PotAward["winners"] = distOrder.map((idx) => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      const amount = baseShare + extra;
      const seat = state.seats[idx];
      if (seat) seat.stack += amount;
      const h = hands.get(idx);
      return {
        seatIdx: idx,
        amount,
        handName: h?.name ?? "?",
        handDescr: h?.descr ?? "?",
      };
    });

    awards.push({ amount: pot.amount, winners: winnerInfo });
  }

  const result: HandResult = {
    pots,
    awards,
    finalStacks: state.seats.map((s) => s.stack),
  };

  return { result, effects: [] };
}

function endHand(state: HandState, viaFold: boolean): { effects: Effect[] } {
  const effects: Effect[] = [];
  let result: HandResult;
  if (viaFold) {
    result = awardSinglePotToSole(state);
  } else {
    // Make sure board is complete (for all-in run-out)
    effects.push(...dealRemainingCommunityCards(state));
    const sd = showdown(state);
    result = sd.result;
  }
  state.street = "complete";
  state.currentSeatIdx = null;
  state.result = result;
  effects.push({ kind: "handComplete", result });
  return { effects };
}

function advanceStreet(state: HandState): Effect[] {
  const effects: Effect[] = [];
  const alive = aliveSeats(state);

  if (alive.length === 1) {
    const r = endHand(state, true);
    return [...effects, ...r.effects];
  }

  const remainingActionable = actionableSeats(state).length;
  // If 0 or 1 actionable players (others all-in), run cards out then showdown.
  if (remainingActionable <= 1) {
    moveBetsIntoTotal(state);
    const r = endHand(state, false);
    return [...effects, ...r.effects];
  }

  moveBetsIntoTotal(state);

  const cur = STREET_ORDER.indexOf(state.street);
  const nextStreet = STREET_ORDER[cur + 1];

  if (nextStreet === "showdown") {
    const r = endHand(state, false);
    return [...effects, ...r.effects];
  }

  // Deal next street
  let cards: Card[] = [];
  if (nextStreet === "flop") cards = burnAndDeal(state, 3);
  else if (nextStreet === "turn" || nextStreet === "river") cards = burnAndDeal(state, 1);
  state.board.push(...cards);
  state.street = nextStreet ?? state.street;
  effects.push({
    kind: "streetAdvanced",
    street: state.street,
    cardsDealt: cards,
    board: state.board.slice(),
  });

  // First to act post-flop
  const next = firstToActPostflop(state);
  state.currentSeatIdx = next;
  if (next !== null) effects.push({ kind: "turnChanged", seatIdx: next });
  return effects;
}

function reject(code: string, message: string): ApplyResult {
  return { ok: false, code, message };
}

function validateAndApplyAction(
  state: HandState,
  seatIdx: number,
  action: Action,
): { effects: Effect[]; chipsCommitted: number; isAllIn: boolean } | { error: ApplyResult } {
  const seat = state.seats[seatIdx];
  if (!seat) return { error: reject("bad_seat", "Unknown seat") };
  const need = state.toMatch - seat.committedThisRound;
  const effects: Effect[] = [];

  switch (action.kind) {
    case "fold": {
      seat.isFolded = true;
      seat.hasActed = true;
      return { effects, chipsCommitted: 0, isAllIn: false };
    }
    case "check": {
      if (need !== 0) return { error: reject("cannot_check", "There is a bet to call") };
      seat.hasActed = true;
      return { effects, chipsCommitted: 0, isAllIn: false };
    }
    case "call": {
      if (need <= 0) return { error: reject("cannot_call", "Nothing to call — check instead") };
      const pay = Math.min(need, seat.stack);
      seat.stack -= pay;
      seat.committedThisRound += pay;
      seat.totalCommitted += pay;
      seat.hasActed = true;
      if (seat.stack === 0) seat.isAllIn = true;
      return { effects, chipsCommitted: pay, isAllIn: seat.isAllIn };
    }
    case "bet": {
      if (state.toMatch !== 0) {
        return { error: reject("cannot_bet", "There is already a bet — raise instead") };
      }
      if (action.amount < state.config.bb && action.amount < seat.stack) {
        return {
          error: reject("bet_too_small", `Bet must be at least ${state.config.bb} (or all-in)`),
        };
      }
      if (action.amount > seat.stack) {
        return { error: reject("not_enough_chips", "Bet exceeds your stack") };
      }
      seat.stack -= action.amount;
      seat.committedThisRound += action.amount;
      seat.totalCommitted += action.amount;
      seat.hasActed = true;
      if (seat.stack === 0) seat.isAllIn = true;
      state.toMatch = seat.committedThisRound;
      state.lastRaiseSize = action.amount;
      // Reset hasActed for everyone else still in
      for (const s of state.seats) {
        if (s.idx !== seat.idx && !s.isFolded && !s.isAllIn) s.hasActed = false;
      }
      return { effects, chipsCommitted: action.amount, isAllIn: seat.isAllIn };
    }
    case "raise": {
      if (state.toMatch === 0) {
        return { error: reject("cannot_raise", "No bet to raise — bet instead") };
      }
      if (action.to <= state.toMatch) {
        return { error: reject("raise_too_small", "Raise must exceed current bet") };
      }
      const totalChipsNeeded = action.to - seat.committedThisRound;
      if (totalChipsNeeded > seat.stack) {
        return { error: reject("not_enough_chips", "Raise exceeds your stack") };
      }
      const isAllIn = totalChipsNeeded === seat.stack;
      const raiseSize = action.to - state.toMatch;
      if (raiseSize < state.lastRaiseSize && !isAllIn) {
        return {
          error: reject(
            "raise_below_min",
            `Raise must be at least ${state.toMatch + state.lastRaiseSize} (or all-in)`,
          ),
        };
      }
      seat.stack -= totalChipsNeeded;
      seat.committedThisRound = action.to;
      seat.totalCommitted += totalChipsNeeded;
      seat.hasActed = true;
      if (seat.stack === 0) seat.isAllIn = true;
      const fullRaise = raiseSize >= state.lastRaiseSize;
      const prevToMatch = state.toMatch;
      state.toMatch = action.to;
      if (fullRaise) state.lastRaiseSize = raiseSize;
      // Reopen action: if full raise, every other still-actionable seat must act again.
      // Short all-in raise still increases toMatch but per the simplified rule,
      // we still require everyone matched — effectively reopening to call, not re-raise.
      for (const s of state.seats) {
        if (s.idx !== seat.idx && !s.isFolded && !s.isAllIn) {
          if (fullRaise || s.committedThisRound < state.toMatch) s.hasActed = false;
        }
      }
      return { effects, chipsCommitted: totalChipsNeeded, isAllIn: seat.isAllIn };
    }
  }
}

export function startHand(opts: StartHandOptions): { state: HandState; effects: Effect[] } {
  const N = opts.seats.length;
  if (N < 2) throw new Error("Need at least 2 seats");
  if (opts.dealerIdx < 0 || opts.dealerIdx >= N) throw new Error("Invalid dealerIdx");

  const seats: SeatState[] = opts.seats.map((s, idx) => ({
    idx,
    playerId: s.playerId,
    startingStack: s.stack,
    stack: s.stack,
    holeCards: null,
    committedThisRound: 0,
    totalCommitted: 0,
    hasActed: false,
    isFolded: false,
    isAllIn: false,
  }));

  const deck = shuffle(freshDeck(), mulberry32(hashSeed(opts.seed)));

  const state: HandState = {
    handId: opts.handId,
    seed: opts.seed,
    config: opts.blinds,
    street: "preflop",
    deck,
    board: [],
    seats,
    dealerIdx: opts.dealerIdx,
    currentSeatIdx: null,
    toMatch: 0,
    lastRaiseSize: opts.blinds.bb,
    result: null,
  };

  // Heads-up: dealer is SB.
  // 3+: SB = dealer+1, BB = dealer+2.
  const sbIdx = N === 2 ? opts.dealerIdx : (opts.dealerIdx + 1) % N;
  const bbIdx = N === 2 ? (opts.dealerIdx + 1) % N : (opts.dealerIdx + 2) % N;
  const sbSeat = state.seats[sbIdx];
  const bbSeat = state.seats[bbIdx];
  if (!sbSeat || !bbSeat) throw new Error("invalid blind seats");
  postBlind(sbSeat, opts.blinds.sb);
  postBlind(bbSeat, opts.blinds.bb);

  state.toMatch = opts.blinds.bb;

  const effects: Effect[] = [
    {
      kind: "blindsPosted",
      smallSeat: sbIdx,
      smallBlind: opts.blinds.sb,
      bigSeat: bbIdx,
      bigBlind: opts.blinds.bb,
    },
  ];

  effects.push(...dealHole(state));

  // First to act preflop:
  // Heads-up: SB = dealer = first to act.
  // 3+: dealer+3 (UTG).
  const firstToAct = N === 2 ? sbIdx : (opts.dealerIdx + 3) % N;
  state.currentSeatIdx = firstToAct;
  effects.push({ kind: "turnChanged", seatIdx: firstToAct });

  return { state, effects };
}

/**
 * Force-fold a specific seat regardless of whose turn it is. Used for mid-hand
 * disconnects (Phase 5) and host-kick (Phase 10). Behaves as if the player chose
 * fold: their committed chips stay in the pot, betting continues. If folding
 * leaves only one alive seat, the hand ends. If the folded seat WAS the current
 * actor, the turn advances.
 */
export function forceFold(state: HandState, seatIdx: number): ApplyResult {
  if (state.street === "complete" || state.currentSeatIdx === null) {
    return reject("hand_over", "Hand is already complete");
  }
  const seat = state.seats[seatIdx];
  if (!seat) return reject("bad_seat", `No seat ${seatIdx}`);
  if (seat.isFolded) return reject("already_folded", `Seat ${seatIdx} is already folded`);

  const next = cloneState(state);
  const target = next.seats[seatIdx];
  if (!target) return reject("bad_seat", `No seat ${seatIdx}`);
  target.isFolded = true;
  target.hasActed = true;

  const effects: Effect[] = [
    {
      kind: "actionTaken",
      seatIdx,
      action: { kind: "fold" },
      chipsCommitted: 0,
      isAllIn: false,
    },
  ];

  // Hand ends if only one alive seat remains.
  if (aliveSeats(next).length === 1) {
    const r = endHand(next, true);
    return { ok: true, state: next, effects: [...effects, ...r.effects] };
  }

  // If the betting round is now complete (all remaining actionable seats are matched),
  // advance the street.
  if (bettingRoundComplete(next)) {
    effects.push(...advanceStreet(next));
  } else if (next.currentSeatIdx === seatIdx) {
    // Force-folded the current actor — pass the turn to the next eligible seat.
    const nextSeat = nextActiveSeat(next, seatIdx);
    next.currentSeatIdx = nextSeat;
    if (nextSeat !== null) effects.push({ kind: "turnChanged", seatIdx: nextSeat });
  }
  // Otherwise: turn unchanged, hand continues.

  return { ok: true, state: next, effects };
}

export function applyAction(
  state: HandState,
  seatIdx: number,
  action: Action,
): ApplyResult {
  if (state.street === "complete" || state.currentSeatIdx === null) {
    return reject("hand_over", "Hand is already complete");
  }
  if (state.currentSeatIdx !== seatIdx) {
    return reject("not_your_turn", `It is seat ${state.currentSeatIdx}'s turn`);
  }
  const next = cloneState(state);
  const result = validateAndApplyAction(next, seatIdx, action);
  if ("error" in result) return result.error;

  const effects: Effect[] = [
    ...result.effects,
    {
      kind: "actionTaken",
      seatIdx,
      action,
      chipsCommitted: result.chipsCommitted,
      isAllIn: result.isAllIn,
    },
  ];

  // Check if hand ended by everyone folding
  if (aliveSeats(next).length === 1) {
    const r = endHand(next, true);
    return { ok: true, state: next, effects: [...effects, ...r.effects] };
  }

  if (bettingRoundComplete(next)) {
    effects.push(...advanceStreet(next));
  } else {
    const nextSeat = nextActiveSeat(next, seatIdx);
    next.currentSeatIdx = nextSeat;
    if (nextSeat !== null) effects.push({ kind: "turnChanged", seatIdx: nextSeat });
  }

  return { ok: true, state: next, effects };
}

export { type HandState };
