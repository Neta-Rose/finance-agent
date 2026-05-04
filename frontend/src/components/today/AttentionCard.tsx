import { ChevronRight } from "lucide-react";
import { ScoreChip } from "../design/ScoreChip";
import { ActionBadge } from "../design/ActionBadge";
import { whyToday } from "../../utils/today/whyToday";
import { usePreferencesStore } from "../../store/preferencesStore";
import type { AttentionItem } from "../../types/api";

interface AttentionCardProps {
  item: AttentionItem;
  score?: number;
  onClick: (ticker: string) => void;
}

type Severity = "amber" | "red";

const REASON_TO_SEVERITY: Record<AttentionItem["reason"], Severity> = {
  catalyst_expired: "red",
  verdict_close: "red",
  verdict_sell: "red",
  verdict_reduce: "amber",
};

const SEVERITY_STYLES: Record<Severity, { bg: string; border: string; accent: string }> = {
  amber: {
    bg: "var(--color-amber-bg)",
    border: "var(--color-amber-border)",
    accent: "var(--color-amber)",
  },
  red: {
    bg: "var(--color-red-bg)",
    border: "var(--color-red-border)",
    accent: "var(--color-red)",
  },
};

/**
 * One ticker that needs attention today.
 *
 * Per spec section 3:
 *   - Severity-tinted background (amber or red based on reason)
 *   - 0.5px border in severity color
 *   - 2px left-edge accent border (preattentive signal)
 *   - ScoreChip left — score-in-color is the at-a-glance reading
 *   - Tap → opens StrategyModal
 */
export function AttentionCard({ item, score, onClick }: AttentionCardProps) {
  const language = usePreferencesStore((s) => s.language);
  const why = whyToday(item, language);
  const severity = REASON_TO_SEVERITY[item.reason];
  const styles = SEVERITY_STYLES[severity];

  return (
    <button
      type="button"
      onClick={() => onClick(item.ticker)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        width: "calc(100% - 32px)",
        margin: "0 16px",
        padding: "12px 14px",
        background: styles.bg,
        border: `0.5px solid ${styles.border}`,
        borderInlineStartWidth: 2,
        borderInlineStartColor: styles.accent,
        borderRadius: "var(--radius-md)",
        textAlign: "start",
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
            background: styles.bg,
            border: `0.5px solid ${styles.border}`,
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "var(--text-xs)",
            color: styles.accent,
          }}
        >
          —
        </span>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              fontWeight: "var(--weight-bold)",
              fontSize: "var(--text-md)",
              color: "var(--text-primary)",
            }}
          >
            {item.ticker}
          </span>
          <ActionBadge verdict={item.verdict} score={score} />
        </div>
        <p
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
            lineHeight: 1.4,
            fontWeight: "var(--weight-regular)",
          }}
        >
          {why}
        </p>
      </div>

      <ChevronRight
        size={16}
        style={{ color: "var(--text-tertiary)", flexShrink: 0, marginTop: 2 }}
      />
    </button>
  );
}
