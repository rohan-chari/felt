import { useState } from "react";
import { useParams } from "react-router-dom";
import { getOrCreatePlayerId } from "../identity";
import { useRoomConnection } from "../rooms/useRoomConnection";
import { ActionPanel } from "./ActionPanel";
import { ChatPanel } from "./ChatPanel";
import { HoleCardsHero } from "./HoleCardsHero";
import { NextHandCountdown } from "./NextHandCountdown";
import "./Room.css";
import { ShowdownBanner } from "./ShowdownBanner";
import { Table } from "./Table";
import { Toast } from "./Toast";

function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard might not be available; ignore.
    }
  };
  return (
    <div className="share">
      <span className="share-label">Share:</span>
      <code className="share-url">{url}</code>
      <button type="button" className="share-copy" onClick={onCopy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function Room() {
  const { roomId = "" } = useParams<{ roomId: string }>();
  const [displayName, setDisplayName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pendingSeat, setPendingSeat] = useState<number | null>(null);
  const [rebuyOpen, setRebuyOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const playerId = getOrCreatePlayerId();

  const { view, send, clearTransientError } = useRoomConnection({
    roomId,
    playerId,
    displayName,
    enabled: submitted && displayName.trim().length > 0,
  });

  // If join failed (e.g., name_taken), bounce back to the prompt with the error.
  const joinFailed = submitted && view.status === "error";

  if (!submitted || joinFailed) {
    return (
      <div className="room-page">
        <h1>Room {roomId}</h1>
        <p>Pick a display name to join.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (displayName.trim().length === 0) return;
            // On retry after a failed join, ensure we treat this as a fresh attempt.
            setSubmitted(false);
            requestAnimationFrame(() => setSubmitted(true));
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
        {joinFailed && view.error && <p className="error">{view.error}</p>}
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

  const isHost = view.hostId === playerId;
  const seatedCount = view.seats.filter((s) => s.kind === "taken").length;
  const canStart = isHost && seatedCount >= 2 && !view.gameStarted;

  const onSitHere = (seatIndex: number) => setPendingSeat(seatIndex);
  const onStandUp = () => send({ type: "seat.leave" });
  const onRebuy = () => setRebuyOpen(true);
  const confirmBuyIn = (buyIn: number) => {
    if (pendingSeat === null) return;
    send({ type: "seat.take", seatIndex: pendingSeat, buyIn });
    setPendingSeat(null);
  };
  const confirmRebuy = (amount: number) => {
    send({ type: "seat.rebuy", amount });
    setRebuyOpen(false);
  };

  return (
    <div className="room-page">
      <header className="room-header">
        <h1>Room {roomId}</h1>
        <ShareLink url={window.location.href} />
      </header>

      <div className="room-layout">
        <main>
          <Table
            seats={view.seats}
            players={view.players}
            myPlayerId={playerId}
            hostId={view.hostId}
            gameStarted={view.gameStarted}
            hand={view.hand}
            myHoleCards={view.myHoleCards}
            onSitHere={onSitHere}
            onStandUp={onStandUp}
            onRebuy={onRebuy}
          />

          {view.nextHandAt && view.nextHandAt > Date.now() && (
            <NextHandCountdown at={view.nextHandAt} />
          )}

          {view.hand && view.hand.street !== "complete" && (
            <ActionPanel
              hand={view.hand}
              myPlayerId={playerId}
              players={view.players}
              onAction={(action) => send({ type: "hand.action", action })}
            />
          )}

          {view.hand && <ShowdownBanner hand={view.hand} players={view.players} />}

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
            {view.gameStarted && !view.hand && <span className="hint">Game in progress.</span>}
          </div>
        </main>

      </div>

      <aside className={`chat-overlay ${chatOpen ? "open" : "closed"}`} aria-hidden={!chatOpen}>
        <ChatPanel
          messages={view.chat}
          onSend={(text) => send({ type: "chat.send", text })}
        />
      </aside>

      <button
        type="button"
        className={`chat-toggle ${chatOpen ? "open" : "closed"}`}
        onClick={() => setChatOpen((v) => !v)}
        aria-label={chatOpen ? "Hide chat" : "Show chat"}
        title={chatOpen ? "Hide chat" : "Show chat"}
      >
        <span className="chat-toggle-arrow">{chatOpen ? "›" : "‹"}</span>
        <span className="chat-toggle-label">Chat</span>
      </button>

      <HoleCardsHero cards={view.myHoleCards?.cards ?? null} />

      {view.transientError && (
        <Toast
          triggerKey={view.transientError.seq}
          message={view.transientError.message}
          onClose={clearTransientError}
        />
      )}

      {pendingSeat !== null && view.config && (
        <BuyInModal
          title={`Sit at seat ${pendingSeat + 1}`}
          minBuyIn={view.config.minBuyIn}
          maxBuyIn={view.config.maxBuyIn}
          onCancel={() => setPendingSeat(null)}
          onConfirm={confirmBuyIn}
        />
      )}

      {rebuyOpen && view.config && (
        <BuyInModal
          title="Rebuy"
          minBuyIn={view.config.minBuyIn}
          maxBuyIn={view.config.maxBuyIn}
          onCancel={() => setRebuyOpen(false)}
          onConfirm={confirmRebuy}
        />
      )}
    </div>
  );
}

type BuyInModalProps = {
  title: string;
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
        <h3>{props.title}</h3>
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
