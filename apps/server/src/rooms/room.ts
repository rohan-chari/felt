import type {
  ChatMessage,
  ChatMessageId,
  Player,
  PlayerId,
  RoomConfig,
  RoomDelta,
  RoomId,
  RoomSnapshot,
  Seat,
} from "@felt/shared";

export type InternalRoomConfig = RoomConfig & { chatLimit: number };

export type RoomState = {
  roomId: RoomId;
  config: InternalRoomConfig;
  hostId: PlayerId | null;
  players: Map<PlayerId, Player>;
  seats: Seat[];
  gameStarted: boolean;
  chat: ChatMessage[];
};

const DEFAULT_CONFIG: InternalRoomConfig = {
  maxSeats: 8,
  minBuyIn: 100,
  maxBuyIn: 500,
  chatLimit: 50,
};

export type RoomEvent =
  | { kind: "playerJoined"; player: Player }
  | { kind: "playerLeft"; playerId: PlayerId }
  | { kind: "seatTaken"; seatIndex: number; playerId: PlayerId; stack: number }
  | { kind: "seatLeft"; seatIndex: number }
  | { kind: "gameStarted" }
  | { kind: "chatMessage"; message: ChatMessage };

export type RoomIntent =
  | { kind: "seatTake"; playerId: PlayerId; seatIndex: number; buyIn: number }
  | { kind: "seatLeave"; playerId: PlayerId }
  | { kind: "gameStart"; playerId: PlayerId }
  | {
      kind: "chatSend";
      playerId: PlayerId;
      text: string;
      chatId: ChatMessageId;
      ts: number;
    };

export type IntentResult =
  | { ok: true; state: RoomState; delta: RoomDelta }
  | { ok: false; code: string; message: string };

export function createRoom(roomId: RoomId, config?: Partial<InternalRoomConfig>): RoomState {
  const merged: InternalRoomConfig = { ...DEFAULT_CONFIG, ...config };
  const seats: Seat[] = Array.from({ length: merged.maxSeats }, (_, index) => ({
    kind: "empty",
    index,
  }));
  return {
    roomId,
    config: merged,
    hostId: null,
    players: new Map(),
    seats,
    gameStarted: false,
    chat: [],
  };
}

function cloneState(state: RoomState): RoomState {
  return {
    roomId: state.roomId,
    config: state.config,
    hostId: state.hostId,
    players: new Map(state.players),
    seats: state.seats.slice(),
    gameStarted: state.gameStarted,
    chat: state.chat.slice(),
  };
}

export function applyEvent(state: RoomState, event: RoomEvent): RoomState {
  const next = cloneState(state);
  switch (event.kind) {
    case "playerJoined":
      next.players.set(event.player.id, event.player);
      if (next.hostId === null) next.hostId = event.player.id;
      return next;
    case "playerLeft":
      next.players.delete(event.playerId);
      return next;
    case "seatTaken":
      next.seats[event.seatIndex] = {
        kind: "taken",
        index: event.seatIndex,
        playerId: event.playerId,
        stack: event.stack,
      };
      return next;
    case "seatLeft":
      next.seats[event.seatIndex] = { kind: "empty", index: event.seatIndex };
      return next;
    case "gameStarted":
      next.gameStarted = true;
      return next;
    case "chatMessage": {
      next.chat = [...next.chat, event.message];
      const overflow = next.chat.length - next.config.chatLimit;
      if (overflow > 0) next.chat = next.chat.slice(overflow);
      return next;
    }
  }
}

function findSeatOf(state: RoomState, playerId: PlayerId): number {
  for (let i = 0; i < state.seats.length; i++) {
    const seat = state.seats[i];
    if (seat?.kind === "taken" && seat.playerId === playerId) return i;
  }
  return -1;
}

function reject(code: string, message: string): IntentResult {
  return { ok: false, code, message };
}

export function applyIntent(state: RoomState, intent: RoomIntent): IntentResult {
  switch (intent.kind) {
    case "seatTake": {
      if (intent.seatIndex < 0 || intent.seatIndex >= state.seats.length) {
        return reject("bad_seat", `Seat ${intent.seatIndex} is out of range`);
      }
      if (state.gameStarted) {
        return reject("game_started", "Game has already started");
      }
      if (!state.players.has(intent.playerId)) {
        return reject("not_in_room", "You are not in this room");
      }
      const seat = state.seats[intent.seatIndex];
      if (!seat || seat.kind !== "empty") {
        return reject("seat_taken", `Seat ${intent.seatIndex} is taken`);
      }
      if (findSeatOf(state, intent.playerId) !== -1) {
        return reject("already_seated", "You are already seated");
      }
      if (intent.buyIn < state.config.minBuyIn || intent.buyIn > state.config.maxBuyIn) {
        return reject(
          "bad_buyin",
          `Buy-in must be between ${state.config.minBuyIn} and ${state.config.maxBuyIn}`,
        );
      }
      const next = applyEvent(state, {
        kind: "seatTaken",
        seatIndex: intent.seatIndex,
        playerId: intent.playerId,
        stack: intent.buyIn,
      });
      return {
        ok: true,
        state: next,
        delta: {
          kind: "seatTaken",
          seatIndex: intent.seatIndex,
          playerId: intent.playerId,
          stack: intent.buyIn,
        },
      };
    }
    case "seatLeave": {
      const seatIndex = findSeatOf(state, intent.playerId);
      if (seatIndex === -1) return reject("not_seated", "You are not seated");
      const next = applyEvent(state, { kind: "seatLeft", seatIndex });
      return {
        ok: true,
        state: next,
        delta: { kind: "seatLeft", seatIndex, playerId: intent.playerId },
      };
    }
    case "gameStart": {
      if (intent.playerId !== state.hostId) return reject("not_host", "Only the host can start");
      if (state.gameStarted) return reject("already_started", "Game has already started");
      const seated = state.seats.filter((s) => s.kind === "taken").length;
      if (seated < 2) return reject("not_enough_players", "Need at least 2 seated players");
      const next = applyEvent(state, { kind: "gameStarted" });
      return { ok: true, state: next, delta: { kind: "gameStarted" } };
    }
    case "chatSend": {
      if (!state.players.has(intent.playerId)) {
        return reject("not_in_room", "You are not in this room");
      }
      const trimmed = intent.text.trim();
      if (trimmed.length === 0) return reject("empty_chat", "Message is empty");
      if (intent.text.length > 500) return reject("chat_too_long", "Message is too long");
      const player = state.players.get(intent.playerId);
      const message: ChatMessage = {
        id: intent.chatId,
        playerId: intent.playerId,
        displayName: player?.displayName ?? "?",
        text: trimmed,
        ts: intent.ts,
      };
      const next = applyEvent(state, { kind: "chatMessage", message });
      return { ok: true, state: next, delta: { kind: "chat", message } };
    }
  }
}

export function toSnapshot(state: RoomState): RoomSnapshot {
  const players = [...state.players.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    roomId: state.roomId,
    hostId: state.hostId,
    players,
    seats: state.seats.slice(),
    gameStarted: state.gameStarted,
    chat: state.chat.slice(),
    config: {
      maxSeats: state.config.maxSeats,
      minBuyIn: state.config.minBuyIn,
      maxBuyIn: state.config.maxBuyIn,
    },
  };
}
