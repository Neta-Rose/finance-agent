import { scoreBg, scoreBorder, scoreColor } from "../../utils/today/scoreColor";

interface HeroStatCardProps {
  value: string;
  pnlLine: string;
  pnlPositive: boolean | null;
  portfolioScore: number | null;
  /** Optional one-liner prose beneath the score bar (e.g., "Mostly on track…") */
  description?: string;
}

export function HeroStatCard({ value, pnlLine, pnlPositive, portfolioScore, description }: HeroStatCardProps) {
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
        padding: "16px 16px 14px",
        margin: "0 16px",
      }}
    >
      {/* Top row: score ←→ value */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        {/* Left: score number + "Portfolio score" label */}
        <div>
          <div
            style={{
              fontSize: 42,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-2px",
              color: scoreTextColor,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {hasScore ? (portfolioScore as number) : "—"}
          </div>
          <div
            style={{
              fontSize: 9,
              fontWeight: 400,
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginTop: 4,
            }}
          >
            Portfolio score
          </div>
        </div>

        {/* Right: ₪value + pnl */}
        <div style={{ textAlign: "end" }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
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
                fontSize: 10,
                fontWeight: 400,
                color: pnlColor,
                fontVariantNumeric: "tabular-nums",
                marginTop: 4,
              }}
            >
              {pnlLine}
            </div>
          )}
        </div>
      </div>

      {/* Score bar — 3px track */}
      <div style={{ marginTop: 14 }}>
        <div
          style={{
            position: "relative",
            height: 3,
            borderRadius: 2,
            background: "rgba(255,255,255,0.07)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              insetInlineStart: 0,
              top: 0,
              bottom: 0,
              width: hasScore ? `${Math.max(0, Math.min(100, portfolioScore as number))}%` : "0%",
              background: scoreTextColor,
              borderRadius: 2,
              transition: "width 260ms ease",
            }}
          />
        </div>

        {/* Anchor labels */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 5,
            fontSize: 9,
            fontWeight: 400,
            color: "rgba(255,255,255,0.2)",
            textTransform: "lowercase",
            letterSpacing: "0.02em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>0 poor</span>
          <span>50 stable</span>
          <span>100 excellent</span>
        </div>
      </div>

      {/* Description prose — optional one-liner summary */}
      {description && (
        <p
          style={{
            margin: "12px 0 0",
            fontSize: "var(--text-sm)",
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            fontWeight: 400,
          }}
        >
          {description}
        </p>
      )}
    </div>
  );
}

const SCORE_BAR_ANCHORS = [
  { at: 0, label: "exit" },
  { at: 50, label: "hold" },
  { at: 100, label: "strong buy" },
] as const;

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
          borderRadius: 3,
          background: "rgba(255,255,255,0.07)",
          overflow: "hidden",
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
            borderRadius: 3,
            transition: "width 220ms ease",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
          fontSize: 9,
          fontWeight: 400,
          color: "rgba(255,255,255,0.2)",
          textTransform: "lowercase",
          letterSpacing: "0.02em",
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
