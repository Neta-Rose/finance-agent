import { useRef, useState } from "react";
import { Card } from "../ui/Card";
import { VerdictBadge } from "../ui/Badge";
import { formatILS, formatPct, plColor } from "../../utils/format";
import type { PositionRow as PositionRowType, VerdictRow } from "../../types/api";

interface PositionRowProps {
  position: PositionRowType;
  verdict?: VerdictRow;
  hasAlert?: boolean;
  isChecking?: boolean;
  jobType?: 'quick_check' | 'deep_dive' | null;
  onQuickCheck?: () => void;
  onClick: () => void;
}

export function PositionRow({
  position,
  verdict,
  hasAlert,
  isChecking,
  jobType,
  onQuickCheck,
  onClick,
}: PositionRowProps) {
  const plClass = plColor(position.plPct);
  const dayClass = plColor(position.dayChangePct ?? 0);
  const stale = position.priceStale;
  const [dragX, setDragX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const touchStartX = useRef<number | null>(null);

  let borderColor = "";
  let bgClass = "";

  if (isChecking) {
    if (jobType === 'quick_check') {
      borderColor = "border-[var(--color-accent-yellow)]";
      bgClass = "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent-yellow)_16%,transparent),color-mix(in_srgb,var(--color-accent-yellow)_5%,transparent))]";
    } else {
      borderColor = "border-[var(--color-accent-orange)]";
      bgClass = "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent-orange)_16%,transparent),color-mix(in_srgb,var(--color-accent-orange)_5%,transparent))]";
    }
  } else if (hasAlert) {
    borderColor = "border-[color-mix(in_srgb,var(--color-accent-yellow)_35%,transparent)]";
    bgClass = "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent-yellow)_14%,transparent),color-mix(in_srgb,var(--color-accent-red)_6%,transparent))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent-yellow)_12%,transparent),0_0_22px_color-mix(in_srgb,var(--color-accent-yellow)_12%,transparent)]";
  }

  const mobileCardClass = `${borderColor} ${bgClass}`;
  const desktopRowClass = isChecking
    ? (jobType === 'quick_check'
        ? "bg-[color-mix(in_srgb,var(--color-accent-yellow)_8%,transparent)]"
        : "bg-[color-mix(in_srgb,var(--color-accent-orange)_8%,transparent)]")
    : hasAlert
    ? "bg-[color-mix(in_srgb,var(--color-accent-yellow)_8%,transparent)]"
    : "hover:bg-[var(--color-bg-muted)]";

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!onQuickCheck) return;
    touchStartX.current = event.touches[0]?.clientX ?? null;
    setSwiping(true);
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!onQuickCheck || touchStartX.current == null) return;
    const currentX = event.touches[0]?.clientX ?? touchStartX.current;
    const delta = Math.max(0, Math.min(currentX - touchStartX.current, 120));
    setDragX(delta);
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

  const dayChangePct = position.dayChangePct ?? 0;
  const hasDayChange = dayChangePct !== 0;

  return (
    <>
      {/* Mobile card */}
      <div className="md:hidden">
        <div className="relative overflow-hidden rounded-lg">
          {onQuickCheck && (
            <div className="absolute inset-0 flex items-center pl-4 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-accent-yellow)_25%,transparent),color-mix(in_srgb,var(--color-accent-yellow)_5%,transparent))] border border-[color-mix(in_srgb,var(--color-accent-yellow)_25%,transparent)] rounded-lg">
              <div>
                <p className="text-[11px] font-semibold text-[var(--color-accent-yellow)]">Swipe right to run quick check</p>
                <p className="text-[10px] text-[var(--color-fg-subtle)]">Queues a focused review on this asset</p>
              </div>
            </div>
          )}
          <div
            style={{
              transform: `translateX(${dragX}px)`,
              transition: swiping ? "none" : "transform 180ms ease",
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={resetSwipe}
          >
            <Card onClick={onClick} className={`px-3 py-3 ${mobileCardClass}`}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono font-bold text-[var(--color-fg-default)] text-sm">{position.ticker}</span>
                  <span className="text-[10px] text-[var(--color-fg-subtle)] bg-[var(--color-bg-muted)] px-1 rounded">
                    {position.exchange}
                  </span>
                  {verdict && <VerdictBadge verdict={verdict.verdict} size="sm" />}
                  {isChecking && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      jobType === 'quick_check'
                        ? 'bg-[color-mix(in_srgb,var(--color-accent-yellow)_18%,transparent)] text-[var(--color-accent-yellow)]'
                        : 'bg-[color-mix(in_srgb,var(--color-accent-orange)_18%,transparent)] text-[var(--color-accent-orange)]'
                    }`}>
                      {jobType === 'quick_check' ? 'quick check' : 'deep analysis'}
                    </span>
                  )}
                  {!isChecking && hasAlert && (
                    <span
                      className="text-[10px] px-1 py-0.5 rounded font-medium bg-[color-mix(in_srgb,var(--color-accent-yellow)_16%,transparent)] text-[var(--color-accent-yellow)]"
                      title="Needs attention"
                    >
                      !
                    </span>
                  )}
                  {stale && <span className="text-[10px]" title="Price may be stale">⚠️</span>}
                </div>
                {/* Today's change as primary top-right metric */}
                <div className="text-right shrink-0">
                  {hasDayChange ? (
                    <>
                      <span className={`text-sm font-semibold tabular-nums ${dayClass}`}>
                        {dayChangePct >= 0 ? "+" : ""}{dayChangePct.toFixed(2)}%
                      </span>
                      <p className="text-[10px] text-[var(--color-fg-subtle)] tabular-nums">
                        day
                      </p>
                    </>
                  ) : (
                    <span className={`text-sm font-semibold tabular-nums ${plClass}`}>
                      {formatPct(position.plPct)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-[var(--color-fg-muted)]">
                <span className="tabular-nums">{formatILS(position.currentILS)}</span>
                <span>·</span>
                <span className={`tabular-nums ${plClass}`}>{formatPct(position.plPct)} P/L</span>
                <span>·</span>
                <span className="tabular-nums">{(position.weightPct ?? 0).toFixed(1)}%</span>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Desktop table row */}
      <tr
        onClick={onClick}
        className={`hidden md:table-row cursor-pointer border-b border-[var(--color-border-muted)] ${desktopRowClass}`}
      >
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-sm text-[var(--color-fg-default)]">{position.ticker}</span>
            <span className="text-[10px] text-[var(--color-fg-subtle)] bg-[var(--color-bg-muted)] px-1 rounded">
              {position.exchange}
            </span>
            {isChecking && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                jobType === 'quick_check'
                  ? 'bg-[color-mix(in_srgb,var(--color-accent-yellow)_18%,transparent)] text-[var(--color-accent-yellow)]'
                  : 'bg-[color-mix(in_srgb,var(--color-accent-orange)_18%,transparent)] text-[var(--color-accent-orange)]'
              }`}>
                {jobType === 'quick_check' ? 'quick check' : 'deep analysis'}
              </span>
            )}
            {!isChecking && hasAlert && (
              <span className="text-[10px] px-1 py-0.5 rounded font-medium bg-[color-mix(in_srgb,var(--color-accent-yellow)_16%,transparent)] text-[var(--color-accent-yellow)]">
                !
              </span>
            )}
            {stale && <span className="text-[10px]" title="Price may be stale">⚠️</span>}
          </div>
        </td>
        <td className="px-3 py-2.5 text-sm text-[var(--color-fg-default)] tabular-nums text-right">{formatILS(position.livePriceILS)}</td>
        <td className={`px-3 py-2.5 text-sm tabular-nums text-right font-semibold ${hasDayChange ? dayClass : "text-[var(--color-fg-subtle)]"}`}>
          {hasDayChange ? `${dayChangePct >= 0 ? "+" : ""}${dayChangePct.toFixed(2)}%` : "—"}
        </td>
        <td className="px-3 py-2.5 text-sm text-[var(--color-fg-default)] tabular-nums text-right font-medium">{formatILS(position.currentILS)}</td>
        <td className={`px-3 py-2.5 text-sm tabular-nums text-right font-semibold ${plClass}`}>{formatPct(position.plPct)}</td>
        <td className={`px-3 py-2.5 text-sm tabular-nums text-right ${plClass}`}>{formatILS(position.plILS)}</td>
        <td className="px-3 py-2.5 text-sm text-[var(--color-fg-muted)] tabular-nums text-right">{(position.weightPct ?? 0).toFixed(1)}%</td>
        <td className="px-3 py-2.5">
          {verdict && <VerdictBadge verdict={verdict.verdict} size="sm" />}
        </td>
      </tr>
    </>
  );
}
