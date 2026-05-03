import type {
  Card,
  ChatMessage,
  HandView,
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
  hand: HandView | null;
  nextHandAt: number | null;
  myHoleCards: { handId: string; cards: [Card, Card] } | null;
  /** Fatal error during initial join — replaces the room view. */
  error: string | null;
  /** Transient error from a rejected action — shown as a toast over the room view. Monotonic seq lets the toast component re-trigger when the same error fires twice. */
  transientError: { code: string; message: string; seq: number } | null;
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
  hand: null,
  nextHandAt: null,
  myHoleCards: null,
  error: null,
  transientError: null,
};

function sortById(players: Player[]): Player[] {
  return [...players].sort((a, b) => a.id.localeCompare(b.id));
}

const FRIENDLY_ERRORS: Record<string, string> = {
  name_taken: "That name is already in use in this room. Pick another one.",
  room_not_found: "Room not found — it may have ended.",
  seat_taken: "That seat was just taken. Try another.",
  already_seated: "You're already seated.",
  bad_buyin: "Buy-in is outside the allowed range.",
  not_your_turn: "It's not your turn yet.",
  cannot_check: "You can't check — there's a bet to call.",
  cannot_call: "Nothing to call — check instead.",
  bet_too_small: "Your bet is below the minimum.",
  raise_too_small: "Your raise must exceed the current bet.",
  raise_below_min: "Your raise is below the minimum.",
  not_enough_chips: "You don't have enough chips for that.",
  no_hand: "No hand is in progress yet.",
  not_in_hand: "You're not seated in this hand.",
  not_host: "Only the host can do that.",
  not_enough_players: "Need at least two seated players to start.",
  game_started: "The game has already started.",
  already_started: "The hand has already started.",
  empty_chat: "Type something before sending.",
  chat_too_long: "Message is too long.",
  not_seated: "You're not seated.",
  bad_seat: "That seat doesn't exist.",
  not_in_room: "You're not in this room.",
  no_session: "Session expired — refresh the page.",
};

export function friendlyError(code: string, fallback: string): string {
  return FRIENDLY_ERRORS[code] ?? fallback;
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
        hand: msg.snapshot.hand,
        nextHandAt: msg.snapshot.nextHandAt,
        myHoleCards: state.myHoleCards, // preserve across snapshots
        error: null,
        transientError: state.transientError,
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
            busted: false,
          };
          return { ...state, seats: next };
        }
        case "seatLeft": {
          const next = state.seats.slice();
          next[delta.seatIndex] = { kind: "empty", index: delta.seatIndex };
          return { ...state, seats: next };
        }
        case "seatStackUpdated": {
          const next = state.seats.slice();
          const existing = next[delta.seatIndex];
          if (existing?.kind === "taken") {
            next[delta.seatIndex] = {
              ...existing,
              stack: delta.stack,
              busted: delta.busted,
            };
          }
          return { ...state, seats: next };
        }
        case "gameStarted":
          return { ...state, gameStarted: true };
        case "chat":
          return { ...state, chat: [...state.chat, delta.message] };
        case "hand.snapshot":
          return { ...state, hand: delta.hand };
        case "hand.action":
          // Informational; the snapshot delta carries the new state.
          return state;
        case "nextHandScheduled":
          return { ...state, nextHandAt: delta.at };
      }
      return state;
    }
    case "hand.holeCards":
      return { ...state, myHoleCards: { handId: msg.handId, cards: msg.cards } };
    case "error":
      // Pre-join (haven't received a snapshot yet): fatal — shows the prompt with an error.
      // Post-join: transient — surfaced as a toast.
      if (state.status !== "joined") {
        return { ...state, status: "error", error: friendlyError(msg.code, msg.message) };
      }
      return {
        ...state,
        transientError: {
          code: msg.code,
          message: friendlyError(msg.code, msg.message),
          seq: (state.transientError?.seq ?? 0) + 1,
        },
      };
  }
}
