import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "../api";
import "./Room.css";

export function Home() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const roomId = await createRoom();
      navigate(`/r/${roomId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setBusy(false);
    }
  };

  return (
    <div className="home-page">
      <div className="home-card">
        <h1 className="home-logo">Felt</h1>
        <p className="home-tagline">A poker table for your group chat.</p>
        <button type="button" className="home-cta" onClick={onCreate} disabled={busy}>
          {busy ? "Creating…" : "Create Room"}
        </button>
        {error && <p className="home-error">{error}</p>}
      </div>
    </div>
  );
}
