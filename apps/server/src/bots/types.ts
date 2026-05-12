import type { Action, BotPersona, Card } from "@felt/shared";

/** Decision context passed to the bot decider — everything the model needs to act. */
export type BotDecisionInput = {
  persona: BotPersona;
  /** The bot's hole cards. */
  holeCards: readonly [Card, Card];
  /** Community cards on the table (0–5). */
  board: readonly Card[];
  street: "preflop" | "flop" | "turn" | "river";
  /** Total chips in the pot (including chips already committed this round). */
  pot: number;
  /** Chips the bot still needs to put in to call. 0 if checking is legal. */
  toCall: number;
  /** Bot's current stack. */
  stack: number;
  /** Smallest legal raise INCREMENT above the current toMatch. */
  minRaiseTo: number;
  /** Big blind (for sizing reasoning). */
  bigBlind: number;
  /** Friendly-formatted action log from this hand (preflop through current street). */
  actionLog: string;
  /** Public stack/state of opponents still in the hand. */
  opponents: Array<{ stack: number; committedThisRound: number; isFolded: boolean; isAllIn: boolean }>;
};

/**
 * Returns a legal Action the bot wants to take, or null on any failure
 * (network error, bad response, etc.) — caller falls back to check/fold.
 */
export type BotDecider = (input: BotDecisionInput) => Promise<Action | null>;
