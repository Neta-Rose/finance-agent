import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPortfolio, fetchVerdicts } from "../api/portfolio";
import { TopBar } from "../components/ui/TopBar";
import { SummaryStrip } from "../components/portfolio/SummaryStrip";
import { PositionRow } from "../components/portfolio/PositionRow";
import { StrategyModal } from "../components/portfolio/StrategyModal";
import { Spinner } from "../components/ui/Spinner";
import { ErrorState } from "../components/ui/ErrorState";
import { EmptyState } from "../components/ui/EmptyState";
import { formatILS } from "../utils/format";
import type { VerdictRow } from "../types/api";

export function Portfolio() {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

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

  const verdictMap = useMemo(() => {
    const map: Record<string, VerdictRow> = {};
    verdictsData?.verdicts.forEach((v) => { map[v.ticker] = v; });
    return map;
  }, [verdictsData]);

  const { winners, losers } = useMemo(() => {
    if (!portfolio) return { winners: 0, losers: 0 };
    return {
      winners: portfolio.positions.filter((p) => p.plPct > 0).length,
      losers: portfolio.positions.filter((p) => p.plPct < 0).length,
    };
  }, [portfolio]);

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
        subtitle={formatILS(portfolio.totalILS)}
        onRefresh={refetch}
        refreshing={isFetching}
      />

      <SummaryStrip
        totalILS={portfolio.totalILS}
        totalPlILS={portfolio.totalPlILS}
        totalPlPct={portfolio.totalPlPct}
        positionCount={portfolio.positions.length}
        winners={winners}
        losers={losers}
        usdIlsRate={portfolio.usdIlsRate}
        updatedAt={portfolio.updatedAt}
      />

      {/* Mobile card list */}
      <div className="md:hidden px-4 pt-2 pb-4 space-y-2">
        {portfolio.positions.map((pos) => (
          <PositionRow
            key={pos.ticker}
            position={pos}
            verdict={verdictMap[pos.ticker]}
            onClick={() => setSelectedTicker(pos.ticker)}
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
                  onClick={() => setSelectedTicker(pos.ticker)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <StrategyModal
        ticker={selectedTicker}
        onClose={() => setSelectedTicker(null)}
      />
    </>
  );
}
