import type { Player, RoomId, ServerMessage } from "@felt/shared";

export type RoomViewState = {
  status: "connecting" | "joined" | "error";
  roomId: RoomId | null;
  players: Player[];
  error: string | null;
};

export const initialRoomViewState: RoomViewState = {
  status: "connecting",
  roomId: null,
  players: [],
  error: null,
};

function sortById(players: Player[]): Player[] {
  return [...players].sort((a, b) => a.id.localeCompare(b.id));
}

export function applyServerMessage(state: RoomViewState, msg: ServerMessage): RoomViewState {
  switch (msg.type) {
    case "room.snapshot":
      return {
        status: "joined",
        roomId: msg.snapshot.roomId,
        players: sortById(msg.snapshot.players),
        error: null,
      };
    case "room.delta": {
      const { delta } = msg;
      if (delta.kind === "playerJoined") {
        const without = state.players.filter((p) => p.id !== delta.player.id);
        return { ...state, players: sortById([...without, delta.player]) };
      }
      return {
        ...state,
        players: state.players.filter((p) => p.id !== delta.playerId),
      };
    }
    case "error":
      return { ...state, status: "error", error: msg.message };
  }
}
