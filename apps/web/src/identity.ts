const STORAGE_KEY = "felt.playerId";

// localStorage so a player's identity survives tab close and browser restart —
// closing the browser mid-hand and reopening the room link puts you back in
// your seat with your hole cards. Two distinct players on the same machine
// should use separate browsers or incognito windows.
export function getOrCreatePlayerId(storage: Storage = localStorage): string {
  const existing = storage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  storage.setItem(STORAGE_KEY, fresh);
  return fresh;
}

export function resetPlayerId(storage: Storage = localStorage): void {
  storage.removeItem(STORAGE_KEY);
}
