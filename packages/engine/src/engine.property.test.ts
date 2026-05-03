import * as fc from "fast-check";
import { describe, it } from "vitest";
import { mulberry32 } from "./cards.js";
import { applyAction, startHand } from "./engine.js";
import { calculatePots } from "./pots.js";
import type { Action, ApplyResult, HandState } from "./types.js";

function pickLegalAction(state: HandState, rng: () => number): Action {
  const seatIdx = state.currentSeatIdx;
  if (seatIdx === null) throw new Error("no current seat");
  const seat = state.seats[seatIdx];
  if (!seat) throw new Error("bad seat");
  const need = state.toMatch - seat.committedThisRound;
  const r = rng();

  // 15% fold, 55% call/check, 30% raise/bet
  if (r < 0.15) return { kind: "fold" };
  if (r < 0.7) {
    if (need <= 0) return { kind: "check" };
    return { kind: "call" };
  }
  // bet/raise
  if (state.toMatch === 0) {
    const min = state.config.bb;
    const max = seat.stack;
    if (max < min) return need <= 0 ? { kind: "check" } : { kind: "call" };
    const amt = Math.min(min + Math.floor(rng() * (max - min + 1)), max);
    return { kind: "bet", amount: amt };
  }
  const minRaise = state.toMatch + state.lastRaiseSize;
  const maxRaise = seat.committedThisRound + seat.stack;
  if (maxRaise <= state.toMatch) {
    // Can't raise, must call (or fold but we already filtered)
    return { kind: "call" };
  }
  if (maxRaise < minRaise) {
    // Short all-in raise
    return { kind: "raise", to: maxRaise };
  }
  const to = Math.min(minRaise + Math.floor(rng() * (maxRaise - minRaise + 1)), maxRaise);
  return { kind: "raise", to };
}

function tryAction(state: HandState, action: Action): ApplyResult {
  const seatIdx = state.currentSeatIdx;
  if (seatIdx === null) throw new Error("no current seat");
  return applyAction(state, seatIdx, action);
}

function playRandomHand(opts: {
  seats: number[];
  blinds: { sb: number; bb: number };
  dealerIdx: number;
  seed: string;
  driverSeed: number;
}): HandState {
  const { state: initial } = startHand({
    handId: `prop-${opts.seed}`,
    seats: opts.seats.map((stack, i) => ({ playerId: `p${i}`, stack })),
    dealerIdx: opts.dealerIdx,
    blinds: opts.blinds,
    seed: opts.seed,
  });
  let state = initial;
  const rng = mulberry32(opts.driverSeed);
  let safety = 1000;
  while (state.street !== "complete" && safety-- > 0) {
    let action = pickLegalAction(state, rng);
    let r = tryAction(state, action);
    if (!r.ok) {
      // Fall back: try call → check → fold
      for (const fallback of [
        { kind: "call" } as Action,
        { kind: "check" } as Action,
        { kind: "fold" } as Action,
      ]) {
        r = tryAction(state, fallback);
        if (r.ok) {
          action = fallback;
          break;
        }
      }
      if (!r.ok) throw new Error(`stuck — last error: ${r.code}`);
    }
    state = r.state;
  }
  if (safety <= 0) throw new Error("hand did not terminate");
  return state;
}

describe("property: chip conservation", () => {
  it("after any random hand, sum of stacks equals sum of starting stacks", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 1, max: 100000 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (numSeats, driverSeed, seed) => {
          const stacks = Array.from({ length: numSeats }, (_, i) => 50 + ((i * 37) % 200));
          const start = stacks.reduce((a, b) => a + b, 0);
          const final = playRandomHand({
            seats: stacks,
            blinds: { sb: 1, bb: 2 },
            dealerIdx: 0,
            seed,
            driverSeed,
          });
          const end = final.seats.reduce((sum, s) => sum + s.stack, 0);
          if (end !== start) {
            throw new Error(`chip leak: start=${start} end=${end}`);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("property: valid turn order", () => {
  it("currentSeatIdx is always non-folded and non-all-in until completion", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 1, max: 100000 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (numSeats, driverSeed, seed) => {
          // Replay step-by-step asserting at each turn
          const stacks = Array.from({ length: numSeats }, () => 100);
          const { state: initial } = startHand({
            handId: `to-${seed}`,
            seats: stacks.map((stack, i) => ({ playerId: `p${i}`, stack })),
            dealerIdx: 0,
            blinds: { sb: 1, bb: 2 },
            seed,
          });
          let state = initial;
          const rng = mulberry32(driverSeed);
          let safety = 1000;
          while (state.street !== "complete" && safety-- > 0) {
            const cur = state.currentSeatIdx;
            if (cur === null) throw new Error("currentSeatIdx null mid-hand");
            const seat = state.seats[cur];
            if (!seat) throw new Error("invalid currentSeatIdx");
            if (seat.isFolded) throw new Error("acting seat is folded");
            if (seat.isAllIn) throw new Error("acting seat is all-in");
            let action = pickLegalAction(state, rng);
            let r = tryAction(state, action);
            if (!r.ok) {
              for (const fb of [
                { kind: "call" } as Action,
                { kind: "check" } as Action,
                { kind: "fold" } as Action,
              ]) {
                r = tryAction(state, fb);
                if (r.ok) {
                  action = fb;
                  break;
                }
              }
              if (!r.ok) throw new Error(`stuck: ${r.code}`);
            }
            state = r.state;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("property: terminal state distributes all chips", () => {
  it("finalStacks always sums to starting total", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 1, max: 100000 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (numSeats, driverSeed, seed) => {
          const stacks = Array.from({ length: numSeats }, (_, i) => 30 + i * 25);
          const start = stacks.reduce((a, b) => a + b, 0);
          const final = playRandomHand({
            seats: stacks,
            blinds: { sb: 1, bb: 2 },
            dealerIdx: 0,
            seed,
            driverSeed,
          });
          if (!final.result) throw new Error("hand had no result");
          const finalSum = final.result.finalStacks.reduce((a, b) => a + b, 0);
          const stackSum = final.seats.reduce((a, s) => a + s.stack, 0);
          if (finalSum !== start) {
            throw new Error(
              `finalStacks sum ${finalSum} != start ${start}; stacks sum=${stackSum}; numSeats=${numSeats} stacks=${stacks.join(",")} seed=${seed} driver=${driverSeed}`,
            );
          }
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });
});

describe("property: side pots sum to total committed", () => {
  it("calculatePots preserves total commitment (including orphaned layers)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 2, maxLength: 8 }),
        fc.array(fc.integer({ min: 0, max: 7 }), { maxLength: 4 }),
        (commitments, foldedIdxsRaw) => {
          const folded = new Set(foldedIdxsRaw.filter((i) => i < commitments.length));
          const pots = calculatePots(commitments, folded);
          const sum = pots.reduce((s, p) => s + p.amount, 0);
          const expected = commitments.reduce((s, c) => s + c, 0);
          if (sum !== expected) {
            throw new Error(`pot sum ${sum} != total committed ${expected}`);
          }
          for (const p of pots) {
            if (p.amount <= 0) throw new Error("zero-amount pot emitted");
            // Contributions sum to amount
            let contribSum = 0;
            for (const v of p.contributions.values()) contribSum += v;
            if (contribSum !== p.amount) {
              throw new Error(`contrib sum ${contribSum} != pot amount ${p.amount}`);
            }
          }
          if (folded.size === 0) {
            const allEqual = commitments.every((c) => c === commitments[0]);
            if (allEqual && commitments[0]! > 0 && pots.length !== 1) {
              throw new Error("expected single pot for equal commitments");
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
