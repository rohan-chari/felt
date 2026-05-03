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
  | { type: "chat.send"; text: string };

export type RoomDelta =
  | { kind: "playerJoined"; player: Player }
  | { kind: "playerLeft"; playerId: PlayerId }
  | { kind: "hostChanged"; hostId: PlayerId | null }
  | { kind: "seatTaken"; seatIndex: number; playerId: PlayerId; stack: number }
  | { kind: "seatLeft"; seatIndex: number; playerId: PlayerId }
  | { kind: "gameStarted" }
  | { kind: "chat"; message: ChatMessage };

export type ServerMessage =
  | { type: "room.snapshot"; snapshot: RoomSnapshot }
  | { type: "room.delta"; roomId: RoomId; delta: RoomDelta }
  | { type: "error"; code: string; message: string };
