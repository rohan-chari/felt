import { useState } from "react";
import { useParams } from "react-router-dom";
import { getOrCreatePlayerId } from "../identity";
import { useRoomConnection } from "../rooms/useRoomConnection";

export function Room() {
  const { roomId = "" } = useParams<{ roomId: string }>();
  const [displayName, setDisplayName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const playerId = getOrCreatePlayerId();

  const view = useRoomConnection({
    roomId,
    playerId,
    displayName,
    enabled: submitted && displayName.trim().length > 0,
  });

  if (!submitted) {
    return (
      <div style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
        <h1>Room {roomId}</h1>
        <p>Pick a display name to join.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (displayName.trim().length > 0) setSubmitted(true);
          }}
        >
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            autoFocus
          />
          <button type="submit" disabled={displayName.trim().length === 0}>
            Join
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <h1>Room {roomId}</h1>
      <p>
        Share this link: <code>{window.location.href}</code>
      </p>

      {view.status === "connecting" && <p>Connecting…</p>}
      {view.status === "error" && <p style={{ color: "crimson" }}>{view.error}</p>}
      {view.status === "joined" && (
        <>
          <h2>Players ({view.players.length})</h2>
          <ul>
            {view.players.map((p) => (
              <li key={p.id}>
                {p.displayName}
                {p.id === playerId && " (you)"}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
