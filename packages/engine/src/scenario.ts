import { expect } from "vitest";
import { applyAction, startHand } from "./engine.js";
import type { Action, Effect, HandState } from "./types.js";

export type ScenarioSetup = {
  numSeats: number | null;
  blinds: { sb: number; bb: number };
  stacks: number[] | null;
  dealerIdx: number;
  seed: string;
};

export class Scenario {
  private setup: ScenarioSetup = {
    numSeats: null,
    blinds: { sb: 1, bb: 2 },
    stacks: null,
    dealerIdx: 0,
    seed: "scenario-seed",
  };
  private state: HandState | null = null;
  private effects: Effect[] = [];
  private allEffects: Effect[] = [];

  seats(n: number): this {
    this.setup.numSeats = n;
    return this;
  }

  blinds(sb: number, bb: number): this {
    this.setup.blinds = { sb, bb };
    return this;
  }

  stacks(...stacks: number[]): this {
    this.setup.stacks = stacks;
    return this;
  }

  dealer(idx: number): this {
    this.setup.dealerIdx = idx;
    return this;
  }

  seed(s: string): this {
    this.setup.seed = s;
    return this;
  }

  deal(): this {
    const N = this.setup.numSeats ?? this.setup.stacks?.length;
    if (!N) throw new Error("scenario: must call .seats(n) or .stacks(...) before .deal()");
    const stacks = this.setup.stacks ?? Array.from({ length: N }, () => 100);
    if (stacks.length !== N) throw new Error("scenario: stacks length must match seats");
    const seats = stacks.map((stack, i) => ({ playerId: `p${i}`, stack }));
    const result = startHand({
      handId: "scenario",
      seats,
      dealerIdx: this.setup.dealerIdx,
      blinds: this.setup.blinds,
      seed: this.setup.seed,
    });
    this.state = result.state;
    this.effects = result.effects;
    this.allEffects = result.effects.slice();
    return this;
  }

  private act(action: Action): this {
    if (!this.state) throw new Error("scenario: call .deal() before actions");
    if (this.state.currentSeatIdx === null) {
      throw new Error("scenario: hand is over, no more actions allowed");
    }
    const r = applyAction(this.state, this.state.currentSeatIdx, action);
    if (!r.ok) {
      throw new Error(`scenario action failed: ${r.code} — ${r.message}`);
    }
    this.state = r.state;
    this.effects = r.effects;
    this.allEffects.push(...r.effects);
    return this;
  }

  fold(): this {
    return this.act({ kind: "fold" });
  }
  check(): this {
    return this.act({ kind: "check" });
  }
  call(): this {
    return this.act({ kind: "call" });
  }
  bet(amount: number): this {
    return this.act({ kind: "bet", amount });
  }
  raise(to: number): this {
    return this.act({ kind: "raise", to });
  }

  /** Run remaining streets by checking everything down. */
  checkdown(): this {
    while (this.state && this.state.street !== "complete") {
      const cur = this.state.currentSeatIdx;
      if (cur === null) break;
      this.act({ kind: "check" });
    }
    return this;
  }

  get currentState(): HandState {
    if (!this.state) throw new Error("scenario: not started");
    return this.state;
  }

  get effectsSinceLastAction(): Effect[] {
    return this.effects;
  }

  get effectLog(): Effect[] {
    return this.allEffects;
  }

  get expect(): ExpectChain {
    return new ExpectChain(this);
  }
}

export class ExpectChain {
  constructor(private scn: Scenario) {}

  street(s: HandState["street"]): Scenario {
    expect(this.scn.currentState.street).toBe(s);
    return this.scn;
  }

  currentSeat(idx: number | null): Scenario {
    expect(this.scn.currentState.currentSeatIdx).toBe(idx);
    return this.scn;
  }

  toMatch(amount: number): Scenario {
    expect(this.scn.currentState.toMatch).toBe(amount);
    return this.scn;
  }

  stacks(...stacks: number[]): Scenario {
    expect(this.scn.currentState.seats.map((s) => s.stack)).toEqual(stacks);
    return this.scn;
  }

  winner(idx: number | number[]): Scenario {
    const ids = Array.isArray(idx) ? idx : [idx];
    const result = this.scn.currentState.result;
    if (!result) throw new Error("expect.winner: hand not complete");
    const winners = new Set<number>();
    for (const award of result.awards) for (const w of award.winners) winners.add(w.seatIdx);
    expect([...winners].sort()).toEqual(ids.sort());
    return this.scn;
  }

  complete(): Scenario {
    expect(this.scn.currentState.street).toBe("complete");
    expect(this.scn.currentState.result).not.toBeNull();
    return this.scn;
  }

  /** Conservation: stacks + outstanding commitments == starting stacks. */
  chipsConserved(): Scenario {
    const s = this.scn.currentState;
    const start = s.seats.reduce((sum, x) => sum + x.startingStack, 0);
    if (s.street === "complete") {
      const endTotal = s.seats.reduce((sum, x) => sum + x.stack, 0);
      expect(endTotal).toBe(start);
    } else {
      // Mid-hand: totalCommitted already includes committedThisRound
      const inFlight = s.seats.reduce((sum, x) => sum + x.stack + x.totalCommitted, 0);
      expect(inFlight).toBe(start);
    }
    return this.scn;
  }

  potTotal(amount: number): Scenario {
    const s = this.scn.currentState;
    // totalCommitted already accumulates committedThisRound
    const total = s.seats.reduce((sum, x) => sum + x.totalCommitted, 0);
    expect(total).toBe(amount);
    return this.scn;
  }
}

export function scenario(): Scenario {
  return new Scenario();
}
