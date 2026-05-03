import type { Card } from "./cards.js";
import type { Pot } from "./pots.js";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";

export type Action =
  | { kind: "fold" }
  | { kind: "check" }
  | { kind: "call" }
  | { kind: "bet"; amount: number }
  | { kind: "raise"; to: number };

export type SeatState = {
  idx: number;
  playerId: string;
  startingStack: number;
  stack: number;
  holeCards: readonly [Card, Card] | null;
  committedThisRound: number;
  totalCommitted: number;
  hasActed: boolean;
  isFolded: boolean;
  isAllIn: boolean;
};

export type HandConfig = {
  sb: number;
  bb: number;
};

export type PotAward = {
  amount: number;
  winners: Array<{
    seatIdx: number;
    amount: number;
    handName: string;
    handDescr: string;
  }>;
};

export type HandResult = {
  pots: Pot[];
  awards: PotAward[];
  finalStacks: number[];
};

export type HandState = {
  handId: string;
  seed: string;
  config: HandConfig;
  street: Street;
  deck: Card[];
  board: Card[];
  seats: SeatState[];
  dealerIdx: number;
  currentSeatIdx: number | null;
  toMatch: number;
  lastRaiseSize: number;
  result: HandResult | null;
};

export type Effect =
  | {
      kind: "blindsPosted";
      smallSeat: number;
      smallBlind: number;
      bigSeat: number;
      bigBlind: number;
    }
  | { kind: "holeCardsDealt"; seatIdx: number; cards: readonly [Card, Card] }
  | {
      kind: "actionTaken";
      seatIdx: number;
      action: Action;
      chipsCommitted: number;
      isAllIn: boolean;
    }
  | { kind: "streetAdvanced"; street: Street; cardsDealt: Card[]; board: Card[] }
  | { kind: "turnChanged"; seatIdx: number }
  | { kind: "handComplete"; result: HandResult };

export type ApplyOk = { ok: true; state: HandState; effects: Effect[] };
export type ApplyErr = { ok: false; code: string; message: string };
export type ApplyResult = ApplyOk | ApplyErr;

export type StartHandOptions = {
  handId: string;
  seats: Array<{ playerId: string; stack: number }>;
  dealerIdx: number;
  blinds: HandConfig;
  seed: string;
};
