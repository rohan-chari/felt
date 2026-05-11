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
  /** True for messages emitted by the server itself (host audit log entries, etc.). */
  system?: boolean;
};

export type RoomConfig = {
  maxSeats: number;
  minBuyIn: number;
  maxBuyIn: number;
  /** Default buy-in the UI pre-fills (host-tunable). Always within [minBuyIn, maxBuyIn]. */
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  /** Per-turn auto-act timeout. */
  turnTimerMs: number;
  /** Extra time granted by a single time-bank use. */
  timeBankMs: number;
  /** Delay between hand-end and next-hand auto-deal. */
  interHandDelayMs: number;
  /** If false, after each hand ends the room sits idle until the host starts the next hand. */
  autoDealEnabled: boolean;
  /** House rule: if a player elects to reveal one hole card at showdown, both are shown. */
  showOneShowBoth: boolean;
};

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  maxSeats: 8,
  minBuyIn: 100,
  maxBuyIn: 2000,
  startingStack: 200,
  smallBlind: 1,
  bigBlind: 2,
  turnTimerMs: 30_000,
  timeBankMs: 30_000,
  interHandDelayMs: 4000,
  autoDealEnabled: true,
  showOneShowBoth: true,
};

/**
 * Per-player session ledger entry.
 *
 * `total` is the cumulative chips brought in (initial sit + every rebuy).
 * `cashedOut` is the cumulative stack reclaimed via standing up or being
 * kicked. Together they let the client compute live net as
 *   net = (currentStack ?? 0) + cashedOut - total
 * which holds across any sit / stand / re-sit / kick sequence.
 */
export type BuyInLedgerEntry = {
  playerId: PlayerId;
  total: number;
  cashedOut: number;
};

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
  /** Host has paused the room: current hand finishes, but no new hand starts until resume. */
  paused: boolean;
  /** Host has ended the session: room is locked (no new joins, no sit-takes, no hands). */
  ended: boolean;
};
