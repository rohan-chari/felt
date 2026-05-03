import { useEffect, useState } from "react";

type Props = {
  /** Unix epoch ms when the next hand starts. */
  at: number;
};

export function NextHandCountdown({ at }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const secondsLeft = Math.max(0, Math.ceil((at - now) / 1000));
  return (
    <div className="next-hand-countdown" aria-live="polite">
      Next hand in {secondsLeft}s…
    </div>
  );
}
