import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing, ChevronDown, ChevronUp, Newspaper, Radar, Search, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { TopBar } from "../components/ui/TopBar";
import { Spinner } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { usePreferencesStore } from "../store/preferencesStore";
import { t, getGreeting } from "../store/i18n";
import { apiClient } from "../api/client";
import { fetchOnboardStatus } from "../api/onboarding";
import type { FeedPageResponse, FeedItem } from "../types/api";

type FeedFilter =
  | "all"
  | "events"
  | "quick_check"
  | "daily_brief"
  | "deep_dive"
  | "new_ideas"
  | "full_report";

const FILTERS: Array<{ id: FeedFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "events", label: "News" },
  { id: "quick_check", label: "Quick" },
  { id: "daily_brief", label: "Daily" },
  { id: "deep_dive", label: "Deep" },
  { id: "new_ideas", label: "Ideas" },
  { id: "full_report", label: "Weekly" },
];

const toneClasses: Record<FeedItem["tone"], string> = {
  amber: "border-amber-300/25 bg-[linear-gradient(180deg,rgba(245,158,11,0.10),rgba(17,24,39,0.96))]",
  emerald: "border-emerald-300/25 bg-[linear-gradient(180deg,rgba(16,185,129,0.10),rgba(17,24,39,0.96))]",
  rose: "border-rose-300/25 bg-[linear-gradient(180deg,rgba(244,63,94,0.10),rgba(17,24,39,0.96))]",
  sky: "border-sky-300/25 bg-[linear-gradient(180deg,rgba(56,189,248,0.10),rgba(17,24,39,0.96))]",
  slate: "border-[var(--color-border)] bg-[linear-gradient(180deg,rgba(148,163,184,0.06),rgba(17,24,39,0.96))]",
};

function iconForItem(item: FeedItem) {
  if (item.kind === "market_news") return <Newspaper size={14} />;
  if (item.mode === "quick_check") return <Radar size={14} />;
  if (item.mode === "new_ideas") return <Sparkles size={14} />;
  return <BellRing size={14} />;
}

function modeLabel(item: FeedItem): string {
  if (item.kind === "market_news") return "Market News";
  if (item.mode === "full_report") return "Weekly report";
  return item.mode.replace(/_/g, " ");
}

export function Alerts() {
  const language = usePreferencesStore((s) => s.language);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: onboardStatus } = useQuery({
    queryKey: ["onboard-status"],
    queryFn: fetchOnboardStatus,
    staleTime: 60_000,
  });

  const feedPath = useMemo(() => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("mode", filter);
    if (deferredSearch) params.set("q", deferredSearch);
    const suffix = params.toString();
    return `/reports/feed/${page}${suffix ? `?${suffix}` : ""}`;
  }, [deferredSearch, filter, page]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["feed-page", page, filter, deferredSearch],
    queryFn: () => apiClient.get<FeedPageResponse>(feedPath).then((r) => r.data),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const items = data?.items ?? [];

  if (isLoading) {
    return (
      <>
        <TopBar title={t("alerts", language)} />
        <div className="flex h-48 items-center justify-center">
          <Spinner size="lg" />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <TopBar title={t("alerts", language)} />
        <ErrorState message={t("errorLoadAlerts", language)} onRetry={refetch} />
      </>
    );
  }

  return (
    <>
      <TopBar
        title={t("alerts", language)}
        subtitle={data?.totalItems ? `${data.totalItems}` : undefined}
        greeting={getGreeting(onboardStatus?.displayName, language)}
        onRefresh={() => void refetch()}
        refreshing={isFetching}
      />

      <div className="space-y-3 px-4 pb-8">
        <div className="sticky top-12 z-20 -mx-4 space-y-3 border-b border-[var(--color-border)] bg-[var(--color-bg-base)] px-4 py-3">
          <label className="flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2.5">
            <Search size={15} className="text-[var(--color-fg-subtle)]" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search ticker, mode, reasoning"
              className="w-full bg-transparent text-sm text-[var(--color-fg-default)] outline-none placeholder:text-[var(--color-fg-subtle)]"
            />
          </label>

          <div className="flex gap-2 overflow-x-auto">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                onClick={() => {
                  setFilter(option.id);
                  setPage(1);
                }}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  filter === option.id
                    ? "border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/15 text-[var(--color-fg-default)]"
                    : "border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {!data || items.length === 0 ? (
          <EmptyState message={t("emptyAlerts", language)} icon="📰" />
        ) : (
          items.map((item) => {
            const isExpanded = expanded[item.id] ?? false;
            return (
              <article key={item.id} className={`overflow-hidden rounded-3xl border shadow-sm ${toneClasses[item.tone]}`}>
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [item.id]: !isExpanded }))}
                  className="w-full px-4 py-4 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/10">
                          {iconForItem(item)}
                        </span>
                        <span>{modeLabel(item)}</span>
                      </div>
                      <h2 className="truncate text-sm font-semibold text-[var(--color-fg-default)]">{item.title}</h2>
                      <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.kind !== "market_news" && (
                        <div className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1 text-[10px] font-semibold text-[var(--color-fg-muted)]">
                          {item.tickerCount} ticker{item.tickerCount === 1 ? "" : "s"}
                        </div>
                      )}
                      {isExpanded ? <ChevronUp size={16} className="text-[var(--color-fg-muted)]" /> : <ChevronDown size={16} className="text-[var(--color-fg-muted)]" />}
                    </div>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-[var(--color-fg-muted)]">{item.summary}</p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.highlights.slice(0, 3).map((highlight) => (
                      <span
                        key={highlight}
                        className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1 text-[10px] font-medium text-[var(--color-fg-muted)]"
                      >
                        {highlight}
                      </span>
                    ))}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-white/10 px-4 py-4">
                    {item.kind === "market_news" ? (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-[var(--color-border)] bg-black/10 p-3">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">Ticker</p>
                          <p className="mt-2 text-sm font-semibold text-[var(--color-fg-default)]">{item.event?.ticker}</p>
                        </div>
                        <div className="rounded-2xl border border-[var(--color-border)] bg-black/10 p-3">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">Source</p>
                          <p className="mt-2 text-sm text-[var(--color-fg-default)]">{item.event?.source ?? "feed"}</p>
                        </div>
                        {item.event?.url ? (
                          <a
                            href={item.event.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg-default)]"
                          >
                            Open source
                          </a>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {item.dailyBrief ? (
                          <div className="rounded-2xl border border-[var(--color-border)] bg-black/10 p-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">Portfolio view</p>
                            <p className="mt-2 text-sm text-[var(--color-fg-default)]">{item.dailyBrief.headline ?? item.summary}</p>
                            {item.dailyBrief.today ? <p className="mt-2 text-xs leading-5 text-[var(--color-fg-muted)]">{item.dailyBrief.today}</p> : null}
                            {item.dailyBrief.tomorrow ? <p className="mt-2 text-xs leading-5 text-[var(--color-fg-muted)]">{item.dailyBrief.tomorrow}</p> : null}
                            {item.dailyBrief.marketView ? <p className="mt-2 text-xs leading-5 text-[var(--color-fg-muted)]">{item.dailyBrief.marketView}</p> : null}
                            {item.dailyBrief.securityNote ? <p className="mt-2 text-xs leading-5 text-[var(--color-fg-default)]">{item.dailyBrief.securityNote}</p> : null}
                            {item.dailyBrief.dashboardPath ? (
                              <Link
                                to={item.dailyBrief.dashboardPath}
                                className="mt-3 inline-flex rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg-default)]"
                              >
                                Open dashboard
                              </Link>
                            ) : null}
                          </div>
                        ) : null}
                        {item.tickers.map((ticker) => {
                          const entry = item.entries[ticker];
                          if (!entry) return null;
                          return (
                            <div key={ticker} className="rounded-2xl border border-[var(--color-border)] bg-black/10 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-mono text-sm font-semibold text-[var(--color-fg-default)]">{ticker}</p>
                                  <p className="mt-1 text-sm leading-6 text-[var(--color-fg-muted)]">{entry.reasoning}</p>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-right">
                                  <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">Verdict</p>
                                  <p className="mt-1 text-xs font-semibold text-[var(--color-fg-default)]">
                                    {entry.verdict} · {entry.confidence}
                                  </p>
                                </div>
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-[var(--color-fg-muted)]">
                                  {entry.timeframe}
                                </span>
                                {entry.analystTypes.map((analyst) => (
                                  <span
                                    key={`${ticker}-${analyst}`}
                                    className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-[var(--color-fg-muted)]"
                                  >
                                    {analyst}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}

        {(data?.totalPages ?? 1) > 1 && (
          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={(data?.page ?? 1) === 1}
              className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs font-medium text-[var(--color-fg-muted)] disabled:opacity-30"
            >
              Newer
            </button>
            <span className="text-xs text-[var(--color-fg-subtle)]">
              Page {data?.page ?? 1} / {data?.totalPages ?? 1}
            </span>
            <button
              onClick={() => setPage((current) => Math.min(data?.totalPages ?? 1, current + 1))}
              disabled={(data?.page ?? 1) === (data?.totalPages ?? 1)}
              className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs font-medium text-[var(--color-fg-muted)] disabled:opacity-30"
            >
              Older
            </button>
          </div>
        )}
      </div>
    </>
  );
}
