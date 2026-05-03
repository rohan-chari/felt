import { describe, expect, it } from "vitest";
import {
  type Card,
  freshDeck,
  hashSeed,
  isCard,
  mulberry32,
  parseCard,
  RANKS,
  shuffle,
  SUITS,
} from "./cards.js";

describe("cards", () => {
  it("RANKS and SUITS have expected sizes", () => {
    expect(RANKS).toHaveLength(13);
    expect(SUITS).toHaveLength(4);
  });

  it("isCard validates well-formed cards", () => {
    expect(isCard("Ah")).toBe(true);
    expect(isCard("Td")).toBe(true);
    expect(isCard("2c")).toBe(true);
    expect(isCard("Xh")).toBe(false);
    expect(isCard("Ax")).toBe(false);
    expect(isCard("AH")).toBe(false);
    expect(isCard("a")).toBe(false);
    expect(isCard("Ahh")).toBe(false);
  });

  it("parseCard returns the card or throws", () => {
    expect(parseCard("Ah")).toBe("Ah" as Card);
    expect(() => parseCard("Xh")).toThrow();
  });
});

describe("freshDeck", () => {
  it("returns 52 cards", () => {
    expect(freshDeck()).toHaveLength(52);
  });

  it("contains every (rank, suit) combination exactly once", () => {
    const deck = freshDeck();
    const set = new Set(deck);
    expect(set.size).toBe(52);
    for (const r of RANKS) {
      for (const s of SUITS) {
        expect(set.has(`${r}${s}`)).toBe(true);
      }
    }
  });

  it("is deterministic across calls", () => {
    expect(freshDeck()).toEqual(freshDeck());
  });
});

describe("hashSeed + mulberry32", () => {
  it("hashSeed is deterministic", () => {
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    expect(hashSeed("abc")).not.toBe(hashSeed("abd"));
  });

  it("mulberry32 is deterministic for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it("mulberry32 produces values in [0, 1)", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("different seeds produce different streams", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });
});

describe("shuffle", () => {
  it("preserves all elements (multiset equality)", () => {
    const deck = freshDeck();
    const out = shuffle(deck, mulberry32(123));
    expect(out).toHaveLength(52);
    expect(new Set(out)).toEqual(new Set(deck));
  });

  it("does not mutate the input", () => {
    const deck = freshDeck();
    const before = deck.slice();
    shuffle(deck, mulberry32(123));
    expect(deck).toEqual(before);
  });

  it("is deterministic for a given seed", () => {
    const a = shuffle(freshDeck(), mulberry32(7));
    const b = shuffle(freshDeck(), mulberry32(7));
    expect(a).toEqual(b);
  });

  it("different seeds produce different orders", () => {
    const a = shuffle(freshDeck(), mulberry32(1));
    const b = shuffle(freshDeck(), mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it("seeded by string via hashSeed is stable", () => {
    const a = shuffle(freshDeck(), mulberry32(hashSeed("hand-1")));
    const b = shuffle(freshDeck(), mulberry32(hashSeed("hand-1")));
    expect(a).toEqual(b);
  });
});
