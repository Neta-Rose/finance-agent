import { formatILS, formatPct, timeAgo } from "../../utils/format";
import type { SummaryStripProps } from "../../types/api";

export function SummaryStrip({ totalILS, totalPlILS, totalPlPct, positionCount, winners, losers, usdIlsRate, updatedAt }: SummaryStripProps) {
  const plSign = (totalPlILS ?? 0) >= 0 ? "+" : "";

  return (
    <div className="grid grid-cols-2 gap-3 px-4 py-3">
      {/* Total Value */}
      <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg p-3">
        <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">Total Value</p>
        <p className="text-base font-bold text-[var(--color-fg-default)]">{formatILS(totalILS)}</p>
      </div>

      {/* Total P/L */}
      <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg p-3">
        <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">Total P/L</p>
        <p className={`text-base font-bold ${(totalPlILS ?? 0) >= 0 ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]"}`}>
          {plSign}{formatILS(Math.abs(totalPlILS ?? 0))}
        </p>
        <p className={`text-[10px] mt-0.5 ${(totalPlPct ?? 0) >= 0 ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]"}`}>
          {formatPct(totalPlPct)}
        </p>
      </div>

      {/* Positions */}
      <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg p-3">
        <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">Positions</p>
        <p className="text-base font-bold text-[var(--color-fg-default)]">{positionCount}</p>
        <p className="text-[10px] mt-0.5">
          <span className="text-[var(--color-accent-green)]">{winners}▲</span>
          {" "}
          <span className="text-[var(--color-accent-red)]">{losers}▼</span>
        </p>
      </div>

      {/* USD/ILS */}
      <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg p-3">
        <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">USD/ILS</p>
        <p className="text-base font-bold text-[var(--color-fg-default)]">{(usdIlsRate ?? 0).toFixed(2)}</p>
        <p className="text-[10px] text-[var(--color-fg-subtle)] mt-0.5">Updated {timeAgo(updatedAt)}</p>
      </div>
    </div>
  );
}
