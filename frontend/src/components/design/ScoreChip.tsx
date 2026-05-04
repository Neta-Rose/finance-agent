import { scoreBg, scoreColor } from "../../utils/today/scoreColor";
import { tInterpolate, t } from "../../store/i18n";
import { usePreferencesStore } from "../../store/preferencesStore";

interface ScoreChipProps {
  score: number;
}

/**
 * 26×26 rounded-square score badge.
 *
 * Shape: border-radius 7px (hardcoded — must never be circular).
 * Color: background and foreground always from the central scoreColor/scoreBg functions.
 * Content: score number, 10px bold, centered.
 *
 * One prop. No size variant. No color override. Used everywhere a score is listed.
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
        borderRadius: 7,
        fontSize: 10,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1,
        background: scoreBg(score),
        color: scoreColor(score),
        flexShrink: 0,
      }}
    >
      {score}
    </span>
  );
}
