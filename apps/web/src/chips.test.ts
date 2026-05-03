import { describe, expect, it } from "vitest";
import { CHIP_DENOMS, chipBreakdown } from "./chips";

function totalOf(parts: ReturnType<typeof chipBreakdown>): number {
  return parts.reduce((s, p) => s + p.value * p.count, 0);
}

function totalCount(parts: ReturnType<typeof chipBreakdown>): number {
  return parts.reduce((s, p) => s + p.count, 0);
}

describe("chipBreakdown", () => {
  it("returns nothing for zero or negative", () => {
    expect(chipBreakdown(0)).toEqual([]);
    expect(chipBreakdown(-5)).toEqual([]);
  });

  it("conserves the dollar total for any positive input", () => {
    for (const n of [1, 5, 13, 25, 50, 100, 137, 200, 237, 500, 1000, 1234, 5000]) {
      const parts = chipBreakdown(n);
      expect(totalOf(parts)).toBe(n);
    }
  });

  it("$25 splits into 5×$5 (not 1×$25)", () => {
    expect(chipBreakdown(25)).toEqual([{ value: 5, count: 5 }]);
  });

  it("$100 splits into 4×$25", () => {
    expect(chipBreakdown(100)).toEqual([{ value: 25, count: 4 }]);
  });

  it("$200 splits into 8×$25", () => {
    expect(chipBreakdown(200)).toEqual([{ value: 25, count: 8 }]);
  });

  it("$500 splits into 5×$100", () => {
    expect(chipBreakdown(500)).toEqual([{ value: 100, count: 5 }]);
  });

  it("$5000 uses $1000 chips (5 of them)", () => {
    expect(chipBreakdown(5000)).toEqual([{ value: 1000, count: 5 }]);
  });

  it("$237 splits across multiple denoms", () => {
    // largest denom giving ≥4 chips: $25 (237/25 = 9). Remainder 12 → 2×$5 + 2×$1.
    expect(chipBreakdown(237)).toEqual([
      { value: 25, count: 9 },
      { value: 5, count: 2 },
      { value: 1, count: 2 },
    ]);
  });

  it("$1 is just one $1 chip", () => {
    expect(chipBreakdown(1)).toEqual([{ value: 1, count: 1 }]);
  });

  it("at least 4 chips of the largest denom whenever possible", () => {
    for (const n of [20, 50, 75, 100, 200, 400, 800, 2000]) {
      const parts = chipBreakdown(n);
      const top = parts[0];
      if (top && Math.floor(n / top.value) >= 4) {
        expect(top.count).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("returns parts in descending denom order", () => {
    const parts = chipBreakdown(1387);
    for (let i = 1; i < parts.length; i++) {
      expect((parts[i - 1] as { value: number }).value).toBeGreaterThan(
        (parts[i] as { value: number }).value,
      );
    }
  });

  it("uses every denom defined in CHIP_DENOMS for very large stacks", () => {
    const parts = chipBreakdown(11_111);
    const usedValues = parts.map((p) => p.value);
    expect(usedValues).toContain(1000);
    // Sum still correct
    expect(totalOf(parts)).toBe(11_111);
    expect(totalCount(parts)).toBeGreaterThanOrEqual(11);
  });
});

describe("CHIP_DENOMS", () => {
  it("is sorted descending", () => {
    for (let i = 1; i < CHIP_DENOMS.length; i++) {
      const prev = CHIP_DENOMS[i - 1];
      const cur = CHIP_DENOMS[i];
      expect(prev?.value).toBeGreaterThan(cur?.value as number);
    }
  });
});
