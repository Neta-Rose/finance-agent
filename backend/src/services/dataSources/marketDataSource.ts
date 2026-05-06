import { getPriceHistory } from "../priceService.js";
import { priceHistoryCache } from "./cache.js";

/**
 * Market data source — Phase 4, task 4.5.
 *
 * Spec: design.md §6.1 dataSources/marketDataSource; I1.2.
 *
 * Computes deterministic technical indicators from price history.
 * All functions are pure given the same candle series.
 */

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TechnicalIndicators {
  closes: number[];
  ma50: number | null;
  ma200: number | null;
  rsi14: number | null;
  macdSignal: "bullish_crossover" | "bearish_crossover" | "neutral";
  week52High: number | null;
  week52Low: number | null;
  positionInRange: number | null;
  keyLevelSupport: number | null;
  keyLevelResistance: number | null;
  currentPrice: number | null;
}

// ---------------------------------------------------------------------------
// Pure computation helpers
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

export function computeSma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  return mean(closes.slice(-period));
}

export function computeEma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let prev = mean(closes.slice(0, period));
  for (let i = period; i < closes.length; i++) {
    prev = closes[i]! * k + prev * (1 - k);
  }
  return prev;
}

export function computeRsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  const window = closes.slice(-15);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < window.length; i++) {
    const diff = window[i]! - window[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / 14) / (losses / 14);
  return 100 - 100 / (1 + rs);
}

export function computeMacdSignal(
  closes: number[]
): "bullish_crossover" | "bearish_crossover" | "neutral" {
  if (closes.length < 35) return "neutral";
  const prior = closes.slice(0, -1);
  const macdNow = (computeEma(closes, 12) ?? 0) - (computeEma(closes, 26) ?? 0);
  const macdPrev = (computeEma(prior, 12) ?? 0) - (computeEma(prior, 26) ?? 0);
  if (macdPrev <= 0 && macdNow > 0) return "bullish_crossover";
  if (macdPrev >= 0 && macdNow < 0) return "bearish_crossover";
  return "neutral";
}

export function computeKeyLevels(closes: number[]): {
  support: number | null;
  resistance: number | null;
} {
  const window = closes.slice(-30);
  if (window.length === 0) return { support: null, resistance: null };
  return {
    support: Math.min(...window),
    resistance: Math.max(...window),
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function getPriceHistorySeries(
  ticker: string,
  timeframe = "3M"
): Promise<Candle[]> {
  const cacheKey = `${ticker}:${timeframe}`;
  const cached = priceHistoryCache.get(cacheKey);
  if (cached) return cached as Candle[];

  const candles = await getPriceHistory(ticker, timeframe);
  priceHistoryCache.set(cacheKey, candles);
  return candles as Candle[];
}

export async function computeTechnicalIndicators(
  ticker: string,
  currentPrice?: number
): Promise<TechnicalIndicators> {
  const candles = await getPriceHistorySeries(ticker, "3M");
  const closes = candles
    .map((c) => c.close)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

  const livePrice =
    currentPrice ??
    (closes.length > 0 ? closes[closes.length - 1]! : null);

  const week52High = closes.length > 0 ? Math.max(...closes) : null;
  const week52Low = closes.length > 0 ? Math.min(...closes) : null;
  const positionInRange =
    week52High !== null &&
    week52Low !== null &&
    week52High > week52Low &&
    livePrice !== null
      ? Math.max(0, Math.min(1, (livePrice - week52Low) / (week52High - week52Low)))
      : null;

  const { support, resistance } = computeKeyLevels(closes);

  return {
    closes,
    ma50: computeSma(closes, 50),
    ma200: computeSma(closes, 200),
    rsi14: computeRsi14(closes),
    macdSignal: computeMacdSignal(closes),
    week52High,
    week52Low,
    positionInRange,
    keyLevelSupport: support,
    keyLevelResistance: resistance,
    currentPrice: livePrice,
  };
}
