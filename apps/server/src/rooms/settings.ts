import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@felt/shared";

export type ValidateResult =
  | { ok: true; settings: Partial<RoomConfig> }
  | { ok: false; error: string };

const isPosInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

/**
 * Validate a Partial<RoomConfig> submitted by a host at room creation. Unknown
 * keys are dropped. Each provided field is range-checked, then cross-field
 * invariants (sb < bb, minBuyIn ≤ maxBuyIn, startingStack ∈ [minBuyIn, maxBuyIn])
 * are checked against the merged-with-defaults result.
 */
export function validateRoomSettings(input: unknown): ValidateResult {
  if (input === null || input === undefined) return { ok: true, settings: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "settings must be a JSON object" };
  }
  const raw = input as Record<string, unknown>;
  const out: Partial<RoomConfig> = {};

  const numericFields: Array<{
    key: keyof RoomConfig;
    min: number;
    max: number;
  }> = [
    { key: "smallBlind", min: 1, max: 1_000_000 },
    { key: "bigBlind", min: 1, max: 1_000_000 },
    { key: "minBuyIn", min: 1, max: 100_000_000 },
    { key: "maxBuyIn", min: 1, max: 100_000_000 },
    { key: "startingStack", min: 1, max: 100_000_000 },
    { key: "maxSeats", min: 2, max: 9 },
    { key: "turnTimerMs", min: 5_000, max: 600_000 },
    { key: "timeBankMs", min: 0, max: 600_000 },
    { key: "interHandDelayMs", min: 0, max: 60_000 },
  ];
  for (const { key, min, max } of numericFields) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (!isPosInt(v)) return { ok: false, error: `${key} must be a non-negative integer` };
    if (v < min || v > max) return { ok: false, error: `${key} must be between ${min} and ${max}` };
    (out as Record<string, unknown>)[key] = v;
  }

  for (const key of ["autoDealEnabled", "showOneShowBoth"] as const) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (!isBool(v)) return { ok: false, error: `${key} must be a boolean` };
    out[key] = v;
  }

  // Cross-field invariants against the merged result.
  const merged: RoomConfig = { ...DEFAULT_ROOM_CONFIG, ...out };
  if (merged.smallBlind >= merged.bigBlind) {
    return { ok: false, error: "smallBlind must be less than bigBlind" };
  }
  if (merged.minBuyIn > merged.maxBuyIn) {
    return { ok: false, error: "minBuyIn must be ≤ maxBuyIn" };
  }
  if (merged.startingStack < merged.minBuyIn || merged.startingStack > merged.maxBuyIn) {
    return { ok: false, error: "startingStack must be within [minBuyIn, maxBuyIn]" };
  }
  if (merged.bigBlind > merged.minBuyIn) {
    return { ok: false, error: "bigBlind must be ≤ minBuyIn" };
  }
  return { ok: true, settings: out };
}
