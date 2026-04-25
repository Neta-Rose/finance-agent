import { useState, useEffect, useRef } from "react";
import { X, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { createChart, ColorType, CandlestickSeries, LineSeries } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { CandlestickData, LineData } from "lightweight-charts";
import { fetchPositionHistory, updatePosition } from "../../api/portfolio";
import { useToastStore } from "../../store/toastStore";
import { usePreferencesStore } from "../../store/preferencesStore";
import { t } from "../../store/i18n";
import { formatILS, formatPct } from "../../utils/format";
import type { PositionRow, VerdictRow } from "../../types/api";
import { Spinner } from "../ui/Spinner";
import { VerdictBadge, ConfidenceBadge } from "../ui/Badge";

interface PositionDetailModalProps {
  position: PositionRow | null;
  verdict?: VerdictRow;
  onClose: () => void;
  onDeletePosition?: (position: PositionRow) => Promise<void>;
}

type Timeframe = "1D" | "1W" | "1M" | "3M" | "1Y";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function PositionDetailModal({ position, verdict, onClose, onDeletePosition }: PositionDetailModalProps) {
  const language = usePreferencesStore((s) => s.language);
  const theme = usePreferencesStore((s) => s.theme);
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

  useEffect(() => {
    if (!position) return;
    setLoading(true);
    fetchPositionHistory(position.ticker, timeframe)
      .then((data) => { setChartData(data); setLoading(false); })
      .catch(() => { setChartData([]); setLoading(false); });
  }, [position, timeframe]);

  useEffect(() => {
    if (!chartContainerRef.current || !position) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    }

    const bgMuted = cssVar("--color-bg-muted") || "#21262d";
    const border = cssVar("--color-border") || "#30363d";
    const fgMuted = cssVar("--color-fg-muted") || "#8b949e";
    const accentGreen = cssVar("--color-accent-green") || "#3fb950";
    const accentRed = cssVar("--color-accent-red") || "#f85149";
    const accentBlue = cssVar("--color-accent-blue") || "#58a6ff";
    const fgSubtle = cssVar("--color-fg-subtle") || "#6e7681";

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: fgMuted,
        fontSize: 10,
      },
      grid: {
        vertLines: { color: bgMuted },
        horzLines: { color: bgMuted },
      },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: true },
      crosshair: {
        mode: 0,
        vertLine: { color: fgSubtle, width: 1, style: 2 },
        horzLine: { color: fgSubtle, width: 1, style: 2 },
      },
      handleScale: false,
      handleScroll: false,
    });

    chartRef.current = chart;

    const hasOhlc = chartData.length > 0 && "open" in chartData[0];

    if (hasOhlc) {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: accentGreen,
        downColor: accentRed,
        borderUpColor: accentGreen,
        borderDownColor: accentRed,
        wickUpColor: accentGreen,
        wickDownColor: accentRed,
      });
      series.setData(chartData as CandlestickData[]);
      seriesRef.current = series as unknown as ISeriesApi<"Candlestick">;
    } else {
      const series = chart.addSeries(LineSeries, { color: accentBlue, lineWidth: 2 });
      series.setData(chartData as LineData[]);
      seriesRef.current = series as unknown as ISeriesApi<"Line">;
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: 200,
        });
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    };
  }, [position, chartData, theme]);

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

  const plPositive = position.plPct >= 0;
  const plClass = plPositive ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]";
  const dayChangePct = position.dayChangePct ?? 0;
  const dayChangeILS = position.dayChangeILS ?? 0;
  const hasDayChange = dayChangePct !== 0 || dayChangeILS !== 0;
  const dayPositive = dayChangePct >= 0;
  const dayClass = dayPositive ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]";
  const hasMultipleAccounts = (position.accountBreakdown?.length ?? 0) > 1;
  const canDeleteSinglePosition = !!onDeletePosition && !hasMultipleAccounts && (position.accounts?.length ?? 0) === 1;
  const inputCls = "w-full bg-[var(--color-bg-base)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)] tabular-nums";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full bg-[var(--color-bg-base)] border-t border-[var(--color-border)] md:rounded-2xl md:border md:max-w-lg md:max-h-[88vh] flex flex-col overflow-hidden"
        style={{ maxHeight: "92vh" }}
      >
        {/* ── Header ── */}
        <div className="sticky top-0 z-10 bg-[var(--color-bg-base)] border-b border-[var(--color-border)] px-4 pt-4 pb-3 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-xl text-[var(--color-fg-default)] tracking-tight">{position.ticker}</span>
              <span className="text-[10px] text-[var(--color-fg-subtle)] bg-[var(--color-bg-muted)] px-1.5 py-0.5 rounded font-medium">
                {position.exchange}
              </span>
              {verdict && <VerdictBadge verdict={verdict.verdict} />}
            </div>
            <div className="flex items-center gap-2 shrink-0">
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
              <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--color-fg-muted)] hover:text-[var(--color-fg-default)] hover:bg-[var(--color-bg-muted)]">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Hero metrics */}
          <div className="mt-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-2xl font-bold tabular-nums text-[var(--color-fg-default)] leading-none">
                {formatILS(position.livePriceILS)}
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                {hasDayChange ? (
                  <span className={`inline-flex items-center gap-1 text-sm font-semibold tabular-nums ${dayClass}`}>
                    {dayPositive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    {dayPositive ? "+" : ""}{dayChangePct.toFixed(2)}%
                    <span className="font-normal text-xs opacity-75">({dayPositive ? "+" : ""}{formatILS(Math.abs(dayChangeILS))})</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-sm text-[var(--color-fg-subtle)]">
                    <Minus size={13} />
                    <span>—</span>
                  </span>
                )}
                <span className="text-[10px] text-[var(--color-fg-subtle)]">today</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-base font-bold tabular-nums text-[var(--color-fg-default)]">{formatILS(position.currentILS)}</p>
              <p className={`text-sm font-semibold tabular-nums ${plClass}`}>
                {plPositive ? "+" : ""}{formatPct(position.plPct)}
                <span className="font-normal text-xs ml-1 opacity-75">({plPositive ? "+" : ""}{formatILS(position.plILS)})</span>
              </p>
              <p className="text-[10px] text-[var(--color-fg-subtle)] mt-0.5">{position.weightPct.toFixed(1)}% weight</p>
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto">

          {/* Chart */}
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-medium text-[var(--color-fg-subtle)] uppercase tracking-wider">{t("priceHistory", language)}</p>
              <div className="flex gap-1">
                {(["1D", "1W", "1M", "3M", "1Y"] as Timeframe[]).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      timeframe === tf
                        ? "bg-[var(--color-accent-blue)] text-white"
                        : "bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg-default)]"
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl overflow-hidden bg-[var(--color-bg-subtle)] border border-[var(--color-border)]">
              {loading ? (
                <div className="h-[200px] flex items-center justify-center">
                  <Spinner size="md" />
                </div>
              ) : chartData.length === 0 ? (
                <div className="h-[200px] flex items-center justify-center text-xs text-[var(--color-fg-subtle)]">
                  {t("noChartData", language)}
                </div>
              ) : (
                <div ref={chartContainerRef} className="w-full" style={{ height: 200 }} />
              )}
            </div>
          </div>

          {/* Secondary stats */}
          <div className="px-4 pt-3 pb-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-xl p-3">
                <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("currentValue", language)}</p>
                <p className="text-sm font-semibold tabular-nums text-[var(--color-fg-default)]">{formatILS(position.currentILS)}</p>
              </div>
              <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-xl p-3">
                <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("costBasis", language)}</p>
                <p className="text-sm font-semibold tabular-nums text-[var(--color-fg-default)]">{formatILS(position.costILS)}</p>
              </div>
              <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-xl p-3">
                <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("weight", language)}</p>
                <p className="text-sm font-semibold tabular-nums text-[var(--color-fg-default)]">{position.weightPct.toFixed(1)}%</p>
              </div>
            </div>
          </div>

          {/* Position detail: shares + avg price (editable) */}
          <div className="px-4 pt-1 pb-3 border-b border-[var(--color-border)]">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1.5">{t("shares", language)}</p>
                {editMode && !hasMultipleAccounts ? (
                  <input type="number" value={editShares} onChange={(e) => setEditShares(e.target.value)} className={inputCls} min="1" />
                ) : (
                  <p className="text-sm font-semibold tabular-nums text-[var(--color-fg-default)]">{position.shares.toLocaleString()}</p>
                )}
              </div>
              <div>
                <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1.5">{t("avgBuyPrice", language)}</p>
                {editMode && !hasMultipleAccounts ? (
                  <input type="number" value={editAvgPrice} onChange={(e) => setEditAvgPrice(e.target.value)} className={inputCls} min="0.01" step="0.01" />
                ) : (
                  <p className="text-sm font-semibold tabular-nums text-[var(--color-fg-default)]">{formatILS(position.avgPriceILS)}</p>
                )}
              </div>
            </div>
          </div>

          {/* Multi-account breakdown */}
          {hasMultipleAccounts && (
            <div className="px-4 py-3 border-b border-[var(--color-border)] space-y-2">
              <p className="text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wider">
                {t("accounts", language)}
              </p>
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
                        onChange={(e) => setAccountEdits((cur) => ({ ...cur, [entry.account]: { shares: e.target.value, avgPriceILS: cur[entry.account]?.avgPriceILS ?? String(entry.avgPriceILS) } }))}
                        className={inputCls}
                        min="0"
                      />
                    ) : (
                      <p className="text-sm font-semibold tabular-nums text-[var(--color-fg-default)]">{entry.shares.toLocaleString()}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{t("avgBuyPrice", language)}</p>
                    {editMode ? (
                      <input
                        type="number"
                        value={accountEdits[entry.account]?.avgPriceILS ?? String(entry.avgPriceILS)}
                        onChange={(e) => setAccountEdits((cur) => ({ ...cur, [entry.account]: { shares: cur[entry.account]?.shares ?? String(entry.shares), avgPriceILS: e.target.value } }))}
                        className={inputCls}
                        min="0.01"
                        step="0.01"
                      />
                    ) : (
                      <p className="text-sm font-semibold tabular-nums text-[var(--color-fg-default)]">{formatILS(entry.avgPriceILS)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Edit actions */}
          {editMode && (
            <div className="px-4 py-3 space-y-2 border-b border-[var(--color-border)]">
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="w-full py-2.5 rounded-xl bg-[var(--color-accent-blue)] text-white text-sm font-semibold disabled:opacity-50"
              >
                {saving ? t("saving", language) : t("saveChanges", language)}
              </button>
              {canDeleteSinglePosition && (
                <button
                  onClick={async () => {
                    if (!onDeletePosition || !position) return;
                    setDeleting(true);
                    try { await onDeletePosition(position); } finally { setDeleting(false); }
                  }}
                  disabled={deleting}
                  className="w-full py-2.5 rounded-xl border border-[color-mix(in_srgb,var(--color-accent-red)_40%,transparent)] text-[var(--color-accent-red)] text-sm font-semibold disabled:opacity-50"
                >
                  {deleting ? "Removing..." : "Remove Position"}
                </button>
              )}
            </div>
          )}

          {/* Strategy verdict */}
          {verdict && (
            <div className="px-4 py-3 border-b border-[var(--color-border)]">
              <p className="text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wider mb-2">{t("reasoning", language)}</p>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <VerdictBadge verdict={verdict.verdict} />
                <ConfidenceBadge confidence={verdict.confidence} size="md" />
                {verdict.timeframe && verdict.timeframe !== "undefined" && (
                  <span className="text-xs text-[var(--color-fg-subtle)]">· {verdict.timeframe}</span>
                )}
              </div>
              <p className="text-xs text-[var(--color-fg-muted)] leading-relaxed">
                {verdict.reasoning.slice(0, 200)}{verdict.reasoning.length > 200 ? "…" : ""}
              </p>
            </div>
          )}

          {/* Accounts (single account display) */}
          {!hasMultipleAccounts && position.accounts && position.accounts.length > 0 && (
            <div className="px-4 py-3 flex items-center gap-2 border-b border-[var(--color-border)]">
              <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("accounts", language)}:</p>
              {position.accounts.map((acc) => (
                <span key={acc} className="px-2 py-0.5 bg-[var(--color-bg-muted)] rounded text-xs text-[var(--color-fg-default)]">
                  {acc}
                </span>
              ))}
            </div>
          )}

          {/* Stale warning */}
          {position.priceStale && (
            <div className="mx-4 my-3 flex items-center gap-2 p-3 bg-[color-mix(in_srgb,var(--color-accent-yellow)_10%,transparent)] border border-[color-mix(in_srgb,var(--color-accent-yellow)_30%,transparent)] rounded-xl">
              <span className="text-[var(--color-accent-yellow)] text-sm">⚠</span>
              <p className="text-xs text-[var(--color-accent-yellow)]">{t("priceStale", language)}</p>
            </div>
          )}

          <div className="h-6" />
        </div>
      </div>
    </div>
  );
}
