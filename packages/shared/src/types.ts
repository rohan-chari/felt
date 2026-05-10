export type RoomId = string;
export type PlayerId = string;
export type ChatMessageId = string;

export type Player = {
  id: PlayerId;
  displayName: string;
};

export type Seat =
  | { kind: "empty"; index: number }
  | {
      kind: "taken";
      index: number;
      playerId: PlayerId;
      stack: number;
      /** True after the player loses their stack to 0; they need to rebuy to play again. */
      busted: boolean;
    };

export type ChatMessage = {
  id: ChatMessageId;
  playerId: PlayerId;
  displayName: string;
  text: string;
  ts: number;
};

export type RoomConfig = {
  maxSeats: number;
  minBuyIn: number;
  maxBuyIn: number;
};

/**
 * Total chips a player has bought into this session, summed across the initial
 * sit-down and any rebuys. Used by the ledger to compute net (current stack -
 * total buy-in). Players who stand up + re-sit accumulate.
 */
export type BuyInLedgerEntry = { playerId: PlayerId; total: number };

export type RoomSnapshot = {
  roomId: RoomId;
  hostId: PlayerId | null;
  players: Player[];
  seats: Seat[];
  gameStarted: boolean;
  chat: ChatMessage[];
  config: RoomConfig;
  /** Public view of the current hand, if one is in progress (or the most recently completed). */
  hand: import("./hand.js").HandView | null;
  /** Unix epoch ms when the next hand will auto-deal, if scheduled. */
  nextHandAt: number | null;
  /** Per-player total chips bought in (initial sit + rebuys). */
  buyIns: BuyInLedgerEntry[];
};
