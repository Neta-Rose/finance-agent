import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPortfolio, fetchVerdicts } from "../api/portfolio";
import { fetchOnboardStatus } from "../api/onboarding";
import { fetchJobs } from "../api/jobs";
import { TopBar } from "../components/ui/TopBar";
import { SummaryStrip } from "../components/portfolio/SummaryStrip";
import { PositionRow } from "../components/portfolio/PositionRow";
import { PositionDetailModal } from "../components/portfolio/PositionDetailModal";
import { StrategyModal } from "../components/portfolio/StrategyModal";
import { Spinner } from "../components/ui/Spinner";
import { ErrorState } from "../components/ui/ErrorState";
import { EmptyState } from "../components/ui/EmptyState";
import { formatILS } from "../utils/format";
import type { VerdictRow, PositionRow as PositionRowType } from "../types/api";

export function Portfolio() {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<PositionRowType | null>(null);

  const { data: portfolio, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: verdictsData } = useQuery({
    queryKey: ["verdicts"],
    queryFn: fetchVerdicts,
    staleTime: 60_000,
  });

  const { data: onboardStatus } = useQuery({
    queryKey: ["onboard-status"],
    queryFn: fetchOnboardStatus,
    staleTime: 60_000,
  });

  const { data: jobsData } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    staleTime: 30_000,
    refetchInterval: 15_000,
  });

  const verdictMap = useMemo(() => {
    const map: Record<string, VerdictRow> = {};
    verdictsData?.verdicts.forEach((v) => { map[v.ticker] = v; });
    return map;
  }, [verdictsData]);

  // Tickers that need attention: action-needed verdict or expired catalyst
  const alertTickers = useMemo(() => {
    const set = new Set<string>();
    verdictsData?.verdicts.forEach((v) => {
      if (["SELL", "REDUCE", "CLOSE"].includes(v.verdict) || v.hasExpiredCatalysts) {
        set.add(v.ticker);
      }
    });
    return set;
  }, [verdictsData]);

  const { winners, losers } = useMemo(() => {
    if (!portfolio) return { winners: 0, losers: 0 };
    return {
      winners: portfolio.positions.filter((p) => p.plPct > 0).length,
      losers: portfolio.positions.filter((p) => p.plPct < 0).length,
    };
  }, [portfolio]);

  // Active jobs for running indicator
  const activeJobs = useMemo(() => {
    if (!jobsData?.jobs) return [];
    return jobsData.jobs.filter((j) => j.status === "pending" || j.status === "running");
  }, [jobsData]);

  const handlePositionClick = (pos: PositionRowType) => {
    setSelectedPosition(pos);
    setSelectedTicker(pos.ticker);
  };

  if (isLoading) {
    return (
      <>
        <TopBar title="Portfolio" />
        <div className="flex items-center justify-center h-48">
          <Spinner size="lg" />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <TopBar title="Portfolio" />
        <ErrorState message="Failed to load portfolio" onRetry={refetch} />
      </>
    );
  }

  if (!portfolio || portfolio.positions.length === 0) {
    return (
      <>
        <TopBar title="Portfolio" />
        <EmptyState message="No positions found" icon="📭" />
      </>
    );
  }

  return (
    <>
      <TopBar
        title="Portfolio"
        subtitle={formatILS(portfolio.totalILS ?? null)}
        greeting={onboardStatus?.displayName ? `Hello ${onboardStatus.displayName} — Let's monitor some positions 📈` : undefined}
        onRefresh={refetch}
        refreshing={isFetching}
      />

      {/* Active Jobs Banner */}
      {activeJobs.length > 0 && (
        <div className="mx-4 mt-3 mb-1">
          <div className="flex items-center gap-2 text-xs text-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/10 border border-[var(--color-accent-blue)]/30 rounded-lg px-3 py-2">
            <span className="animate-spin">🔄</span>
            <span className="font-medium">
              {activeJobs.length} job{activeJobs.length !== 1 ? "s" : ""} running
            </span>
            <div className="flex-1" />
            <div className="h-1.5 w-24 bg-[var(--color-bg-muted)] rounded-full overflow-hidden">
              <div className="h-full bg-[var(--color-accent-blue)] animate-pulse rounded-full" style={{ width: "60%" }} />
            </div>
          </div>
        </div>
      )}

      <SummaryStrip
        totalILS={portfolio.totalILS ?? 0}
        totalPlILS={portfolio.totalPlILS ?? 0}
        totalPlPct={portfolio.totalPlPct ?? 0}
        positionCount={portfolio.positions.length}
        winners={winners}
        losers={losers}
        usdIlsRate={portfolio.usdIlsRate ?? 0}
        updatedAt={portfolio.updatedAt}
      />

      {/* Add Position Button */}
      <div className="px-4 pt-3">
        <button
          onClick={() => {/* TODO: Navigate to add position */}}
          className="w-full py-2.5 rounded-lg border border-dashed border-[var(--color-border)] text-xs text-[var(--color-accent-blue)] font-medium hover:bg-[var(--color-bg-muted)] transition-colors"
        >
          + Add Position
        </button>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden px-4 pt-2 pb-4 space-y-2">
        {portfolio.positions.map((pos) => (
          <PositionRow
            key={pos.ticker}
            position={pos}
            verdict={verdictMap[pos.ticker]}
            hasAlert={alertTickers.has(pos.ticker)}
            onClick={() => handlePositionClick(pos)}
          />
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block px-4 pb-4">
        <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {["Ticker", "Shares", "Avg ₪", "Live ₪", "Value ₪", "P/L %", "P/L ₪", "Weight", "Verdict"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-[var(--color-fg-subtle)] uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {portfolio.positions.map((pos) => (
                <PositionRow
                  key={pos.ticker}
                  position={pos}
                  verdict={verdictMap[pos.ticker]}
                  onClick={() => handlePositionClick(pos)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PositionDetailModal
        position={selectedPosition}
        onClose={() => {
          setSelectedPosition(null);
          setSelectedTicker(null);
          refetch();
        }}
      />

      <StrategyModal
        ticker={selectedTicker}
        onClose={() => setSelectedTicker(null)}
      />
    </>
  );
}
