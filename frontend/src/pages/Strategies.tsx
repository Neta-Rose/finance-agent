import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStrategies } from "../api/strategies";
import { TopBar } from "../components/ui/TopBar";
import { StrategyModal } from "../components/portfolio/StrategyModal";
import { VerdictBadge, ConfidenceBadge } from "../components/ui/Badge";
import { Spinner } from "../components/ui/Spinner";
import { ErrorState } from "../components/ui/ErrorState";
import { EmptyState } from "../components/ui/EmptyState";
import { formatILS, timeAgo } from "../utils/format";
import type { Verdict, StrategyRow } from "../types/api";

const VERDICT_ORDER: Record<Verdict, number> = {
  SELL: 0,
  CLOSE: 0,
  REDUCE: 1,
  BUY: 2,
  ADD: 2,
  HOLD: 3,
};

const VERDICT_FILTER_OPTIONS = ["All", "BUY", "ADD", "HOLD", "REDUCE", "SELL", "CLOSE"] as const;

function sortStrategies(strategies: StrategyRow[]): StrategyRow[] {
  return [...strategies].sort((a, b) => {
    const orderA = VERDICT_ORDER[a.verdict] ?? 99;
    const orderB = VERDICT_ORDER[b.verdict] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.ticker.localeCompare(b.ticker);
  });
}

export function Strategies() {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<string>("All");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["strategies"],
    queryFn: fetchStrategies,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = sortStrategies(data.strategies);
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      list = list.filter((s) => s.ticker.includes(q));
    }
    if (verdictFilter !== "All") {
      list = list.filter((s) => s.verdict === verdictFilter);
    }
    return list;
  }, [data, search, verdictFilter]);

  const isEmpty = !data || data.strategies.length === 0;
  const noResults = !isEmpty && filtered.length === 0;

  return (
    <>
      <TopBar title="Strategies" subtitle={`${data?.strategies.length ?? 0} positions`} />

      {/* Filters */}
      <div className="px-4 pt-3 pb-2 space-y-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticker..."
          className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
        />
        <div className="flex gap-1.5 flex-wrap">
          {VERDICT_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setVerdictFilter(opt)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                verdictFilter === opt
                  ? "bg-[var(--color-accent-blue)] text-white"
                  : "bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)] border border-[var(--color-border)]"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-8">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" />
          </div>
        )}

        {error && <ErrorState message="Failed to load strategies" onRetry={refetch} />}

        {isEmpty && <EmptyState message="No strategies yet — run a full report" icon="🎯" />}

        {noResults && (
          <EmptyState message="No strategies match your filter" icon="🔍" />
        )}

        {/* Mobile card list */}
        {filtered.length > 0 && (
          <>
            <div className="md:hidden space-y-2 pt-2">
              {filtered.map((s) => (
                <div
                  key={s.ticker}
                  onClick={() => setSelectedTicker(s.ticker)}
                  className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg px-3 py-3 cursor-pointer active:opacity-80"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-sm text-[var(--color-fg-default)]">{s.ticker}</span>
                      <VerdictBadge verdict={s.verdict} size="sm" />
                      {s.hasExpiredCatalysts && <span className="text-[10px]">🔴</span>}
                    </div>
                    <div className="text-[10px] text-[var(--color-fg-subtle)] shrink-0">{timeAgo(s.updatedAt)}</div>
                  </div>
                  <div className="text-[10px] text-[var(--color-fg-muted)] mb-1.5">
                    {s.confidence} · {s.timeframe} · {formatILS(s.positionSizeILS)}
                  </div>
                  <p className="text-xs text-[var(--color-fg-muted)] line-clamp-2 leading-snug">
                    {s.reasoning}
                  </p>
                  {s.hasExpiredCatalysts && (
                    <p className="text-[10px] text-[var(--color-accent-red)] mt-1">🔴 Expired catalyst</p>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block mt-2 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    {["Ticker", "Verdict", "Confidence", "Timeframe", "Size ₪", "Weight %", "Reasoning", "Updated", "⚠️"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-[var(--color-fg-subtle)] uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr
                      key={s.ticker}
                      onClick={() => setSelectedTicker(s.ticker)}
                      className="cursor-pointer hover:bg-[var(--color-bg-muted)] border-b border-[var(--color-border-muted)] last:border-0"
                    >
                      <td className="px-3 py-2.5">
                        <span className="font-mono font-bold text-sm text-[var(--color-fg-default)]">{s.ticker}</span>
                      </td>
                      <td className="px-3 py-2.5"><VerdictBadge verdict={s.verdict} size="sm" /></td>
                      <td className="px-3 py-2.5"><ConfidenceBadge confidence={s.confidence} /></td>
                      <td className="px-3 py-2.5 text-sm text-[var(--color-fg-muted)] capitalize">{s.timeframe}</td>
                      <td className="px-3 py-2.5 text-sm text-[var(--color-fg-muted)] text-right">{formatILS(s.positionSizeILS)}</td>
                      <td className="px-3 py-2.5 text-sm text-[var(--color-fg-muted)] text-right">{s.positionWeightPct.toFixed(1)}%</td>
                      <td className="px-3 py-2.5 text-xs text-[var(--color-fg-muted)] max-w-[200px] truncate">{s.reasoning}</td>
                      <td className="px-3 py-2.5 text-[10px] text-[var(--color-fg-subtle)]">{timeAgo(s.updatedAt)}</td>
                      <td className="px-3 py-2.5 text-center">{s.hasExpiredCatalysts ? "🔴" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <StrategyModal
        ticker={selectedTicker}
        onClose={() => setSelectedTicker(null)}
      />
    </>
  );
}
