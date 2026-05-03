import type { Action, Card, Street } from "@felt/shared";
import type { Pot } from "./pots.js";

export type { Action, Street } from "@felt/shared";

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
