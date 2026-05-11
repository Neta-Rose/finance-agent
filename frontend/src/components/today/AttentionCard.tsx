import { ActionBadge } from "../design/ActionBadge";
import { scoreColor } from "../../utils/today/scoreColor";
import { whyToday } from "../../utils/today/whyToday";
import { scoreBucketEmoji, scoreBucketLabel } from "../../utils/advisory";
import { timeAgo } from "../../utils/format";
import { usePreferencesStore } from "../../store/preferencesStore";
import type { AttentionItem } from "../../types/api";

interface AttentionCardProps {
  item: AttentionItem;
  score?: number;
  weightPct?: number;
  /** ISO string — shown as "Xd ago" in right column below weight */
  updatedAt?: string | null;
  onClick: (ticker: string) => void;
}

type Severity = "amber" | "red";

const REASON_TO_SEVERITY: Record<AttentionItem["reason"], Severity> = {
  catalyst_expired: "red",
  verdict_close: "red",
  verdict_sell: "red",
  verdict_reduce: "amber",
};

const SEVERITY_STYLES: Record<Severity, { tint: string; border: string; accent: string }> = {
  amber: {
    tint: "var(--color-amber-tint)",
    border: "var(--color-amber-border)",
    accent: "var(--color-amber)",
  },
  red: {
    tint: "var(--color-red-tint)",
    border: "var(--color-red-border)",
    accent: "var(--color-red)",
  },
};

export function AttentionCard({ item, score, weightPct, updatedAt, onClick }: AttentionCardProps) {
  const language = usePreferencesStore((s) => s.language);
  const why = whyToday(item, language);
  const severity = REASON_TO_SEVERITY[item.reason];
  const styles = SEVERITY_STYLES[severity];
  const scoreTextColor = score !== undefined ? scoreColor(score) : styles.accent;

  return (
    <button
      type="button"
      onClick={() => onClick(item.ticker)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        width: "calc(100% - 32px)",
        margin: "0 16px",
        padding: "11px 13px",
        background: styles.tint,
        border: `0.5px solid ${styles.border}`,
        borderInlineStartWidth: 2,
        borderInlineStartColor: styles.accent,
        borderRadius: 12,
        textAlign: "start",
        cursor: "pointer",
      }}
    >
      {/* Left: ticker → reason → score number */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontWeight: 700,
            fontSize: 14,
            color: "var(--text-primary)",
            lineHeight: 1.2,
          }}
        >
          {item.ticker}
        </span>
        <span
          style={{
            display: "block",
            fontSize: 10,
            fontWeight: 400,
            color: "var(--text-tertiary)",
            lineHeight: 1.4,
            marginTop: 3,
          }}
        >
          {why}
        </span>
        {score !== undefined && (
          <span
            style={{
              display: "block",
              fontSize: 20,
              fontWeight: 700,
              color: scoreTextColor,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              marginTop: 6,
            }}
          >
            {score}
          </span>
        )}
        {score !== undefined && (
          <span
            style={{
              display: "block",
              fontSize: 10,
              fontWeight: 500,
              color: scoreTextColor,
              lineHeight: 1.2,
              marginTop: 3,
            }}
          >
            {scoreBucketEmoji(score)} {scoreBucketLabel(score)}
          </span>
        )}
      </div>

      {/* Right: badge → weight → time-ago (vertical stack) */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 5,
          flexShrink: 0,
        }}
      >
        <ActionBadge verdict={item.verdict} score={score} />
        {weightPct !== undefined && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 400,
              color: "var(--text-tertiary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {weightPct.toFixed(1)}% weight
          </span>
        )}
        {updatedAt && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 400,
              color: "var(--text-tertiary)",
            }}
          >
            {timeAgo(updatedAt)}
          </span>
        )}
      </div>
    </button>
  );
}
