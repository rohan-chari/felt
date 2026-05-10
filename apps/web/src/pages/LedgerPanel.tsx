import type { BuyInLedgerEntry, Player, Seat } from "@felt/shared";

type LedgerPanelProps = {
  players: Player[];
  seats: Seat[];
  buyIns: BuyInLedgerEntry[];
};

type LedgerRow = {
  playerId: string;
  displayName: string;
  buyIn: number;
  stack: number;
  net: number;
};

function buildRows(props: LedgerPanelProps): LedgerRow[] {
  const stackByPlayer = new Map<string, number>();
  for (const seat of props.seats) {
    if (seat.kind === "taken") stackByPlayer.set(seat.playerId, seat.stack);
  }
  const buyInByPlayer = new Map<string, number>();
  for (const entry of props.buyIns) buyInByPlayer.set(entry.playerId, entry.total);

  const rows: LedgerRow[] = [];
  // Anyone with a recorded buy-in shows up, even if they later stood up.
  const playerIds = new Set<string>();
  for (const entry of props.buyIns) playerIds.add(entry.playerId);
  for (const seat of props.seats) {
    if (seat.kind === "taken") playerIds.add(seat.playerId);
  }

  for (const playerId of playerIds) {
    const player = props.players.find((p) => p.id === playerId);
    const buyIn = buyInByPlayer.get(playerId) ?? 0;
    const stack = stackByPlayer.get(playerId) ?? 0;
    rows.push({
      playerId,
      displayName: player?.displayName ?? "(left)",
      buyIn,
      stack,
      net: stack - buyIn,
    });
  }
  rows.sort((a, b) => b.net - a.net);
  return rows;
}

export function LedgerPanel(props: LedgerPanelProps) {
  const rows = buildRows(props);
  if (rows.length === 0) {
    return (
      <div className="ledger-panel">
        <h3 className="ledger-title">Ledger</h3>
        <p className="ledger-empty">No buy-ins yet — sit down to start tracking.</p>
      </div>
    );
  }
  return (
    <div className="ledger-panel">
      <h3 className="ledger-title">Ledger</h3>
      <table className="ledger-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Buy-in</th>
            <th>Stack</th>
            <th>Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.playerId}>
              <td className="ledger-name">{r.displayName}</td>
              <td>${r.buyIn}</td>
              <td>${r.stack}</td>
              <td className={r.net > 0 ? "ledger-up" : r.net < 0 ? "ledger-down" : ""}>
                {r.net > 0 ? "+" : ""}
                ${r.net}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
