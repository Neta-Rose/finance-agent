import { scoreBg, scoreBorder, scoreColor } from "../../utils/today/scoreColor";

interface HeroStatCardProps {
  /** Display value, e.g. "₪284,500" */
  value: string;
  /** All-time P/L line, e.g. "+12.4% all-time" — color follows portfolioScore */
  pnlLine: string;
  /** Whether all-time P/L is positive — drives pnlLine color (green/red) */
  pnlPositive: boolean | null;
  /** Portfolio health score — drives card tint (background + border) */
  portfolioScore: number | null;
}

/**
 * Hero card at top of Portfolio screen — total value + all-time P/L.
 *
 * Per spec section 3 + section 4:
 *   - Background tint follows portfolio score (green/amber/red)
 *   - Score chip is implicit (no number rendered) — the tint IS the signal
 *   - 26px bold value, 10px P/L line
 *
 * When portfolioScore is null (e.g. during bootstrap with no strategies yet),
 * card falls back to neutral surface bg.
 */
export function HeroStatCard({ value, pnlLine, pnlPositive, portfolioScore }: HeroStatCardProps) {
  const hasScore = portfolioScore !== null && Number.isFinite(portfolioScore);
  const tintScore = hasScore ? (portfolioScore as number) : 70; // neutral fallback

  const bg = hasScore ? scoreBg(tintScore) : "var(--bg-surface)";
  const border = hasScore ? scoreBorder(tintScore) : "var(--bg-border-mid)";

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
        padding: "14px 16px",
        margin: "0 16px",
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div
        style={{
          fontSize: "var(--text-xl)",
          fontWeight: "var(--weight-bold)",
          color: "var(--text-primary)",
          letterSpacing: "-0.5px",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {pnlLine && (
        <div
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: 500,
            color: pnlColor,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {pnlLine}
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
