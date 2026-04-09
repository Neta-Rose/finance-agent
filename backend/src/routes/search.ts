import { Router, type Request, type Response, type NextFunction } from "express";
import YahooFinance from "yahoo-finance2";
import type { Exchange } from "../types/index.js";

const router = Router();
const yf = new YahooFinance();

const CACHE_TTL = 30_000;
const searchCache = new Map<string, { results: SearchResult[]; ts: number }>();

export interface SearchResult {
  symbol: string;
  shortName: string;
  exchange: Exchange;
  exchDisp: string;
  flag: string;
  price: number | null;
  currency: string;
}

const EXCHANGE_MAP: Record<string, Exchange> = {
  NMS: "NASDAQ", NGM: "NASDAQ", NCM: "NASDAQ",
  NYQ: "NYSE",   NYS: "NYSE",
  TLV: "TASE",
  LSE: "LSE",    IOB: "LSE",
  GER: "XETRA",  EBS: "XETRA",
  PAR: "EURONEXT", AMS: "EURONEXT", BRU: "EURONEXT", LIS: "EURONEXT",
};

const FLAG_MAP: Record<Exchange, string> = {
  NASDAQ:   "🇺🇸",
  NYSE:     "🇺🇸",
  TASE:     "🇮🇱",
  LSE:      "🇬🇧",
  XETRA:    "🇩🇪",
  EURONEXT: "🇪🇺",
  OTHER:    "🌐",
};

function mapExchange(yahooCode: string): Exchange {
  return EXCHANGE_MAP[yahooCode] ?? "OTHER";
}

router.get(
  "/search/ticker",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = String(req.query["q"] ?? "").trim().toUpperCase();
      if (q.length < 2) {
        res.json({ results: [] });
        return;
      }

      const cached = searchCache.get(q);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        res.json({ results: cached.results });
        return;
      }

      let quotes: Array<{
        symbol: string;
        shortname?: string;
        longname?: string;
        exchange?: string;
        exchDisp?: string;
        quoteType?: string;
      }> = [];

      try {
        const searchRes = await yf.search(q, {
          quotesCount: 6,
          newsCount: 0,
          enableFuzzyQuery: false,
        } as Parameters<typeof yf.search>[1]);
        quotes = ((searchRes.quotes ?? []) as typeof quotes).filter(
          (r) => r.quoteType === "EQUITY"
        );
      } catch {
        res.json({ results: [] });
        return;
      }

      const priceResults = await Promise.allSettled(
        quotes.map((item) => yf.quote(item.symbol))
      );

      const results: SearchResult[] = quotes.map((item, i) => {
        const exchange = mapExchange(item.exchange ?? "");
        const pr = priceResults[i];
        let price: number | null = null;
        let currency = "USD";

        if (pr !== undefined && pr.status === "fulfilled") {
          const fulfilled = pr as PromiseFulfilledResult<{ regularMarketPrice?: number; currency?: string }>;
          const raw = fulfilled.value.regularMarketPrice ?? null;
          currency = fulfilled.value.currency ?? "USD";
          if (raw !== null && raw !== undefined) {
            price = exchange === "TASE" ? raw / 100 : raw;
          }
        }

        return {
          symbol: item.symbol,
          shortName: item.longname ?? item.shortname ?? item.symbol,
          exchange,
          exchDisp: item.exchDisp ?? exchange,
          flag: FLAG_MAP[exchange],
          price,
          currency: exchange === "TASE" ? "ILS" : currency,
        };
      });

      searchCache.set(q, { results, ts: Date.now() });
      res.json({ results });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
