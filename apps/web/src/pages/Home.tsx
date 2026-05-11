import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@felt/shared";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "../api";
import { resetPlayerId } from "../identity";
import "./Room.css";

type FormState = {
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  turnTimerSec: number;
  autoDealEnabled: boolean;
  showOneShowBoth: boolean;
};

const defaultForm: FormState = {
  smallBlind: DEFAULT_ROOM_CONFIG.smallBlind,
  bigBlind: DEFAULT_ROOM_CONFIG.bigBlind,
  minBuyIn: DEFAULT_ROOM_CONFIG.minBuyIn,
  maxBuyIn: DEFAULT_ROOM_CONFIG.maxBuyIn,
  maxSeats: DEFAULT_ROOM_CONFIG.maxSeats,
  turnTimerSec: DEFAULT_ROOM_CONFIG.turnTimerMs / 1000,
  autoDealEnabled: DEFAULT_ROOM_CONFIG.autoDealEnabled,
  showOneShowBoth: DEFAULT_ROOM_CONFIG.showOneShowBoth,
};

function formToSettings(f: FormState): Partial<RoomConfig> {
  return {
    smallBlind: f.smallBlind,
    bigBlind: f.bigBlind,
    minBuyIn: f.minBuyIn,
    maxBuyIn: f.maxBuyIn,
    startingStack: Math.min(f.maxBuyIn, Math.max(f.minBuyIn, DEFAULT_ROOM_CONFIG.startingStack)),
    maxSeats: f.maxSeats,
    turnTimerMs: f.turnTimerSec * 1000,
    autoDealEnabled: f.autoDealEnabled,
    showOneShowBoth: f.showOneShowBoth,
  };
}

export function Home() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetTick, setResetTick] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [form, setForm] = useState<FormState>(defaultForm);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const settings = showSettings ? formToSettings(form) : undefined;
      const roomId = await createRoom(settings);
      navigate(`/r/${roomId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setBusy(false);
    }
  };

  const onSwitchIdentity = () => {
    resetPlayerId();
    setResetTick((n) => n + 1);
  };

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  return (
    <div className="home-page">
      <div className="home-card">
        <h1 className="home-logo">Felt</h1>
        <p className="home-tagline">A poker table for your group chat.</p>
        <button type="button" className="home-cta" onClick={onCreate} disabled={busy}>
          {busy ? "Creating…" : "Create Room"}
        </button>
        {error && <p className="home-error">{error}</p>}

        <button
          type="button"
          className="home-settings-toggle"
          onClick={() => setShowSettings((s) => !s)}
          aria-expanded={showSettings}
        >
          {showSettings ? "Hide settings ▲" : "Customize settings ▼"}
        </button>

        {showSettings && (
          <div className="home-settings">
            <div className="settings-row">
              <label className="settings-label" htmlFor="sb">Small blind</label>
              <input
                id="sb"
                type="number"
                min={1}
                value={form.smallBlind}
                onChange={(e) => setField("smallBlind", Number(e.target.value) || 1)}
              />
              <label className="settings-label" htmlFor="bb">Big blind</label>
              <input
                id="bb"
                type="number"
                min={2}
                value={form.bigBlind}
                onChange={(e) => setField("bigBlind", Number(e.target.value) || 2)}
              />
            </div>
            <div className="settings-row">
              <label className="settings-label" htmlFor="min">Min buy-in</label>
              <input
                id="min"
                type="number"
                min={1}
                value={form.minBuyIn}
                onChange={(e) => setField("minBuyIn", Number(e.target.value) || 1)}
              />
              <label className="settings-label" htmlFor="max">Max buy-in</label>
              <input
                id="max"
                type="number"
                min={1}
                value={form.maxBuyIn}
                onChange={(e) => setField("maxBuyIn", Number(e.target.value) || 1)}
              />
            </div>
            <div className="settings-row">
              <label className="settings-label" htmlFor="seats">Max seats</label>
              <input
                id="seats"
                type="number"
                min={2}
                max={9}
                value={form.maxSeats}
                onChange={(e) => setField("maxSeats", Number(e.target.value) || 2)}
              />
              <label className="settings-label" htmlFor="timer">Turn timer (s)</label>
              <input
                id="timer"
                type="number"
                min={5}
                max={600}
                value={form.turnTimerSec}
                onChange={(e) => setField("turnTimerSec", Number(e.target.value) || 5)}
              />
            </div>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={form.autoDealEnabled}
                onChange={(e) => setField("autoDealEnabled", e.target.checked)}
              />
              Auto-deal next hand
            </label>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={form.showOneShowBoth}
                onChange={(e) => setField("showOneShowBoth", e.target.checked)}
              />
              Show one, show both (house rule)
            </label>
          </div>
        )}

        <button type="button" className="home-switch" onClick={onSwitchIdentity}>
          {resetTick > 0 ? "Identity cleared — you'll join as a new player" : "Not you? Switch identity"}
        </button>
      </div>
    </div>
  );
}
