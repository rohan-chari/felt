import { describe, expect, it } from "vitest";
import { applyAction, forceFold, markSittingOut, startHand } from "./engine.js";
import type { Effect } from "./types.js";

function basicStart(seedSuffix = "1") {
  return startHand({
    handId: `h-${seedSuffix}`,
    seats: [
      { playerId: "p0", stack: 100 },
      { playerId: "p1", stack: 100 },
      { playerId: "p2", stack: 100 },
    ],
    dealerIdx: 0,
    blinds: { sb: 1, bb: 2 },
    seed: `seed-${seedSuffix}`,
  });
}

describe("startHand (3-handed)", () => {
  it("posts blinds at SB=dealer+1 and BB=dealer+2", () => {
    const { state, effects } = basicStart();
    const blinds = effects.find((e) => e.kind === "blindsPosted");
    expect(blinds).toEqual({
      kind: "blindsPosted",
      smallSeat: 1,
      smallBlind: 1,
      bigSeat: 2,
      bigBlind: 2,
    });
    expect(state.seats[1]?.stack).toBe(99);
    expect(state.seats[2]?.stack).toBe(98);
    expect(state.seats[1]?.committedThisRound).toBe(1);
    expect(state.seats[2]?.committedThisRound).toBe(2);
  });

  it("UTG (dealer+3, wraps to seat 0) acts first preflop in 3+ hands", () => {
    const { state, effects } = basicStart();
    expect(state.currentSeatIdx).toBe(0);
    expect(effects.find((e) => e.kind === "turnChanged")).toEqual({
      kind: "turnChanged",
      seatIdx: 0,
    });
  });

  it("toMatch starts at the big blind", () => {
    const { state } = basicStart();
    expect(state.toMatch).toBe(2);
    expect(state.lastRaiseSize).toBe(2);
  });

  it("deals 2 hole cards per seat", () => {
    const { state, effects } = basicStart();
    const dealt = effects.filter((e) => e.kind === "holeCardsDealt");
    expect(dealt).toHaveLength(3);
    for (const seat of state.seats) {
      expect(seat.holeCards).not.toBeNull();
      expect(seat.holeCards).toHaveLength(2);
    }
    // All 6 dealt cards distinct
    const allCards = state.seats.flatMap((s) => s.holeCards ?? []);
    expect(new Set(allCards).size).toBe(6);
  });

  it("street starts at preflop, board is empty", () => {
    const { state } = basicStart();
    expect(state.street).toBe("preflop");
    expect(state.board).toEqual([]);
  });

  it("seed determinism: same seed → identical deal", () => {
    const a = basicStart("xyz");
    const b = basicStart("xyz");
    expect(a.state.seats.map((s) => s.holeCards)).toEqual(
      b.state.seats.map((s) => s.holeCards),
    );
  });
});

describe("startHand (heads-up)", () => {
  function huStart() {
    return startHand({
      handId: "hu",
      seats: [
        { playerId: "p0", stack: 100 },
        { playerId: "p1", stack: 100 },
      ],
      dealerIdx: 0,
      blinds: { sb: 1, bb: 2 },
      seed: "hu-seed",
    });
  }

  it("dealer is SB heads-up; BB is the other player", () => {
    const { state, effects } = huStart();
    const blinds = effects.find((e) => e.kind === "blindsPosted");
    expect(blinds).toEqual({
      kind: "blindsPosted",
      smallSeat: 0,
      smallBlind: 1,
      bigSeat: 1,
      bigBlind: 2,
    });
  });

  it("SB acts first preflop heads-up", () => {
    const { state } = huStart();
    expect(state.currentSeatIdx).toBe(0);
  });
});

describe("applyAction — basic", () => {
  it("rejects an action from the wrong seat", () => {
    const { state } = basicStart();
    const r = applyAction(state, 1, { kind: "call" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_your_turn");
  });

  it("rejects check when there is a bet to call", () => {
    const { state } = basicStart();
    const r = applyAction(state, 0, { kind: "check" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("cannot_check");
  });

  it("fold removes the player from action and advances to next seat", () => {
    const { state } = basicStart();
    const r = applyAction(state, 0, { kind: "fold" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.seats[0]?.isFolded).toBe(true);
    expect(r.state.currentSeatIdx).toBe(1);
  });

  it("call matches the toMatch and advances to next seat", () => {
    const { state } = basicStart();
    const r = applyAction(state, 0, { kind: "call" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.seats[0]?.committedThisRound).toBe(2);
    expect(r.state.seats[0]?.stack).toBe(98);
    expect(r.state.currentSeatIdx).toBe(1);
  });

  it("raise to X reopens action; previous callers must act again", () => {
    const { state } = basicStart();
    let s = state;
    const r1 = applyAction(s, 0, { kind: "raise", to: 8 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    s = r1.state;
    expect(s.toMatch).toBe(8);
    expect(s.lastRaiseSize).toBe(6);
    expect(s.currentSeatIdx).toBe(1);
  });

  it("everyone folds to BB → BB wins uncontested", () => {
    let { state } = basicStart();
    const r1 = applyAction(state, 0, { kind: "fold" });
    if (!r1.ok) throw new Error("fail");
    state = r1.state;
    const r2 = applyAction(state, 1, { kind: "fold" });
    if (!r2.ok) throw new Error("fail");
    state = r2.state;
    expect(state.street).toBe("complete");
    expect(state.result).not.toBeNull();
    // BB (seat 2) should have won the SB's chip plus the SB blind
    // SB committed 1, BB committed 2, total pot = 3, BB gets it back: net 1 chip gain
    expect(state.seats[2]?.stack).toBe(101);
    expect(state.seats[1]?.stack).toBe(99); // SB lost their 1 blind
    expect(state.seats[0]?.stack).toBe(100);
  });

  describe("forceFold (mid-hand disconnect)", () => {
    it("folds the named seat even when it isn't their turn", () => {
      const { state } = basicStart();
      // 3-handed: UTG (seat 0) is current. Force-fold seat 2 (BB) instead.
      const r = forceFold(state, 2);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.state.seats[2]?.isFolded).toBe(true);
      // Turn unchanged — still UTG (seat 0).
      expect(r.state.currentSeatIdx).toBe(0);
    });

    it("advances the turn when the folded seat WAS the current actor", () => {
      const { state } = basicStart();
      // Force-fold the current actor (seat 0).
      const r = forceFold(state, 0);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.state.seats[0]?.isFolded).toBe(true);
      // Next active seat is 1 (SB).
      expect(r.state.currentSeatIdx).toBe(1);
    });

    it("ends the hand if forcing the fold leaves only one player", () => {
      const { state: initial } = basicStart();
      let s = initial;
      // Fold seat 0 (UTG) and seat 1 (SB) → only seat 2 (BB) remains.
      let r = forceFold(s, 0);
      if (!r.ok) throw new Error("fail");
      s = r.state;
      r = forceFold(s, 1);
      if (!r.ok) throw new Error("fail");
      s = r.state;
      expect(s.street).toBe("complete");
      // BB wins blinds + UTG's 0 (UTG didn't pay).
      // Stacks: SB=99 (lost 1), UTG=100, BB=101 (won 2 = 1 SB + 0 BB ... wait BB had 2 in)
      // Pot = 1 (SB) + 2 (BB) = 3. BB wins all 3. BB ends with starting 100 - 2 BB + 3 = 101.
      expect(s.seats[2]?.stack).toBe(101);
    });

    it("rejects folding a seat that's already folded or doesn't exist", () => {
      const { state } = basicStart();
      const r1 = forceFold(state, 99);
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.code).toBe("bad_seat");

      const r2 = forceFold(state, 0);
      if (!r2.ok) throw new Error("fail");
      const r3 = forceFold(r2.state, 0);
      expect(r3.ok).toBe(false);
      if (!r3.ok) expect(r3.code).toBe("already_folded");
    });

    it("rejects forceFold on a complete hand", () => {
      const { state: initial } = basicStart();
      let s = initial;
      const r1 = forceFold(s, 0);
      if (!r1.ok) throw new Error("fail");
      s = r1.state;
      const r2 = forceFold(s, 1);
      if (!r2.ok) throw new Error("fail");
      s = r2.state;
      // Hand should be complete now
      expect(s.street).toBe("complete");
      const r3 = forceFold(s, 2);
      expect(r3.ok).toBe(false);
      if (!r3.ok) expect(r3.code).toBe("hand_over");
    });
  });

  describe("actionLog", () => {
    it("appends an entry per applyAction call (act kind, with seatIdx and action)", () => {
      const { state } = basicStart();
      expect(state.actionLog).toEqual([]);

      const r1 = applyAction(state, 0, { kind: "fold" });
      if (!r1.ok) throw new Error("fail");
      expect(r1.state.actionLog).toEqual([
        { kind: "act", seatIdx: 0, action: { kind: "fold" } },
      ]);

      const r2 = applyAction(r1.state, 1, { kind: "call" });
      if (!r2.ok) throw new Error("fail");
      expect(r2.state.actionLog).toEqual([
        { kind: "act", seatIdx: 0, action: { kind: "fold" } },
        { kind: "act", seatIdx: 1, action: { kind: "call" } },
      ]);
    });

    it("forceFold appends a forceFold entry", () => {
      const { state } = basicStart();
      const r = forceFold(state, 2);
      if (!r.ok) throw new Error("fail");
      expect(r.state.actionLog).toEqual([{ kind: "forceFold", seatIdx: 2 }]);
    });

    it("markSittingOut appends a sitOut entry", () => {
      const { state } = basicStart();
      const r = markSittingOut(state, 2);
      if (!r.ok) throw new Error("fail");
      expect(r.state.actionLog[0]).toEqual({ kind: "sitOut", seatIdx: 2 });
    });
  });

  describe("markSittingOut (mid-hand disconnect protection)", () => {
    it("marks the seat sitting out without folding it; their committed chips stay in the pot", () => {
      const { state } = basicStart();
      // Seat 2 is BB (committed 2). Mark them sitting out before any action.
      const r = markSittingOut(state, 2);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const seat = r.state.seats[2];
      expect(seat?.sittingOut).toBe(true);
      expect(seat?.isFolded).toBe(false);
      expect(seat?.totalCommitted).toBe(2); // their BB stays in the pot
      // Stack untouched (still 98 after posting BB).
      expect(seat?.stack).toBe(98);
    });

    it("skips the sitting-out seat in turn order", () => {
      const { state } = basicStart();
      // Seat 0 (UTG) is current. Sit out seat 1 (SB).
      const r1 = markSittingOut(state, 1);
      if (!r1.ok) throw new Error("fail");
      // UTG calls. Action should jump to BB (seat 2), not SB.
      const r2 = applyAction(r1.state, 0, { kind: "call" });
      if (!r2.ok) throw new Error("fail");
      expect(r2.state.currentSeatIdx).toBe(2);
    });

    it("advances the turn when the sitting-out seat WAS the current actor", () => {
      const { state } = basicStart();
      // Sit out seat 0 (UTG) — currently their turn.
      const r = markSittingOut(state, 0);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Next active is seat 1 (SB).
      expect(r.state.currentSeatIdx).toBe(1);
    });

    it("runs cards out and goes to showdown when only one actionable seat remains", () => {
      // 3-handed: UTG folds. Then SB sits out. BB is the only actionable seat
      // remaining alongside one alive (committed-only) sitter — engine should
      // run out the rest of the streets and hit showdown.
      const { state: initial } = basicStart();
      const r1 = applyAction(initial, 0, { kind: "fold" });
      if (!r1.ok) throw new Error("fail");
      // After fold: SB (seat 1) is current. Sit them out.
      const r2 = markSittingOut(r1.state, 1);
      if (!r2.ok) throw new Error("fail");
      // SB committed 1; not folded. BB is the only actionable. Engine should
      // immediately advance to showdown via run-out.
      expect(r2.state.street).toBe("complete");
      expect(r2.state.result).not.toBeNull();
      // Total chips should be conserved.
      const totalEnd = r2.state.seats.reduce((sum, s) => sum + s.stack, 0);
      const totalStart = r2.state.seats.reduce((sum, s) => sum + s.startingStack, 0);
      expect(totalEnd).toBe(totalStart);
    });

    it("rejects sitting out a seat that's already folded, all-in, or sitting out", () => {
      const { state } = basicStart();
      const r1 = markSittingOut(state, 99);
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.code).toBe("bad_seat");

      const r2 = applyAction(state, 0, { kind: "fold" });
      if (!r2.ok) throw new Error("fail");
      const r3 = markSittingOut(r2.state, 0);
      expect(r3.ok).toBe(false);
      if (!r3.ok) expect(r3.code).toBe("already_folded");

      const r4 = markSittingOut(state, 1);
      if (!r4.ok) throw new Error("fail");
      const r5 = markSittingOut(r4.state, 1);
      expect(r5.ok).toBe(false);
      if (!r5.ok) expect(r5.code).toBe("already_sitting_out");
    });

    it("rejects sitting out on a complete hand", () => {
      const { state: initial } = basicStart();
      let s = initial;
      const r1 = forceFold(s, 0);
      if (!r1.ok) throw new Error("fail");
      s = r1.state;
      const r2 = forceFold(s, 1);
      if (!r2.ok) throw new Error("fail");
      s = r2.state;
      expect(s.street).toBe("complete");
      const r3 = markSittingOut(s, 2);
      expect(r3.ok).toBe(false);
      if (!r3.ok) expect(r3.code).toBe("hand_over");
    });
  });

  it("call → call → check (BB option used) advances to flop", () => {
    let { state } = basicStart();
    let effects: Effect[] = [];
    const r1 = applyAction(state, 0, { kind: "call" }); // UTG calls 2
    if (!r1.ok) throw new Error("fail");
    state = r1.state;
    const r2 = applyAction(state, 1, { kind: "call" }); // SB completes
    if (!r2.ok) throw new Error("fail");
    state = r2.state;
    const r3 = applyAction(state, 2, { kind: "check" }); // BB checks option
    if (!r3.ok) throw new Error("fail");
    state = r3.state;
    effects = r3.effects;
    expect(state.street).toBe("flop");
    expect(state.board).toHaveLength(3);
    const sa = effects.find((e) => e.kind === "streetAdvanced");
    expect(sa).toMatchObject({ street: "flop", board: state.board });
  });
});
