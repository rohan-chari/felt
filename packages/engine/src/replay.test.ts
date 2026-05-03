import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mulberry32 } from "./cards.js";
import { applyAction, startHand } from "./engine.js";
import type { Action, HandState } from "./types.js";

function pickLegalAction(state: HandState, rng: () => number): Action {
  const seatIdx = state.currentSeatIdx;
  if (seatIdx === null) throw new Error("no current seat");
  const seat = state.seats[seatIdx];
  if (!seat) throw new Error("bad seat");
  const need = state.toMatch - seat.committedThisRound;
  const r = rng();
  if (r < 0.15) return { kind: "fold" };
  if (r < 0.7) {
    if (need <= 0) return { kind: "check" };
    return { kind: "call" };
  }
  if (state.toMatch === 0) {
    const min = state.config.bb;
    const max = seat.stack;
    if (max < min) return need <= 0 ? { kind: "check" } : { kind: "call" };
    const amt = Math.min(min + Math.floor(rng() * (max - min + 1)), max);
    return { kind: "bet", amount: amt };
  }
  const minRaise = state.toMatch + state.lastRaiseSize;
  const maxRaise = seat.committedThisRound + seat.stack;
  if (maxRaise <= state.toMatch) return { kind: "call" };
  if (maxRaise < minRaise) return { kind: "raise", to: maxRaise };
  const to = Math.min(minRaise + Math.floor(rng() * (maxRaise - minRaise + 1)), maxRaise);
  return { kind: "raise", to };
}

type StepRecord = { seatIdx: number; action: Action };

function playAndRecord(opts: {
  stacks: number[];
  blinds: { sb: number; bb: number };
  dealerIdx: number;
  seed: string;
  driverSeed: number;
}): { actions: StepRecord[]; states: HandState[] } {
  const { state: initial } = startHand({
    handId: "replay",
    seats: opts.stacks.map((stack, i) => ({ playerId: `p${i}`, stack })),
    dealerIdx: opts.dealerIdx,
    blinds: opts.blinds,
    seed: opts.seed,
  });
  let state = initial;
  const states: HandState[] = [state];
  const actions: StepRecord[] = [];
  const rng = mulberry32(opts.driverSeed);
  let safety = 1000;
  while (state.street !== "complete" && safety-- > 0) {
    const cur = state.currentSeatIdx;
    if (cur === null) break;
    let action = pickLegalAction(state, rng);
    let r = applyAction(state, cur, action);
    if (!r.ok) {
      for (const fb of [
        { kind: "call" } as Action,
        { kind: "check" } as Action,
        { kind: "fold" } as Action,
      ]) {
        r = applyAction(state, cur, fb);
        if (r.ok) {
          action = fb;
          break;
        }
      }
      if (!r.ok) throw new Error(`stuck: ${r.code}`);
    }
    actions.push({ seatIdx: cur, action });
    state = r.state;
    states.push(state);
  }
  return { actions, states };
}

function replay(opts: {
  stacks: number[];
  blinds: { sb: number; bb: number };
  dealerIdx: number;
  seed: string;
  actions: StepRecord[];
}): HandState[] {
  const { state: initial } = startHand({
    handId: "replay",
    seats: opts.stacks.map((stack, i) => ({ playerId: `p${i}`, stack })),
    dealerIdx: opts.dealerIdx,
    blinds: opts.blinds,
    seed: opts.seed,
  });
  let state = initial;
  const states: HandState[] = [state];
  for (const step of opts.actions) {
    const r = applyAction(state, step.seatIdx, step.action);
    if (!r.ok) throw new Error(`replay diverged: ${r.code} on ${JSON.stringify(step)}`);
    state = r.state;
    states.push(state);
  }
  return states;
}

function fingerprint(state: HandState): string {
  return JSON.stringify({
    street: state.street,
    board: state.board,
    currentSeatIdx: state.currentSeatIdx,
    toMatch: state.toMatch,
    lastRaiseSize: state.lastRaiseSize,
    seats: state.seats.map((s) => ({
      idx: s.idx,
      stack: s.stack,
      holeCards: s.holeCards,
      committedThisRound: s.committedThisRound,
      totalCommitted: s.totalCommitted,
      hasActed: s.hasActed,
      isFolded: s.isFolded,
      isAllIn: s.isAllIn,
    })),
    finalStacks: state.result?.finalStacks ?? null,
  });
}

describe("replay determinism", () => {
  it("a known hand replays bit-for-bit identically", () => {
    const opts = {
      stacks: [100, 100, 100],
      blinds: { sb: 1, bb: 2 },
      dealerIdx: 0,
      seed: "replay-1",
      driverSeed: 12345,
    };
    const original = playAndRecord(opts);
    const replayed = replay({ ...opts, actions: original.actions });
    expect(original.states).toHaveLength(replayed.length);
    for (let i = 0; i < original.states.length; i++) {
      const a = fingerprint(original.states[i] as HandState);
      const b = fingerprint(replayed[i] as HandState);
      if (a !== b) {
        throw new Error(`step ${i} diverged:\n  original=${a}\n  replay=${b}`);
      }
    }
  });

  it("property: replay always matches original (random hands)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 1, max: 100000 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (numSeats, driverSeed, seed) => {
          const stacks = Array.from({ length: numSeats }, (_, i) => 50 + ((i * 31) % 200));
          const opts = {
            stacks,
            blinds: { sb: 1, bb: 2 },
            dealerIdx: 0,
            seed,
            driverSeed,
          };
          const original = playAndRecord(opts);
          const replayed = replay({ ...opts, actions: original.actions });
          if (original.states.length !== replayed.length) {
            throw new Error(`length mismatch: ${original.states.length} vs ${replayed.length}`);
          }
          for (let i = 0; i < original.states.length; i++) {
            const a = fingerprint(original.states[i] as HandState);
            const b = fingerprint(replayed[i] as HandState);
            if (a !== b) {
              throw new Error(`step ${i} diverged: ${a} vs ${b}`);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

