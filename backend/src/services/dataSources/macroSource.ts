import { getUsdIlsRate } from "../priceService.js";
import { macroCache } from "./cache.js";

/**
 * Macro data source — Phase 4, task 4.5.
 *
 * Spec: design.md §6.1 dataSources/macroSource; I1.3.
 *
 * Fetches deterministic macro facts: central-bank rate, USD/ILS, sector
 * performance. Phase 4 ships with the FX rate (already available via
 * priceService) and neutral defaults for the rest. Phase 5+ can wire in
 * real central-bank and sector-performance feeds.
 */

export interface MacroFacts {
  relevantBank: string;
  currentRate: number | null;
  rateDirection: "hiking" | "cutting" | "holding";
  rateRelevance: "headwind" | "tailwind" | "neutral";
  sectorName: string;
  sectorPerformanceVsMarket30d: number | null;
  sectorTrend: "outperforming" | "underperforming" | "in-line";
  usdIls: number;
  currencyTrend: "usd_strengthening" | "ils_strengthening" | "stable";
  currencyImpact: "positive" | "negative" | "neutral";
  geopoliticalFactor: string | null;
  geopoliticalRisk: "high" | "medium" | "low" | "none";
  marketRegime: "risk_on" | "risk_off" | "mixed";
}

const NEUTRAL_MACRO: Omit<MacroFacts, "usdIls" | "relevantBank"> = {
  currentRate: null,
  rateDirection: "holding",
  rateRelevance: "neutral",
  sectorName: "unknown",
  sectorPerformanceVsMarket30d: null,
  sectorTrend: "in-line",
  currencyTrend: "stable",
  currencyImpact: "neutral",
  geopoliticalFactor: null,
  geopoliticalRisk: "low",
  marketRegime: "mixed",
};

export async function getMacroFacts(
  ticker: string,
  exchange: string
): Promise<MacroFacts> {
  const cacheKey = `macro:${ticker}:${exchange}`;
  const cached = macroCache.get(cacheKey);
  if (cached) return cached as MacroFacts;

  const usdIls = await getUsdIlsRate();
  const isTase = exchange === "TASE";

  const facts: MacroFacts = {
    ...NEUTRAL_MACRO,
    relevantBank: isTase ? "Bank of Israel" : "Federal Reserve",
    usdIls,
  };

  macroCache.set(cacheKey, facts);
  return facts;
}
