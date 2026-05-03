import type { Card, HandView, Player, Seat } from "@felt/shared";

type TableProps = {
  seats: Seat[];
  players: Player[];
  myPlayerId: string;
  hostId: string | null;
  gameStarted: boolean;
  hand: HandView | null;
  myHoleCards: { handId: string; cards: [Card, Card] } | null;
  onSitHere: (seatIndex: number) => void;
  onStandUp: () => void;
  onRebuy: () => void;
};

function nameFor(playerId: string, players: Player[]): string {
  return players.find((p) => p.id === playerId)?.displayName ?? "?";
}

function rankSuitClass(card: Card): string {
  const suit = card[1];
  return suit === "h" || suit === "d" ? "card-red" : "card-black";
}

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

function CardFace({ card }: { card: Card }) {
  const rank = card[0] === "T" ? "10" : card[0];
  return (
    <div className={`card-face ${rankSuitClass(card)}`}>
      <span className="card-rank">{rank}</span>
      <span className="card-suit">{suitGlyph(card)}</span>
    </div>
  );
}

function CardBack() {
  return <div className="card-back" />;
}

export function Table(props: TableProps) {
  const {
    seats,
    players,
    myPlayerId,
    hostId,
    gameStarted,
    hand,
    myHoleCards,
    onSitHere,
    onStandUp,
    onRebuy,
  } = props;
  const mySeatIndex = seats.findIndex((s) => s.kind === "taken" && s.playerId === myPlayerId);
  const N = seats.length;

  // Build a quick lookup for hand-side seat info per player
  const handByPlayer = new Map<string, NonNullable<HandView>["seats"][number]>();
  if (hand) for (const hs of hand.seats) handByPlayer.set(hs.playerId, hs);
  const currentPlayerId = hand?.currentPlayerId ?? null;

  return (
    <div className="felt-table">
      <div className="felt-center">
        {hand && hand.board.length > 0 ? (
          <div className="board-row">
            {hand.board.map((c) => (
              <CardFace key={c} card={c} />
            ))}
          </div>
        ) : gameStarted ? (
          <span className="game-state">Hand in progress</span>
        ) : (
          <span className="game-state muted">Waiting…</span>
        )}
      </div>
      {seats.map((seat) => {
        const angle = (seat.index / N) * 2 * Math.PI - Math.PI / 2;
        const radiusX = 42;
        const radiusY = 38;
        const x = 50 + radiusX * Math.cos(angle);
        const y = 50 + radiusY * Math.sin(angle);
        const style = {
          left: `${x}%`,
          top: `${y}%`,
          transform: "translate(-50%, -50%)",
        } as const;

        if (seat.kind === "empty") {
          return (
            <div className="seat-slot" key={seat.index} style={style}>
              <button
                type="button"
                className="seat seat-empty"
                onClick={() => onSitHere(seat.index)}
                disabled={mySeatIndex !== -1 || gameStarted}
                title={
                  gameStarted
                    ? "Game already started"
                    : mySeatIndex !== -1
                      ? "You're already seated"
                      : `Sit at seat ${seat.index + 1}`
                }
              >
                Sit
              </button>
            </div>
          );
        }

        const handSeat = handByPlayer.get(seat.playerId);
        const isInHand = !!handSeat;
        const isCurrent = currentPlayerId === seat.playerId;
        const isFolded = handSeat?.isFolded ?? false;
        const liveStack = handSeat?.stack ?? seat.stack;
        const committed = handSeat?.committedThisRound ?? 0;

        return (
          <div className="seat-slot" key={seat.index} style={style}>
            <div
              className={[
                "seat",
                "seat-taken",
                seat.playerId === myPlayerId && "mine",
                isCurrent && "current",
                isFolded && "folded",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {isInHand && !isFolded && (
                <div className="seat-cards">
                  {(() => {
                    const isMine = seat.playerId === myPlayerId;
                    const myCards =
                      isMine && myHoleCards && myHoleCards.handId === hand?.handId
                        ? myHoleCards.cards
                        : null;
                    const revealedCards = handSeat?.holeCards ?? null;
                    const cards = myCards ?? revealedCards;
                    if (cards) {
                      return cards.map((c) => <CardFace key={c} card={c} />);
                    }
                    return [<CardBack key="b1" />, <CardBack key="b2" />];
                  })()}
                </div>
              )}
              <div className="seat-name">
                {nameFor(seat.playerId, players)}
                {seat.playerId === hostId && <span className="host-badge"> ★</span>}
              </div>
              <div className="seat-stack">${liveStack}</div>
              {seat.busted && <div className="seat-busted">Busted</div>}
              {isInHand && committed > 0 && <div className="seat-bet">+${committed}</div>}
              {seat.playerId === myPlayerId && seat.busted && (
                <button type="button" className="stand-btn" onClick={onRebuy}>
                  Rebuy
                </button>
              )}
              {seat.playerId === myPlayerId && !seat.busted && !gameStarted && (
                <button type="button" className="stand-btn" onClick={onStandUp}>
                  Cash out
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
