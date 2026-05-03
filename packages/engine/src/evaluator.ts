/// <reference path="./pokersolver.d.ts" />
import pokersolver, { type Hand as PokersolverHand } from "pokersolver";
import type { Card } from "./cards.js";

const { Hand } = pokersolver;

export type EvalResult = {
  rank: number;
  name: string;
  descr: string;
};

export function evaluate(cards: Card[]): EvalResult {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`evaluate requires 5–7 cards, got ${cards.length}`);
  }
  const hand = Hand.solve(cards.slice());
  return {
    rank: hand.rank,
    name: hand.name,
    descr: hand.descr,
  };
}

export function winners(holeCards: Card[][], board: Card[]): number[] {
  if (board.length !== 5) {
    throw new Error(`winners requires a 5-card board, got ${board.length}`);
  }
  const hands = holeCards.map((holes) => {
    if (holes.length !== 2) {
      throw new Error(`each holes set must be 2 cards, got ${holes.length}`);
    }
    return Hand.solve([...holes, ...board]);
  });
  const winningHands = Hand.winners(hands);
  const indices: number[] = [];
  for (let i = 0; i < hands.length; i++) {
    if (winningHands.includes(hands[i] as PokersolverHand)) indices.push(i);
  }
  return indices;
}
