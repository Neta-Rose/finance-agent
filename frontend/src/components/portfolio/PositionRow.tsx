import { Card } from "../ui/Card";
import { VerdictBadge } from "../ui/Badge";
import { formatILS, formatPct, plColor } from "../../utils/format";
import type { PositionRow as PositionRowType, VerdictRow } from "../../types/api";

interface PositionRowProps {
  position: PositionRowType;
  verdict?: VerdictRow;
  onClick: () => void;
}

export function PositionRow({ position, verdict, onClick }: PositionRowProps) {
  const plClass = plColor(position.plPct);
  const stale = position.priceStale;

  return (
    <>
      {/* Mobile card */}
      <div className="md:hidden">
        <Card onClick={onClick} className="px-3 py-3">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono font-bold text-[var(--color-fg-default)] text-sm">{position.ticker}</span>
              <span className="text-[10px] text-[var(--color-fg-subtle)] bg-[var(--color-bg-muted)] px-1 rounded">
                {position.exchange}
              </span>
              {verdict && <VerdictBadge verdict={verdict.verdict} size="sm" />}
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
            <span>{position.weightPct.toFixed(1)}%</span>
          </div>
        </Card>
      </div>

      {/* Desktop table row */}
      <tr
        onClick={onClick}
        className="hidden md:table-row cursor-pointer hover:bg-[var(--color-bg-muted)] border-b border-[var(--color-border-muted)]"
      >
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-sm text-[var(--color-fg-default)]">{position.ticker}</span>
            <span className="text-[10px] text-[var(--color-fg-subtle)] bg-[var(--color-bg-muted)] px-1 rounded">
              {position.exchange}
            </span>
            {stale && <span className="text-[10px]" title="Price may be stale">⚠️</span>}
          </div>
        </td>
        <td className="px-3 py-2.5 text-sm text-[var(--color-fg-muted)] text-right">{position.shares}</td>
        <td className="px-3 py-2.5 text-sm text-[var(--color-fg-muted)] text-right">{formatILS(position.avgPriceILS)}</td>
        <td className="px-3 py-2.5 text-sm text-[var(--color-fg-default)] text-right">{formatILS(position.livePriceILS)}</td>
        <td className="px-3 py-2.5 text-sm text-[var(--color-fg-default)] text-right font-medium">{formatILS(position.currentILS)}</td>
        <td className={`px-3 py-2.5 text-sm text-right font-semibold ${plClass}`}>{formatPct(position.plPct)}</td>
        <td className={`px-3 py-2.5 text-sm text-right ${plClass}`}>{formatILS(position.plILS)}</td>
        <td className="px-3 py-2.5 text-sm text-[var(--color-fg-muted)] text-right">{position.weightPct.toFixed(1)}%</td>
        <td className="px-3 py-2.5">
          {verdict && <VerdictBadge verdict={verdict.verdict} size="sm" />}
        </td>
      </tr>
    </>
  );
}
