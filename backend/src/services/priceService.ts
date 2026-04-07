import yf from "yahoo-finance2";
import type { Exchange } from "../types/index.js";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  result: PriceResult;
  ts: number;
}

export interface PriceResult {
  ticker: string;
  exchange: Exchange;
  priceILS: number;
  priceNative: number;
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
  const yfTicker = exchange === "TASE" ? `${ticker}.TA` : ticker;

  const quote = await yf.quote(yfTicker);
  const rawPrice = quote["regularMarketPrice"];

  if (rawPrice === undefined || rawPrice === null) {
    throw new PriceFetchError(ticker, `No price data for ${yfTicker}`);
  }

  let priceNative: number;
  let priceILS: number;
  const currency = exchange === "TASE" ? "ILS" : "USD";

  if (exchange === "TASE") {
    priceNative = rawPrice / 100; // Yahoo returns agorot → ILS
    priceILS = priceNative;
  } else {
    priceNative = rawPrice;
    priceILS = rawPrice * usdIlsRate;
  }

  return {
    ticker,
    exchange,
    priceILS,
    priceNative,
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
    throw new PriceFetchError(
      ticker,
      `Failed to fetch price: ${err instanceof Error ? err.message : String(err)}`
    );
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
