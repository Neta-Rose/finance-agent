import { scoreBg, scoreColor } from "../../utils/today/scoreColor";
import { tInterpolate, t } from "../../store/i18n";
import { usePreferencesStore } from "../../store/preferencesStore";

interface ScoreChipProps {
  score: number;
}

/**
 * Square score badge — 26x26 px.
 * Color is always derived from score via the central scoreColor() helper.
 * Used everywhere a ticker is listed (holdings rows, attention cards, detail screens).
 *
 * Per spec: this component has only one prop. No size/variant/anything else.
 */
export function ScoreChip({ score }: ScoreChipProps) {
  const language = usePreferencesStore((s) => s.language);
  const aria = tInterpolate(t("scoreChipAria", language), { score });
  return (
    <span
      role="img"
      aria-label={aria}
      title={aria}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-bold)",
        fontVariantNumeric: "tabular-nums",
        background: scoreBg(score),
        color: scoreColor(score),
        flexShrink: 0,
      }}
    >
      {score}
    </span>
  );
}
