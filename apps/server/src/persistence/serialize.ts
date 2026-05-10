import type { Player, PlayerId } from "@felt/shared";
import type { RoomState } from "../rooms/room.js";
import type { RoomSnapshotBlob } from "./types.js";

/**
 * JSON-safe shape of a snapshot. Maps are converted to entry arrays; everything
 * else is already plain JSON (Cards are 2-char strings, all numbers/booleans).
 */
export type RoomSnapshotJson = Omit<RoomSnapshotBlob, "room"> & {
  room: Omit<RoomState, "players"> & { players: Array<[PlayerId, Player]> };
};

export function blobToJson(blob: RoomSnapshotBlob): RoomSnapshotJson {
  const { room, ...rest } = blob;
  return {
    ...rest,
    room: {
      ...room,
      players: Array.from(room.players.entries()),
    },
  };
}

export function jsonToBlob(json: RoomSnapshotJson): RoomSnapshotBlob {
  const { room, ...rest } = json;
  const { players, ...roomRest } = room;
  return {
    ...rest,
    room: {
      ...roomRest,
      players: new Map(players),
    },
  };
}
