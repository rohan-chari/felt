import type { HandState } from "@felt/engine";
import type { HandRecord, PlayerId, PreAction, RoomId } from "@felt/shared";
import type { RoomState } from "../rooms/room.js";

/**
 * The persisted shape of a room. Includes mid-hand engine state, the current
 * turn's auto-act deadline, and any queued pre-actions, so a server restart
 * can resume a hand exactly where it left off.
 */
export type RoomSnapshotBlob = {
  /** Schema version — bump when the persisted shape changes incompatibly. */
  version: 1;
  room: RoomState;
  hand: HandState | null;
  /** Unix epoch ms when the current actor's turn auto-acts; null if no active turn. */
  currentTurnDeadline: number | null;
  /** Pre-actions queued for this room. Cleared at hand end. */
  preActions: Array<[PlayerId, PreAction]>;
};

/** Persistence backend. Implementations must round-trip RoomSnapshotBlob byte-for-byte. */
export interface Persistence {
  /** Insert or update the snapshot for a room. */
  saveSnapshot(roomId: RoomId, blob: RoomSnapshotBlob): Promise<void>;
  /** Fetch one snapshot by room id, or null if none. */
  loadSnapshot(roomId: RoomId): Promise<RoomSnapshotBlob | null>;
  /** Fetch every persisted snapshot — used at server boot to rehydrate hot rooms. */
  loadAll(): Promise<RoomSnapshotBlob[]>;
  /** Drop a room's snapshot (e.g., when the room is empty and GC'd). */
  deleteSnapshot(roomId: RoomId): Promise<void>;
  /** Append a completed hand to history. Idempotent on (roomId, handId). */
  saveHand(record: HandRecord): Promise<void>;
  /** Fetch every completed hand for a room, oldest first. */
  listHandsByRoom(roomId: RoomId): Promise<HandRecord[]>;
  /** Release any underlying resources (DB pool, etc). */
  close(): Promise<void>;
}
