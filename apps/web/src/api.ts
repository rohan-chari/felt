import type { RoomConfig } from "@felt/shared";

function resolveApiUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined;
  if (fromEnv) return fromEnv;
  // Prod: nginx proxies /rooms and /ws on the same origin as the static bundle.
  // Dev: vite dev server runs on :5173 while the server runs on :8080.
  if (import.meta.env.DEV) return "http://localhost:8080";
  return typeof window !== "undefined" ? window.location.origin : "http://localhost:8080";
}

const API_URL = resolveApiUrl();

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

export function wsUrl(path: string): string {
  const url = new URL(API_URL);
  const proto = url.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${url.host}${path}`;
}

export async function createRoom(settings?: Partial<RoomConfig>): Promise<string> {
  const init: RequestInit = { method: "POST" };
  if (settings && Object.keys(settings).length > 0) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(settings);
  }
  const res = await fetch(apiUrl("/rooms"), init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to create room: ${res.status}`);
  }
  const body = (await res.json()) as { roomId: string };
  return body.roomId;
}
