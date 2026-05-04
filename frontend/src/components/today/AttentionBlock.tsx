import { AlertCircle } from "lucide-react";
import { AttentionCard } from "./AttentionCard";
import { t, tInterpolate } from "../../store/i18n";
import { usePreferencesStore } from "../../store/preferencesStore";
import type { AttentionItem } from "../../types/api";

interface AttentionBlockProps {
  items: AttentionItem[];
  clearCount: number;
  onCardClick: (ticker: string) => void;
}

/**
 * Attention-state block — heading + stack of AttentionCards.
 * Renders only when there's at least one item; the parent is responsible for the gate.
 */
export function AttentionBlock({ items, clearCount, onCardClick }: AttentionBlockProps) {
  const language = usePreferencesStore((s) => s.language);
  const header = tInterpolate(t("attentionHeader", language), { count: items.length });
  const clearSuffix = tInterpolate(t("attentionClearSuffix", language), { count: clearCount });

  return (
    <div className="mt-3">
      <div className="mx-4 mb-2 flex items-center gap-2">
        <AlertCircle size={14} className="text-[var(--color-accent-red)] shrink-0" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-default)]">
          {header}
        </p>
        <span className="text-[11px] text-[var(--color-fg-subtle)]">· {clearSuffix}</span>
      </div>
      <div>
        {items.map((item) => (
          <AttentionCard key={item.ticker} item={item} onClick={onCardClick} />
        ))}
      </div>
    </div>
  );
}
