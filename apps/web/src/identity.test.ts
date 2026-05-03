import { afterEach, describe, expect, it, vi } from "vitest";
import { getOrCreatePlayerId } from "./identity";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => map.delete(k),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe("getOrCreatePlayerId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a new id when none exists", () => {
    const s = memoryStorage();
    const id = getOrCreatePlayerId(s);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.getItem("felt.playerId")).toBe(id);
  });

  it("reuses the stored id on subsequent calls", () => {
    const s = memoryStorage();
    const a = getOrCreatePlayerId(s);
    const b = getOrCreatePlayerId(s);
    expect(a).toBe(b);
  });

  it("defaults to sessionStorage so each browser tab is a distinct player", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("localStorage", local);

    const id = getOrCreatePlayerId();

    expect(session.getItem("felt.playerId")).toBe(id);
    expect(local.getItem("felt.playerId")).toBeNull();
  });
});
