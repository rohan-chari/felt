import type { BuyInLedgerEntry, Player, RoomId, Seat } from "@felt/shared";
import { useState } from "react";

type LedgerPanelProps = {
  roomId: RoomId | null;
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
  const byPlayer = new Map<string, { total: number; cashedOut: number }>();
  for (const entry of props.buyIns) {
    byPlayer.set(entry.playerId, { total: entry.total, cashedOut: entry.cashedOut });
  }

  const rows: LedgerRow[] = [];
  // Anyone with a recorded buy-in shows up, even if they later stood up or were kicked.
  const playerIds = new Set<string>();
  for (const entry of props.buyIns) playerIds.add(entry.playerId);
  for (const seat of props.seats) {
    if (seat.kind === "taken") playerIds.add(seat.playerId);
  }

  for (const playerId of playerIds) {
    const player = props.players.find((p) => p.id === playerId);
    const totals = byPlayer.get(playerId) ?? { total: 0, cashedOut: 0 };
    const seatedStack = stackByPlayer.get(playerId) ?? 0;
    // Total chips on hand = current seat stack + everything previously cashed out.
    const stack = seatedStack + totals.cashedOut;
    rows.push({
      playerId,
      displayName: player?.displayName ?? "(left)",
      buyIn: totals.total,
      stack,
      net: stack - totals.total,
    });
  }
  rows.sort((a, b) => b.net - a.net);
  return rows;
}

function formatLedgerText(roomId: RoomId | null, rows: LedgerRow[]): string {
  if (rows.length === 0) return "No buy-ins yet.";
  const header = `Felt — Session ledger${roomId ? ` (room ${roomId})` : ""}`;
  const nameWidth = Math.max(6, ...rows.map((r) => r.displayName.length));
  const lines = rows.map((r) => {
    const name = r.displayName.padEnd(nameWidth);
    const net = `${r.net > 0 ? "+" : ""}$${r.net}`;
    return `${name}  ${net.padStart(8)}   (buy-in $${r.buyIn}, stack $${r.stack})`;
  });
  return [header, ...lines].join("\n");
}

export function LedgerPanel(props: LedgerPanelProps) {
  const rows = buildRows(props);
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatLedgerText(props.roomId, rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard might not be available.
    }
  };

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
      <div className="ledger-header">
        <h3 className="ledger-title">Ledger</h3>
        <button type="button" className="ledger-copy" onClick={onCopy} title="Copy ledger as text">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
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
