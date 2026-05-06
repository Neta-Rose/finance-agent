import { fundamentalsCache } from "./cache.js";

/**
 * Fundamentals data source — Phase 4, task 4.5.
 *
 * Spec: design.md §6.1 dataSources/fundamentalsSource; I1.1.
 *
 * Fetches deterministic fundamentals facts from yahoo-finance2.
 * The LLM receives these as inputs and produces only the
 * `fundamentalView` prose.
 *
 * Phase 4 ships with the yahoo-finance2 quoteSummary path. Exa-based
 * analyst-consensus enrichment is a Phase 5+ enhancement.
 */

import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance();

export interface FundamentalsFacts {
  earningsResult: "beat" | "miss" | "in-line" | "unknown";
  epsActual: number | null;
  epsExpected: number | null;
  revenueActualM: number | null;
  revenueExpectedM: number | null;
  revenueGrowthYoY: number | null;
  marginTrend: "improving" | "declining" | "stable" | "unknown";
  guidance: "raised" | "lowered" | "maintained" | "unknown";
  pe: number | null;
  sectorAvgPe: number | null;
  peAssessment: "cheap" | "fair" | "expensive" | "unknown";
  analystBuy: number;
  analystHold: number;
  analystSell: number;
  avgTargetPrice: number | null;
  targetCurrency: string;
  balanceSheet: "healthy" | "concerning" | "unknown";
  insiderActivity: "buying" | "selling" | "none" | "unknown";
}

const NEUTRAL_FUNDAMENTALS: FundamentalsFacts = {
  earningsResult: "unknown",
  epsActual: null,
  epsExpected: null,
  revenueActualM: null,
  revenueExpectedM: null,
  revenueGrowthYoY: null,
  marginTrend: "unknown",
  guidance: "unknown",
  pe: null,
  sectorAvgPe: null,
  peAssessment: "unknown",
  analystBuy: 0,
  analystHold: 0,
  analystSell: 0,
  avgTargetPrice: null,
  targetCurrency: "USD",
  balanceSheet: "unknown",
  insiderActivity: "unknown",
};

function safeNum(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export async function getFundamentalsFacts(
  ticker: string,
  exchange: string
): Promise<FundamentalsFacts> {
  const cacheKey = `fundamentals:${ticker}:${exchange}`;
  const cached = fundamentalsCache.get(cacheKey);
  if (cached) return cached as FundamentalsFacts;

  try {
    const yfTicker =
      exchange === "TASE" && !ticker.endsWith(".TA") ? `${ticker}.TA` : ticker;

    const summary = await yf.quoteSummary(yfTicker, {
      modules: [
        "financialData",
        "defaultKeyStatistics",
        "recommendationTrend",
        "earningsTrend",
      ],
    });

    const fd = summary.financialData;
    const ks = summary.defaultKeyStatistics;
    const rt = summary.recommendationTrend;
    const et = summary.earningsTrend;

    const pe = safeNum(fd?.currentRatio) ?? safeNum(ks?.trailingPE);
    const analystBuy =
      (rt?.trend?.[0]?.strongBuy ?? 0) + (rt?.trend?.[0]?.buy ?? 0);
    const analystHold = rt?.trend?.[0]?.hold ?? 0;
    const analystSell =
      (rt?.trend?.[0]?.sell ?? 0) + (rt?.trend?.[0]?.strongSell ?? 0);

    // Earnings result from most recent quarter
    const latestEarnings = et?.trend?.[0];
    const epsActual = safeNum(latestEarnings?.earningsEstimate?.avg);
    const epsExpected = safeNum(latestEarnings?.earningsEstimate?.avg);
    let earningsResult: FundamentalsFacts["earningsResult"] = "unknown";
    if (epsActual !== null && epsExpected !== null) {
      if (epsActual > epsExpected * 1.01) earningsResult = "beat";
      else if (epsActual < epsExpected * 0.99) earningsResult = "miss";
      else earningsResult = "in-line";
    }

    const facts: FundamentalsFacts = {
      ...NEUTRAL_FUNDAMENTALS,
      earningsResult,
      epsActual,
      epsExpected,
      revenueGrowthYoY: safeNum(fd?.revenueGrowth),
      pe: safeNum(ks?.trailingPE),
      analystBuy,
      analystHold,
      analystSell,
      avgTargetPrice: safeNum(fd?.targetMeanPrice),
      targetCurrency: exchange === "TASE" ? "ILS" : "USD",
    };

    fundamentalsCache.set(cacheKey, facts);
    return facts;
  } catch {
    // On any fetch failure, return neutral defaults so the analyst step
    // can still produce a schema-valid artifact.
    fundamentalsCache.set(cacheKey, NEUTRAL_FUNDAMENTALS);
    return { ...NEUTRAL_FUNDAMENTALS };
  }
}
