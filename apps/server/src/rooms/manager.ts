import { randomUUID } from "node:crypto";
import type { PlayerId, RoomDelta, RoomId, ServerMessage } from "@felt/shared";
import {
  applyEvent,
  applyIntent,
  createRoom,
  type RoomState,
  toSnapshot,
} from "./room.js";

export type SessionId = string;

export type Effect = {
  sessionId: SessionId;
  message: ServerMessage;
};

type SessionInfo = {
  roomId: RoomId;
  playerId: PlayerId;
};

type JoinArgs = {
  sessionId: SessionId;
  roomId: RoomId;
  playerId: PlayerId;
  displayName: string;
};

type IntentError = { error: { code: string; message: string } };

const ROOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_ID_LENGTH = 6;

function generateRoomId(): RoomId {
  let id = "";
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    const idx = Math.floor(Math.random() * ROOM_ID_ALPHABET.length);
    id += ROOM_ID_ALPHABET[idx];
  }
  return id;
}

function findSeatOf(state: RoomState, playerId: PlayerId): number {
  for (let i = 0; i < state.seats.length; i++) {
    const seat = state.seats[i];
    if (seat?.kind === "taken" && seat.playerId === playerId) return i;
  }
  return -1;
}

export class RoomManager {
  private rooms = new Map<RoomId, RoomState>();
  private sessions = new Map<SessionId, SessionInfo>();

  createRoom(): RoomId {
    let id = generateRoomId();
    while (this.rooms.has(id)) id = generateRoomId();
    this.rooms.set(id, createRoom(id));
    return id;
  }

  hasRoom(roomId: RoomId): boolean {
    return this.rooms.has(roomId);
  }

  private sessionsInRoom(roomId: RoomId, except?: SessionId): SessionId[] {
    const out: SessionId[] = [];
    for (const [sid, info] of this.sessions) {
      if (info.roomId !== roomId) continue;
      if (sid === except) continue;
      out.push(sid);
    }
    return out;
  }

  private playerHasOtherSessions(roomId: RoomId, playerId: PlayerId): boolean {
    for (const info of this.sessions.values()) {
      if (info.roomId === roomId && info.playerId === playerId) return true;
    }
    return false;
  }

  private broadcastDelta(roomId: RoomId, delta: RoomDelta, except?: SessionId): Effect[] {
    const message: ServerMessage = { type: "room.delta", roomId, delta };
    return this.sessionsInRoom(roomId, except).map((sessionId) => ({ sessionId, message }));
  }

  handleJoin(args: JoinArgs): Effect[] | IntentError {
    const room = this.rooms.get(args.roomId);
    if (!room) {
      return { error: { code: "room_not_found", message: `Room ${args.roomId} does not exist` } };
    }

    const player = { id: args.playerId, displayName: args.displayName };
    const wasPresent = room.players.has(args.playerId);
    const updated = applyEvent(room, { kind: "playerJoined", player });
    this.rooms.set(args.roomId, updated);
    this.sessions.set(args.sessionId, { roomId: args.roomId, playerId: args.playerId });

    const effects: Effect[] = [
      {
        sessionId: args.sessionId,
        message: { type: "room.snapshot", snapshot: toSnapshot(updated) },
      },
    ];

    if (!wasPresent) {
      effects.push(
        ...this.broadcastDelta(
          args.roomId,
          { kind: "playerJoined", player },
          args.sessionId,
        ),
      );
    }

    return effects;
  }

  handleLeave(sessionId: SessionId): Effect[] {
    const info = this.sessions.get(sessionId);
    if (!info) return [];
    this.sessions.delete(sessionId);

    if (this.playerHasOtherSessions(info.roomId, info.playerId)) return [];

    const room = this.rooms.get(info.roomId);
    if (!room) return [];

    let next = room;
    const deltas: RoomDelta[] = [];

    const seatIndex = findSeatOf(next, info.playerId);
    if (seatIndex !== -1) {
      next = applyEvent(next, { kind: "seatLeft", seatIndex });
      deltas.push({ kind: "seatLeft", seatIndex, playerId: info.playerId });
    }

    next = applyEvent(next, { kind: "playerLeft", playerId: info.playerId });
    deltas.push({ kind: "playerLeft", playerId: info.playerId });

    this.rooms.set(info.roomId, next);

    const effects: Effect[] = [];
    for (const delta of deltas) {
      effects.push(...this.broadcastDelta(info.roomId, delta));
    }
    return effects;
  }

  private dispatchIntent(
    sessionId: SessionId,
    runIntent: (
      state: RoomState,
      info: SessionInfo,
    ) => ReturnType<typeof applyIntent>,
  ): Effect[] | IntentError {
    const info = this.sessions.get(sessionId);
    if (!info) return { error: { code: "no_session", message: "Session has not joined a room" } };
    const room = this.rooms.get(info.roomId);
    if (!room) return { error: { code: "room_not_found", message: "Room no longer exists" } };

    const result = runIntent(room, info);
    if (!result.ok) return { error: { code: result.code, message: result.message } };

    this.rooms.set(info.roomId, result.state);
    return this.broadcastDelta(info.roomId, result.delta);
  }

  handleSeatTake(
    sessionId: SessionId,
    args: { seatIndex: number; buyIn: number },
  ): Effect[] | IntentError {
    return this.dispatchIntent(sessionId, (state, info) =>
      applyIntent(state, {
        kind: "seatTake",
        playerId: info.playerId,
        seatIndex: args.seatIndex,
        buyIn: args.buyIn,
      }),
    );
  }

  handleSeatLeave(sessionId: SessionId): Effect[] | IntentError {
    return this.dispatchIntent(sessionId, (state, info) =>
      applyIntent(state, { kind: "seatLeave", playerId: info.playerId }),
    );
  }

  handleGameStart(sessionId: SessionId): Effect[] | IntentError {
    return this.dispatchIntent(sessionId, (state, info) =>
      applyIntent(state, { kind: "gameStart", playerId: info.playerId }),
    );
  }

  handleChat(sessionId: SessionId, args: { text: string }): Effect[] | IntentError {
    return this.dispatchIntent(sessionId, (state, info) =>
      applyIntent(state, {
        kind: "chatSend",
        playerId: info.playerId,
        text: args.text,
        chatId: randomUUID(),
        ts: Date.now(),
      }),
    );
  }
}
