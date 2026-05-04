import { ChevronRight } from "lucide-react";
import { VerdictBadge } from "../ui/Badge";
import { whyToday } from "../../utils/today/whyToday";
import { usePreferencesStore } from "../../store/preferencesStore";
import type { AttentionItem } from "../../types/api";

interface AttentionCardProps {
  item: AttentionItem;
  onClick: (ticker: string) => void;
}

const REASON_BORDER: Record<AttentionItem["reason"], string> = {
  catalyst_expired: "var(--color-accent-red)",
  verdict_close: "var(--color-accent-red)",
  verdict_sell: "var(--color-accent-red)",
  verdict_reduce: "var(--color-accent-yellow)",
};

/**
 * One ticker that needs attention today.
 * Tap → opens StrategyModal (with this AttentionItem) — drill-down to "why".
 */
export function AttentionCard({ item, onClick }: AttentionCardProps) {
  const language = usePreferencesStore((s) => s.language);
  const why = whyToday(item, language);
  const borderColor = REASON_BORDER[item.reason];

  return (
    <button
      type="button"
      onClick={() => onClick(item.ticker)}
      className="w-full text-start mx-4 my-1.5 px-3.5 py-3 rounded-xl bg-[var(--color-bg-subtle)] border border-[var(--color-border)] flex items-start gap-3 active:bg-[var(--color-bg-muted)] transition-colors"
      style={{ borderInlineStartWidth: 3, borderInlineStartColor: borderColor }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono font-bold text-[var(--color-fg-default)]">
            {item.ticker}
          </span>
          <VerdictBadge verdict={item.verdict} size="sm" />
        </div>
        <p className="text-xs text-[var(--color-fg-muted)] leading-snug">{why}</p>
      </div>
      <ChevronRight
        size={18}
        className="text-[var(--color-fg-subtle)] shrink-0 mt-1 rtl:rotate-180"
      />
    </button>
  );
}
