import type { Action } from "@felt/shared";
import { buildPrompt } from "./buildPrompt.js";
import type { BotDecider } from "./types.js";

/**
 * Build a real OpenAI-backed decider. Returns null when OPENAI_API_KEY is
 * absent — callers should treat that as "bots cannot decide; fall back to
 * check/fold" so missing config doesn't crash the room.
 *
 * The model is hardcoded to gpt-4o-mini (cheap, fast, plenty good enough for
 * casual poker). We avoid pulling in the @openai SDK as a hard dep — using
 * fetch keeps the surface small and the API stable.
 */
export function createOpenAiDecider(opts?: {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): BotDecider | null {
  const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = opts?.model ?? "gpt-4o-mini";
  const fetchImpl = opts?.fetchImpl ?? fetch;

  return async (input) => {
    const { system, user } = buildPrompt(input);
    let raw: unknown;
    try {
      const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          temperature: 0.8,
        }),
      });
      if (!res.ok) return null;
      raw = await res.json();
    } catch {
      return null;
    }

    const content = extractContent(raw);
    if (!content) return null;
    try {
      const parsed = JSON.parse(content) as unknown;
      return toAction(parsed);
    } catch {
      return null;
    }
  };
}

function extractContent(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { choices?: Array<{ message?: { content?: string } }> };
  return r.choices?.[0]?.message?.content ?? null;
}

function toAction(parsed: unknown): Action | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  const action = p.action;
  if (action === "fold") return { kind: "fold" };
  if (action === "check") return { kind: "check" };
  if (action === "call") return { kind: "call" };
  if (action === "bet" && typeof p.amount === "number") {
    return { kind: "bet", amount: Math.floor(p.amount) };
  }
  if (action === "raise" && typeof p.to === "number") {
    return { kind: "raise", to: Math.floor(p.to) };
  }
  return null;
}
