import { useRef, useState } from "react";
import { ScoreChip } from "../design/ScoreChip";
import { ActionBadge } from "../design/ActionBadge";
import { positionSubLine } from "../../utils/today/positionSubLine";
import type { PositionRow as PositionRowType, VerdictRow } from "../../types/api";

interface PositionRowProps {
  position: PositionRowType;
  verdict?: VerdictRow;
  score?: number;
  isChecking?: boolean;
  jobType?: "quick_check" | "deep_dive" | null;
  onQuickCheck?: () => void;
  onClick: () => void;
}

/**
 * One holding row.
 *
 * Layout:
 *   [ScoreChip] [TICKER  EXCHANGE  VerdictBadge]   [day%]
 *               [verdict-aware sub-line · weight%]  [P/L%]
 *
 * Sub-line priority: triggered catalyst → upcoming catalyst date → verdict default.
 * HOLD default ("thesis on track") is verdict-matched and never appears on REDUCE/SELL/CLOSE.
 */
export function PositionRow({
  position,
  verdict,
  score,
  isChecking,
  jobType,
  onQuickCheck,
  onClick,
}: PositionRowProps) {
  const [dragX, setDragX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const dayChangePct = position.dayChangePct ?? 0;
  const hasDay = dayChangePct !== 0;
  const dayColor = hasDay
    ? dayChangePct >= 0
      ? "var(--color-green)"
      : "var(--color-red)"
    : "var(--text-tertiary)";

  const plPct = position.plPct ?? 0;
  const subLine = positionSubLine(verdict, position.weightPct ?? 0);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!onQuickCheck) return;
    touchStartX.current = event.touches[0]?.clientX ?? null;
    setSwiping(true);
  };
  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!onQuickCheck || touchStartX.current == null) return;
    const currentX = event.touches[0]?.clientX ?? touchStartX.current;
    setDragX(Math.max(0, Math.min(currentX - touchStartX.current, 120)));
  };
  const resetSwipe = () => {
    touchStartX.current = null;
    setSwiping(false);
    setDragX(0);
  };
  const handleTouchEnd = () => {
    if (!onQuickCheck) { resetSwipe(); return; }
    const shouldTrigger = dragX > 72;
    resetSwipe();
    if (shouldTrigger) onQuickCheck();
  };

  return (
    <div className="relative overflow-hidden">
      {onQuickCheck && (
        <div
          className="absolute inset-0 flex items-center px-4"
          style={{
            background: "var(--color-amber-bg)",
            borderTop: "0.5px solid var(--color-amber-border)",
            color: "var(--color-amber)",
          }}
        >
          <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)" }}>
            Quick check
          </span>
        </div>
      )}
      <div
        onClick={onClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={resetSwipe}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: swiping ? "none" : "transform 180ms ease",
          minHeight: 48,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          borderTop: "0.5px solid var(--bg-border)",
          background: "var(--bg-base)",
          cursor: "pointer",
        }}
      >
        {/* Score chip */}
        {score !== undefined ? (
          <ScoreChip score={score} />
        ) : (
          <span
            aria-hidden
            style={{
              width: 26,
              height: 26,
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-surface)",
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "var(--text-xs)",
              color: "var(--text-ghost)",
            }}
          >
            —
          </span>
        )}

        {/* Middle: title line (ticker · exchange · badge) + sub-line */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: "var(--weight-bold)",
                color: "var(--text-primary)",
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
              }}
            >
              {position.ticker}
            </span>
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-tertiary)",
                fontWeight: "var(--weight-regular)",
              }}
            >
              {position.exchange}
            </span>
            {verdict && <ActionBadge verdict={verdict.verdict} score={score} />}
            {isChecking && (
              <span
                style={{
                  fontSize: "var(--text-2xs)",
                  fontWeight: "var(--weight-bold)",
                  color: "var(--color-amber)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {jobType === "quick_check" ? "Checking" : "Deep dive"}
              </span>
            )}
          </div>

          {/* Sub-line: verdict-aware snippet · weight% */}
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-tertiary)",
              marginTop: 2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {subLine}
            {position.priceStale ? <> · stale</> : null}
          </div>
        </div>

        {/* Right: day change + P/L */}
        <div style={{ textAlign: "end", flexShrink: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: dayColor,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {hasDay ? `${dayChangePct >= 0 ? "+" : ""}${dayChangePct.toFixed(2)}%` : "—"}
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 400,
              color: "var(--text-tertiary)",
              fontVariantNumeric: "tabular-nums",
              marginTop: 2,
            }}
          >
            P/L {plPct >= 0 ? "+" : ""}{plPct.toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}
