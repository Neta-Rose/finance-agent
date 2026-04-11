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
  onQuickCheck?: () => void;
  onClick: () => void;
}

export function PositionRow({
  position,
  verdict,
  hasAlert,
  isChecking,
  onQuickCheck,
  onClick,
}: PositionRowProps) {
  const plClass = plColor(position.plPct);
  const stale = position.priceStale;
  const [dragX, setDragX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const mobileCardClass = isChecking
    ? "border-[var(--color-accent-yellow)] bg-[linear-gradient(135deg,rgba(251,191,36,0.16),rgba(251,191,36,0.05))]"
    : hasAlert
    ? "border-[rgba(245,158,11,0.35)] bg-[linear-gradient(135deg,rgba(245,158,11,0.14),rgba(239,68,68,0.06))] shadow-[0_0_0_1px_rgba(245,158,11,0.12),0_0_22px_rgba(245,158,11,0.12)]"
    : "";

  const desktopRowClass = isChecking
    ? "bg-[rgba(251,191,36,0.08)]"
    : hasAlert
    ? "bg-[rgba(245,158,11,0.08)]"
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

  return (
    <>
      {/* Mobile card */}
      <div className="md:hidden">
        <div className="relative overflow-hidden rounded-lg">
          {onQuickCheck && (
            <div className="absolute inset-0 flex items-center pl-4 bg-[linear-gradient(90deg,rgba(234,179,8,0.25),rgba(234,179,8,0.05))] border border-[rgba(234,179,8,0.25)] rounded-lg">
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
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-[rgba(251,191,36,0.18)] text-[var(--color-accent-yellow)]">
                      checking
                    </span>
                  )}
                  {!isChecking && hasAlert && (
                    <span
                      className="text-[10px] px-1 py-0.5 rounded font-medium"
                      style={{ background: "rgba(245,158,11,0.16)", color: "rgb(245,158,11)" }}
                      title="Needs attention"
                    >
                      !
                    </span>
                  )}
                  {stale && <span className="text-[10px]" title="Price may be stale">⚠️</span>}
                </div>
                <span className={`text-sm font-semibold shrink-0 ${plClass}`}>
                  {formatPct(position.plPct)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-[var(--color-fg-muted)]">
                <span>{formatILS(position.currentILS)}</span>
                <span>·</span>
                <span>{position.shares} shares</span>
                <span>·</span>
                <span>{(position.weightPct ?? 0).toFixed(1)}%</span>
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
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-[rgba(251,191,36,0.18)] text-[var(--color-accent-yellow)]">
                checking
              </span>
            )}
            {!isChecking && hasAlert && (
              <span className="text-[10px] px-1 py-0.5 rounded font-medium bg-[rgba(245,158,11,0.16)] text-[rgb(245,158,11)]">
                !
              </span>
            )}
            {stale && <span className="text-[10px]" title="Price may be stale">⚠️</span>}
          </div>
        </td>
        <td className="px-3 py-2.5 text-sm text-[var(--color-fg-muted)] text-right">{position.shares}</td>
        <td className="px-3 py-2.5 text-sm text-[var(--color-fg-muted)] text-right">{formatILS(position.avgPriceILS)}</td>
        <td className="px-3 py-2.5 text-sm text-[var(--color-fg-default)] text-right">{formatILS(position.livePriceILS)}</td>
        <td className="px-3 py-2.5 text-sm text-[var(--color-fg-default)] text-right font-medium">{formatILS(position.currentILS)}</td>
        <td className={`px-3 py-2.5 text-sm text-right font-semibold ${plClass}`}>{formatPct(position.plPct)}</td>
        <td className={`px-3 py-2.5 text-sm text-right ${plClass}`}>{formatILS(position.plILS)}</td>
        <td className="px-3 py-2.5 text-sm text-[var(--color-fg-muted)] text-right">{(position.weightPct ?? 0).toFixed(1)}%</td>
        <td className="px-3 py-2.5">
          {verdict && <VerdictBadge verdict={verdict.verdict} size="sm" />}
        </td>
      </tr>
    </>
  );
}
