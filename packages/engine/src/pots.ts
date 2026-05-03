export type Pot = {
  amount: number;
  eligibleSeats: number[];
  /** seatIdx → chips contributed to this pot. Used to refund orphaned pots. */
  contributions: Map<number, number>;
};

function sameMembers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function mergeContributions(
  target: Map<number, number>,
  source: Map<number, number>,
): void {
  for (const [k, v] of source) target.set(k, (target.get(k) ?? 0) + v);
}

export function calculatePots(commitments: readonly number[], folded: ReadonlySet<number>): Pot[] {
  const levels = [...new Set(commitments.filter((c) => c > 0))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const layerSize = level - prev;
    let amount = 0;
    const contributions = new Map<number, number>();
    for (let i = 0; i < commitments.length; i++) {
      const c = commitments[i] ?? 0;
      const take = Math.min(layerSize, Math.max(0, c - prev));
      if (take > 0) {
        amount += take;
        contributions.set(i, take);
      }
    }
    const eligible: number[] = [];
    for (let i = 0; i < commitments.length; i++) {
      const c = commitments[i] ?? 0;
      if (c >= level && !folded.has(i)) eligible.push(i);
    }
    if (amount > 0) {
      const last = pots[pots.length - 1];
      // Merge with previous pot only if eligibility matches AND both are non-empty,
      // so an orphaned (no-eligible) layer is preserved separately for refund.
      if (
        last &&
        eligible.length > 0 &&
        last.eligibleSeats.length > 0 &&
        sameMembers(last.eligibleSeats, eligible)
      ) {
        last.amount += amount;
        mergeContributions(last.contributions, contributions);
      } else {
        pots.push({ amount, eligibleSeats: eligible, contributions });
      }
    }
    prev = level;
  }
  return pots;
}
