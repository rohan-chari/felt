import { RANKS, SUITS } from "@felt/shared";
export { RANKS, SUITS } from "@felt/shared";
export type { Card, Rank, Suit } from "@felt/shared";
import type { Card } from "@felt/shared";

const RANK_SET = new Set<string>(RANKS);
const SUIT_SET = new Set<string>(SUITS);

export function isCard(value: unknown): value is Card {
  if (typeof value !== "string" || value.length !== 2) return false;
  return RANK_SET.has(value[0] as string) && SUIT_SET.has(value[1] as string);
}

export function parseCard(s: string): Card {
  if (!isCard(s)) throw new Error(`Invalid card: ${s}`);
  return s;
}

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push(`${r}${s}`);
    }
  }
  return deck;
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
