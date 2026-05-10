import type { HandRecord, RoomId } from "@felt/shared";
import { blobToJson, jsonToBlob, type RoomSnapshotJson } from "./serialize.js";
import type { Persistence, RoomSnapshotBlob } from "./types.js";

/**
 * In-memory persistence — stores the JSON form so round-trip behavior matches
 * the on-disk impls (Maps must convert through entries arrays and back).
 */
export class MemoryPersistence implements Persistence {
  private store = new Map<RoomId, RoomSnapshotJson>();
  // Keyed by handId; second index by roomId built lazily on listHandsByRoom.
  private hands = new Map<string, HandRecord>();

  async saveSnapshot(roomId: RoomId, blob: RoomSnapshotBlob): Promise<void> {
    this.store.set(roomId, blobToJson(blob));
  }

  async loadSnapshot(roomId: RoomId): Promise<RoomSnapshotBlob | null> {
    const json = this.store.get(roomId);
    return json ? jsonToBlob(json) : null;
  }

  async loadAll(): Promise<RoomSnapshotBlob[]> {
    return Array.from(this.store.values()).map(jsonToBlob);
  }

  async deleteSnapshot(roomId: RoomId): Promise<void> {
    this.store.delete(roomId);
  }

  async saveHand(record: HandRecord): Promise<void> {
    // Defensive deep-clone via JSON so callers can mutate the in-engine state
    // without retroactively rewriting persisted history.
    this.hands.set(record.handId, JSON.parse(JSON.stringify(record)) as HandRecord);
  }

  async listHandsByRoom(roomId: RoomId): Promise<HandRecord[]> {
    const out: HandRecord[] = [];
    for (const r of this.hands.values()) {
      if (r.roomId === roomId) out.push(JSON.parse(JSON.stringify(r)) as HandRecord);
    }
    out.sort((a, b) => a.completedAt - b.completedAt);
    return out;
  }

  async close(): Promise<void> {
    this.store.clear();
    this.hands.clear();
  }
}
