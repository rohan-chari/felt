const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8080";

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

export function wsUrl(path: string): string {
  const url = new URL(API_URL);
  const proto = url.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${url.host}${path}`;
}

export async function createRoom(): Promise<string> {
  const res = await fetch(apiUrl("/rooms"), { method: "POST" });
  if (!res.ok) throw new Error(`Failed to create room: ${res.status}`);
  const body = (await res.json()) as { roomId: string };
  return body.roomId;
}
