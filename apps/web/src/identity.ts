const STORAGE_KEY = "felt.playerId";

// crypto.randomUUID() is only available in secure contexts (HTTPS / localhost).
// Fall back to a manual UUID v4 built from crypto.getRandomValues, which works
// in all contexts including plain HTTP on a LAN IP.
function uuidv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through to manual implementation.
    }
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Set version 4 and variant bits per RFC 4122.
  // Use DataView to avoid noUncheckedIndexedAccess complaints on Uint8Array index access.
  const dv = new DataView(bytes.buffer);
  dv.setUint8(6, (dv.getUint8(6) & 0x0f) | 0x40);
  dv.setUint8(8, (dv.getUint8(8) & 0x3f) | 0x80);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// localStorage so a player's identity survives tab close and browser restart —
// closing the browser mid-hand and reopening the room link puts you back in
// your seat with your hole cards. Two distinct players on the same machine
// should use separate browsers or incognito windows.
export function getOrCreatePlayerId(storage: Storage = localStorage): string {
  const existing = storage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const fresh = uuidv4();
  storage.setItem(STORAGE_KEY, fresh);
  return fresh;
}

export function resetPlayerId(storage: Storage = localStorage): void {
  storage.removeItem(STORAGE_KEY);
}
