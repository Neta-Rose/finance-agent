import YahooFinance from "yahoo-finance2";
import type { Exchange } from "../types/index.js";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// YahooFinance v3: createYahooFinance returns the class, need to instantiate
const yf = new YahooFinance();

interface CacheEntry {
  result: PriceResult;
  ts: number;
}

export interface PriceResult {
  ticker: string;
  exchange: Exchange;
  priceILS: number;
  priceNative: number;
  dayChangeNative: number;
  dayChangePct: number;
  currency: string;
  source: string;
  fetchedAt: string;
  stale: boolean;
}

const priceCache = new Map<string, CacheEntry>();
const fxCache = { rate: 3.7, ts: 0 };

export class PriceFetchError extends Error {
  constructor(public readonly ticker: string, message: string) {
    super(message);
    this.name = "PriceFetchError";
  }
}

export async function getUsdIlsRate(): Promise<number> {
  const now = Date.now();
  if (now - fxCache.ts < FX_CACHE_TTL_MS && fxCache.rate > 0) {
    return fxCache.rate;
  }

  try {
    const res = await fetch(
      "https://api.frankfurter.app/latest?from=USD&to=ILS"
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { rates?: { ILS?: number } };
    const rate = data.rates?.ILS;
    if (!rate) throw new Error("No ILS rate in response");
    fxCache.rate = rate;
    fxCache.ts = now;
    return rate;
  } catch {
    if (fxCache.ts > 0 && fxCache.rate > 0) {
      return fxCache.rate;
    }
    return 3.7;
  }
}

async function getPriceFromYF(
  ticker: string,
  exchange: Exchange,
  usdIlsRate: number
): Promise<PriceResult> {
  const yfTicker = exchange === "TASE" && !ticker.endsWith(".TA") ? `${ticker}.TA` : ticker;

  const quote = await yf.quote(yfTicker);
  const rawPrice = quote["regularMarketPrice"];

  if (rawPrice === undefined || rawPrice === null) {
    throw new PriceFetchError(ticker, `No price data for ${yfTicker}`);
  }

  const rawChange = (quote["regularMarketChange"] as number | null | undefined) ?? 0;
  const rawChangePct = (quote["regularMarketChangePercent"] as number | null | undefined) ?? 0;

  let priceNative: number;
  let priceILS: number;
  let dayChangeNative: number;
  const currency = exchange === "TASE" ? "ILS" : "USD";

  if (exchange === "TASE") {
    priceNative = rawPrice / 100; // Yahoo returns agorot → ILS
    priceILS = priceNative;
    dayChangeNative = rawChange / 100; // agorot → ILS
  } else {
    priceNative = rawPrice;
    priceILS = rawPrice * usdIlsRate;
    dayChangeNative = rawChange;
  }

  return {
    ticker,
    exchange,
    priceILS,
    priceNative,
    dayChangeNative,
    dayChangePct: rawChangePct,
    currency,
    source: "yahoo_finance",
    fetchedAt: new Date().toISOString(),
    stale: false,
  };
}

export async function getPrice(
  ticker: string,
  exchange: Exchange,
  usdIlsRate: number
): Promise<PriceResult> {
  const now = Date.now();
  const cacheKey = `${ticker}_${exchange}`;

  const cached = priceCache.get(cacheKey);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return { ...cached.result, stale: false };
  }

  try {
    const result = await getPriceFromYF(ticker, exchange, usdIlsRate);
    priceCache.set(cacheKey, { result, ts: now });
    return result;
  } catch (err) {
    if (cached) {
      return { ...cached.result, stale: true };
    }
    // Return 0 on error, never throw
    return {
      ticker,
      exchange,
      priceILS: 0,
      priceNative: 0,
      dayChangeNative: 0,
      dayChangePct: 0,
      currency: exchange === "TASE" ? "ILS" : "USD",
      source: "yahoo_finance",
      fetchedAt: new Date().toISOString(),
      stale: true,
    };
  }
}

export async function getPricesParallel(
  positions: Array<{ ticker: string; exchange: Exchange }>,
  usdIlsRate: number
): Promise<Map<string, PriceResult>> {
  const results = await Promise.allSettled(
    positions.map((pos) => getPrice(pos.ticker, pos.exchange, usdIlsRate))
  );

  const map = new Map<string, PriceResult>();
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status === "fulfilled") {
      map.set(positions[i]!.ticker, r.value);
    }
  }

  return map;
}

interface CandlestickData {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

function timeframeToRange(timeframe: string): { period1: Date; period2: Date; interval: "5m" | "30m" | "1h" | "1d" | "1wk" | "1m" | "2m" | "15m" | "60m" | "90m" | "5d" | "1mo" | "3mo" } {
  const now = new Date();
  const period2 = now;
  let period1: Date;
  let interval: "5m" | "30m" | "1h" | "1d" | "1wk" | "1m" | "2m" | "15m" | "60m" | "90m" | "5d" | "1mo" | "3mo" = "1h";

  switch (timeframe) {
    case "1D":
      period1 = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
      interval = "5m";
      break;
    case "1W":
      period1 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      interval = "30m";
      break;
    case "1M":
      period1 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      interval = "1h";
      break;
    case "3M":
      period1 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      interval = "1d";
      break;
    case "1Y":
      period1 = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      interval = "1wk";
      break;
    default:
      period1 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      interval = "1h";
  }

  return { period1, period2, interval };
}

export async function getPriceHistory(
  ticker: string,
  timeframe: string
): Promise<CandlestickData[]> {
  const { period1, period2, interval } = timeframeToRange(timeframe);
  const yfTicker = ticker;

  try {
    const result = await yf.chart(yfTicker, {
      period1: Math.floor(period1.getTime() / 1000),
      period2: Math.floor(period2.getTime() / 1000),
      interval,
    });

    if (!result || !result.quotes || result.quotes.length === 0) {
      return [];
    }

    const candles: CandlestickData[] = [];
    for (const q of result.quotes) {
      if (q.date && q.open != null && q.high != null && q.low != null && q.close != null) {
        candles.push({
          time: Math.floor(new Date(q.date).getTime() / 1000),
          open: q.open,
          high: q.high,
          low: q.low,
          close: q.close,
        });
      }
    }

    return candles.sort((a, b) => a.time - b.time);
  } catch (err) {
    console.error(`Failed to get price history for ${ticker}:`, err);
    return [];
  }
}
