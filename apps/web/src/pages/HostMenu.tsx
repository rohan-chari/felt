import type { Player, PlayerId, RoomConfig, Seat } from "@felt/shared";
import { useState } from "react";

type Props = {
  hostId: PlayerId;
  players: Player[];
  seats: Seat[];
  config: RoomConfig | null;
  paused: boolean;
  ended: boolean;
  onPause: () => void;
  onResume: () => void;
  onEndSession: () => void;
  onKick: (playerId: PlayerId) => void;
  onUpdateSettings: (settings: Partial<RoomConfig>) => void;
  onTransferHost: (playerId: PlayerId) => void;
};

type SettingsDraft = {
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  turnTimerSec: number;
  autoDealEnabled: boolean;
  showOneShowBoth: boolean;
};

function draftFromConfig(c: RoomConfig): SettingsDraft {
  return {
    smallBlind: c.smallBlind,
    bigBlind: c.bigBlind,
    minBuyIn: c.minBuyIn,
    maxBuyIn: c.maxBuyIn,
    turnTimerSec: Math.round(c.turnTimerMs / 1000),
    autoDealEnabled: c.autoDealEnabled,
    showOneShowBoth: c.showOneShowBoth,
  };
}

function diffSettings(c: RoomConfig, d: SettingsDraft): Partial<RoomConfig> {
  const out: Partial<RoomConfig> = {};
  if (d.smallBlind !== c.smallBlind) out.smallBlind = d.smallBlind;
  if (d.bigBlind !== c.bigBlind) out.bigBlind = d.bigBlind;
  if (d.minBuyIn !== c.minBuyIn) out.minBuyIn = d.minBuyIn;
  if (d.maxBuyIn !== c.maxBuyIn) out.maxBuyIn = d.maxBuyIn;
  const timerMs = d.turnTimerSec * 1000;
  if (timerMs !== c.turnTimerMs) out.turnTimerMs = timerMs;
  if (d.autoDealEnabled !== c.autoDealEnabled) out.autoDealEnabled = d.autoDealEnabled;
  if (d.showOneShowBoth !== c.showOneShowBoth) out.showOneShowBoth = d.showOneShowBoth;
  return out;
}

export function HostMenu({
  hostId,
  players,
  seats,
  config,
  paused,
  ended,
  onPause,
  onResume,
  onEndSession,
  onKick,
  onUpdateSettings,
  onTransferHost,
}: Props) {
  const [open, setOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);

  const kickables = players.filter((p) => p.id !== hostId);
  const seatedIds = new Set(
    seats.filter((s): s is Extract<Seat, { kind: "taken" }> => s.kind === "taken").map((s) => s.playerId),
  );

  if (ended) {
    return (
      <div className="host-menu host-menu-ended" aria-label="Host menu">
        Session ended
      </div>
    );
  }

  const openSettings = () => {
    if (config) setDraft(draftFromConfig(config));
    setSettingsOpen((v) => !v);
  };
  const setField = <K extends keyof SettingsDraft>(k: K, v: SettingsDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  const onApply = () => {
    if (!config || !draft) return;
    const diff = diffSettings(config, draft);
    if (Object.keys(diff).length === 0) {
      setSettingsOpen(false);
      return;
    }
    onUpdateSettings(diff);
    setSettingsOpen(false);
  };

  return (
    <div className={`host-menu ${open ? "open" : ""}`} aria-label="Host menu">
      <button
        type="button"
        className="host-menu-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Host {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="host-menu-body">
          {paused ? (
            <button type="button" className="host-action host-action-resume" onClick={onResume}>
              Resume
            </button>
          ) : (
            <button type="button" className="host-action host-action-pause" onClick={onPause}>
              Pause
            </button>
          )}

          <button type="button" className="host-action" onClick={openSettings}>
            Settings {settingsOpen ? "▴" : "▾"}
          </button>
          {settingsOpen && draft && config && (
            <div className="host-settings">
              <div className="host-settings-grid">
                <label>SB</label>
                <input
                  type="number"
                  min={1}
                  value={draft.smallBlind}
                  onChange={(e) => setField("smallBlind", Number(e.target.value) || 1)}
                />
                <label>BB</label>
                <input
                  type="number"
                  min={2}
                  value={draft.bigBlind}
                  onChange={(e) => setField("bigBlind", Number(e.target.value) || 2)}
                />
                <label>Min buy-in</label>
                <input
                  type="number"
                  min={1}
                  value={draft.minBuyIn}
                  onChange={(e) => setField("minBuyIn", Number(e.target.value) || 1)}
                />
                <label>Max buy-in</label>
                <input
                  type="number"
                  min={1}
                  value={draft.maxBuyIn}
                  onChange={(e) => setField("maxBuyIn", Number(e.target.value) || 1)}
                />
                <label>Timer (s)</label>
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={draft.turnTimerSec}
                  onChange={(e) => setField("turnTimerSec", Number(e.target.value) || 5)}
                />
              </div>
              <label className="host-settings-check">
                <input
                  type="checkbox"
                  checked={draft.autoDealEnabled}
                  onChange={(e) => setField("autoDealEnabled", e.target.checked)}
                />
                Auto-deal next hand
              </label>
              <label className="host-settings-check">
                <input
                  type="checkbox"
                  checked={draft.showOneShowBoth}
                  onChange={(e) => setField("showOneShowBoth", e.target.checked)}
                />
                Show one, show both
              </label>
              <div className="host-settings-actions">
                <button type="button" className="host-action" onClick={onApply}>
                  Apply
                </button>
                <button
                  type="button"
                  className="host-action-cancel"
                  onClick={() => setSettingsOpen(false)}
                >
                  Cancel
                </button>
              </div>
              <div className="host-settings-hint">
                Blinds apply at the next hand. Most other changes apply immediately.
              </div>
            </div>
          )}

          {kickables.length > 0 && (
            <div className="host-kick-section">
              <div className="host-kick-label">Transfer host</div>
              {kickables.map((p) => (
                <button
                  type="button"
                  key={`xfer-${p.id}`}
                  className="host-xfer-btn"
                  onClick={() => onTransferHost(p.id)}
                  title="Hand off host duties to this player"
                >
                  {p.displayName}
                </button>
              ))}
              <div className="host-kick-label" style={{ marginTop: 6 }}>Kick</div>
              {kickables.map((p) => (
                <button
                  type="button"
                  key={`kick-${p.id}`}
                  className="host-kick-btn"
                  onClick={() => onKick(p.id)}
                  title={seatedIds.has(p.id) ? "Kick (cashes out their stack)" : "Remove from room"}
                >
                  {p.displayName}
                </button>
              ))}
            </div>
          )}

          {confirmEnd ? (
            <div className="host-end-confirm">
              <span>End the session?</span>
              <button type="button" className="host-action host-action-end" onClick={onEndSession}>
                Yes, end
              </button>
              <button type="button" className="host-action-cancel" onClick={() => setConfirmEnd(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="host-action host-action-end"
              onClick={() => setConfirmEnd(true)}
            >
              End session
            </button>
          )}
        </div>
      )}
    </div>
  );
}
