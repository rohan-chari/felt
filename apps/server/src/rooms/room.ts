import {
  type ChatMessage,
  type ChatMessageId,
  DEFAULT_ROOM_CONFIG,
  type Player,
  type PlayerId,
  type RoomConfig,
  type RoomDelta,
  type RoomId,
  type RoomSnapshot,
  type Seat,
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
  /** Slot index of the dealer for the NEXT hand. Server rotates after each hand. */
  nextDealerSlot: number;
  /** Unix epoch ms when the next hand will auto-deal, if scheduled. */
  nextHandAt: number | null;
  /** Total chips bought in (initial sit + rebuys) per playerId. Survives stand-up + re-sit. */
  buyIns: Map<PlayerId, number>;
  /** Cumulative chips reclaimed at standup / kick (sum of stack at each departure). */
  cashedOuts: Map<PlayerId, number>;
  /** Host paused the room — current hand finishes, no new hand auto-starts until resume. */
  paused: boolean;
  /** Host ended the session — room is locked (no new joins, no sit-takes, no hands). */
  ended: boolean;
};

const DEFAULT_CONFIG: InternalRoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  chatLimit: 50,
};

export type RoomEvent =
  | { kind: "playerJoined"; player: Player }
  | { kind: "playerLeft"; playerId: PlayerId }
  | { kind: "hostChanged"; hostId: PlayerId | null }
  | { kind: "seatTaken"; seatIndex: number; playerId: PlayerId; stack: number }
  | { kind: "seatLeft"; seatIndex: number }
  | { kind: "seatStackUpdated"; seatIndex: number; stack: number; busted: boolean }
  | { kind: "gameStarted" }
  | { kind: "chatMessage"; message: ChatMessage }
  | { kind: "nextHandScheduled"; at: number | null }
  | { kind: "nextDealerSlotSet"; slot: number }
  | { kind: "buyInIncreased"; playerId: PlayerId; amount: number }
  | { kind: "cashedOutIncreased"; playerId: PlayerId; amount: number }
  | { kind: "pausedChanged"; paused: boolean }
  | { kind: "sessionEnded" }
  | { kind: "configReplaced"; config: InternalRoomConfig };

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
    nextDealerSlot: 0,
    nextHandAt: null,
    buyIns: new Map(),
    cashedOuts: new Map(),
    paused: false,
    ended: false,
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
    nextDealerSlot: state.nextDealerSlot,
    nextHandAt: state.nextHandAt,
    buyIns: new Map(state.buyIns),
    cashedOuts: new Map(state.cashedOuts),
    paused: state.paused,
    ended: state.ended,
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
        busted: false,
      };
      return next;
    case "seatLeft":
      next.seats[event.seatIndex] = { kind: "empty", index: event.seatIndex };
      return next;
    case "seatStackUpdated": {
      const seat = next.seats[event.seatIndex];
      if (seat?.kind === "taken") {
        next.seats[event.seatIndex] = {
          ...seat,
          stack: event.stack,
          busted: event.busted,
        };
      }
      return next;
    }
    case "gameStarted":
      next.gameStarted = true;
      return next;
    case "chatMessage": {
      next.chat = [...next.chat, event.message];
      const overflow = next.chat.length - next.config.chatLimit;
      if (overflow > 0) next.chat = next.chat.slice(overflow);
      return next;
    }
    case "nextHandScheduled":
      next.nextHandAt = event.at;
      return next;
    case "nextDealerSlotSet":
      next.nextDealerSlot = event.slot;
      return next;
    case "buyInIncreased": {
      const prev = next.buyIns.get(event.playerId) ?? 0;
      next.buyIns.set(event.playerId, prev + event.amount);
      return next;
    }
    case "cashedOutIncreased": {
      const prev = next.cashedOuts.get(event.playerId) ?? 0;
      next.cashedOuts.set(event.playerId, prev + event.amount);
      return next;
    }
    case "hostChanged":
      next.hostId = event.hostId;
      return next;
    case "pausedChanged":
      next.paused = event.paused;
      return next;
    case "sessionEnded":
      next.ended = true;
      return next;
    case "configReplaced":
      next.config = event.config;
      return next;
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
      // Players can sit any time, including while a game is in progress —
      // they get dealt in starting the next hand. (See Phase 5: mid-session join.)
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
      startingStack: state.config.startingStack,
      smallBlind: state.config.smallBlind,
      bigBlind: state.config.bigBlind,
      turnTimerMs: state.config.turnTimerMs,
      timeBankMs: state.config.timeBankMs,
      interHandDelayMs: state.config.interHandDelayMs,
      autoDealEnabled: state.config.autoDealEnabled,
      showOneShowBoth: state.config.showOneShowBoth,
    },
    hand: null, // Manager merges in active handView before sending.
    nextHandAt: state.nextHandAt,
    buyIns: [...new Set([...state.buyIns.keys(), ...state.cashedOuts.keys()])].map(
      (playerId) => ({
        playerId,
        total: state.buyIns.get(playerId) ?? 0,
        cashedOut: state.cashedOuts.get(playerId) ?? 0,
      }),
    ),
    paused: state.paused,
    ended: state.ended,
  };
}
