import type { Card, HandRecord } from "@felt/shared";
import { useState } from "react";

type Props = {
  hands: HandRecord[];
  myPlayerId: string;
  onOpenReplay: (handId: string) => void;
};

function suitGlyph(card: Card): string {
  switch (card[1]) {
    case "h":
      return "♥";
    case "d":
      return "♦";
    case "c":
      return "♣";
    case "s":
      return "♠";
    default:
      return "?";
  }
}

function rankClass(card: Card): string {
  return card[1] === "h" || card[1] === "d" ? "hh-card-red" : "hh-card-black";
}

function MiniCard({ card }: { card: Card }) {
  const rank = card[0] === "T" ? "10" : card[0];
  return (
    <span className={`hh-card ${rankClass(card)}`}>
      {rank}
      <span className="hh-suit">{suitGlyph(card)}</span>
    </span>
  );
}

function actionSummary(action: HandRecord["actionLog"][number]): string {
  if (action.kind === "forceFold") return "force-folded";
  if (action.kind === "sitOut") return "sat out (disconnected)";
  // act
  const a = action.action;
  switch (a.kind) {
    case "fold":
      return "folded";
    case "check":
      return "checked";
    case "call":
      return "called";
    case "bet":
      return `bet $${a.amount}`;
    case "raise":
      return `raised to $${a.to}`;
  }
}

export function HandHistoryPanel({ hands, myPlayerId, onOpenReplay }: Props) {
  const [openHandId, setOpenHandId] = useState<string | null>(null);

  if (hands.length === 0) {
    return (
      <div className="hand-history">
        <h3 className="hh-title">Hand history</h3>
        <p className="hh-empty">No hands played yet.</p>
      </div>
    );
  }

  return (
    <div className="hand-history">
      <h3 className="hh-title">Hand history</h3>
      <ol className="hh-list">
        {hands.map((h, idx) => {
          const isOpen = openHandId === h.handId;
          const winner = h.result.awards[0]?.winners[0];
          const totalPot = h.result.awards.reduce((sum, a) => sum + a.amount, 0);
          return (
            <li key={h.handId} className={`hh-item ${isOpen ? "open" : ""}`}>
              <button
                type="button"
                className="hh-summary"
                onClick={() => setOpenHandId(isOpen ? null : h.handId)}
              >
                <span className="hh-num">#{idx + 1}</span>
                <span className="hh-winner">
                  {winner ? `${winnerName(h, winner.playerId)} won $${totalPot}` : "no winner"}
                </span>
                {h.board.length > 0 && (
                  <span className="hh-board">
                    {h.board.map((c) => (
                      <MiniCard key={c} card={c} />
                    ))}
                  </span>
                )}
                <span className="hh-toggle">{isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen && (
                <HandDetail
                  record={h}
                  myPlayerId={myPlayerId}
                  onOpenReplay={onOpenReplay}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function winnerName(record: HandRecord, playerId: string): string {
  return record.seats.find((s) => s.playerId === playerId)?.displayName ?? playerId;
}

function HandDetail({
  record,
  myPlayerId,
  onOpenReplay,
}: {
  record: HandRecord;
  myPlayerId: string;
  onOpenReplay: (handId: string) => void;
}) {
  return (
    <div className="hh-detail">
      <button
        type="button"
        className="hh-replay-btn"
        onClick={() => onOpenReplay(record.handId)}
      >
        ▶ Replay this hand
      </button>
      <div className="hh-detail-row">
        <span className="hh-label">Blinds:</span>
        <span>
          ${record.blinds.sb} / ${record.blinds.bb}
        </span>
      </div>
      <div className="hh-detail-row">
        <span className="hh-label">Seed hash:</span>
        <code className="hh-hash">{record.seedHash.slice(0, 12)}…</code>
      </div>
      <div className="hh-detail-row">
        <span className="hh-label">Seed (revealed):</span>
        <code className="hh-hash">{record.seed}</code>
      </div>

      <div className="hh-section-label">Seats</div>
      <ul className="hh-seats">
        {record.seats.map((s) => (
          <li key={s.seatIdx} className="hh-seat-row">
            <span className="hh-seat-name">
              {s.displayName}
              {s.playerId === myPlayerId && <span className="hh-you"> (you)</span>}
            </span>
            <span className="hh-cards">
              {s.holeCards ? (
                s.holeCards.map((c) => <MiniCard key={c} card={c} />)
              ) : s.isFolded ? (
                <span className="hh-muted">folded</span>
              ) : (
                <span className="hh-muted">hidden</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className="hh-section-label">Actions</div>
      <ol className="hh-actions">
        {record.actionLog.map((entry, i) => {
          const seat = record.seats[entry.seatIdx];
          return (
            <li key={i} className="hh-action-row">
              <span className="hh-action-name">{seat?.displayName ?? `seat ${entry.seatIdx}`}</span>
              <span className="hh-action-verb">{actionSummary(entry)}</span>
            </li>
          );
        })}
      </ol>

      <div className="hh-section-label">Result</div>
      <ul className="hh-awards">
        {record.result.awards.map((a, i) => (
          <li key={i} className="hh-award-row">
            <span>${a.amount}</span>
            <span> → </span>
            <span>
              {a.winners.map((w, wi) => (
                <span key={wi}>
                  {wi > 0 && ", "}
                  {winnerName(record, w.playerId)} (${w.amount}, {w.handDescr})
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
