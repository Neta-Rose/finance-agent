import { formatILS, formatPct, timeAgo } from "../../utils/format";
import { usePreferencesStore } from "../../store/preferencesStore";
import { t } from "../../store/i18n";
import type { SummaryStripProps } from "../../types/api";

export function SummaryStrip({ totalILS, totalPlILS, totalPlPct, totalDayChangeILS, totalDayChangePct, usdIlsRate, updatedAt }: SummaryStripProps) {
  const language = usePreferencesStore((s) => s.language);
  const plSign = (totalPlILS ?? 0) >= 0 ? "+" : "";
  const daySign = (totalDayChangeILS ?? 0) >= 0 ? "+" : "";
  const hasDayChange = totalDayChangeILS !== 0 || totalDayChangePct !== 0;

  return (
    <div className="grid grid-cols-2 gap-3 px-4 py-3">
      {/* Today's change — most time-sensitive, shown first */}
      <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg p-3">
        <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("today", language)}</p>
        {hasDayChange ? (
          <>
            <p className={`text-base font-bold tabular-nums ${(totalDayChangePct ?? 0) >= 0 ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]"}`}>
              {daySign}{formatPct(Math.abs(totalDayChangePct ?? 0))}
            </p>
            <p className={`text-[10px] mt-0.5 tabular-nums ${(totalDayChangeILS ?? 0) >= 0 ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]"}`}>
              {daySign}{formatILS(Math.abs(totalDayChangeILS ?? 0))}
            </p>
          </>
        ) : (
          <p className="text-base font-bold text-[var(--color-fg-subtle)]">—</p>
        )}
      </div>

      {/* Total portfolio value */}
      <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg p-3">
        <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("totalValue", language)}</p>
        <p className="text-base font-bold tabular-nums text-[var(--color-fg-default)]">{formatILS(totalILS)}</p>
      </div>

      {/* Total P/L */}
      <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg p-3">
        <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("totalPL", language)}</p>
        <p className={`text-base font-bold tabular-nums ${(totalPlPct ?? 0) >= 0 ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]"}`}>
          {formatPct(totalPlPct)}
        </p>
        <p className={`text-[10px] mt-0.5 tabular-nums ${(totalPlILS ?? 0) >= 0 ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]"}`}>
          {plSign}{formatILS(Math.abs(totalPlILS ?? 0))}
        </p>
      </div>

      {/* USD/ILS rate */}
      <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg p-3">
        <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("usdIls", language)}</p>
        <p className="text-base font-bold tabular-nums text-[var(--color-fg-muted)]">{(usdIlsRate ?? 0).toFixed(2)}</p>
        <p className="text-[10px] text-[var(--color-fg-subtle)] mt-0.5">{t("updatedAt", language)} {timeAgo(updatedAt)}</p>
      </div>
    </div>
  );
}
