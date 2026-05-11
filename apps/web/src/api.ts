import type { RoomConfig } from "@felt/shared";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8080";

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
