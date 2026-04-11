import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { createChart, ColorType, CandlestickSeries, LineSeries } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { CandlestickData, LineData } from "lightweight-charts";
import { fetchPositionHistory } from "../../api/portfolio";
import { updatePosition } from "../../api/portfolio";
import { useToastStore } from "../../store/toastStore";
import { usePreferencesStore } from "../../store/preferencesStore";
import { t } from "../../store/i18n";
import { formatILS, formatPct } from "../../utils/format";
import type { PositionRow, VerdictRow } from "../../types/api";
import { Spinner } from "../ui/Spinner";
import { VerdictBadge } from "../ui/Badge";

interface PositionDetailModalProps {
  position: PositionRow | null;
  verdict?: VerdictRow;
  onClose: () => void;
  onDeletePosition?: (position: PositionRow) => Promise<void>;
}

type Timeframe = "1D" | "1W" | "1M" | "3M" | "1Y";

export function PositionDetailModal({ position, verdict, onClose, onDeletePosition }: PositionDetailModalProps) {
  const language = usePreferencesStore((s) => s.language);
  const [timeframe, setTimeframe] = useState<Timeframe>("1M");
  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState<CandlestickData[] | LineData[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editShares, setEditShares] = useState("");
  const [editAvgPrice, setEditAvgPrice] = useState("");
  const [accountEdits, setAccountEdits] = useState<Record<string, { shares: string; avgPriceILS: string }>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const showToast = useToastStore((s) => s.show);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!position) return;
    setEditShares(String(position.shares));
    setEditAvgPrice(String(position.avgPriceILS));
    setAccountEdits(
      Object.fromEntries(
        (position.accountBreakdown ?? []).map((entry) => [
          entry.account,
          { shares: String(entry.shares), avgPriceILS: String(entry.avgPriceILS) },
        ])
      )
    );
  }, [position]);

  // Fetch price history when timeframe changes
  useEffect(() => {
    if (!position) return;
    setLoading(true);
    fetchPositionHistory(position.ticker, timeframe)
      .then((data) => {
        setChartData(data);
        setLoading(false);
      })
      .catch(() => {
        setChartData([]);
        setLoading(false);
      });
  }, [position, timeframe]);

  // Create/update chart
  useEffect(() => {
    if (!chartContainerRef.current || !position) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b949e",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "#21262d" },
        horzLines: { color: "#21262d" },
      },
      rightPriceScale: {
        borderColor: "#30363d",
      },
      timeScale: {
        borderColor: "#30363d",
        timeVisible: true,
      },
      crosshair: {
        mode: 0,
        vertLine: { color: "#6e7681", width: 1, style: 2 },
        horzLine: { color: "#6e7681", width: 1, style: 2 },
      },
      handleScale: false,
      handleScroll: false,
    });

    chartRef.current = chart;

    // Determine if we have ohlc data (candlestick) or just close prices (line)
    const hasOhlc = chartData.length > 0 && "open" in chartData[0];

    if (hasOhlc) {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#3fb950",
        downColor: "#f85149",
        borderUpColor: "#3fb950",
        borderDownColor: "#f85149",
        wickUpColor: "#3fb950",
        wickDownColor: "#f85149",
      });
      series.setData(chartData as CandlestickData[]);
      seriesRef.current = series as unknown as ISeriesApi<"Candlestick">;
    } else {
      const series = chart.addSeries(LineSeries, {
        color: "#58a6ff",
        lineWidth: 2,
      });
      series.setData(chartData as LineData[]);
      seriesRef.current = series as unknown as ISeriesApi<"Line">;
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: 180,
        });
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [position, chartData]);

  const handleSaveEdit = async () => {
    if (!position) return;
    setSaving(true);
    try {
      if ((position.accountBreakdown?.length ?? 0) > 1) {
        await Promise.all(
          position.accountBreakdown.map((entry) =>
            updatePosition(position.ticker, {
              account: entry.account,
              shares: Number(accountEdits[entry.account]?.shares ?? entry.shares),
              avgPriceILS: Number(accountEdits[entry.account]?.avgPriceILS ?? entry.avgPriceILS),
            })
          )
        );
      } else {
        await updatePosition(position.ticker, {
          account: position.accounts?.[0],
          shares: Number(editShares),
          avgPriceILS: Number(editAvgPrice),
        });
      }
      showToast(t("saveChanges", language) + " ✓", "success");
      setEditMode(false);
    } catch {
      showToast(t("errorLoadPortfolio", language), "error");
    } finally {
      setSaving(false);
    }
  };

  if (!position) return null;

  const plClass = position.plPct >= 0 ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]";
  const hasMultipleAccounts = (position.accountBreakdown?.length ?? 0) > 1;
  const canDeleteSinglePosition = !!onDeletePosition && !hasMultipleAccounts && (position.accounts?.length ?? 0) === 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full bg-[var(--color-bg-subtle)] md:rounded-xl md:max-w-xl md:max-h-[90vh] flex flex-col overflow-hidden"
        style={{ maxHeight: "92vh" }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[var(--color-bg-subtle)] border-b border-[var(--color-border)] px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-1 -ml-1 text-[var(--color-fg-muted)] hover:text-[var(--color-fg-default)]">
              <X size={18} />
            </button>
            <span className="font-mono font-bold text-lg text-[var(--color-fg-default)]">{position.ticker}</span>
            <span className="text-[10px] text-[var(--color-fg-subtle)] bg-[var(--color-bg-muted)] px-1.5 py-0.5 rounded">
              {position.exchange}
            </span>
          </div>
          <button
            onClick={() => setEditMode(!editMode)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              editMode
                ? "bg-[var(--color-accent-blue)] text-white"
                : "bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)] border border-[var(--color-border)]"
            }`}
          >
            {editMode ? t("cancel", language) : t("edit", language)}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-8 space-y-4">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[var(--color-bg-muted)] rounded-lg p-3">
              <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("shares", language)}</p>
              {editMode && !hasMultipleAccounts ? (
                <input
                  type="number"
                  value={editShares}
                  onChange={(e) => setEditShares(e.target.value)}
                  className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
                  min="1"
                />
              ) : (
                <p className="text-sm font-bold text-[var(--color-fg-default)]">{position.shares.toLocaleString()}</p>
              )}
            </div>
            <div className="bg-[var(--color-bg-muted)] rounded-lg p-3">
              <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("avgBuyPrice", language)}</p>
              {editMode && !hasMultipleAccounts ? (
                <input
                  type="number"
                  value={editAvgPrice}
                  onChange={(e) => setEditAvgPrice(e.target.value)}
                  className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
                  min="0.01"
                  step="0.01"
                />
              ) : (
                <p className="text-sm font-bold text-[var(--color-fg-default)]">{formatILS(position.avgPriceILS)}</p>
              )}
            </div>
            <div className="bg-[var(--color-bg-muted)] rounded-lg p-3">
              <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("livePrice", language)}</p>
              <p className="text-sm font-bold text-[var(--color-fg-default)]">{formatILS(position.livePriceILS)}</p>
            </div>
            <div className="bg-[var(--color-bg-muted)] rounded-lg p-3">
              <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("currentValue", language)}</p>
              <p className="text-sm font-bold text-[var(--color-fg-default)]">{formatILS(position.currentILS)}</p>
            </div>
            <div className="bg-[var(--color-bg-muted)] rounded-lg p-3">
              <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("costBasis", language)}</p>
              <p className="text-sm font-bold text-[var(--color-fg-default)]">{formatILS(position.costILS)}</p>
            </div>
            <div className="bg-[var(--color-bg-muted)] rounded-lg p-3">
              <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("colPl", language)}</p>
              <p className={`text-sm font-bold ${plClass}`}>
                {position.plPct >= 0 ? "+" : ""}{formatILS(position.plILS)} ({formatPct(position.plPct)})
              </p>
            </div>
            <div className="bg-[var(--color-bg-muted)] rounded-lg p-3 col-span-2">
              <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("weight", language)}</p>
              <p className="text-sm font-bold text-[var(--color-fg-default)]">{position.weightPct.toFixed(2)}%</p>
            </div>
          </div>

          {hasMultipleAccounts && (
            <div className="bg-[var(--color-bg-muted)] rounded-lg p-3 space-y-3">
              <div>
                <p className="text-xs font-semibold text-[var(--color-fg-default)]">Account Breakdown</p>
                <p className="text-[11px] text-[var(--color-fg-subtle)]">
                  {editMode
                    ? "This ticker exists in multiple accounts. Edit each account separately."
                    : "This row is aggregated from multiple accounts."}
                </p>
              </div>
              {position.accountBreakdown.map((entry) => (
                <div key={entry.account} className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">Account</p>
                    <p className="text-sm font-semibold text-[var(--color-fg-default)]">{entry.account}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("shares", language)}</p>
                    {editMode ? (
                      <input
                        type="number"
                        value={accountEdits[entry.account]?.shares ?? String(entry.shares)}
                        onChange={(e) =>
                          setAccountEdits((current) => ({
                            ...current,
                            [entry.account]: {
                              shares: e.target.value,
                              avgPriceILS: current[entry.account]?.avgPriceILS ?? String(entry.avgPriceILS),
                            },
                          }))
                        }
                        className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
                        min="0"
                      />
                    ) : (
                      <p className="text-sm font-bold text-[var(--color-fg-default)]">{entry.shares.toLocaleString()}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("avgBuyPrice", language)}</p>
                    {editMode ? (
                      <input
                        type="number"
                        value={accountEdits[entry.account]?.avgPriceILS ?? String(entry.avgPriceILS)}
                        onChange={(e) =>
                          setAccountEdits((current) => ({
                            ...current,
                            [entry.account]: {
                              shares: current[entry.account]?.shares ?? String(entry.shares),
                              avgPriceILS: e.target.value,
                            },
                          }))
                        }
                        className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
                        min="0.01"
                        step="0.01"
                      />
                    ) : (
                      <p className="text-sm font-bold text-[var(--color-fg-default)]">{formatILS(entry.avgPriceILS)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Edit Save Button */}
          {editMode && (
            <div className="space-y-2">
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="w-full py-3 rounded-lg bg-[var(--color-accent-blue)] text-white text-sm font-semibold disabled:opacity-50"
              >
                {saving ? t("saving", language) : t("saveChanges", language)}
              </button>
              {canDeleteSinglePosition && (
                <button
                  onClick={async () => {
                    if (!onDeletePosition || !position) return;
                    setDeleting(true);
                    try {
                      await onDeletePosition(position);
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  disabled={deleting}
                  className="w-full py-3 rounded-lg border border-[var(--color-accent-red)]/40 text-[var(--color-accent-red)] text-sm font-semibold disabled:opacity-50"
                >
                  {deleting ? "Removing..." : "Remove Position"}
                </button>
              )}
            </div>
          )}

          {/* Price Chart */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-[var(--color-fg-muted)]">{t("priceHistory", language)}</p>
              <div className="flex gap-1">
                {(["1D", "1W", "1M", "3M", "1Y"] as Timeframe[]).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      timeframe === tf
                        ? "bg-[var(--color-accent-blue)] text-white"
                        : "bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)]"
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-[var(--color-bg-muted)] rounded-lg p-2">
              {loading ? (
                <div className="h-[180px] flex items-center justify-center">
                  <Spinner size="md" />
                </div>
              ) : chartData.length === 0 ? (
                <div className="h-[180px] flex items-center justify-center text-xs text-[var(--color-fg-subtle)]">
                  {t("noChartData", language)}
                </div>
              ) : (
                <div ref={chartContainerRef} className="w-full" style={{ height: 180 }} />
              )}
            </div>
          </div>

          {/* Accounts */}
          {position.accounts && position.accounts.length > 0 && (
            <div>
              <p className="text-xs font-medium text-[var(--color-fg-muted)] mb-2">{t("accounts", language)}</p>
              <div className="flex flex-wrap gap-2">
                {position.accounts.map((acc) => (
                  <span key={acc} className="px-2 py-1 bg-[var(--color-bg-muted)] rounded text-xs text-[var(--color-fg-default)]">
                    {acc}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Price Stale Warning */}
          {position.priceStale && (
            <div className="flex items-center gap-2 p-3 bg-[var(--color-accent-yellow)]/10 border border-[var(--color-accent-yellow)]/30 rounded-lg">
              <span className="text-[var(--color-accent-yellow)]">⚠️</span>
              <p className="text-xs text-[var(--color-accent-yellow)]">{t("priceStale", language)}</p>
            </div>
          )}

          {/* Strategy snippet */}
          {verdict && (
            <div className="flex items-start gap-2 p-3 bg-[var(--color-bg-muted)] rounded-lg border border-[var(--color-border)]">
              <VerdictBadge verdict={verdict.verdict} size="sm" />
              <p className="text-xs text-[var(--color-fg-muted)] leading-snug line-clamp-2">
                {verdict.reasoning.slice(0, 120)}{verdict.reasoning.length > 120 ? "…" : ""}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
