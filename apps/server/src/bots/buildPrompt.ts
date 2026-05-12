import type { BotDecisionInput } from "./types.js";
import { personaPrompt } from "./personas.js";

/**
 * Render the bot's decision context as a system + user prompt pair suitable for
 * an OpenAI chat completion. Pure function — easy to unit test and easy to
 * inspect when debugging weird plays.
 */
export function buildPrompt(input: BotDecisionInput): {
  system: string;
  user: string;
} {
  const system = [
    "You are an AI playing No-Limit Texas Hold'em.",
    personaPrompt(input.persona),
    "",
    "Respond ONLY with a JSON object matching this schema:",
    `{ "action": "fold" | "check" | "call" | "bet" | "raise", "amount": <number, only for bet>, "to": <number, only for raise> }`,
    "- 'check' is only legal when there is no bet to call.",
    "- 'call' matches the current bet.",
    "- 'bet' opens betting on a street where toCall=0. amount is total chips to put in this round.",
    "- 'raise' increases an existing bet. 'to' is the new total bet size for the round.",
    "- All chip values are integers. Never exceed your stack.",
    "Output JSON only — no commentary.",
  ].join("\n");

  const oppLines = input.opponents
    .map((o, i) => `  Opponent ${i + 1}: stack=${o.stack}, committedThisRound=${o.committedThisRound}, folded=${o.isFolded}, allIn=${o.isAllIn}`)
    .join("\n");

  const user = [
    `Street: ${input.street}`,
    `Your hole cards: ${input.holeCards.join(" ")}`,
    `Board: ${input.board.length === 0 ? "(none)" : input.board.join(" ")}`,
    `Pot: ${input.pot}`,
    `To call: ${input.toCall}`,
    `Your stack: ${input.stack}`,
    `Big blind: ${input.bigBlind}`,
    `Minimum legal raise-to: ${input.minRaiseTo}`,
    "Opponents:",
    oppLines || "  (none)",
    "Action history this hand:",
    input.actionLog || "  (none)",
    "",
    "What is your action?",
  ].join("\n");

  return { system, user };
}
