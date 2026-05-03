const STORAGE_KEY = "felt.playerId";

// sessionStorage (not localStorage) so two tabs in the same browser are distinct
// players — required for the Phase 1 two-tab test flow. Phase 7 will introduce
// proper auth/session resumption when reconnect support lands.
export function getOrCreatePlayerId(storage: Storage = sessionStorage): string {
  const existing = storage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  storage.setItem(STORAGE_KEY, fresh);
  return fresh;
}
