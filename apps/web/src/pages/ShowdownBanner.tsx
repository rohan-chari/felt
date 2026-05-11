import type { HandView, Player, PlayerId } from "@felt/shared";

type Props = {
  hand: HandView;
  players: Player[];
  myPlayerId: PlayerId;
  onShowCards: () => void;
};

function nameFor(playerId: string, players: Player[]): string {
  return players.find((p) => p.id === playerId)?.displayName ?? playerId;
}

export function ShowdownBanner({ hand, players, myPlayerId, onShowCards }: Props) {
  if (hand.street !== "complete" || !hand.result) return null;

  // Fold-around reveal opt-in: local player won uncontested and their cards
  // are still hidden — offer a "Show my cards" button.
  const nonFolded = hand.seats.filter((s) => !s.isFolded);
  const mySeat = hand.seats.find((s) => s.playerId === myPlayerId);
  const isFoldAroundWinner =
    nonFolded.length === 1 &&
    mySeat &&
    !mySeat.isFolded &&
    mySeat.holeCards === null;

  return (
    <div className="showdown-banner">
      <h3>Hand complete</h3>
      <ul>
        {hand.result.awards.map((award, i) => (
          <li key={i}>
            <strong>${award.amount}</strong> →{" "}
            {award.winners
              .map((w) => `${nameFor(w.playerId, players)} ($${w.amount}, ${w.handDescr})`)
              .join(", ")}
          </li>
        ))}
      </ul>
      {isFoldAroundWinner && (
        <button type="button" className="showdown-show-btn" onClick={onShowCards}>
          Show my cards
        </button>
      )}
    </div>
  );
}
