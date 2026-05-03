import type { Card } from "@felt/shared";

type Props = {
  cards: [Card, Card] | null;
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

function colorClass(card: Card): string {
  return card[1] === "h" || card[1] === "d" ? "hero-red" : "hero-black";
}

export function HoleCardsHero({ cards }: Props) {
  if (!cards) return null;
  return (
    <div className="hole-hero" aria-label="Your hole cards">
      {cards.map((c, i) => {
        const rank = c[0] === "T" ? "10" : c[0];
        // Fan: left card tilts left and sits slightly back, right card tilts right.
        const isLeft = i === 0;
        return (
          <div
            key={c}
            className={`hero-card ${colorClass(c)} ${isLeft ? "hero-card-left" : "hero-card-right"}`}
          >
            <span className="hero-rank">{rank}</span>
            <span className="hero-suit">{suitGlyph(c)}</span>
          </div>
        );
      })}
    </div>
  );
}
