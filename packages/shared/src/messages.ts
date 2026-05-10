import type { Card } from "./cards.js";
import type { Action, HandRecord, HandView, PreAction } from "./hand.js";
import type { ChatMessage, Player, PlayerId, RoomId, RoomSnapshot } from "./types.js";

export type ClientMessage =
  | {
      type: "room.join";
      roomId: RoomId;
      playerId: PlayerId;
      displayName: string;
    }
  | { type: "seat.take"; seatIndex: number; buyIn: number }
  | { type: "seat.leave" }
  | { type: "game.start" }
  | { type: "chat.send"; text: string }
  | { type: "hand.action"; action: Action }
  | { type: "seat.rebuy"; amount: number }
  | { type: "hand.useTimeBank" }
  | { type: "hand.preAction"; preAction: PreAction }
  | { type: "hand.cancelPreAction" }
  | { type: "hand.history" }
  | { type: "hand.replay"; handId: string };

export type RoomDelta =
  | { kind: "playerJoined"; player: Player }
  | { kind: "playerLeft"; playerId: PlayerId }
  | { kind: "hostChanged"; hostId: PlayerId | null }
  | { kind: "seatTaken"; seatIndex: number; playerId: PlayerId; stack: number }
  | { kind: "seatLeft"; seatIndex: number; playerId: PlayerId }
  | { kind: "gameStarted" }
  | { kind: "chat"; message: ChatMessage }
  | { kind: "hand.snapshot"; hand: HandView }
  | { kind: "hand.action"; playerId: PlayerId; action: Action; chipsCommitted: number; isAllIn: boolean }
  | { kind: "nextHandScheduled"; at: number | null }
  | { kind: "seatStackUpdated"; seatIndex: number; playerId: PlayerId; stack: number; busted: boolean }
  | { kind: "buyInsUpdated"; playerId: PlayerId; total: number };

export type ServerMessage =
  | { type: "room.snapshot"; snapshot: RoomSnapshot }
  | { type: "room.delta"; roomId: RoomId; delta: RoomDelta }
  | { type: "hand.holeCards"; handId: string; cards: [Card, Card] }
  | { type: "hand.history"; roomId: RoomId; hands: HandRecord[] }
  | { type: "hand.replay"; handId: string; frames: HandView[] }
  | { type: "error"; code: string; message: string };
