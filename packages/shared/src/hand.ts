import type { Card } from "./cards.js";
import type { PlayerId } from "./types.js";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";

export type Action =
  | { kind: "fold" }
  | { kind: "check" }
  | { kind: "call" }
  | { kind: "bet"; amount: number }
  | { kind: "raise"; to: number };

export type HandSeatView = {
  playerId: PlayerId;
  stack: number;
  committedThisRound: number;
  totalCommitted: number;
  isFolded: boolean;
  isAllIn: boolean;
  /** Revealed only at showdown for non-folded players. Null otherwise. */
  holeCards: readonly [Card, Card] | null;
};

export type HandPotView = {
  amount: number;
  eligiblePlayerIds: PlayerId[];
};

export type HandPotAwardView = {
  amount: number;
  winners: Array<{
    playerId: PlayerId;
    amount: number;
    handName: string;
    handDescr: string;
  }>;
};

export type HandResultView = {
  awards: HandPotAwardView[];
  finalStacks: Array<{ playerId: PlayerId; stack: number }>;
};

export type HandView = {
  handId: string;
  street: Street;
  board: Card[];
  seats: HandSeatView[];
  currentPlayerId: PlayerId | null;
  toMatch: number;
  lastRaiseSize: number;
  result: HandResultView | null;
};
