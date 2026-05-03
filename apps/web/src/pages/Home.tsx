import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "../api";

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
    <div style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <h1>Felt</h1>
      <p>A poker table for your group chat.</p>
      <button type="button" onClick={onCreate} disabled={busy}>
        {busy ? "Creating…" : "Create Room"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}
