import type { HandRecord, RoomId } from "@felt/shared";
import { Pool, type PoolConfig } from "pg";
import { blobToJson, jsonToBlob, type RoomSnapshotJson } from "./serialize.js";
import type { Persistence, RoomSnapshotBlob } from "./types.js";

export type PostgresPersistenceOpts = {
  connectionString?: string;
  poolConfig?: PoolConfig;
  /**
   * If true, run the CREATE TABLE IF NOT EXISTS at construction time. Defaults
   * to true. Set false in production where migrations are managed externally.
   */
  ensureSchema?: boolean;
};

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS room_snapshots (
    room_id    TEXT PRIMARY KEY,
    state      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS room_hands (
    hand_id      TEXT PRIMARY KEY,
    room_id      TEXT NOT NULL,
    record       JSONB NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS room_hands_room_id_completed_at_idx
    ON room_hands (room_id, completed_at);
`;

export class PostgresPersistence implements Persistence {
  private pool: Pool;
  private ready: Promise<void>;

  constructor(opts: PostgresPersistenceOpts = {}) {
    const config: PoolConfig = opts.poolConfig ?? {};
    if (opts.connectionString) config.connectionString = opts.connectionString;
    if (config.max === undefined) config.max = 10;
    this.pool = new Pool(config);
    this.ready = opts.ensureSchema === false
      ? Promise.resolve()
      : this.pool.query(SCHEMA_SQL).then(() => undefined);
  }

  private async exec<T>(fn: () => Promise<T>): Promise<T> {
    await this.ready;
    return fn();
  }

  async saveSnapshot(roomId: RoomId, blob: RoomSnapshotBlob): Promise<void> {
    const json = blobToJson(blob);
    await this.exec(() =>
      this.pool.query(
        `INSERT INTO room_snapshots (room_id, state, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (room_id) DO UPDATE
         SET state = EXCLUDED.state, updated_at = now()`,
        [roomId, JSON.stringify(json)],
      ),
    );
  }

  async loadSnapshot(roomId: RoomId): Promise<RoomSnapshotBlob | null> {
    const result = await this.exec(() =>
      this.pool.query<{ state: RoomSnapshotJson }>(
        `SELECT state FROM room_snapshots WHERE room_id = $1`,
        [roomId],
      ),
    );
    const row = result.rows[0];
    return row ? jsonToBlob(row.state) : null;
  }

  async loadAll(): Promise<RoomSnapshotBlob[]> {
    const result = await this.exec(() =>
      this.pool.query<{ state: RoomSnapshotJson }>(`SELECT state FROM room_snapshots`),
    );
    return result.rows.map((r) => jsonToBlob(r.state));
  }

  async deleteSnapshot(roomId: RoomId): Promise<void> {
    await this.exec(() =>
      this.pool.query(`DELETE FROM room_snapshots WHERE room_id = $1`, [roomId]),
    );
  }

  async saveHand(record: HandRecord): Promise<void> {
    await this.exec(() =>
      this.pool.query(
        `INSERT INTO room_hands (hand_id, room_id, record, completed_at)
         VALUES ($1, $2, $3::jsonb, to_timestamp($4 / 1000.0))
         ON CONFLICT (hand_id) DO UPDATE
         SET record = EXCLUDED.record, completed_at = EXCLUDED.completed_at`,
        [record.handId, record.roomId, JSON.stringify(record), record.completedAt],
      ),
    );
  }

  async listHandsByRoom(roomId: RoomId): Promise<HandRecord[]> {
    const result = await this.exec(() =>
      this.pool.query<{ record: HandRecord }>(
        `SELECT record FROM room_hands
         WHERE room_id = $1
         ORDER BY completed_at ASC`,
        [roomId],
      ),
    );
    // Backfill revealedPlayerIds for records persisted before Phase 10e.
    return result.rows.map((r) => ({
      ...r.record,
      revealedPlayerIds: r.record.revealedPlayerIds ?? [],
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
