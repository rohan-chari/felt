export type ChipDenom = {
  value: number;
  /** CSS class suffix used for color/style (chip-c-1000, chip-c-500, etc.). */
  className: string;
  /** Human-readable label for the chip face (used in tooltips / accessibility). */
  label: string;
};

/** Standard poker denominations, descending. */
export const CHIP_DENOMS: readonly ChipDenom[] = [
  { value: 1000, className: "chip-c-1000", label: "1K" },
  { value: 500, className: "chip-c-500", label: "500" },
  { value: 100, className: "chip-c-100", label: "100" },
  { value: 25, className: "chip-c-25", label: "25" },
  { value: 5, className: "chip-c-5", label: "5" },
  { value: 1, className: "chip-c-1", label: "1" },
] as const;

const TARGET_MIN_TOP_COUNT = 4;

/**
 * Decompose a dollar amount into chip stacks, picking the largest denom that
 * yields at least 4 chips so single-chip piles never look lonely. Returns
 * { value, count } pairs in descending denom order.
 */
export function chipBreakdown(amount: number): Array<{ value: number; count: number }> {
  if (amount <= 0) return [];
  const integer = Math.floor(amount);

  // Find the largest denom that gives at least TARGET_MIN_TOP_COUNT chips.
  let topIdx = CHIP_DENOMS.length - 1;
  for (let i = 0; i < CHIP_DENOMS.length; i++) {
    const denom = CHIP_DENOMS[i];
    if (!denom) continue;
    if (Math.floor(integer / denom.value) >= TARGET_MIN_TOP_COUNT) {
      topIdx = i;
      break;
    }
  }

  const out: Array<{ value: number; count: number }> = [];
  let remaining = integer;
  for (let i = topIdx; i < CHIP_DENOMS.length; i++) {
    const denom = CHIP_DENOMS[i];
    if (!denom) continue;
    if (remaining < denom.value) continue;
    const count = Math.floor(remaining / denom.value);
    out.push({ value: denom.value, count });
    remaining -= count * denom.value;
  }
  return out;
}

export function denomFor(value: number): ChipDenom | undefined {
  return CHIP_DENOMS.find((d) => d.value === value);
}
