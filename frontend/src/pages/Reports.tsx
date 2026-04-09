import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { TopBar } from "../components/ui/TopBar";
import { Spinner } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { usePreferencesStore } from "../store/preferencesStore";
import { t } from "../store/i18n";

function ReportTypeRow({
  type,
  batchId,
  ticker,
  content,
  onExpand,
}: {
  type: string;
  batchId: string;
  ticker: string;
  content: string | undefined;
  onExpand: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const key = `${batchId}:${ticker}:${type}`;
  return (
    <div className="bg-[var(--color-bg-base)] rounded-lg overflow-hidden">
      <button
        onClick={() => {
          if (!expanded) onExpand(key);
          setExpanded((v) => !v);
        }}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)] capitalize"
      >
        {type.replace(/_/g, " ")}
        <span className="text-[var(--color-fg-subtle)]">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          {!content ? (
            <div className="flex items-center gap-2 py-2">
              <Spinner size="sm" />
              <span className="text-[10px] text-[var(--color-fg-subtle)]">Loading...</span>
            </div>
          ) : (
            <pre className="text-[10px] text-[var(--color-fg-muted)] whitespace-pre-wrap break-all font-mono bg-[var(--color-bg-muted)] rounded p-2 max-h-48 overflow-y-auto">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function modeIcon(mode: string) {
  switch (mode) {
    case "deep_dive": return "🔬";
    case "daily_brief": return "📋";
    case "full_report": return "📊";
    case "new_ideas": return "💡";
    default: return "📄";
  }
}

function modeColor(mode: string) {
  switch (mode) {
    case "deep_dive": return "text-[var(--color-accent-blue)]";
    case "daily_brief": return "text-[var(--color-accent-green)]";
    case "full_report": return "text-[var(--color-accent-purple)]";
    case "new_ideas": return "text-[var(--color-accent-yellow)]";
    default: return "text-[var(--color-fg-muted)]";
  }
}

interface ReportTicker {
  ticker: string;
  verdict: string;
}

interface ReportBatch {
  batchId: string;
  date: string;
  mode: string;
  tickers: ReportTicker[];
}

interface ReportPageData {
  batches: ReportBatch[];
}

export function Reports() {
  const language = usePreferencesStore((s) => s.language);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [reportContent, setReportContent] = useState<Record<string, string>>({});

  const { data: meta } = useQuery({
    queryKey: ["reports-meta"],
    queryFn: () => apiClient.get("/reports/meta").then((r) => r.data),
    staleTime: 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["reports-page", currentPage],
    queryFn: () => apiClient.get<ReportPageData>(`/reports/page/${currentPage}`).then((r) => r.data),
    enabled: !!meta,
    staleTime: 60_000,
  });

  // Update total pages when meta loads
  if (meta && totalPages !== (meta.totalPages ?? 1)) {
    setTotalPages(meta.totalPages ?? 1);
  }

  const fetchReport = useCallback(async (batchId: string, ticker: string, type: string) => {
    const key = `${batchId}:${ticker}:${type}`;
    if (reportContent[key]) return;
    try {
      const res = await apiClient.get(`/reports/batch/${batchId}/${ticker}/${type}`);
      setReportContent((prev) => ({ ...prev, [key]: JSON.stringify(res.data, null, 2) }));
    } catch {
      setReportContent((prev) => ({ ...prev, [key]: t("reportLoadError", language) }));
    }
  }, [reportContent, language]);

  // Called by ReportTypeRow when expanded — key format: "batchId:ticker:type"
  const loadReport = useCallback((key: string) => {
    const parts = key.split(":");
    if (parts.length >= 3) {
      const [batchId, ticker, ...typeParts] = parts;
      fetchReport(batchId, ticker, typeParts.join(":"));
    }
  }, [fetchReport]);

  const toggleBatch = (batchId: string) => {
    setExpandedBatch((prev) => (prev === batchId ? null : batchId));
  };

  const toggleTicker = (batchId: string, ticker: string) => {
    const key = `${batchId}:${ticker}`;
    setExpandedTicker((prev) => (prev === key ? null : key));
    // Pre-fetch all reports when expanded
    if (expandedTicker !== key) {
      const types = ["fundamentals", "technical", "sentiment", "macro", "risk", "bull_case", "bear_case", "strategy"];
      types.forEach((t) => fetchReport(batchId, ticker, t));
    }
  };

  const totalBatches = meta?.totalBatches ?? 0;

  return (
    <>
      <TopBar title={t("reports", language)} subtitle={`${totalBatches}`} />

      <div className="px-4 pt-3 pb-8 space-y-3">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" />
          </div>
        )}

        {!isLoading && (!data || data.batches.length === 0) && (
          <EmptyState message={t("emptyReports", language)} icon="📄" />
        )}

        {data?.batches.map((batch) => {
          const isExpanded = expandedBatch === batch.batchId;
          return (
            <div key={batch.batchId} className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg overflow-hidden">
              {/* Batch header */}
              <div
                onClick={() => toggleBatch(batch.batchId)}
                className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer active:bg-[var(--color-bg-muted)]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{modeIcon(batch.mode)}</span>
                  <div>
                    <p className={`text-sm font-semibold capitalize ${modeColor(batch.mode)}`}>
                      {batch.mode.replace("_", " ")}
                    </p>
                    <p className="text-[10px] text-[var(--color-fg-subtle)]">
                      {new Date(batch.date).toLocaleString("en-US", {
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--color-fg-muted)]">{batch.tickers.length}</span>
                  <span className="text-[var(--color-fg-subtle)]">{isExpanded ? "▲" : "▼"}</span>
                </div>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-[var(--color-border)] px-4 py-3 space-y-3">
                  {/* Ticker tags */}
                  <div className="flex flex-wrap gap-2">
                    {batch.tickers.map(({ ticker }) => (
                      <button
                        key={ticker}
                        onClick={() => toggleTicker(batch.batchId, ticker)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold border transition-colors ${
                          expandedTicker === `${batch.batchId}:${ticker}`
                            ? "bg-[var(--color-accent-blue)]/20 border-[var(--color-accent-blue)]/40 text-[var(--color-accent-blue)]"
                            : "bg-[var(--color-bg-muted)] border-[var(--color-border)] text-[var(--color-fg-muted)]"
                        }`}
                      >
                        <span>{ticker}</span>
                        <span className="opacity-60">▾</span>
                      </button>
                    ))}
                  </div>

                  {/* Expanded ticker reports */}
                  {expandedTicker && expandedTicker.startsWith(batch.batchId) && (() => {
                    const ticker = expandedTicker.replace(`${batch.batchId}:`, "");
                    const types = ["fundamentals", "technical", "sentiment", "macro", "risk", "bull_case", "bear_case", "strategy"];
                    return (
                      <div className="space-y-2 pl-2 border-l-2 border-[var(--color-border)]">
                        {types.map((type) => (
                          <ReportTypeRow
                            key={type}
                            type={type}
                            batchId={batch.batchId}
                            ticker={ticker}
                            content={reportContent[`${batch.batchId}:${ticker}:${type}`]}
                            onExpand={loadReport}
                          />
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-xs font-medium text-[var(--color-fg-muted)] disabled:opacity-30"
            >
              {t("newerBtn", language)}
            </button>
            <span className="text-xs text-[var(--color-fg-subtle)]">
              {t("pageOf", language)} {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-xs font-medium text-[var(--color-fg-muted)] disabled:opacity-30"
            >
              {t("olderBtn", language)}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
