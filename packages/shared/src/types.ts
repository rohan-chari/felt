export type RoomId = string;
export type PlayerId = string;
export type ChatMessageId = string;

export type Player = {
  id: PlayerId;
  displayName: string;
};

export type Seat =
  | { kind: "empty"; index: number }
  | { kind: "taken"; index: number; playerId: PlayerId; stack: number };

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
};
