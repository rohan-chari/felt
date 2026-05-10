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
  /**
   * True if the seat is sitting out the current hand (e.g., player disconnected
   * mid-hand and is being protected as "all-in for committed"). Engine skips
   * them in turn order but their committed chips remain in the pot and their
   * hole cards still play at showdown for what they committed.
   */
  sittingOut: boolean;
  /** True once the player has spent their per-hand time bank. Manager-set; engine just stores. */
  timeBankUsed: boolean;
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

/**
 * A persisted record of a single state-mutating operation. Used for hand
 * history display and to drive deterministic replays. `act` covers normal
 * player actions through `applyAction`; `forceFold` and `sitOut` cover
 * the engine's external interventions (host kicks, mid-hand disconnect).
 */
export type HandLogEntry =
  | { kind: "act"; seatIdx: number; action: Action }
  | { kind: "forceFold"; seatIdx: number }
  | { kind: "sitOut"; seatIdx: number };

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
  /** Append-only log of every operation that mutated this state. */
  actionLog: HandLogEntry[];
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
