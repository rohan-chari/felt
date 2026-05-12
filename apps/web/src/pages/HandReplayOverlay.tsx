import { type Card, formatMoney, type HandRecord, type HandView, type Player, type Seat } from "@felt/shared";
import { useEffect, useMemo, useState } from "react";
import { Table } from "./Table";

type Props = {
  record: HandRecord;
  frames: HandView[];
  myPlayerId: string;
  onClose: () => void;
};

const AUTO_STEP_MS = 1100;

/**
 * Adapts a HandRecord's per-seat snapshot into a synthetic Seat[] so the live
 * Table component can render replay frames without modification. Replay seats
 * follow the engine seat order (0..N-1); positions around the felt fall out of
 * Table's angle math.
 */
function synthSeats(record: HandRecord, frame: HandView): Seat[] {
  return record.seats.map((s) => {
    const live = frame.seats[s.seatIdx];
    return {
      kind: "taken" as const,
      index: s.seatIdx,
      playerId: s.playerId,
      stack: live?.stack ?? s.startingStack,
      busted: false,
    };
  });
}

function synthPlayers(record: HandRecord): Player[] {
  return record.seats.map((s) => ({ id: s.playerId, displayName: s.displayName }));
}

function holeCardsForRequester(
  frame: HandView,
  myPlayerId: string,
): { handId: string; cards: [Card, Card] } | null {
  const mine = frame.seats.find((s) => s.playerId === myPlayerId);
  if (!mine?.holeCards) return null;
  return { handId: frame.handId, cards: [mine.holeCards[0], mine.holeCards[1]] };
}

export function HandReplayOverlay(props: Props) {
  const { record, frames, myPlayerId, onClose } = props;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Reset whenever the underlying replay (different hand) changes.
  useEffect(() => {
    setStep(0);
    setPlaying(false);
  }, [record.handId]);

  // Auto-advance while playing.
  useEffect(() => {
    if (!playing) return;
    if (step >= frames.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => Math.min(s + 1, frames.length - 1)), AUTO_STEP_MS);
    return () => clearTimeout(t);
  }, [playing, step, frames.length]);

  // Allow keyboard control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, frames.length - 1));
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frames.length, onClose]);

  const frame = frames[step];
  const synthSeatsForFrame = useMemo(
    () => (frame ? synthSeats(record, frame) : []),
    [record, frame],
  );
  const players = useMemo(() => synthPlayers(record), [record]);
  const myCards = useMemo(
    () => (frame ? holeCardsForRequester(frame, myPlayerId) : null),
    [frame, myPlayerId],
  );

  if (!frame) return null;

  const lastEntry = step === 0 ? null : record.actionLog[step - 1];
  const lastEntryLabel = lastEntry ? describeEntry(lastEntry, record) : "Hand starts";

  return (
    <div className="replay-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="replay-modal">
        <header className="replay-header">
          <div>
            <h3 className="replay-title">Hand replay</h3>
            <span className="replay-step-label">
              Step {step + 1} of {frames.length} · {lastEntryLabel}
            </span>
          </div>
          <button type="button" className="replay-close" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </header>

        <div className="replay-felt-wrap">
          <Table
            seats={synthSeatsForFrame}
            players={players}
            myPlayerId={myPlayerId}
            hostId={null}
            gameStarted={true}
            hand={frame}
            myHoleCards={myCards}
            isDealing={false}
            onSitHere={() => {}}
            onStandUp={() => {}}
            onRebuy={() => {}}
          />
        </div>

        <footer className="replay-controls">
          <button
            type="button"
            onClick={() => setStep(0)}
            disabled={step === 0}
            title="Restart"
          >
            ⏮
          </button>
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(s - 1, 0))}
            disabled={step === 0}
            title="Previous (←)"
          >
            ◀
          </button>
          <button
            type="button"
            className="replay-play"
            onClick={() => setPlaying((p) => !p)}
            disabled={step >= frames.length - 1 && !playing}
            title="Play / pause (space)"
          >
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(s + 1, frames.length - 1))}
            disabled={step >= frames.length - 1}
            title="Next (→)"
          >
            ▶
          </button>
          <button
            type="button"
            onClick={() => setStep(frames.length - 1)}
            disabled={step >= frames.length - 1}
            title="Jump to end"
          >
            ⏭
          </button>
          <input
            type="range"
            className="replay-scrub"
            min={0}
            max={frames.length - 1}
            step={1}
            value={step}
            onChange={(e) => {
              setPlaying(false);
              setStep(Number(e.target.value));
            }}
          />
        </footer>
      </div>
    </div>
  );
}

function describeEntry(entry: HandRecord["actionLog"][number], record: HandRecord): string {
  const seat = record.seats.find((s) => s.seatIdx === entry.seatIdx);
  const name = seat?.displayName ?? `seat ${entry.seatIdx}`;
  if (entry.kind === "forceFold") return `${name} force-folded`;
  if (entry.kind === "sitOut") return `${name} sat out (disconnected)`;
  const a = entry.action;
  switch (a.kind) {
    case "fold":
      return `${name} folded`;
    case "check":
      return `${name} checked`;
    case "call":
      return `${name} called`;
    case "bet":
      return `${name} bet ${formatMoney(a.amount)}`;
    case "raise":
      return `${name} raised to ${formatMoney(a.to)}`;
  }
}
