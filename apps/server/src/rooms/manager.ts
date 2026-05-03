import type { PlayerId, RoomId, ServerMessage } from "@felt/shared";
import { applyEvent, createRoom, type RoomState, toSnapshot } from "./room.js";

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

type JoinError = { error: { code: string; message: string } };

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

  handleJoin(args: JoinArgs): Effect[] | JoinError {
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
      for (const [sid] of this.sessions) {
        if (sid === args.sessionId) continue;
        const info = this.sessions.get(sid);
        if (info?.roomId !== args.roomId) continue;
        effects.push({
          sessionId: sid,
          message: {
            type: "room.delta",
            roomId: args.roomId,
            delta: { kind: "playerJoined", player },
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

    const stillPresent = [...this.sessions.values()].some(
      (s) => s.roomId === info.roomId && s.playerId === info.playerId,
    );
    if (stillPresent) return [];

    const room = this.rooms.get(info.roomId);
    if (!room) return [];
    const updated = applyEvent(room, { kind: "playerLeft", playerId: info.playerId });
    this.rooms.set(info.roomId, updated);

    const effects: Effect[] = [];
    for (const [sid, sInfo] of this.sessions) {
      if (sInfo.roomId !== info.roomId) continue;
      effects.push({
        sessionId: sid,
        message: {
          type: "room.delta",
          roomId: info.roomId,
          delta: { kind: "playerLeft", playerId: info.playerId },
        },
      });
    }
    return effects;
  }
}
