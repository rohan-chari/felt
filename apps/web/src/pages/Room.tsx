import { formatMoney, type HandView, parseMoney } from "@felt/shared";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getOrCreatePlayerId } from "../identity";
import { useRoomConnection } from "../rooms/useRoomConnection";
import { ActionPanel } from "./ActionPanel";
import { ChatPanel } from "./ChatPanel";
import { ChipPile } from "./ChipPile";
import { HandHistoryPanel } from "./HandHistoryPanel";
import { HandReplayOverlay } from "./HandReplayOverlay";
import { HoleCardsHero } from "./HoleCardsHero";
import { HostMenu } from "./HostMenu";
import { LedgerPanel } from "./LedgerPanel";
import { NextHandCountdown } from "./NextHandCountdown";
import "./Room.css";
import { ShowdownBanner } from "./ShowdownBanner";
import { Table } from "./Table";
import { Toast } from "./Toast";

// Keep these in sync with Table.tsx and the .flying-card animation in Room.css.
const DEAL_STEP_MS = 200;
const DEAL_FLIGHT_MS = 500;

/** True while a freshly-started hand is animating its initial deal. */
function useDealAnimation(hand: HandView | null): boolean {
  const [isDealing, setIsDealing] = useState(false);
  const lastHandRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hand) return;
    if (hand.handId === lastHandRef.current) return;
    lastHandRef.current = hand.handId;
    // Only animate brand-new hands at the start of preflop. Anything else
    // (joining mid-hand, reconnect) shows cards immediately.
    if (hand.street !== "preflop" || hand.board.length !== 0) {
      setIsDealing(false);
      return;
    }
    setIsDealing(true);
    const totalMs = hand.seats.length * 2 * DEAL_STEP_MS + DEAL_FLIGHT_MS;
    const timer = setTimeout(() => setIsDealing(false), totalMs);
    return () => clearTimeout(timer);
  }, [hand?.handId, hand?.street, hand?.board.length, hand?.seats.length]);

  return isDealing;
}

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
    <button
      type="button"
      className="share-copy"
      onClick={onCopy}
      title={url}
    >
      {copied ? "Copied!" : "Copy invite"}
    </button>
  );
}

export function Room() {
  const { roomId = "" } = useParams<{ roomId: string }>();
  const [displayName, setDisplayName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pendingSeat, setPendingSeat] = useState<number | null>(null);
  const [rebuyOpen, setRebuyOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [sideTab, setSideTab] = useState<"chat" | "history">("chat");
  const playerId = getOrCreatePlayerId();

  const { view, send, clearTransientError, clearReplay, pushTransientError } = useRoomConnection({
    roomId,
    playerId,
    displayName,
    enabled: submitted && displayName.trim().length > 0,
  });
  const isDealing = useDealAnimation(view.hand);

  // Fetch hand history on first join, then again whenever a hand finishes.
  // The hand snapshot transitions to street === "complete" with a new handId
  // when a fresh hand wraps; that's our trigger to ask the server for an
  // updated history list. Per-completion refetch is cheap (read from Postgres).
  const initialHistoryFetchedRef = useRef(false);
  const lastCompletedHandIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (view.status !== "joined") return;
    if (!initialHistoryFetchedRef.current) {
      initialHistoryFetchedRef.current = true;
      send({ type: "hand.history" });
    }
    const hand = view.hand;
    if (
      hand &&
      hand.street === "complete" &&
      hand.handId !== lastCompletedHandIdRef.current
    ) {
      lastCompletedHandIdRef.current = hand.handId;
      send({ type: "hand.history" });
    }
  }, [view.status, view.hand?.handId, view.hand?.street, send]);

  // If join failed (e.g., name_taken), bounce back to the prompt with the error.
  const joinFailed = submitted && view.status === "error";

  if (!submitted || joinFailed) {
    return (
      <div className="home-page">
        <div className="home-card">
          <h1 className="home-logo">Room</h1>
          <p className="home-tagline">
            <span className="room-code">{roomId}</span>
          </p>
          <form
            className="join-form"
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
          {joinFailed && view.error && <p className="home-error">{view.error}</p>}
        </div>
      </div>
    );
  }

  if (view.status === "connecting") {
    return (
      <div className="home-page">
        <div className="home-card">
          <h1 className="home-logo">Room</h1>
          <p className="home-tagline">Connecting…</p>
        </div>
      </div>
    );
  }

  const isHost = view.hostId === playerId;
  const seatedCount = view.seats.filter((s) => s.kind === "taken").length;
  const canStart = isHost && seatedCount >= 2 && !view.gameStarted;
  // Mid-session joiner: I'm seated, game is on, but I'm not in the current hand.
  const mySeat = view.seats.find((s) => s.kind === "taken" && s.playerId === playerId);
  const myInHand = !!view.hand?.seats.find((s) => s.playerId === playerId);
  const myWaiting =
    !!mySeat && mySeat.kind === "taken" && !mySeat.busted && view.gameStarted && !myInHand;

  const onSitHere = (seatIndex: number) => setPendingSeat(seatIndex);
  const onStandUp = () => send({ type: "seat.leave" });
  const onRebuy = () => setRebuyOpen(true);
  const confirmBuyIn = (buyIn: number) => {
    if (pendingSeat === null) return;
    send({ type: "seat.take", seatIndex: pendingSeat, buyIn });
    setPendingSeat(null);
    // If a game is already running, the joiner waits one hand. Surface it.
    if (view.gameStarted) {
      pushTransientError("seated_waiting", "You'll be dealt in next hand.", "info");
    }
  };
  const confirmRebuy = (amount: number) => {
    send({ type: "seat.rebuy", amount });
    setRebuyOpen(false);
  };

  const openSideTab = (tab: "chat" | "history") => {
    setSideTab(tab);
    setSideOpen(true);
  };

  return (
    <div className="room-page">
      {/* ── Top toolbar ────────────────────────────────────────────── */}
      <div className="room-topbar">
        {/* Left group: host controls (host only) */}
        <div className="room-topbar-left">
          {isHost && (
            <HostMenu
              hostId={playerId}
              players={view.players}
              seats={view.seats}
              config={view.config}
              paused={view.paused}
              ended={view.ended}
              onPause={() => send({ type: "host.pause" })}
              onResume={() => send({ type: "host.resume" })}
              onEndSession={() => send({ type: "host.endSession" })}
              onKick={(targetId) => send({ type: "host.kick", playerId: targetId })}
              onUpdateSettings={(settings) => send({ type: "host.updateSettings", settings })}
              onTransferHost={(targetId) => send({ type: "host.transfer", playerId: targetId })}
              onAddBot={() => send({ type: "host.addBot" })}
              onRemoveBot={(targetId) => send({ type: "host.removeBot", playerId: targetId })}
            />
          )}
        </div>

        {/* Center group: room identity */}
        <div className="room-topbar-center">
          <span className="room-topbar-label">Room</span>
          <span className="room-code">{roomId}</span>
          <ShareLink url={window.location.href} />
        </div>

        {/* Right group: side panel toggles */}
        <div className="room-topbar-right">
          <button
            type="button"
            className={`topbar-side-btn ${sideOpen && sideTab === "history" ? "active" : ""}`}
            onClick={() => sideOpen && sideTab === "history" ? setSideOpen(false) : openSideTab("history")}
            aria-label="Toggle history panel"
          >
            History
          </button>
          <button
            type="button"
            className={`topbar-side-btn ${sideOpen && sideTab === "chat" ? "active" : ""}`}
            onClick={() => sideOpen && sideTab === "chat" ? setSideOpen(false) : openSideTab("chat")}
            aria-label="Toggle chat panel"
          >
            Chat
          </button>
        </div>
      </div>

      {view.ended ? (
        <div className="session-banner session-banner-ended">
          Session ended — final ledger is shown in the History panel.
        </div>
      ) : view.paused ? (
        <div className="session-banner session-banner-paused">
          Paused by host. Hands will resume when the host hits Resume.
        </div>
      ) : null}

      {myWaiting && !view.ended && !view.paused && (
        <div className="waiting-banner">
          You're seated. You'll be dealt in next hand.
        </div>
      )}

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
            isDealing={isDealing}
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
              isDealing={isDealing}
              onAction={(action) => send({ type: "hand.action", action })}
              onUseTimeBank={() => send({ type: "hand.useTimeBank" })}
              onPreAction={(preAction) => send({ type: "hand.preAction", preAction })}
              onCancelPreAction={() => send({ type: "hand.cancelPreAction" })}
            />
          )}

          {view.hand && (
            <ShowdownBanner
              hand={view.hand}
              players={view.players}
              myPlayerId={playerId}
              onShowCards={() => send({ type: "seat.showCards" })}
            />
          )}

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

      {/* ── Right side rail (History + Chat consolidated) ─────────── */}
      <aside
        className={`side-rail ${sideOpen ? "open" : ""}`}
        aria-label="Side panel"
        aria-hidden={!sideOpen}
      >
        <div className="side-rail-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={sideTab === "history"}
            className={`side-rail-tab ${sideTab === "history" ? "active" : ""}`}
            onClick={() => setSideTab("history")}
          >
            History
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sideTab === "chat"}
            className={`side-rail-tab ${sideTab === "chat" ? "active" : ""}`}
            onClick={() => setSideTab("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            className="side-rail-close"
            onClick={() => setSideOpen(false)}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        <div className="side-rail-body" role="tabpanel">
          {sideTab === "history" ? (
            <>
              <LedgerPanel
                roomId={view.roomId}
                players={view.players}
                seats={view.seats}
                buyIns={view.buyIns}
              />
              <HandHistoryPanel
                hands={view.handHistory}
                myPlayerId={playerId}
                onOpenReplay={(handId) => send({ type: "hand.replay", handId })}
              />
            </>
          ) : (
            <ChatPanel
              messages={view.chat}
              onSend={(text) => send({ type: "chat.send", text })}
            />
          )}
        </div>
      </aside>

      <HoleCardsHero cards={view.myHoleCards?.cards ?? null} />
      {(() => {
        const mySeat = view.seats.find(
          (s) => s.kind === "taken" && s.playerId === playerId,
        );
        if (!mySeat || mySeat.kind !== "taken" || mySeat.busted) return null;
        // Use the live in-hand stack ONLY while a hand is actively in progress.
        // Once the hand is complete (showdown banner showing during inter-hand
        // pause), fall back to the room seat stack so a fresh rebuy reflects.
        const handSeat = view.hand?.seats.find((s) => s.playerId === playerId);
        const handIsLive = view.hand && view.hand.street !== "complete";
        const myStack = handIsLive ? (handSeat?.stack ?? mySeat.stack) : mySeat.stack;
        return (
          <div className="hero-chips" aria-label="Your chip stack">
            <ChipPile amount={myStack} size="lg" showTotal={true} />
          </div>
        );
      })()}

      {view.transientError && (
        <Toast
          triggerKey={view.transientError.seq}
          message={view.transientError.message}
          tone={view.transientError.tone}
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
          onValidationError={pushTransientError}
        />
      )}

      {rebuyOpen && view.config && (
        <BuyInModal
          title="Rebuy"
          minBuyIn={view.config.minBuyIn}
          maxBuyIn={view.config.maxBuyIn}
          onCancel={() => setRebuyOpen(false)}
          onConfirm={confirmRebuy}
          onValidationError={pushTransientError}
        />
      )}

      {(() => {
        if (!view.replay) return null;
        const record = view.handHistory.find((h) => h.handId === view.replay?.handId);
        if (!record) return null;
        return (
          <HandReplayOverlay
            record={record}
            frames={view.replay.frames}
            myPlayerId={playerId}
            onClose={clearReplay}
          />
        );
      })()}
    </div>
  );
}

type BuyInModalProps = {
  title: string;
  minBuyIn: number;
  maxBuyIn: number;
  onCancel: () => void;
  onConfirm: (buyIn: number) => void;
  onValidationError: (code: string, message: string) => void;
};

function BuyInModal(props: BuyInModalProps) {
  const [value, setValue] = useState((props.minBuyIn / 100).toFixed(2));
  const parsed = parseMoney(value);
  const num = parsed ?? Number.NaN;
  const valid =
    parsed !== null && num >= props.minBuyIn && num <= props.maxBuyIn;

  const onSubmit = () => {
    if (valid) {
      props.onConfirm(num);
      return;
    }
    if (parsed === null) {
      props.onValidationError("bad_buyin", "Enter a valid buy-in amount.");
    } else if (num < props.minBuyIn) {
      props.onValidationError(
        "bad_buyin",
        `Minimum buy-in is ${formatMoney(props.minBuyIn)}.`,
      );
    } else if (num > props.maxBuyIn) {
      props.onValidationError(
        "bad_buyin",
        `Maximum buy-in is ${formatMoney(props.maxBuyIn)}.`,
      );
    }
  };

  return (
    <div className="buyin-overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <div className="buyin-modal">
        <h3>{props.title}</h3>
        <label>
          Buy-in (between {formatMoney(props.minBuyIn)} and {formatMoney(props.maxBuyIn)})
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            }}
            autoFocus
          />
        </label>
        <div className="actions">
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={onSubmit}>
            Sit down
          </button>
        </div>
      </div>
    </div>
  );
}
