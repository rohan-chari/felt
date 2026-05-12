import type { BotPersona } from "@felt/shared";

export const PERSONAS: readonly BotPersona[] = [
  "tight",
  "loose-aggressive",
  "calling-station",
  "maniac",
  "balanced",
];

const PERSONA_DESCRIPTIONS: Record<BotPersona, string> = {
  tight:
    "You play tight and disciplined. You fold most hands preflop, only continuing with strong holdings (high pairs, big aces, suited broadways). When you do play, you bet for value and rarely bluff.",
  "loose-aggressive":
    "You play loose and aggressive. You enter many pots, raise often, and apply pressure with continuation bets and bluffs. You're not afraid to make big plays, but you can fold to clear strength.",
  "calling-station":
    "You're a calling station. You see flops with almost anything and call down with weak holdings. You rarely raise or bluff — you call to see what happens.",
  maniac:
    "You're a maniac. You raise and re-raise constantly, regardless of cards. You love big pots and applying pressure. You only slow down with the absolute nuts.",
  balanced:
    "You play a balanced, GTO-leaning style. You mix value bets and bluffs at appropriate frequencies, defend appropriately against aggression, and adjust based on opponent tendencies.",
};

export function personaPrompt(persona: BotPersona): string {
  return PERSONA_DESCRIPTIONS[persona];
}

export function randomPersona(): BotPersona {
  const idx = Math.floor(Math.random() * PERSONAS.length);
  return PERSONAS[idx] ?? "balanced";
}

const BOT_NAME_POOL: readonly string[] = [
  "Bluffy McFold",
  "Chip Stacks",
  "All-In Annie",
  "Sir Folds-a-Lot",
  "Lucky Pete",
  "Pocket Rocket",
  "Slow Roll Sam",
  "River Rat",
  "Tilt Master",
  "Coin Flip",
  "The Donk",
  "Calling Carl",
  "Maniac Mike",
  "Nit Nigel",
  "Bubble Boy",
  "Cooler",
  "Bad Beat Betty",
  "The Whale",
  "Shark Bait",
  "Fish Filet",
];

export function randomBotName(taken: Set<string>): string {
  const candidates = BOT_NAME_POOL.filter((n) => !taken.has(n.toLowerCase()));
  const pool = candidates.length > 0 ? candidates : BOT_NAME_POOL;
  const base = pool[Math.floor(Math.random() * pool.length)] ?? "Botty";
  if (!taken.has(base.toLowerCase())) return base;
  // All taken: append a number until we find a free slot.
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}
