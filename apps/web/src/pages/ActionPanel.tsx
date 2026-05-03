import type { Action, HandView, Player, PlayerId } from "@felt/shared";
import { useState } from "react";

type Props = {
  hand: HandView;
  myPlayerId: PlayerId;
  players: Player[];
  onAction: (action: Action) => void;
};

function nameFor(playerId: PlayerId | null, players: Player[]): string {
  if (!playerId) return "?";
  return players.find((p) => p.id === playerId)?.displayName ?? "?";
}

export function ActionPanel({ hand, myPlayerId, players, onAction }: Props) {
  const mySeat = hand.seats.find((s) => s.playerId === myPlayerId);
  const isMyTurn = hand.currentPlayerId === myPlayerId;
  const [raiseTo, setRaiseTo] = useState<string>("");

  if (!mySeat || !isMyTurn) {
    return (
      <div className="action-panel waiting">
        {hand.street === "complete"
          ? "Hand over"
          : `Waiting for ${nameFor(hand.currentPlayerId, players)}…`}
      </div>
    );
  }

  const need = hand.toMatch - mySeat.committedThisRound;
  const canCheck = need <= 0;
  const canCall = need > 0;
  const canBet = hand.toMatch === 0;
  const canRaise = hand.toMatch > 0 && mySeat.stack + mySeat.committedThisRound > hand.toMatch;
  // Min raise: clamp to all-in if a full min-raise exceeds the player's stack.
  const fullMinRaiseTo = hand.toMatch + hand.lastRaiseSize;
  const allInTo = mySeat.committedThisRound + mySeat.stack;
  const minRaiseTo = Math.min(fullMinRaiseTo, allInTo);
  const maxRaiseTo = allInTo;
  const minBet = Math.min(2, mySeat.stack); // bb default; all-in below bb is allowed
  const maxBet = mySeat.stack;

  const numericValue = raiseTo === "" ? Number.NaN : Number(raiseTo);
  const inRangeBet = Number.isFinite(numericValue) && numericValue >= minBet && numericValue <= maxBet;
  const inRangeRaise =
    Number.isFinite(numericValue) && numericValue >= minRaiseTo && numericValue <= maxRaiseTo;
  const outOfRange =
    raiseTo !== "" && ((canBet && !inRangeBet) || (!canBet && canRaise && !inRangeRaise));

  const onSubmitRaise = () => {
    if (!inRangeRaise) return;
    onAction({ kind: "raise", to: numericValue });
    setRaiseTo("");
  };
  const onSubmitBet = () => {
    if (!inRangeBet) return;
    onAction({ kind: "bet", amount: numericValue });
    setRaiseTo("");
  };

  const hint = canBet
    ? `Bet ${minBet}–${maxBet}`
    : `Raise to ${minRaiseTo}–${maxRaiseTo}`;

  return (
    <div className="action-panel active">
      <div className="action-buttons">
        <button type="button" onClick={() => onAction({ kind: "fold" })}>
          Fold
        </button>
        {canCheck && (
          <button type="button" onClick={() => onAction({ kind: "check" })}>
            Check
          </button>
        )}
        {canCall && (
          <button type="button" onClick={() => onAction({ kind: "call" })}>
            Call ${Math.min(need, mySeat.stack)}
          </button>
        )}
      </div>
      {(canBet || canRaise) && (
        <>
          <div className="action-raise">
            <input
              type="number"
              className={outOfRange ? "invalid" : ""}
              placeholder={hint}
              value={raiseTo}
              onChange={(e) => setRaiseTo(e.target.value)}
              min={canBet ? minBet : minRaiseTo}
              max={canBet ? maxBet : maxRaiseTo}
              step={1}
            />
            {canBet && (
              <button type="button" onClick={onSubmitBet} disabled={!inRangeBet}>
                Bet
              </button>
            )}
            {canRaise && (
              <button type="button" onClick={onSubmitRaise} disabled={!inRangeRaise}>
                Raise
              </button>
            )}
          </div>
          <div className="action-hint">
            {outOfRange ? (
              <span className="hint-error">{hint} (you have ${mySeat.stack})</span>
            ) : (
              <span>{hint}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
