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
  /** Whether this player has already used their per-hand time bank. */
  timeBankUsed: boolean;
  /** True if the player disconnected mid-hand and was protected as "all-in for committed". */
  sittingOut: boolean;
};

/** Pre-action types a player can queue while it isn't their turn. */
export type PreAction =
  | { kind: "fold" }
  | { kind: "checkFold" }
  | { kind: "callAny" };

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
  /** Engine-seat index (matches HandView.seats[]) of the dealer for this hand. */
  dealerSeatIdx: number;
  /** Engine-seat index of the small blind. In heads-up this equals dealerSeatIdx. */
  sbSeatIdx: number;
  /** Engine-seat index of the big blind. */
  bbSeatIdx: number;
  /** Unix epoch ms when the current actor's turn auto-acts (fold/check). Null if no active turn. */
  currentTurnDeadline: number | null;
  /**
   * SHA-256 of the seed used to shuffle the deck. Published at hand start so
   * players can verify after the hand ends that the seed wasn't manipulated.
   */
  seedHash: string;
  /** Raw seed, revealed only after the hand completes. Null mid-hand. */
  revealedSeed: string | null;
};

/** A persisted log entry for a completed hand. */
export type HandLogEntryView =
  | { kind: "act"; seatIdx: number; action: Action }
  | { kind: "forceFold"; seatIdx: number }
  | { kind: "sitOut"; seatIdx: number };

/**
 * The persisted shape of a completed hand. Used for hand history display +
 * provably-fair audit (replay (seed, actionLog) → identical states).
 */
export type HandRecord = {
  handId: string;
  roomId: string;
  /** Wall-clock time the hand completed (ms). */
  completedAt: number;
  /** Revealed seed for the hand. With seedHash, anyone can audit the shuffle. */
  seed: string;
  seedHash: string;
  /** sb/bb at hand start. */
  blinds: { sb: number; bb: number };
  /** Engine seat index of the dealer. */
  dealerSeatIdx: number;
  /** Per-engine-seat snapshot at hand start (playerId, displayName, startingStack, holeCards). */
  seats: Array<{
    seatIdx: number;
    playerId: PlayerId;
    displayName: string;
    startingStack: number;
    /**
     * Hole cards dealt to this seat. Persisted unconditionally; the server
     * filters before sending to clients (own cards always, others only if
     * they reached showdown without folding).
     */
    holeCards: readonly [Card, Card] | null;
    /** True if this seat folded (server uses this to gate hole-card reveal). */
    isFolded: boolean;
  }>;
  /** Final board cards (0–5). */
  board: Card[];
  /** Action log in original order. Replay-safe with (seed, blinds, dealer, seats[].startingStack). */
  actionLog: HandLogEntryView[];
  /** Pot awards + final stacks. */
  result: HandResultView;
};
