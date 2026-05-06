import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { fetchPortfolioRiskSnapshot } from "../../api/portfolioRisk";

/**
 * Portfolio risk card — Phase 7, task 7.10.
 *
 * Shows concentration metrics from the latest portfolio_risk_snapshots row.
 * Displayed on the Portfolio page.
 */

export function PortfolioRiskCard() {
  const { data: snapshot } = useQuery({
    queryKey: ["portfolio-risk"],
    queryFn: fetchPortfolioRiskSnapshot,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (!snapshot) return null;

  const top3 = snapshot.concentrationBySingleNamePct.slice(0, 3);
  const largest = snapshot.largestSinglePositionTicker;
  const largestPct = snapshot.largestSinglePositionPct;
  const isConcentrated = largestPct !== null && largestPct > 20;

  return (
    <div
      className="rounded-xl p-4 mb-4"
      style={{
        background: isConcentrated ? "rgba(239,68,68,0.08)" : "var(--color-bg-subtle)",
        border: `1px solid ${isConcentrated ? "rgba(239,68,68,0.25)" : "var(--color-border)"}`,
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <ShieldAlert
          size={16}
          style={{ color: isConcentrated ? "var(--color-accent-red)" : "var(--color-fg-muted)" }}
        />
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: isConcentrated ? "var(--color-accent-red)" : "var(--color-fg-muted)" }}
        >
          Concentration risk
        </span>
      </div>

      <div className="space-y-1.5">
        {top3.map((entry) => (
          <div key={entry.key} className="flex items-center gap-2">
            <span
              className="text-xs font-mono font-medium w-16 shrink-0"
              style={{ color: "var(--color-fg-default)" }}
            >
              {entry.key}
            </span>
            <div
              className="flex-1 h-1.5 rounded-full overflow-hidden"
              style={{ background: "var(--color-bg-muted)" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(entry.pct, 100)}%`,
                  background: entry.pct > 20
                    ? "var(--color-accent-red)"
                    : entry.pct > 15
                    ? "var(--color-accent-blue)"
                    : "var(--color-accent-green)",
                }}
              />
            </div>
            <span
              className="text-xs tabular-nums w-10 text-right shrink-0"
              style={{ color: entry.pct > 20 ? "var(--color-accent-red)" : "var(--color-fg-muted)" }}
            >
              {entry.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>

      {isConcentrated && largest && (
        <p className="text-xs mt-2" style={{ color: "var(--color-accent-red)" }}>
          {largest} is {largestPct?.toFixed(1)}% of portfolio — consider rebalancing.
        </p>
      )}
    </div>
  );
}
