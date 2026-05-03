import { randomUUID } from "node:crypto";
import { applyAction as engineApplyAction, type HandState, startHand } from "@felt/engine";
import type { Action, PlayerId, RoomDelta, RoomId, ServerMessage } from "@felt/shared";
import { buildHandFromRoom, toHandView } from "./hand.js";
import {
  applyEvent,
  applyIntent,
  createRoom,
  type RoomState,
  toSnapshot as roomToSnapshot,
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
  private hands = new Map<RoomId, HandState>();

  createRoom(): RoomId {
    let id = generateRoomId();
    while (this.rooms.has(id)) id = generateRoomId();
    this.rooms.set(id, createRoom(id));
    return id;
  }

  hasRoom(roomId: RoomId): boolean {
    return this.rooms.has(roomId);
  }

  /** For tests / inspection. */
  getHand(roomId: RoomId): HandState | undefined {
    return this.hands.get(roomId);
  }

  private toSnapshotWithHand(room: RoomState) {
    const snap = roomToSnapshot(room);
    const hand = this.hands.get(room.roomId);
    if (hand) snap.hand = toHandView(hand);
    return snap;
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

  private sessionsForPlayerInRoom(roomId: RoomId, playerId: PlayerId): SessionId[] {
    const out: SessionId[] = [];
    for (const [sid, info] of this.sessions) {
      if (info.roomId === roomId && info.playerId === playerId) out.push(sid);
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

  private broadcastHandSnapshot(roomId: RoomId, hand: HandState): Effect[] {
    return this.broadcastDelta(roomId, { kind: "hand.snapshot", hand: toHandView(hand) });
  }

  private sendHoleCardsPrivately(roomId: RoomId, hand: HandState): Effect[] {
    const effects: Effect[] = [];
    for (const seat of hand.seats) {
      if (!seat.holeCards) continue;
      const sessions = this.sessionsForPlayerInRoom(roomId, seat.playerId);
      for (const sid of sessions) {
        effects.push({
          sessionId: sid,
          message: {
            type: "hand.holeCards",
            handId: hand.handId,
            cards: seat.holeCards as [string, string] as [
              import("@felt/shared").Card,
              import("@felt/shared").Card,
            ],
          },
        });
      }
    }
    return effects;
  }

  handleJoin(args: JoinArgs): Effect[] | IntentError {
    const room = this.rooms.get(args.roomId);
    if (!room) {
      return { error: { code: "room_not_found", message: `Room ${args.roomId} does not exist` } };
    }

    // Reject if another player in the room already uses this display name
    // (case-insensitive, trim-equivalent). Same playerId rejoining is allowed.
    const normalize = (s: string) => s.trim().toLowerCase();
    const incoming = normalize(args.displayName);
    for (const existing of room.players.values()) {
      if (existing.id !== args.playerId && normalize(existing.displayName) === incoming) {
        return {
          error: {
            code: "name_taken",
            message: `Name "${args.displayName.trim()}" is already in use in this room`,
          },
        };
      }
    }

    const player = { id: args.playerId, displayName: args.displayName };
    const wasPresent = room.players.has(args.playerId);
    const updated = applyEvent(room, { kind: "playerJoined", player });
    this.rooms.set(args.roomId, updated);
    this.sessions.set(args.sessionId, { roomId: args.roomId, playerId: args.playerId });

    const effects: Effect[] = [
      {
        sessionId: args.sessionId,
        message: { type: "room.snapshot", snapshot: this.toSnapshotWithHand(updated) },
      },
    ];

    if (!wasPresent) {
      effects.push(
        ...this.broadcastDelta(args.roomId, { kind: "playerJoined", player }, args.sessionId),
      );
    }

    // If this player owns a seat in an active hand, send them their hole cards privately.
    const activeHand = this.hands.get(args.roomId);
    if (activeHand) {
      const seat = activeHand.seats.find((s) => s.playerId === args.playerId);
      if (seat?.holeCards) {
        effects.push({
          sessionId: args.sessionId,
          message: {
            type: "hand.holeCards",
            handId: activeHand.handId,
            cards: seat.holeCards as [
              import("@felt/shared").Card,
              import("@felt/shared").Card,
            ],
          },
        });
      }
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
    const info = this.sessions.get(sessionId);
    if (!info) return { error: { code: "no_session", message: "Session has not joined a room" } };
    const room = this.rooms.get(info.roomId);
    if (!room) return { error: { code: "room_not_found", message: "Room no longer exists" } };

    const result = applyIntent(room, { kind: "gameStart", playerId: info.playerId });
    if (!result.ok) return { error: { code: result.code, message: result.message } };

    this.rooms.set(info.roomId, result.state);
    const effects: Effect[] = this.broadcastDelta(info.roomId, result.delta);

    // Create the engine hand
    const { startOpts } = buildHandFromRoom(result.state, randomUUID(), 0);
    const { state: hand } = startHand(startOpts);
    this.hands.set(info.roomId, hand);

    // Broadcast the initial hand.snapshot to everyone
    effects.push(...this.broadcastHandSnapshot(info.roomId, hand));
    // Send hole cards privately to each seat owner
    effects.push(...this.sendHoleCardsPrivately(info.roomId, hand));
    return effects;
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

  handleHandAction(sessionId: SessionId, action: Action): Effect[] | IntentError {
    const info = this.sessions.get(sessionId);
    if (!info) return { error: { code: "no_session", message: "Session has not joined a room" } };
    const hand = this.hands.get(info.roomId);
    if (!hand) return { error: { code: "no_hand", message: "No active hand in this room" } };

    const seatIdx = hand.seats.findIndex((s) => s.playerId === info.playerId);
    if (seatIdx === -1) {
      return { error: { code: "not_in_hand", message: "You are not seated in this hand" } };
    }

    const result = engineApplyAction(hand, seatIdx, action);
    if (!result.ok) {
      return { error: { code: result.code, message: result.message } };
    }
    this.hands.set(info.roomId, result.state);

    const effects: Effect[] = [];
    // Broadcast the action (informational)
    let chipsCommitted = 0;
    let isAllIn = false;
    for (const eff of result.effects) {
      if (eff.kind === "actionTaken" && eff.seatIdx === seatIdx) {
        chipsCommitted = eff.chipsCommitted;
        isAllIn = eff.isAllIn;
      }
    }
    effects.push(
      ...this.broadcastDelta(info.roomId, {
        kind: "hand.action",
        playerId: info.playerId,
        action,
        chipsCommitted,
        isAllIn,
      }),
    );
    // Broadcast the new full hand snapshot
    effects.push(...this.broadcastHandSnapshot(info.roomId, result.state));

    return effects;
  }
}
