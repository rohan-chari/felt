import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Props = {
  deadline: number; // unix ms
};

/**
 * Animated gold border that drains around the seat tile as the turn timer ticks.
 * The "total" duration is inferred from the moment the deadline was first observed —
 * when the deadline changes (new turn or time bank used), the border resets full
 * and starts draining again. Switches to crimson with <5s remaining.
 */
export function CountdownBorder({ deadline }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const startedAtRef = useRef(Date.now());
  const lastDeadlineRef = useRef(deadline);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  if (deadline !== lastDeadlineRef.current) {
    startedAtRef.current = Date.now();
    lastDeadlineRef.current = deadline;
  }

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setDims({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const totalMs = Math.max(1, deadline - startedAtRef.current);
  const remaining = Math.max(0, deadline - now);
  const fraction = Math.min(1, Math.max(0, remaining / totalMs));
  const lowTime = remaining <= 5_000;

  const stroke = 3;
  const rx = 12;
  const w = dims.w;
  const h = dims.h;
  const inset = stroke / 2;

  return (
    <div ref={wrapRef} className="countdown-border" aria-hidden>
      {w > 0 && h > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          <rect
            x={inset}
            y={inset}
            width={Math.max(0, w - stroke)}
            height={Math.max(0, h - stroke)}
            rx={rx}
            ry={rx}
            pathLength={1}
            fill="none"
            stroke={lowTime ? "var(--crimson)" : "var(--accent)"}
            strokeWidth={stroke}
            strokeDasharray="1"
            strokeDashoffset={1 - fraction}
          />
        </svg>
      )}
    </div>
  );
}
