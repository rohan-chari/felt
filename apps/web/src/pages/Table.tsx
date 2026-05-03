import type { Player, Seat } from "@felt/shared";

type TableProps = {
  seats: Seat[];
  players: Player[];
  myPlayerId: string;
  hostId: string | null;
  gameStarted: boolean;
  onSitHere: (seatIndex: number) => void;
  onStandUp: () => void;
};

function nameFor(playerId: string, players: Player[]): string {
  return players.find((p) => p.id === playerId)?.displayName ?? "?";
}

export function Table(props: TableProps) {
  const { seats, players, myPlayerId, hostId, gameStarted, onSitHere, onStandUp } = props;
  const mySeatIndex = seats.findIndex((s) => s.kind === "taken" && s.playerId === myPlayerId);
  const N = seats.length;

  return (
    <div className="felt-table">
      <div className="felt-center">
        {gameStarted ? <span className="game-state">Game in progress</span> : <span className="game-state muted">Waiting…</span>}
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
        return (
          <div className="seat-slot" key={seat.index} style={style}>
            {seat.kind === "empty" ? (
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
            ) : (
              <div className={`seat seat-taken${seat.playerId === myPlayerId ? " mine" : ""}`}>
                <div className="seat-name">
                  {nameFor(seat.playerId, players)}
                  {seat.playerId === hostId && <span className="host-badge"> ★</span>}
                </div>
                <div className="seat-stack">${seat.stack}</div>
                {seat.playerId === myPlayerId && !gameStarted && (
                  <button type="button" className="stand-btn" onClick={onStandUp}>
                    Cash out
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
