import { type Card, formatMoney, type HandView, type Player, type Seat } from "@felt/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChipPile } from "./ChipPile";
import { CountdownBorder } from "./CountdownBorder";

type TableProps = {
  seats: Seat[];
  players: Player[];
  myPlayerId: string;
  hostId: string | null;
  gameStarted: boolean;
  hand: HandView | null;
  myHoleCards: { handId: string; cards: [Card, Card] } | null;
  isDealing: boolean;
  onSitHere: (seatIndex: number) => void;
  onStandUp: () => void;
  onRebuy: () => void;
};

const SEAT_RADIUS_X = 42;
const SEAT_RADIUS_Y = 38;
// Keep this in sync with Room.tsx's DEAL_STEP_MS and Room.css's deal-fly animation.
const DEAL_STEP_MS = 200;
// "Deck" position on the felt — purely cosmetic origin for the deal animation.
const DECK_X = 50;
const DECK_Y = 30;

type FlyingCard = {
  key: string;
  targetX: number;
  targetY: number;
  fromXpx: number;
  fromYpx: number;
  delay: number;
};

const DEAL_FLIGHT_MS = 500;

/**
 * Renders the per-card flight animation using inline transforms + a CSS transition.
 * Each card mounts at the dealer's position (inline style) and flips to its target
 * position after its delay — the browser's transition handles the interpolation.
 * (Avoids CSS custom properties inside @keyframes, which don't reliably pick up
 * per-element values across browsers.)
 */
function DealAnimation({ cards }: { cards: FlyingCard[] }) {
  const [arrived, setArrived] = useState<Set<string>>(() => new Set());

  // Reset arrived state whenever the set of cards changes (a new hand is being dealt).
  const cardsKey = cards.map((c) => c.key).join("|");
  useEffect(() => {
    setArrived(new Set());
    if (cards.length === 0) return;
    const timers = cards.map((c) =>
      // requestAnimationFrame ensures the initial (pre-arrived) frame paints first.
      setTimeout(() => {
        requestAnimationFrame(() => {
          setArrived((prev) => {
            const next = new Set(prev);
            next.add(c.key);
            return next;
          });
        });
      }, c.delay),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardsKey]);

  return (
    <>
      {cards.map((c) => {
        const isThere = arrived.has(c.key);
        const transform = isThere
          ? "translate(-50%, -50%) scale(1) rotate(0deg)"
          : `translate(calc(-50% + ${c.fromXpx}px), calc(-50% + ${c.fromYpx}px)) scale(0.5) rotate(-12deg)`;
        return (
          <div
            key={c.key}
            className="flying-card"
            style={{
              left: `${c.targetX}%`,
              top: `${c.targetY}%`,
              transform,
              opacity: isThere ? 1 : 0.95,
              transition: `transform ${DEAL_FLIGHT_MS}ms cubic-bezier(0.2, 0.8, 0.25, 1), opacity 120ms`,
            }}
          />
        );
      })}
    </>
  );
}

function nameFor(playerId: string, players: Player[]): string {
  return players.find((p) => p.id === playerId)?.displayName ?? "?";
}

function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    const first = parts[0] ?? "";
    return first.slice(0, 2).toUpperCase();
  }
  const a = parts[0]?.[0] ?? "";
  const b = parts[parts.length - 1]?.[0] ?? "";
  return (a + b).toUpperCase();
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

function PotBadge({ pots }: { pots: HandView["pots"] }) {
  const total = pots.reduce((sum, p) => sum + p.amount, 0);
  const sidePots = pots.slice(1).filter((p) => p.amount > 0);
  const splitText =
    sidePots.length > 0
      ? `main ${formatMoney(pots[0]?.amount ?? 0)}${sidePots.map((p, i) => ` · side ${i + 1} ${formatMoney(p.amount)}`).join("")}`
      : null;
  return (
    <div
      className="pot-badge"
      title={pots
        .map((p, i) => `${i === 0 ? "Main" : `Side ${i}`}: ${formatMoney(p.amount)}`)
        .join(" · ")}
    >
      <div className="pot-badge-row">
        <span className="pot-badge-label">Pot</span>
        <span className="pot-badge-amount">{formatMoney(total)}</span>
      </div>
      {splitText && <div className="pot-badge-split">{splitText}</div>}
    </div>
  );
}

type MarkerPos = { x: number; y: number; angle: number; roomSlot: number };

function markerPosForEngineSeat(
  hand: HandView,
  seats: Seat[],
  engineIdx: number,
): MarkerPos | null {
  const N = seats.length;
  const playerId = hand.seats[engineIdx]?.playerId;
  if (!playerId) return null;
  const roomSlot = seats.findIndex((s) => s.kind === "taken" && s.playerId === playerId);
  if (roomSlot < 0) return null;
  const angle = (roomSlot / N) * 2 * Math.PI - Math.PI / 2;
  // Sit comfortably inward from the seat — radius is small enough that the marker
  // clears the hole cards (which sit just above the seat tile).
  const radiusX = 22;
  const radiusY = 16;
  return {
    x: 50 + radiusX * Math.cos(angle),
    y: 50 + radiusY * Math.sin(angle),
    angle,
    roomSlot,
  };
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
    isDealing,
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

  // Dealer / SB / BB marker positions
  const dealerPos = hand ? markerPosForEngineSeat(hand, seats, hand.dealerSeatIdx) : null;
  const sbPos = hand ? markerPosForEngineSeat(hand, seats, hand.sbSeatIdx) : null;
  const bbPos = hand ? markerPosForEngineSeat(hand, seats, hand.bbSeatIdx) : null;
  const headsUp = hand ? hand.seats.length === 2 : false;

  // Measure the felt so we can express dealing-card "from" offsets in pixels
  // (CSS transform percentages would be relative to the card's own size, not the felt).
  const feltRef = useRef<HTMLDivElement>(null);
  const [feltDims, setFeltDims] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = feltRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setFeltDims({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build the deal-animation flying-card list. Two passes (1st card to each, then 2nd),
  // starting from SB and going clockwise. Each card animates from the (cosmetic) deck
  // position to its target seat position, staggered by DEAL_STEP_MS.
  const flyingCards: FlyingCard[] = [];
  if (isDealing && hand && feltDims.w > 0) {
    const N_engine = hand.seats.length;
    for (let pass = 0; pass < 2; pass++) {
      for (let step = 0; step < N_engine; step++) {
        const engineIdx = (hand.sbSeatIdx + step) % N_engine;
        const playerId = hand.seats[engineIdx]?.playerId;
        const seatSlot = seats.findIndex(
          (s) => s.kind === "taken" && s.playerId === playerId,
        );
        if (seatSlot < 0) continue;
        const angle = (seatSlot / N) * 2 * Math.PI - Math.PI / 2;
        const targetX = 50 + SEAT_RADIUS_X * Math.cos(angle);
        const targetY = 50 + SEAT_RADIUS_Y * Math.sin(angle);
        const fromXpx = ((DECK_X - targetX) / 100) * feltDims.w;
        const fromYpx = ((DECK_Y - targetY) / 100) * feltDims.h;
        flyingCards.push({
          key: `${engineIdx}-${pass}`,
          targetX,
          targetY,
          fromXpx,
          fromYpx,
          delay: (pass * N_engine + step) * DEAL_STEP_MS,
        });
      }
    }
  }

  return (
    <div ref={feltRef} className={`felt-table${isDealing ? " dealing" : ""}`}>
      {/* Cosmetic deck — purely a visual origin for the deal animation */}
      <div className="deck" style={{ left: `${DECK_X}%`, top: `${DECK_Y}%` }} aria-hidden>
        <div className="deck-card" />
        <div className="deck-card" />
        <div className="deck-card" />
      </div>

      {/* Dealer / SB / BB markers — smooth left/top transitions handle rotation between hands */}
      {dealerPos && (
        <div
          className={`seat-marker marker-d ${headsUp ? "marker-pair-left" : ""}`}
          style={{ left: `${dealerPos.x}%`, top: `${dealerPos.y}%` }}
          aria-label="Dealer"
          title="Dealer"
        >
          D
        </div>
      )}
      {sbPos && (
        <div
          className={`seat-marker marker-sb ${headsUp ? "marker-pair-right" : ""}`}
          style={{ left: `${sbPos.x}%`, top: `${sbPos.y}%` }}
          aria-label="Small blind"
          title="Small blind"
        >
          SB
        </div>
      )}
      {bbPos && (
        <div
          className="seat-marker marker-bb"
          style={{ left: `${bbPos.x}%`, top: `${bbPos.y}%` }}
          aria-label="Big blind"
          title="Big blind"
        >
          BB
        </div>
      )}

      {/* Deal animation: flying card backs */}
      <DealAnimation cards={flyingCards} />


      {/* Bet piles per seat — positioned at the seat's angle, between seat and felt center */}
      {seats.map((seat) => {
        if (seat.kind !== "taken") return null;
        const handSeat = handByPlayer.get(seat.playerId);
        if (!handSeat || handSeat.committedThisRound <= 0) return null;
        const angle = (seat.index / N) * 2 * Math.PI - Math.PI / 2;
        const radiusX = 24;
        const radiusY = 20;
        const x = 50 + radiusX * Math.cos(angle);
        const y = 50 + radiusY * Math.sin(angle);
        return (
          <div
            className="bet-pile"
            key={`bet-${seat.index}`}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <div className="bet-pile-inner">
              <ChipPile
                amount={handSeat.committedThisRound}
                size="sm"
                showTotal={true}
                showLabels={false}
                title={`Bet: ${formatMoney(handSeat.committedThisRound)}`}
              />
            </div>
          </div>
        );
      })}

      <div className="felt-center">
        {hand && hand.pots.length > 0 && hand.pots.some((p) => p.amount > 0) && (
          <PotBadge pots={hand.pots} />
        )}
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
        // Mid-session joiner: seated, game is on, but not in the current hand snapshot.
        const isWaiting = gameStarted && !isInHand && !seat.busted;
        // Once the hand is complete, fall back to the room seat stack — it's the
        // post-rebuy / post-bust value. The hand snapshot still has the moment-of-
        // showdown stacks which can be stale (e.g. busted player's $0 even after they
        // rebuy back in during the inter-hand pause).
        const handIsLive = !!handSeat && hand?.street !== "complete";
        const liveStack = handIsLive ? (handSeat?.stack ?? seat.stack) : seat.stack;

        const playerName = nameFor(seat.playerId, players);
        return (
          <div
            className={`seat-slot seat-pc-${seat.index % 8}`}
            key={seat.index}
            style={style}
          >
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
              <div className="seat-avatar" aria-hidden>
                {initialsFor(playerName)}
              </div>
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
              <div className="seat-info">
                <div className="seat-name">
                  {playerName}
                  {seat.playerId === hostId && <span className="host-badge">★</span>}
                  {seat.isBot && <span className="bot-badge" title="AI bot">BOT</span>}
                </div>
                {seat.busted ? (
                  <div className="seat-busted">Busted</div>
                ) : (
                  <div className="seat-chips-line">${liveStack}</div>
                )}
              </div>
              {isWaiting && <div className="seat-waiting">Next hand</div>}
              {isCurrent && hand?.currentTurnDeadline && (
                <CountdownBorder deadline={hand.currentTurnDeadline} />
              )}
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
