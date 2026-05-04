import { useRef, useState } from "react";
import { ScoreChip } from "../design/ScoreChip";
import { ActionBadge } from "../design/ActionBadge";
import { formatPct } from "../../utils/format";
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
 * One holding row — design pivot v2.
 *
 * Layout (single, mobile-first; works at all widths):
 *   [ScoreChip] [TICKER · ex · weight%] [ActionBadge]   [day%] / [P/L%]
 *
 * Visual rules per spec section 3:
 *   - 0.5px top border
 *   - 48px min tap target
 *   - Score chip color is the at-a-glance signal (no separate alert state needed)
 *   - Day % is rightmost, 12px bold green/red — the second-most-important number on the row
 *   - P/L % under day %, 10px tertiary
 *
 * Swipe-to-quick-check is preserved as an optional power-user gesture when onQuickCheck is provided.
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
    if (!onQuickCheck) {
      resetSwipe();
      return;
    }
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

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-tertiary)",
              marginTop: 2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {position.exchange} · {(position.weightPct ?? 0).toFixed(1)}% weight
            {position.priceStale ? <> · stale</> : null}
          </div>
        </div>

        <div style={{ textAlign: "end", flexShrink: 0 }}>
          {/* Primary number — day change. 13px bold semantic color. */}
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
          {/* Secondary — all-time P/L. 10px regular tertiary. Context, not signal. */}
          <div
            style={{
              fontSize: 10,
              fontWeight: 400,
              color: "var(--text-tertiary)",
              fontVariantNumeric: "tabular-nums",
              marginTop: 2,
            }}
          >
            {formatPct(plPct)}
          </div>
        </div>
      </div>
    </div>
  );
}
