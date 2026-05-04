import { scoreBg, scoreBorder, scoreColor } from "../../utils/today/scoreColor";
import type { Verdict } from "../../types/api";

interface ActionBadgeProps {
  /** Backend verdict — mapped to display vocabulary internally */
  verdict: Verdict;
  /** Position health score, used when displayAction === "HOLD" to drive color */
  score?: number;
}

/**
 * Pill-shape action badge — HOLD / REDUCE / BUY / EXIT.
 *
 * Backend produces 6 verdicts (BUY/ADD/HOLD/REDUCE/SELL/CLOSE).
 * Display vocabulary is 4: BUY/HOLD/REDUCE/EXIT — mapping happens here only.
 *
 * Color rules per spec section 3:
 *   HOLD   → derive from position score (green/amber/red)
 *   REDUCE → always amber
 *   BUY    → always green
 *   EXIT   → always red
 */

type DisplayAction = "BUY" | "HOLD" | "REDUCE" | "EXIT";

const VERDICT_TO_DISPLAY: Record<Verdict, DisplayAction> = {
  BUY: "BUY",
  ADD: "BUY",
  HOLD: "HOLD",
  REDUCE: "REDUCE",
  SELL: "EXIT",
  CLOSE: "EXIT",
};

// Conceptual numeric scores used when the action's color is fixed:
// BUY → 80 (green), REDUCE → 50 (amber), EXIT → 30 (red).
const FIXED_COLOR_SCORE: Partial<Record<DisplayAction, number>> = {
  BUY: 80,
  REDUCE: 50,
  EXIT: 30,
};

export function ActionBadge({ verdict, score }: ActionBadgeProps) {
  const display = VERDICT_TO_DISPLAY[verdict];
  const colorScore = FIXED_COLOR_SCORE[display] ?? score ?? 70;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: "var(--radius-pill)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-bold)",
        letterSpacing: "0.05em",
        background: scoreBg(colorScore),
        border: `0.5px solid ${scoreBorder(colorScore)}`,
        color: scoreColor(colorScore),
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {display}
    </span>
  );
}
