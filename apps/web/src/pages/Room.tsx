import { useState } from "react";
import { useParams } from "react-router-dom";
import { getOrCreatePlayerId } from "../identity";
import { useRoomConnection } from "../rooms/useRoomConnection";
import { ChatPanel } from "./ChatPanel";
import "./Room.css";
import { Table } from "./Table";

export function Room() {
  const { roomId = "" } = useParams<{ roomId: string }>();
  const [displayName, setDisplayName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pendingSeat, setPendingSeat] = useState<number | null>(null);
  const playerId = getOrCreatePlayerId();

  const { view, send } = useRoomConnection({
    roomId,
    playerId,
    displayName,
    enabled: submitted && displayName.trim().length > 0,
  });

  if (!submitted) {
    return (
      <div className="room-page">
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

  if (view.status === "connecting") {
    return (
      <div className="room-page">
        <h1>Room {roomId}</h1>
        <p>Connecting…</p>
      </div>
    );
  }

  if (view.status === "error") {
    return (
      <div className="room-page">
        <h1>Room {roomId}</h1>
        <p className="error">{view.error}</p>
      </div>
    );
  }

  const isHost = view.hostId === playerId;
  const seatedCount = view.seats.filter((s) => s.kind === "taken").length;
  const canStart = isHost && seatedCount >= 2 && !view.gameStarted;

  const onSitHere = (seatIndex: number) => setPendingSeat(seatIndex);
  const onStandUp = () => send({ type: "seat.leave" });
  const confirmBuyIn = (buyIn: number) => {
    if (pendingSeat === null) return;
    send({ type: "seat.take", seatIndex: pendingSeat, buyIn });
    setPendingSeat(null);
  };

  return (
    <div className="room-page">
      <header className="room-header">
        <h1>Room {roomId}</h1>
        <div className="share">
          Share: <code>{window.location.href}</code>
        </div>
      </header>

      <div className="room-layout">
        <main>
          <Table
            seats={view.seats}
            players={view.players}
            myPlayerId={playerId}
            hostId={view.hostId}
            gameStarted={view.gameStarted}
            onSitHere={onSitHere}
            onStandUp={onStandUp}
          />

          <div className="controls">
            {isHost && !view.gameStarted && (
              <>
                <button
                  type="button"
                  onClick={() => send({ type: "game.start" })}
                  disabled={!canStart}
                >
                  Start game
                </button>
                <span className="hint">
                  {seatedCount < 2
                    ? `Need ${2 - seatedCount} more seated`
                    : "Ready when you are"}
                </span>
              </>
            )}
            {!isHost && !view.gameStarted && (
              <span className="hint">Waiting for host to start the game.</span>
            )}
            {view.gameStarted && <span className="hint">Game in progress.</span>}
          </div>
        </main>

        <aside>
          <ChatPanel
            messages={view.chat}
            onSend={(text) => send({ type: "chat.send", text })}
          />
        </aside>
      </div>

      {pendingSeat !== null && view.config && (
        <BuyInModal
          seatIndex={pendingSeat}
          minBuyIn={view.config.minBuyIn}
          maxBuyIn={view.config.maxBuyIn}
          onCancel={() => setPendingSeat(null)}
          onConfirm={confirmBuyIn}
        />
      )}
    </div>
  );
}

type BuyInModalProps = {
  seatIndex: number;
  minBuyIn: number;
  maxBuyIn: number;
  onCancel: () => void;
  onConfirm: (buyIn: number) => void;
};

function BuyInModal(props: BuyInModalProps) {
  const [value, setValue] = useState(String(props.minBuyIn));
  const num = Number(value);
  const valid =
    Number.isFinite(num) && num >= props.minBuyIn && num <= props.maxBuyIn;

  return (
    <div className="buyin-overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <div className="buyin-modal">
        <h3>Sit at seat {props.seatIndex + 1}</h3>
        <label>
          Buy-in (between {props.minBuyIn} and {props.maxBuyIn})
          <input
            type="number"
            min={props.minBuyIn}
            max={props.maxBuyIn}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </label>
        <div className="actions">
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!valid}
            onClick={() => valid && props.onConfirm(num)}
          >
            Sit down
          </button>
        </div>
      </div>
    </div>
  );
}
