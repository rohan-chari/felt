import { useEffect } from "react";

type Props = {
  /** Monotonic counter — re-fires the timer when the same error happens again. */
  triggerKey: number;
  message: string;
  tone?: "error" | "info";
  onClose: () => void;
  durationMs?: number;
};

export function Toast({ triggerKey, message, tone = "error", onClose, durationMs = 4000 }: Props) {
  useEffect(() => {
    const timer = setTimeout(onClose, durationMs);
    return () => clearTimeout(timer);
  }, [triggerKey, onClose, durationMs]);

  return (
    <div className={`toast toast-${tone}`} role="status" key={triggerKey}>
      <span>{message}</span>
      <button type="button" className="toast-close" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
