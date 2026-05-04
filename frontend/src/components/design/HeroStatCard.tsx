import { scoreBg, scoreBorder, scoreColor } from "../../utils/today/scoreColor";

interface HeroStatCardProps {
  /** Display value, e.g. "₪284,500" */
  value: string;
  /** All-time P/L line, e.g. "+12.4% all-time" — color follows pnlPositive */
  pnlLine: string;
  /** Whether all-time P/L is positive — drives pnlLine color (green/red) */
  pnlPositive: boolean | null;
  /** Portfolio health score — drives card tint and is the primary visual */
  portfolioScore: number | null;
}

/**
 * Hero card at top of Portfolio screen.
 *
 * Per spec section 3 + issue #2:
 *   - Score at 42px, semantic color — this is the primary visual.
 *     "Should I be worried today?" — score answers it.
 *   - Portfolio value at 18px, right-aligned — secondary context.
 *   - P/L line at 10px below value.
 *   - ScoreBar inline when score is available.
 *   - Card tint follows score.
 */
export function HeroStatCard({ value, pnlLine, pnlPositive, portfolioScore }: HeroStatCardProps) {
  const hasScore = portfolioScore !== null && Number.isFinite(portfolioScore);
  const tintScore = hasScore ? (portfolioScore as number) : 70;

  const bg = hasScore ? scoreBg(tintScore) : "var(--bg-surface)";
  const border = hasScore ? scoreBorder(tintScore) : "var(--bg-border-mid)";
  const scoreTextColor = hasScore ? scoreColor(tintScore) : "var(--text-tertiary)";

  const pnlColor =
    pnlPositive === true
      ? "var(--color-green)"
      : pnlPositive === false
      ? "var(--color-red)"
      : "var(--text-secondary)";

  return (
    <div
      style={{
        background: bg,
        border: `0.5px solid ${border}`,
        borderRadius: "var(--radius-lg)",
        padding: "16px 16px 12px",
        margin: "0 16px",
      }}
    >
      {/* Score (primary) + Value (secondary) */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span
            style={{
              fontSize: 42,
              fontWeight: "var(--weight-bold)",
              lineHeight: 1,
              letterSpacing: "-2px",
              color: scoreTextColor,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {hasScore ? (portfolioScore as number) : "—"}
          </span>
          {hasScore && (
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-tertiary)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              / 100
            </span>
          )}
        </div>

        <div style={{ textAlign: "end" }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: "var(--weight-bold)",
              color: "var(--text-primary)",
              letterSpacing: "-0.5px",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
            }}
          >
            {value}
          </div>
          {pnlLine && (
            <div
              style={{
                fontSize: "var(--text-xs)",
                fontWeight: "var(--weight-regular)",
                color: pnlColor,
                fontVariantNumeric: "tabular-nums",
                marginTop: 3,
              }}
            >
              {pnlLine}
            </div>
          )}
        </div>
      </div>

      {/* Score bar — visual position on 0–100 scale */}
      {hasScore && (
        <div style={{ marginTop: 12, margin: "12px -16px 0" }}>
          <ScoreBar score={portfolioScore as number} />
        </div>
      )}
    </div>
  );
}

/**
 * Score-anchor labels for the score bar on the position detail screen.
 * Exported here so position-detail can stay thin.
 */
export const SCORE_BAR_ANCHORS = [
  { at: 0, label: "exit" },
  { at: 50, label: "hold" },
  { at: 100, label: "strong buy" },
] as const;

/**
 * Linear score bar (0..100) with 3 anchored labels.
 * Render the cursor at `score` along the track, color from scoreColor().
 */
interface ScoreBarProps {
  score: number;
}
export function ScoreBar({ score }: ScoreBarProps) {
  const pct = Math.max(0, Math.min(100, score));
  const color = scoreColor(score);
  return (
    <div style={{ padding: "0 16px" }}>
      <div
        style={{
          position: "relative",
          height: 6,
          borderRadius: "var(--radius-pill)",
          background: "var(--bg-surface)",
          overflow: "visible",
        }}
      >
        <div
          style={{
            position: "absolute",
            insetInlineStart: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: color,
            borderRadius: "var(--radius-pill)",
            transition: "width 220ms ease",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            insetInlineStart: `calc(${pct}% - 6px)`,
            top: -3,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: color,
            border: "2px solid var(--bg-base)",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
          fontSize: "var(--text-2xs)",
          color: "var(--text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontVariantNumeric: "tabular-nums",
          fontWeight: "var(--weight-regular)",
        }}
      >
        {SCORE_BAR_ANCHORS.map((a) => (
          <span key={a.at}>
            {a.at} {a.label}
          </span>
        ))}
      </div>
    </div>
  );
}
