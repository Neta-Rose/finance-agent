import { z } from "zod";

export const FundamentalsReportSchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/),
  generatedAt: z.string().datetime(),
  analyst: z.literal("fundamentals"),
  earnings: z.object({
    result: z.enum(["beat", "miss", "in-line", "unknown"]),
    epsActual: z.number().nullable(),
    epsExpected: z.number().nullable(),
    revenueActualM: z.number().nullable(),
    revenueExpectedM: z.number().nullable(),
  }),
  revenueGrowthYoY: z.number().nullable(),
  marginTrend: z.enum(["improving", "declining", "stable", "unknown"]),
  guidance: z.enum(["raised", "lowered", "maintained", "unknown"]),
  valuation: z.object({
    pe: z.number().nullable(),
    sectorAvgPe: z.number().nullable(),
    assessment: z.enum(["cheap", "fair", "expensive", "unknown"]),
  }),
  analystConsensus: z.object({
    buy: z.number().int().min(0),
    hold: z.number().int().min(0),
    sell: z.number().int().min(0),
    avgTargetPrice: z.number().nullable(),
    currency: z.string(),
  }),
  balanceSheet: z.enum(["healthy", "concerning", "unknown"]),
  insiderActivity: z.enum(["buying", "selling", "none", "unknown"]),
  fundamentalView: z.string().max(600),
  sources: z.array(z.string().url()),
});

export const TechnicalReportSchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/),
  generatedAt: z.string().datetime(),
  analyst: z.literal("technical"),
  price: z.object({
    current: z.number(),
    week52High: z.number().nullable(),
    week52Low: z.number().nullable(),
    positionInRange: z.number().nullable(),
  }),
  movingAverages: z.object({
    ma50: z.number().nullable(),
    ma200: z.number().nullable(),
    priceVsMa50: z.enum(["above", "below", "at"]),
    priceVsMa200: z.enum(["above", "below", "at"]),
  }),
  rsi: z.object({
    value: z.number().nullable(),
    signal: z.enum(["overbought", "oversold", "neutral"]),
  }),
  macd: z.enum(["bullish_crossover", "bearish_crossover", "neutral"]),
  volume: z.enum(["above_average", "below_average", "average"]),
  keyLevels: z.object({
    support: z.number().nullable(),
    resistance: z.number().nullable(),
  }),
  pattern: z.string().max(200).nullable(),
  technicalView: z.string().max(600),
  sources: z.array(z.string().url()),
});

export const SentimentReportSchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/),
  generatedAt: z.string().datetime(),
  analyst: z.literal("sentiment"),
  analystActions: z
    .array(
      z.object({
        action: z.enum(["upgrade", "downgrade", "initiation", "target_change", "reiterate"]),
        firm: z.string(),
        fromRating: z.string().nullable(),
        toRating: z.string().nullable(),
        targetPrice: z.number().nullable(),
        date: z.string(),
      })
    )
    .optional(),
  insiderTransactions: z
    .array(
      z.object({
        name: z.string(),
        role: z.string(),
        type: z.enum(["buy", "sell"]),
        shares: z.number(),
        date: z.string(),
      })
    )
    .optional(),
  majorNews: z
    .array(
      z.object({
        headline: z.string().max(200),
        summary: z.string().max(400),
        sentiment: z.enum(["positive", "negative", "neutral"]),
        date: z.string(),
      })
    )
    .optional(),
  shortInterest: z.enum(["rising", "falling", "stable", "unknown"]),
  narrativeShift: z.enum(["improving", "deteriorating", "stable"]),
  sentimentView: z.string().max(600),
  sources: z.array(z.string().url()),
});

export const MacroReportSchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/),
  generatedAt: z.string().datetime(),
  analyst: z.literal("macro"),
  rateEnvironment: z.object({
    relevantBank: z.string(),
    currentRate: z.number().nullable(),
    direction: z.enum(["hiking", "cutting", "holding"]),
    relevance: z.enum(["headwind", "tailwind", "neutral"]),
  }),
  sectorPerformance: z.object({
    sectorName: z.string(),
    performanceVsMarket30d: z.number().nullable(),
    trend: z.enum(["outperforming", "underperforming", "in-line"]),
  }),
  currency: z.object({
    usdIls: z.number(),
    trend: z.enum(["usd_strengthening", "ils_strengthening", "stable"]),
    impactOnPosition: z.enum(["positive", "negative", "neutral"]),
  }),
  geopolitical: z.object({
    relevantFactor: z.string().nullable(),
    riskLevel: z.enum(["high", "medium", "low", "none"]),
  }),
  marketRegime: z.enum(["risk_on", "risk_off", "mixed"]),
  macroView: z.string().max(600),
  sources: z.array(z.string().url()),
});

export const RiskReportSchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/),
  generatedAt: z.string().datetime(),
  analyst: z.literal("risk"),
  livePrice: z.number(),
  livePriceCurrency: z.string(),
  livePriceSource: z.string(),
  shares: z.object({
    main: z.number().int().min(0),
    second: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
  positionValueILS: z.number(),
  portfolioWeightPct: z.number(),
  plILS: z.number(),
  plPct: z.number(),
  avgPricePaid: z.number(),
  concentrationFlag: z.boolean(),
  riskFacts: z.string().max(400),
});

const DebateArgumentSchema = z.object({
  source: z.string().url(),
  claim: z.string().max(200),
  dataPoint: z.string().max(200),
});

export const BullCaseReportSchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/),
  generatedAt: z.string().datetime(),
  analyst: z.literal("bull"),
  round: z.union([z.literal(1), z.literal(2)]),
  coreThesis: z.string().max(300),
  arguments: z.array(DebateArgumentSchema).min(3).max(5),
  responseToBear: z.string().max(300).nullable(),
  bullVerdict: z.enum(["BUY", "ADD", "HOLD", "REDUCE", "SELL", "CLOSE"]),
  conditionToBeWrong: z.string().max(200),
});

export const BearCaseReportSchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/),
  generatedAt: z.string().datetime(),
  analyst: z.literal("bear"),
  round: z.union([z.literal(1), z.literal(2)]),
  coreConcern: z.string().max(300),
  arguments: z.array(DebateArgumentSchema).min(3).max(5),
  responseToBull: z.string().max(300).nullable(),
  bearVerdict: z.enum(["BUY", "ADD", "HOLD", "REDUCE", "SELL", "CLOSE"]),
  conditionToBeWrong: z.string().max(200),
});

// Discriminated union type
export const AnalystReportSchema = z.discriminatedUnion("analyst", [
  FundamentalsReportSchema,
  TechnicalReportSchema,
  SentimentReportSchema,
  MacroReportSchema,
  RiskReportSchema,
  BullCaseReportSchema,
  BearCaseReportSchema,
]);

// export type FundamentalsReport = z.infer<typeof FundamentalsReportSchema>;
