import { applyAction as engineApplyAction, type HandState } from "@felt/engine";
import type { Action, BotPersona } from "@felt/shared";
import type { BotDecider, BotDecisionInput } from "./types.js";

/**
 * Convert engine hand state + the bot's seat index into the input the decider
 * receives. Pure function — easy to test, easy to inspect when a bot misplays.
 */
export function buildBotDecisionInput(
  hand: HandState,
  seatIdx: number,
  persona: BotPersona,
): BotDecisionInput | null {
  const seat = hand.seats[seatIdx];
  if (!seat || !seat.holeCards) return null;
  if (hand.street === "complete" || hand.street === "showdown") return null;

  const toCall = Math.max(0, hand.toMatch - seat.committedThisRound);
  const minRaiseTo = hand.toMatch + (hand.lastRaiseSize || hand.config.bb);
  const pot = hand.seats.reduce((sum, s) => sum + s.totalCommitted, 0);

  const opponents = hand.seats
    .filter((s) => s.idx !== seatIdx)
    .map((s) => ({
      stack: s.stack,
      committedThisRound: s.committedThisRound,
      isFolded: s.isFolded,
      isAllIn: s.isAllIn,
    }));

  const actionLog = renderActionLog(hand);

  return {
    persona,
    holeCards: seat.holeCards,
    board: hand.board,
    street: hand.street,
    pot,
    toCall,
    stack: seat.stack,
    minRaiseTo,
    bigBlind: hand.config.bb,
    actionLog,
    opponents,
  };
}

function renderActionLog(hand: HandState): string {
  if (hand.actionLog.length === 0) return "";
  return hand.actionLog
    .map((entry) => {
      const seat = hand.seats[entry.seatIdx];
      const who = seat?.playerId ?? `seat${entry.seatIdx}`;
      switch (entry.kind) {
        case "act": {
          const a = entry.action;
          if (a.kind === "fold" || a.kind === "check" || a.kind === "call") return `${who}: ${a.kind}`;
          if (a.kind === "bet") return `${who}: bet ${a.amount}`;
          return `${who}: raise to ${a.to}`;
        }
        case "forceFold":
          return `${who}: forced fold`;
        case "sitOut":
          return `${who}: sat out`;
      }
    })
    .join("\n");
}

/**
 * Pick a safe fallback action when the decider fails or returns something
 * illegal. Check if legal, else fold. Never raises — we don't want a buggy
 * controller to spew chips into the pot on the bot's behalf.
 */
export function fallbackAction(hand: HandState, seatIdx: number): Action {
  const seat = hand.seats[seatIdx];
  if (!seat) return { kind: "fold" };
  const need = hand.toMatch - seat.committedThisRound;
  return need > 0 ? { kind: "fold" } : { kind: "check" };
}

/**
 * Validate the decider's chosen action against the engine. Returns the action
 * if legal, otherwise null. We attempt-apply on a cloned state and discard the
 * result — the manager will re-apply through its standard flow afterward so
 * timer/pre-action propagation works the same as for humans.
 */
export function validateAction(
  hand: HandState,
  seatIdx: number,
  action: Action,
): Action | null {
  const result = engineApplyAction(hand, seatIdx, action);
  if (result.ok) return action;
  return null;
}

/**
 * Orchestrate a single bot turn: gather context, call the decider, validate,
 * fall back on failure. Returns the action to apply (never throws).
 */
export async function decideBotAction(
  hand: HandState,
  seatIdx: number,
  persona: BotPersona,
  decider: BotDecider | null,
): Promise<Action> {
  if (!decider) return fallbackAction(hand, seatIdx);
  const input = buildBotDecisionInput(hand, seatIdx, persona);
  if (!input) return fallbackAction(hand, seatIdx);

  let chosen: Action | null;
  try {
    chosen = await decider(input);
  } catch {
    return fallbackAction(hand, seatIdx);
  }
  if (!chosen) return fallbackAction(hand, seatIdx);

  // Clamp bet/raise amounts: a too-small bet falls back rather than crashing.
  const validated = validateAction(hand, seatIdx, chosen);
  if (validated) return validated;
  return fallbackAction(hand, seatIdx);
}
