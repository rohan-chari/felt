import type { Player, PlayerId, RoomId, RoomSnapshot } from "./types.js";

export type ClientMessage = {
  type: "room.join";
  roomId: RoomId;
  playerId: PlayerId;
  displayName: string;
};

export type RoomDelta =
  | { kind: "playerJoined"; player: Player }
  | { kind: "playerLeft"; playerId: PlayerId };

export type ServerMessage =
  | { type: "room.snapshot"; snapshot: RoomSnapshot }
  | { type: "room.delta"; roomId: RoomId; delta: RoomDelta }
  | { type: "error"; code: string; message: string };
