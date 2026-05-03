import type {
  ChatMessage,
  Player,
  PlayerId,
  RoomConfig,
  RoomId,
  Seat,
  ServerMessage,
} from "@felt/shared";

export type RoomViewState = {
  status: "connecting" | "joined" | "error";
  roomId: RoomId | null;
  hostId: PlayerId | null;
  players: Player[];
  seats: Seat[];
  gameStarted: boolean;
  chat: ChatMessage[];
  config: RoomConfig | null;
  error: string | null;
};

export const initialRoomViewState: RoomViewState = {
  status: "connecting",
  roomId: null,
  hostId: null,
  players: [],
  seats: [],
  gameStarted: false,
  chat: [],
  config: null,
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
        hostId: msg.snapshot.hostId,
        players: sortById(msg.snapshot.players),
        seats: msg.snapshot.seats.slice(),
        gameStarted: msg.snapshot.gameStarted,
        chat: msg.snapshot.chat.slice(),
        config: msg.snapshot.config,
        error: null,
      };
    case "room.delta": {
      const { delta } = msg;
      switch (delta.kind) {
        case "playerJoined": {
          const without = state.players.filter((p) => p.id !== delta.player.id);
          return { ...state, players: sortById([...without, delta.player]) };
        }
        case "playerLeft":
          return { ...state, players: state.players.filter((p) => p.id !== delta.playerId) };
        case "hostChanged":
          return { ...state, hostId: delta.hostId };
        case "seatTaken": {
          const next = state.seats.slice();
          next[delta.seatIndex] = {
            kind: "taken",
            index: delta.seatIndex,
            playerId: delta.playerId,
            stack: delta.stack,
          };
          return { ...state, seats: next };
        }
        case "seatLeft": {
          const next = state.seats.slice();
          next[delta.seatIndex] = { kind: "empty", index: delta.seatIndex };
          return { ...state, seats: next };
        }
        case "gameStarted":
          return { ...state, gameStarted: true };
        case "chat":
          return { ...state, chat: [...state.chat, delta.message] };
      }
      return state;
    }
    case "error":
      return { ...state, status: "error", error: msg.message };
  }
}
