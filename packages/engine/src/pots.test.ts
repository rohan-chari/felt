import { describe, expect, it } from "vitest";
import { calculatePots } from "./pots.js";

describe("calculatePots", () => {
  it("single pot when everyone committed equally", () => {
    const pots = calculatePots([100, 100, 100], new Set());
    expect(pots).toHaveLength(1);
    expect(pots[0]).toMatchObject({ amount: 300, eligibleSeats: [0, 1, 2] });
  });

  it("excludes folded players from eligibility but counts their contribution", () => {
    const pots = calculatePots([100, 100, 100], new Set([0]));
    expect(pots).toHaveLength(1);
    expect(pots[0]).toMatchObject({ amount: 300, eligibleSeats: [1, 2] });
  });

  it("creates two pots for one short all-in", () => {
    const pots = calculatePots([50, 100, 100], new Set());
    expect(pots.map((p) => ({ amount: p.amount, eligibleSeats: p.eligibleSeats }))).toEqual([
      { amount: 150, eligibleSeats: [0, 1, 2] },
      { amount: 100, eligibleSeats: [1, 2] },
    ]);
  });

  it("creates three pots for two short stacks at different levels", () => {
    const pots = calculatePots([30, 70, 100], new Set());
    expect(pots.map((p) => ({ amount: p.amount, eligibleSeats: p.eligibleSeats }))).toEqual([
      { amount: 90, eligibleSeats: [0, 1, 2] },
      { amount: 80, eligibleSeats: [1, 2] },
      { amount: 30, eligibleSeats: [2] },
    ]);
  });

  it("merges adjacent layers with identical eligibility (folded short stack)", () => {
    const pots = calculatePots([50, 100, 100], new Set([0]));
    expect(pots).toHaveLength(1);
    expect(pots[0]).toMatchObject({ amount: 250, eligibleSeats: [1, 2] });
  });

  it("zero commitments produce no pots", () => {
    expect(calculatePots([0, 0, 0], new Set())).toEqual([]);
  });

  it("ignores zero-commitment seats but includes them as candidates", () => {
    const pots = calculatePots([100, 100, 0], new Set());
    expect(pots).toHaveLength(1);
    expect(pots[0]).toMatchObject({ amount: 200, eligibleSeats: [0, 1] });
  });

  it("conservation: sum of pot amounts equals sum of commitments", () => {
    const cases: Array<[number[], Set<number>]> = [
      [[10, 20, 30], new Set()],
      [[10, 20, 30], new Set([0])],
      [[100, 100, 100, 100], new Set()],
      [[50, 50, 100, 200], new Set([1])],
      [[5, 5, 5, 5, 5, 100], new Set()],
    ];
    for (const [commits, folded] of cases) {
      const pots = calculatePots(commits, folded);
      const total = pots.reduce((s, p) => s + p.amount, 0);
      const expected = commits.reduce((s, c) => s + c, 0);
      expect(total).toBe(expected);
    }
  });

  it("orphaned pot (no eligible) is still emitted with empty eligibleSeats and contribution map", () => {
    // Commitments [50, 87, 124, 138, 138], all of seats 3 and 4 fold.
    // Layer 124-138 contributed only by 3 and 4 (both folded) → orphaned.
    const pots = calculatePots([50, 87, 124, 138, 138], new Set([3, 4]));
    const last = pots[pots.length - 1];
    expect(last).toBeDefined();
    expect(last?.eligibleSeats).toEqual([]);
    expect(last?.amount).toBe(28);
    expect(last?.contributions.get(3)).toBe(14);
    expect(last?.contributions.get(4)).toBe(14);
  });

  it("conservation holds with orphan pots present", () => {
    const pots = calculatePots([50, 87, 124, 138, 138], new Set([3, 4]));
    const total = pots.reduce((s, p) => s + p.amount, 0);
    expect(total).toBe(50 + 87 + 124 + 138 + 138);
  });
});
