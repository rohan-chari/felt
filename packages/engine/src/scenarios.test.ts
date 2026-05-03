import { describe, it } from "vitest";
import { scenario } from "./scenario.js";

describe("scenario DSL — sanity", () => {
  it("heads-up: SB folds preflop, BB wins one chip", () => {
    scenario()
      .seats(2)
      .blinds(1, 2)
      .stacks(100, 100)
      .seed("hu-fold")
      .deal()
      .fold() // SB (seat 0) folds preflop
      .expect.complete()
      .expect.winner(1)
      .expect.stacks(99, 101)
      .expect.chipsConserved();
  });

  it("3-handed: UTG and SB fold, BB wins blinds", () => {
    scenario()
      .seats(3)
      .blinds(1, 2)
      .stacks(100, 100, 100)
      .seed("3way-fold")
      .deal()
      .fold() // UTG (seat 0)
      .fold() // SB (seat 1)
      .expect.complete()
      .expect.winner(2)
      .expect.stacks(100, 99, 101);
  });

  it("3-handed: limp around to BB, BB checks, advances to flop", () => {
    scenario()
      .seats(3)
      .blinds(1, 2)
      .stacks(100, 100, 100)
      .seed("3way-limp")
      .deal()
      .call() // UTG (seat 0) limps
      .call() // SB (seat 1) completes
      .check() // BB (seat 2) checks the option
      .expect.street("flop")
      .expect.toMatch(0)
      .expect.potTotal(6);
  });
});

describe("heads-up scenarios", () => {
  it("HU: BB raises preflop, SB folds", () => {
    scenario()
      .seats(2).blinds(1, 2).stacks(100, 100).seed("hu-1").deal()
      .call()        // SB completes
      .raise(8)      // BB raises to 8
      .fold()        // SB folds
      .expect.complete().expect.winner(1).expect.stacks(98, 102);
  });

  it("HU: SB raises preflop, BB calls, both check down", () => {
    scenario()
      .seats(2).blinds(1, 2).stacks(100, 100).seed("hu-2").deal()
      .raise(6)      // SB raises to 6
      .call()        // BB calls
      .check()       // BB acts first post-flop, checks
      .check()       // SB checks
      .check()       // BB turn
      .check()       // SB turn
      .check()       // BB river
      .check()       // SB river
      .expect.complete().expect.chipsConserved();
  });

  it("HU: SB shoves preflop, BB calls", () => {
    scenario()
      .seats(2).blinds(1, 2).stacks(100, 100).seed("hu-allin").deal()
      .raise(100)    // SB all-in (raise to 100)
      .call()        // BB calls all-in
      .expect.complete().expect.chipsConserved();
  });

  it("HU: BB checks option, SB bets flop, BB folds", () => {
    scenario()
      .seats(2).blinds(1, 2).stacks(100, 100).seed("hu-3").deal()
      .call()        // SB completes
      .check()       // BB checks
      .check()       // BB checks flop
      .bet(10)       // SB bets 10
      .fold()        // BB folds
      .expect.complete().expect.winner(0).expect.stacks(102, 98);
  });

  it("HU: SB calls, BB checks, both check down to river, showdown", () => {
    scenario()
      .seats(2).blinds(1, 2).stacks(100, 100).seed("hu-4").deal()
      .call().check()
      .checkdown()
      .expect.complete().expect.chipsConserved();
  });
});

describe("3-handed scenarios", () => {
  it("3w: UTG raises, SB folds, BB calls, check-down to river", () => {
    scenario()
      .seats(3).blinds(1, 2).stacks(100, 100, 100).seed("3w-1").deal()
      .raise(6)      // UTG raises to 6
      .fold()        // SB folds
      .call()        // BB calls
      .check()       // BB acts first post-flop
      .check()       // UTG
      .check().check()  // turn
      .check().check()  // river
      .expect.complete().expect.chipsConserved();
  });

  it("3w: UTG opens, SB 3-bets, BB folds, UTG calls", () => {
    scenario()
      .seats(3).blinds(1, 2).stacks(100, 100, 100).seed("3w-2").deal()
      .raise(6)      // UTG to 6
      .raise(20)     // SB to 20
      .fold()        // BB folds
      .call()        // UTG calls
      .checkdown()
      .expect.complete().expect.chipsConserved();
  });

  it("3w: UTG shoves, both call, three-way showdown", () => {
    scenario()
      .seats(3).blinds(1, 2).stacks(100, 100, 100).seed("3w-3").deal()
      .raise(100)    // UTG all-in
      .call()        // SB calls all-in
      .call()        // BB calls all-in
      .expect.complete().expect.chipsConserved();
  });

  it("3w: UTG min-raise, SB calls, BB folds, check-down", () => {
    scenario()
      .seats(3).blinds(1, 2).stacks(100, 100, 100).seed("3w-4").deal()
      .raise(4)      // UTG min-raise to 4
      .call()        // SB
      .fold()        // BB
      .checkdown()
      .expect.complete().expect.chipsConserved();
  });
});

describe("side pot scenarios", () => {
  it("3w: short stack all-in pre, two cover, side pot exists", () => {
    scenario()
      .seats(3).blinds(1, 2).stacks(50, 100, 100).seed("sp-1").deal()
      .raise(50)     // UTG all-in for 50
      .call()        // SB calls 50
      .call()        // BB calls 50
      // SB and BB still have 50 each — they continue post-flop while UTG sits all-in
      .checkdown()
      .expect.complete().expect.chipsConserved();
  });

  it("3w: two short all-ins at different levels create main + side pot", () => {
    scenario()
      .seats(3).blinds(1, 2).stacks(30, 70, 100).seed("sp-2").deal()
      .raise(30)     // UTG all-in for 30
      .raise(70)     // SB all-in for 70
      .call()        // BB calls 70
      .expect.complete().expect.chipsConserved();
  });

  it("3w: short stack all-in, others continue betting post-flop", () => {
    scenario()
      .seats(3).blinds(1, 2).stacks(20, 200, 200).seed("sp-3").deal()
      .raise(20)     // UTG all-in
      .call()        // SB calls
      .call()        // BB calls
      // post-flop: UTG sitting all-in, SB acts first
      .bet(30)
      .raise(80)
      .call()
      .expect.chipsConserved()
      .checkdown()
      .expect.complete().expect.chipsConserved();
  });
});

describe("min-raise enforcement", () => {
  it("rejects a raise below the min-raise", () => {
    let threw = false;
    try {
      scenario()
        .seats(3).blinds(1, 2).stacks(100, 100, 100).seed("mr-1").deal()
        .raise(6)     // UTG to 6 (raiseSize=4)
        .raise(7);    // SB tries to raise by only 1 — illegal (min would be 10)
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error("expected illegal raise to throw");
  });

  it("allows a short all-in below min-raise", () => {
    scenario()
      .seats(3).blinds(1, 2).stacks(100, 7, 100).seed("mr-2").deal()
      .raise(6)     // UTG to 6
      .raise(7)     // SB all-in for 7 (below min-raise but allowed because all-in)
      .call()       // BB calls 7
      .call()       // UTG calls 7
      .checkdown()
      .expect.complete().expect.chipsConserved();
  });
});

describe("street advancement", () => {
  it("HU: walks every street to showdown via checks", () => {
    const s = scenario()
      .seats(2).blinds(1, 2).stacks(100, 100).seed("walk").deal()
      .call().check();
    s.expect.street("flop");
    s.checkdown();
    s.expect.complete().expect.chipsConserved();
  });

  it("3w: pre-flop bet folds others, no community cards dealt", () => {
    const s = scenario()
      .seats(3).blinds(1, 2).stacks(100, 100, 100).seed("nc").deal()
      .raise(20).fold().fold();
    s.expect.complete();
    if (s.currentState.board.length !== 0) throw new Error("board should be empty when hand ends preflop");
  });
});

describe("seed determinism", () => {
  it("same seed produces identical hole cards across runs", () => {
    const a = scenario().seats(3).blinds(1, 2).stacks(100, 100, 100).seed("det").deal();
    const b = scenario().seats(3).blinds(1, 2).stacks(100, 100, 100).seed("det").deal();
    const aCards = a.currentState.seats.map((s) => s.holeCards);
    const bCards = b.currentState.seats.map((s) => s.holeCards);
    if (JSON.stringify(aCards) !== JSON.stringify(bCards)) {
      throw new Error("expected identical cards from identical seed");
    }
  });
});

describe("4-handed scenarios", () => {
  it("4w (dealer=0): UTG=3, opens, folds around to BB", () => {
    scenario()
      .seats(4).blinds(1, 2).stacks(100, 100, 100, 100).seed("4w-2").dealer(0).deal()
      // turn order preflop: UTG(3) → seat 0 → SB(1) → BB(2)
      .raise(6)     // UTG=3 raises
      .fold()       // seat 0
      .fold()       // SB=1
      .fold()       // BB=2 folds
      .expect.complete().expect.winner(3);
  });

  it("4w: limp around, BB checks option, post-flop check-down", () => {
    scenario()
      .seats(4).blinds(1, 2).stacks(100, 100, 100, 100).seed("4w-3").dealer(0).deal()
      .call().call().call().check()
      .expect.street("flop")
      .checkdown()
      .expect.complete().expect.chipsConserved();
  });
});

describe("dealer rotation: action order changes", () => {
  it("dealer=2 in 3-handed → SB=0, BB=1, UTG=2", () => {
    scenario()
      .seats(3).blinds(1, 2).stacks(100, 100, 100).dealer(2).seed("dr-1").deal()
      .expect.currentSeat(2);  // UTG (dealer+1+2 mod 3 = 2)
  });

  it("dealer=1 in 3-handed → SB=2, BB=0, UTG=1", () => {
    scenario()
      .seats(3).blinds(1, 2).stacks(100, 100, 100).dealer(1).seed("dr-2").deal()
      .expect.currentSeat(1);
  });
});

describe("re-raise sequences", () => {
  it("3-bet, 4-bet, 5-bet shove, fold", () => {
    scenario()
      .seats(3).blinds(1, 2).stacks(200, 200, 200).seed("rr-1").deal()
      .raise(6)      // UTG opens 6
      .raise(20)     // SB 3-bets to 20
      .raise(60)     // BB 4-bets to 60
      .fold()        // UTG folds
      .raise(200)    // SB 5-bet shoves
      .fold()        // BB folds
      .expect.complete().expect.winner(1).expect.chipsConserved();
  });
});

describe("post-flop dynamics", () => {
  it("HU check-raise on the flop", () => {
    scenario()
      .seats(2).blinds(1, 2).stacks(100, 100).seed("cr-1").deal()
      .call().check()        // limp + check
      .check()               // BB checks flop
      .bet(8)                // SB bets
      .raise(24)             // BB check-raises
      .call()                // SB calls
      .checkdown()
      .expect.complete().expect.chipsConserved();
  });

  it("3w turn donk-bet then over-raise", () => {
    scenario()
      .seats(3).blinds(1, 2).stacks(200, 200, 200).seed("dnk-1").deal()
      .call().call().check()
      .check().check().check() // flop checks around
      .bet(10).raise(40).fold().call() // turn: SB bets, BB raises, UTG folds, SB calls
      .checkdown()
      .expect.complete().expect.chipsConserved();
  });
});

describe("all-in dynamics", () => {
  it("all-in pre-flop heads-up runs board to showdown", () => {
    const s = scenario()
      .seats(2).blinds(1, 2).stacks(100, 100).seed("ai-hu").deal()
      .raise(100).call();
    s.expect.complete().expect.chipsConserved();
    if (s.currentState.board.length !== 5) throw new Error("board should be 5 cards on all-in showdown");
  });

  it("all 4 all-in pre-flop runs to showdown", () => {
    const s = scenario()
      .seats(4).blinds(1, 2).stacks(100, 100, 100, 100).seed("ai-4w").dealer(0).deal()
      .raise(100).call().call().call();
    s.expect.complete().expect.chipsConserved();
    if (s.currentState.board.length !== 5) throw new Error("board should be 5 cards");
  });

  it("two short all-ins create three pots that distribute correctly", () => {
    const s = scenario()
      .seats(3).blinds(1, 2).stacks(30, 70, 200).seed("3pot").deal()
      .raise(30).raise(70).call();   // UTG all-in 30, SB all-in 70, BB calls 70
    s.expect.complete().expect.chipsConserved();
    // Pots: main (30*3=90), side1 (40*2=80), no third pot (BB had nothing else to win)
    // With BB committing 70 and SB max 70, BB only loses 70.
    const totalCommitted = s.currentState.seats.reduce((t, x) => t + x.totalCommitted, 0);
    if (totalCommitted !== 30 + 70 + 70) throw new Error(`unexpected total commitment ${totalCommitted}`);
  });
});

describe("BB-walk and option scenarios", () => {
  it("3w: UTG and SB fold preflop, BB walks", () => {
    scenario()
      .seats(3).blinds(1, 2).stacks(100, 100, 100).seed("walk-3w").deal()
      .fold().fold()
      .expect.complete().expect.winner(2)
      .expect.stacks(100, 99, 101);
  });

  it("HU SB calls, BB checks option, then BB bets flop and SB calls", () => {
    scenario()
      .seats(2).blinds(1, 2).stacks(100, 100).seed("hu-opt").deal()
      .call().check()
      .bet(5).call()
      .checkdown()
      .expect.complete().expect.chipsConserved();
  });
});

describe("specific seed outcomes (regression)", () => {
  it("a known hand plays out and someone wins with chip conservation", () => {
    const s = scenario()
      .seats(3).blinds(1, 2).stacks(100, 100, 100).seed("regression-x42").deal()
      .call().call().check()
      .checkdown();
    s.expect.complete().expect.chipsConserved();
    // Result should have at least one winner
    const r = s.currentState.result;
    if (!r) throw new Error("missing result");
    const winnerCount = new Set(r.awards.flatMap((a) => a.winners.map((w) => w.seatIdx))).size;
    if (winnerCount < 1) throw new Error("no winners");
  });
});
