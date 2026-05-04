import { Activity } from "lucide-react";
import { t, tInterpolate, type TranslationKey } from "../../store/i18n";
import { usePreferencesStore } from "../../store/preferencesStore";
import { timeAgo } from "../../utils/format";
import type { HealthLabel } from "../../types/api";

interface HealthHeroProps {
  score: number; // 0..100
  label: HealthLabel;
  clearCount: number;
  totalCount: number;
  lastReviewedAt: string | null;
}

const LABEL_KEY: Record<HealthLabel, TranslationKey> = {
  healthy: "healthLabelHealthy",
  steady: "healthLabelSteady",
  watch: "healthLabelWatch",
};

const LABEL_COLOR: Record<HealthLabel, string> = {
  healthy: "var(--color-accent-green)",
  steady: "var(--color-accent-blue)",
  watch: "var(--color-accent-yellow)",
};

/**
 * Clear-state hero — no attention items, calm-but-substantive headline:
 * portfolio score (0-100) + label (Healthy/Steady/Watch) + summary line.
 *
 * The score is mathematically grounded (5-component deterministic sum),
 * giving "all clear" a defensible "science behind it" rather than feeling hollow.
 */
export function HealthHero({
  score,
  label,
  clearCount,
  totalCount,
  lastReviewedAt,
}: HealthHeroProps) {
  const language = usePreferencesStore((s) => s.language);
  const color = LABEL_COLOR[label];
  const labelText = t(LABEL_KEY[label], language);

  const summary = tInterpolate(t("healthHeroSummary", language), {
    clear: clearCount,
    total: totalCount,
    timeAgo: lastReviewedAt ? timeAgo(lastReviewedAt) : "—",
  });

  return (
    <div
      className="mx-4 mt-3 mb-1 px-4 py-4 rounded-xl border"
      style={{
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        background: `linear-gradient(135deg, color-mix(in srgb, ${color} 10%, transparent), transparent 60%)`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity size={16} style={{ color }} />
          <span
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color }}
          >
            {labelText}
          </span>
        </div>
        <div className="text-right tabular-nums">
          <span className="text-2xl font-bold" style={{ color }}>
            {score}
          </span>
          <span className="text-xs text-[var(--color-fg-muted)] ml-1">/ 100</span>
        </div>
      </div>
      <p className="text-xs text-[var(--color-fg-muted)]">{summary}</p>
    </div>
  );
}
