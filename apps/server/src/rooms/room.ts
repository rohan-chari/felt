import type { Player, PlayerId, RoomId, RoomSnapshot } from "@felt/shared";

export type RoomState = {
  roomId: RoomId;
  players: Map<PlayerId, Player>;
};

export type RoomEvent =
  | { kind: "playerJoined"; player: Player }
  | { kind: "playerLeft"; playerId: PlayerId };

export function createRoom(roomId: RoomId): RoomState {
  return { roomId, players: new Map() };
}

export function applyEvent(state: RoomState, event: RoomEvent): RoomState {
  const players = new Map(state.players);
  switch (event.kind) {
    case "playerJoined":
      players.set(event.player.id, event.player);
      break;
    case "playerLeft":
      players.delete(event.playerId);
      break;
  }
  return { roomId: state.roomId, players };
}

export function toSnapshot(state: RoomState): RoomSnapshot {
  const players = [...state.players.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { roomId: state.roomId, players };
}
