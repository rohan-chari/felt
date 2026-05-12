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
  | { type: "hand.replay"; handId: string }
  | { type: "host.pause" }
  | { type: "host.resume" }
  | { type: "host.kick"; playerId: PlayerId }
  | { type: "host.endSession" }
  | { type: "host.updateSettings"; settings: Partial<import("./types.js").RoomConfig> }
  | { type: "host.transfer"; playerId: PlayerId }
  | { type: "host.addBot"; seatIndex?: number }
  | { type: "host.removeBot"; playerId: PlayerId }
  | { type: "seat.showCards" };

export type RoomDelta =
  | { kind: "playerJoined"; player: Player }
  | { kind: "playerLeft"; playerId: PlayerId }
  | { kind: "hostChanged"; hostId: PlayerId | null }
  | {
      kind: "seatTaken";
      seatIndex: number;
      playerId: PlayerId;
      stack: number;
      isBot?: boolean;
      botPersona?: import("./types.js").BotPersona;
    }
  | { kind: "seatLeft"; seatIndex: number; playerId: PlayerId }
  | { kind: "gameStarted" }
  | { kind: "chat"; message: ChatMessage }
  | { kind: "hand.snapshot"; hand: HandView }
  | { kind: "hand.action"; playerId: PlayerId; action: Action; chipsCommitted: number; isAllIn: boolean }
  | { kind: "nextHandScheduled"; at: number | null }
  | { kind: "seatStackUpdated"; seatIndex: number; playerId: PlayerId; stack: number; busted: boolean }
  | { kind: "buyInsUpdated"; playerId: PlayerId; total: number }
  | { kind: "cashedOutUpdated"; playerId: PlayerId; cashedOut: number }
  | { kind: "pausedChanged"; paused: boolean }
  | { kind: "sessionEnded" }
  | { kind: "configUpdated"; config: import("./types.js").RoomConfig };

export type ServerMessage =
  | { type: "room.snapshot"; snapshot: RoomSnapshot }
  | { type: "room.delta"; roomId: RoomId; delta: RoomDelta }
  | { type: "hand.holeCards"; handId: string; cards: [Card, Card] }
  | { type: "hand.history"; roomId: RoomId; hands: HandRecord[] }
  | { type: "hand.replay"; handId: string; frames: HandView[] }
  | { type: "error"; code: string; message: string };
