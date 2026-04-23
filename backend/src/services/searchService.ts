import YahooFinance from "yahoo-finance2";
import { logger } from "./logger.js";
import type { Exchange } from "../types/index.js";

const yf = new YahooFinance();
const ALPHA_VANTAGE_API_KEY = process.env["ALPHA_VANTAGE_API_KEY"]?.trim() || "demo";
const YAHOO_SEARCH_TIMEOUT_MS = Number(process.env["YAHOO_SEARCH_TIMEOUT_MS"] ?? 1200);
const FALLBACK_SEARCH_TIMEOUT_MS = Number(process.env["FALLBACK_SEARCH_TIMEOUT_MS"] ?? 1800);

export interface InstrumentSearchResult {
  symbol: string;
  shortName: string;
  exchange: Exchange;
  exchDisp: string;
  flag: string;
  price: number | null;
  currency: string;
  assetType: "stock" | "etf" | "crypto" | "fund" | "bond" | "index" | "other";
}

export interface InstrumentSearchResponse {
  results: InstrumentSearchResult[];
  error: string | null;
}

const EXCHANGE_MAP: Record<string, Exchange> = {
  NMS: "NASDAQ", NGM: "NASDAQ", NCM: "NASDAQ",
  NYQ: "NYSE", NYS: "NYSE",
  TLV: "TASE",
  LSE: "LSE", IOB: "LSE",
  GER: "XETRA", EBS: "XETRA",
  PAR: "EURONEXT", AMS: "EURONEXT", BRU: "EURONEXT", LIS: "EURONEXT",
};

const FLAG_MAP: Record<Exchange, string> = {
  NASDAQ: "🇺🇸",
  NYSE: "🇺🇸",
  TASE: "🇮🇱",
  LSE: "🇬🇧",
  XETRA: "🇩🇪",
  EURONEXT: "🇪🇺",
  OTHER: "🌐",
};

function mapExchange(yahooCode: string): Exchange {
  return EXCHANGE_MAP[yahooCode] ?? "OTHER";
}

function mapAssetType(quoteType: string | undefined, symbol?: string): InstrumentSearchResult["assetType"] {
  const normalized = (quoteType ?? "").toUpperCase();
  if (normalized === "EQUITY") return "stock";
  if (normalized === "ETF" || normalized === "ETN") return "etf";
  if (normalized === "CRYPTOCURRENCY" || normalized === "CRYPTO" || symbol?.endsWith("-USD")) return "crypto";
  if (normalized === "MUTUALFUND" || normalized === "MONEYMARKET") return "fund";
  if (normalized === "BOND") return "bond";
  if (normalized === "INDEX") return "index";
  if (normalized === "TRUST" || normalized === "REIT") return "fund";
  return "other";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function flagForResult(exchange: Exchange, exchDisp: string): string {
  if (exchange !== "OTHER") return FLAG_MAP[exchange];
  const normalized = exchDisp.toLowerCase();
  if (normalized.includes("united states")) return "🇺🇸";
  if (normalized.includes("israel")) return "🇮🇱";
  if (normalized.includes("united kingdom")) return "🇬🇧";
  if (normalized.includes("germany")) return "🇩🇪";
  if (normalized.includes("europe")) return "🇪🇺";
  return FLAG_MAP.OTHER;
}

function rankSymbolCandidate(
  query: string,
  item: { symbol: string; shortName?: string; assetType: InstrumentSearchResult["assetType"] }
): number {
  const symbol = item.symbol.toUpperCase();
  const name = (item.shortName ?? "").toUpperCase();
  let score = 0;
  if (symbol === query) score += 100;
  if (symbol.startsWith(query)) score += 40;
  if (name.includes(query)) score += 20;
  if (item.assetType === "etf") score += 12;
  if (item.assetType === "stock") score += 10;
  if (item.assetType === "crypto") score += 8;
  if (!/[=^]/.test(symbol)) score += 5;
  return score;
}

async function enrichPrices(
  items: Array<Omit<InstrumentSearchResult, "price" | "currency"> & { currencyHint?: string }>
): Promise<InstrumentSearchResult[]> {
  const quotes = await Promise.allSettled(items.map((item) => yf.quote(item.symbol)));
  return items.map((item, index) => {
    const quote = quotes[index];
    let price: number | null = null;
    let currency = item.currencyHint ?? "USD";

    if (quote?.status === "fulfilled") {
      const fulfilled = quote.value as { regularMarketPrice?: number; currency?: string };
      if (fulfilled.regularMarketPrice !== undefined && fulfilled.regularMarketPrice !== null) {
        price = item.exchange === "TASE" ? fulfilled.regularMarketPrice / 100 : fulfilled.regularMarketPrice;
      }
      if (fulfilled.currency) {
        currency = item.exchange === "TASE" ? "ILS" : fulfilled.currency;
      }
    }

    return {
      ...item,
      price,
      currency,
    };
  });
}

async function searchYahoo(query: string): Promise<InstrumentSearchResult[]> {
  const searchRes = await withTimeout(
    yf.search(query, {
      quotesCount: 12,
      newsCount: 0,
      enableFuzzyQuery: false,
    } as Parameters<typeof yf.search>[1]),
    YAHOO_SEARCH_TIMEOUT_MS,
    "yahoo_search"
  );

  const quotes = ((searchRes.quotes ?? []) as Array<{
    symbol: string;
    shortname?: string;
    longname?: string;
    exchange?: string;
    exchDisp?: string;
    quoteType?: string;
  }>)
    .filter((item) => {
      if (!item.symbol) return false;
      const assetType = mapAssetType(item.quoteType, item.symbol);
      return assetType !== "index" || item.symbol.toUpperCase() === query;
    })
    .map((item) => {
      const exchange = mapExchange(item.exchange ?? "");
      const exchDisp = item.exchDisp ?? exchange;
      return {
        symbol: item.symbol,
        shortName: item.longname ?? item.shortname ?? item.symbol,
        exchange,
        exchDisp,
        flag: flagForResult(exchange, exchDisp),
        assetType: mapAssetType(item.quoteType, item.symbol),
        currencyHint: exchange === "TASE" ? "ILS" : "USD",
      };
    })
    .sort((left, right) => rankSymbolCandidate(query, right) - rankSymbolCandidate(query, left))
    .slice(0, 8);

  return enrichPrices(quotes);
}

async function searchAlphaVantage(query: string): Promise<InstrumentSearchResult[]> {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "SYMBOL_SEARCH");
  url.searchParams.set("keywords", query);
  url.searchParams.set("apikey", ALPHA_VANTAGE_API_KEY);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FALLBACK_SEARCH_TIMEOUT_MS);
  const response = await fetch(url.toString(), { signal: controller.signal }).finally(() => {
    clearTimeout(timeoutId);
  });
  if (!response.ok) {
    throw new Error(`alpha_vantage_http_${response.status}`);
  }

  const payload = await response.json() as {
    bestMatches?: Array<Record<string, string>>;
    Note?: string;
    Information?: string;
  };

  if (payload.Note || payload.Information) {
    throw new Error(payload.Note ?? payload.Information ?? "alpha_vantage_unavailable");
  }

  const matches = (payload.bestMatches ?? [])
    .map((item) => {
      const symbol = item["1. symbol"] ?? "";
      const type = item["3. type"] ?? "";
      const region = item["4. region"] ?? "Global";
      const currency = item["8. currency"] ?? "USD";
      const assetType = mapAssetType(type, symbol);
      const exchange = region === "United States" ? "NYSE" : "OTHER";
      return {
        symbol,
        shortName: item["2. name"] ?? symbol,
        exchange,
        exchDisp: region,
        flag: flagForResult(exchange, region),
        assetType,
        currencyHint: currency,
      } satisfies Omit<InstrumentSearchResult, "price" | "currency"> & { currencyHint?: string };
    })
    .filter((item) => item.symbol)
    .sort((left, right) => rankSymbolCandidate(query, right) - rankSymbolCandidate(query, left))
    .slice(0, 8);

  return enrichPrices(matches);
}

export async function searchInstruments(queryRaw: string): Promise<InstrumentSearchResponse> {
  const query = queryRaw.trim().toUpperCase();
  if (query.length < 2) {
    return { results: [], error: null };
  }

  try {
    const yahooResults = await searchYahoo(query);
    if (yahooResults.length > 0) {
      return { results: yahooResults, error: null };
    }
    logger.warn(`Yahoo search returned no results for query=${query}; trying Alpha Vantage fallback`);
  } catch (error) {
    logger.warn(`Yahoo search failed for query=${query}: ${String(error)}`);
  }

  try {
    const alphaResults = await searchAlphaVantage(query);
    if (alphaResults.length > 0) {
      return { results: alphaResults, error: null };
    }
    return { results: [], error: null };
  } catch (error) {
    logger.warn(`Alpha Vantage fallback failed for query=${query}: ${String(error)}`);
    return {
      results: [],
      error: "Search is temporarily unavailable. Please try again or contact admin.",
    };
  }
}
