import { type Action, formatMoney, type HandView, parseMoney, type Player, type PlayerId, type PreAction } from "@felt/shared";
import { useEffect, useState } from "react";

type Props = {
  hand: HandView;
  myPlayerId: PlayerId;
  players: Player[];
  isDealing: boolean;
  onAction: (action: Action) => void;
  onUseTimeBank: () => void;
  onPreAction: (preAction: PreAction) => void;
  onCancelPreAction: () => void;
};

function nameFor(playerId: PlayerId | null, players: Player[]): string {
  if (!playerId) return "?";
  return players.find((p) => p.id === playerId)?.displayName ?? "?";
}

export function ActionPanel({
  hand,
  myPlayerId,
  players,
  isDealing,
  onAction,
  onUseTimeBank,
  onPreAction,
  onCancelPreAction,
}: Props) {
  const mySeat = hand.seats.find((s) => s.playerId === myPlayerId);
  const isMyTurn = hand.currentPlayerId === myPlayerId;
  const [raiseTo, setRaiseTo] = useState<string>("");
  const [queuedPre, setQueuedPre] = useState<PreAction | null>(null);

  // Clear local pre-action state when the hand changes or it becomes my turn
  // (pre-action either fired or is no longer relevant).
  useEffect(() => {
    setQueuedPre(null);
  }, [hand.handId, isMyTurn]);

  if (isDealing) {
    return <div className="action-panel waiting">Dealing…</div>;
  }

  // Not seated this hand: show whose turn it is.
  if (!mySeat) {
    return (
      <div className="action-panel waiting">
        {hand.street === "complete"
          ? "Hand over"
          : `Waiting for ${nameFor(hand.currentPlayerId, players)}…`}
      </div>
    );
  }

  // Seated, in the hand, but not my turn → show pre-action options.
  if (!isMyTurn) {
    if (hand.street === "complete") {
      return <div className="action-panel waiting">Hand over</div>;
    }
    if (mySeat.isFolded || mySeat.isAllIn) {
      return (
        <div className="action-panel waiting">
          Waiting for {nameFor(hand.currentPlayerId, players)}…
        </div>
      );
    }

    const pickPre = (pre: PreAction) => {
      if (queuedPre?.kind === pre.kind) {
        setQueuedPre(null);
        onCancelPreAction();
      } else {
        setQueuedPre(pre);
        onPreAction(pre);
      }
    };

    return (
      <div className="action-panel pre-action">
        <div className="pre-action-label">
          Waiting for {nameFor(hand.currentPlayerId, players)}…
        </div>
        <div className="pre-action-buttons">
          <button
            type="button"
            className={queuedPre?.kind === "fold" ? "selected" : ""}
            onClick={() => pickPre({ kind: "fold" })}
          >
            Fold
          </button>
          <button
            type="button"
            className={queuedPre?.kind === "checkFold" ? "selected" : ""}
            onClick={() => pickPre({ kind: "checkFold" })}
          >
            Check / Fold
          </button>
          <button
            type="button"
            className={queuedPre?.kind === "callAny" ? "selected" : ""}
            onClick={() => pickPre({ kind: "callAny" })}
          >
            Call any
          </button>
        </div>
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

  const parsedCents = raiseTo === "" ? null : parseMoney(raiseTo);
  const numericValue = parsedCents ?? Number.NaN;
  const inRangeBet = parsedCents !== null && numericValue >= minBet && numericValue <= maxBet;
  const inRangeRaise =
    parsedCents !== null && numericValue >= minRaiseTo && numericValue <= maxRaiseTo;
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
    ? `Bet ${formatMoney(minBet)}–${formatMoney(maxBet)}`
    : `Raise to ${formatMoney(minRaiseTo)}–${formatMoney(maxRaiseTo)}`;

  return (
    <div className="action-panel active">
      <div className="action-buttons">
        {!mySeat.timeBankUsed && (
          <button type="button" className="time-bank-btn" onClick={onUseTimeBank} title="Use time bank">
            +Time
          </button>
        )}
        <button type="button" className="btn-fold" onClick={() => onAction({ kind: "fold" })}>
          Fold
        </button>
        {canCheck && (
          <button type="button" className="btn-check" onClick={() => onAction({ kind: "check" })}>
            Check
          </button>
        )}
        {canCall && (
          <button type="button" className="btn-call" onClick={() => onAction({ kind: "call" })}>
            Call {formatMoney(Math.min(need, mySeat.stack))}
          </button>
        )}
      </div>
      {(canBet || canRaise) && (
        <>
          <div className="action-raise">
            <input
              type="text"
              inputMode="decimal"
              className={outOfRange ? "invalid" : ""}
              placeholder={hint}
              value={raiseTo}
              onChange={(e) => setRaiseTo(e.target.value)}
            />
            {canBet && (
              <button type="button" className="btn-bet" onClick={onSubmitBet} disabled={!inRangeBet}>
                Bet
              </button>
            )}
            {canRaise && (
              <button type="button" className="btn-raise" onClick={onSubmitRaise} disabled={!inRangeRaise}>
                Raise
              </button>
            )}
          </div>
          <div className="action-hint">
            {outOfRange ? (
              <span className="hint-error">{hint} (you have {formatMoney(mySeat.stack)})</span>
            ) : (
              <span>{hint}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
