import type { HandView, Player } from "@felt/shared";

type Props = {
  hand: HandView;
  players: Player[];
};

function nameFor(playerId: string, players: Player[]): string {
  return players.find((p) => p.id === playerId)?.displayName ?? playerId;
}

export function ShowdownBanner({ hand, players }: Props) {
  if (hand.street !== "complete" || !hand.result) return null;
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
    </div>
  );
}
