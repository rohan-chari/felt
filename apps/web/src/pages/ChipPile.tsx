import { formatMoney } from "@felt/shared";
import { chipBreakdown, denomFor } from "../chips";

type Props = {
  amount: number;
  /** Visual size variant. */
  size?: "sm" | "md" | "lg";
  /** Show the dollar total label below. */
  showTotal?: boolean;
  /** Show per-denom count labels (e.g., "8×$25"). Defaults to true; turn off in tight spots. */
  showLabels?: boolean;
  /** Optional title attribute for the wrapper. */
  title?: string;
};

const SIZE_TOKENS: Record<NonNullable<Props["size"]>, string> = {
  sm: "chip-pile-sm",
  md: "chip-pile-md",
  lg: "chip-pile-lg",
};

/**
 * Side-view chip stacks: one column per denomination, each chip a thin
 * horizontal puck stacked vertically. Pure CSS — no images.
 */
export function ChipPile({
  amount,
  size = "md",
  showTotal = true,
  showLabels = true,
  title,
}: Props) {
  const parts = chipBreakdown(amount);
  if (parts.length === 0) {
    return (
      <div className={`chip-pile ${SIZE_TOKENS[size]} chip-pile-empty`} title={title}>
        {showTotal && <div className="chip-pile-total">{formatMoney(0)}</div>}
      </div>
    );
  }
  return (
    <div className={`chip-pile ${SIZE_TOKENS[size]}`} title={title}>
      <div className="chip-pile-row">
        {parts.map((p) => {
          const denom = denomFor(p.value);
          // Cap visible chip count to keep stacks readable; full count shown in label.
          const visible = Math.min(p.count, 10);
          return (
            <div className="chip-stack" key={p.value}>
              <div className="chip-stack-tower">
                {Array.from({ length: visible }, (_, i) => (
                  <div key={i} className={`chip ${denom?.className ?? ""}`} />
                ))}
              </div>
              {showLabels && (
                <div className="chip-stack-label">
                  {p.count}×<span className="chip-stack-label-value">{denom?.label ?? formatMoney(p.value)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {showTotal && <div className="chip-pile-total">{formatMoney(amount)}</div>}
    </div>
  );
}
