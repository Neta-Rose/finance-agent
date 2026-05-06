import { TechnicalReportSchema } from "../../../schemas/analysts.js";
import { gatherTechnicalData, makePromptHandler, persistReportArtifact } from "../handlerUtils.js";
import { computeTechnicalIndicators } from "../../dataSources/marketDataSource.js";

/**
 * technical handler — Phase 4 synthesizer.
 *
 * Deterministic facts (MA50/MA200/RSI/MACD/week52/keyLevels) are computed
 * server-side from price history. The LLM produces only `technicalView`
 * (prose) and `pattern` (enum). [I1.2]
 */

interface Candle { time: number; open: number; high: number; low: number; close: number }

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = mean(values.slice(0, period));
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
  }
  return prev;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return mean(values.slice(-period));
}

function rsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  const period = 14;
  const window = closes.slice(-period - 1);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < window.length; i++) {
    const diff = window[i]! - window[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function macdSignal(closes: number[]): "bullish_crossover" | "bearish_crossover" | "neutral" {
  // Compare current MACD line (EMA12 - EMA26) to its 9-period EMA signal.
  // Without a full series we approximate: prior bar signal vs current bar signal.
  if (closes.length < 35) return "neutral";
  const recent = closes;
  const prior = closes.slice(0, -1);
  const macdNow = (ema(recent, 12) ?? 0) - (ema(recent, 26) ?? 0);
  const macdPrev = (ema(prior, 12) ?? 0) - (ema(prior, 26) ?? 0);
  if (macdPrev <= 0 && macdNow > 0) return "bullish_crossover";
  if (macdPrev >= 0 && macdNow < 0) return "bearish_crossover";
  return "neutral";
}

function priceVs(price: number, ma: number | null): "above" | "below" | "at" {
  if (ma === null) return "at";
  const epsilon = Math.max(Math.abs(ma) * 0.001, 1e-9);
  if (price > ma + epsilon) return "above";
  if (price < ma - epsilon) return "below";
  return "at";
}

function rsiSignal(value: number | null): "overbought" | "oversold" | "neutral" {
  if (value === null) return "neutral";
  if (value >= 70) return "overbought";
  if (value <= 30) return "oversold";
  return "neutral";
}

function volumeSignal(history: Candle[]): "above_average" | "below_average" | "average" {
  // priceService chart() does not surface volume; mark neutral until provider-native upgrade in Phase 4.
  void history;
  return "average";
}

interface TechnicalFloor {
  price: { current: number; week52High: number | null; week52Low: number | null; positionInRange: number | null };
  movingAverages: { ma50: number | null; ma200: number | null; priceVsMa50: "above" | "below" | "at"; priceVsMa200: "above" | "below" | "at" };
  rsi: { value: number | null; signal: "overbought" | "oversold" | "neutral" };
  macd: "bullish_crossover" | "bearish_crossover" | "neutral";
  volume: "above_average" | "below_average" | "average";
  keyLevels: { support: number | null; resistance: number | null };
  pattern: string | null;
  technicalView: string;
  sources: string[];
}

function buildTechnicalFloor(data: Record<string, unknown>): TechnicalFloor {
  const history = Array.isArray(data["history"]) ? (data["history"] as Candle[]) : [];
  const closes = history.map((c) => c.close).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const priceCtx = data["price"] as { priceNative?: number } | null | undefined;
  const livePrice = typeof priceCtx?.priceNative === "number" && priceCtx.priceNative > 0
    ? priceCtx.priceNative
    : (closes.length > 0 ? closes[closes.length - 1]! : 0);

  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const week52High = closes.length > 0 ? Math.max(...closes) : null;
  const week52Low = closes.length > 0 ? Math.min(...closes) : null;
  const positionInRange =
    week52High !== null && week52Low !== null && week52High > week52Low
      ? Math.max(0, Math.min(1, (livePrice - week52Low) / (week52High - week52Low)))
      : null;
  const rsiValue = rsi14(closes);
  const support = closes.length > 0 ? Math.min(...closes.slice(-30)) : null;
  const resistance = closes.length > 0 ? Math.max(...closes.slice(-30)) : null;

  return {
    price: { current: livePrice, week52High, week52Low, positionInRange },
    movingAverages: {
      ma50,
      ma200,
      priceVsMa50: priceVs(livePrice, ma50),
      priceVsMa200: priceVs(livePrice, ma200),
    },
    rsi: { value: rsiValue, signal: rsiSignal(rsiValue) },
    macd: macdSignal(closes),
    volume: volumeSignal(history),
    keyLevels: { support, resistance },
    pattern: null,
    technicalView: "Deterministic technical floor: indicators computed from price history; LLM prose unavailable.",
    sources: ["https://finance.yahoo.com/"],
  };
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function pickNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export const technicalHandler = makePromptHandler({
  kind: "analyst.technical",
  analyst: "technical",
  schema: TechnicalReportSchema,
  schemaName: "TechnicalReportSchema",
  async gatherData(step, ws) {
    const common = await gatherTechnicalData(step, ws);
    // Pre-compute deterministic indicators so the LLM only writes prose. [I1.2]
    const priceCtx = common["price"] as { priceNative?: number } | null | undefined;
    const livePrice = typeof priceCtx?.priceNative === "number" ? priceCtx.priceNative : undefined;
    const indicators = await computeTechnicalIndicators(step.ticker, livePrice);
    return { ...common, indicators };
  },
  artifactPath: persistReportArtifact("technical"),
  normalizeRaw(raw, inputs) {
    const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    // Use pre-computed indicators from gatherData when available (Phase 4).
    // Fall back to computing from history for backward compatibility.
    const indicators = inputs?.data["indicators"] as ReturnType<typeof buildTechnicalFloor> | undefined;
    const floor = indicators ?? (inputs ? buildTechnicalFloor(inputs.data) : null);
    const ticker = inputs?.step.ticker ?? (typeof obj["ticker"] === "string" ? (obj["ticker"] as string) : "UNKNOWN");

    const priceObj = obj["price"] && typeof obj["price"] === "object" ? (obj["price"] as Record<string, unknown>) : {};
    const maObj = obj["movingAverages"] && typeof obj["movingAverages"] === "object" ? (obj["movingAverages"] as Record<string, unknown>) : {};
    const rsiObj = obj["rsi"] && typeof obj["rsi"] === "object" ? (obj["rsi"] as Record<string, unknown>) : {};
    const klObj = obj["keyLevels"] && typeof obj["keyLevels"] === "object" ? (obj["keyLevels"] as Record<string, unknown>) : {};

    const price = floor?.price ?? { current: 0, week52High: null, week52Low: null, positionInRange: null };
    const ma = floor?.movingAverages ?? { ma50: null, ma200: null, priceVsMa50: "at" as const, priceVsMa200: "at" as const };
    const rsi = floor?.rsi ?? { value: null, signal: "neutral" as const };
    const kl = floor?.keyLevels ?? { support: null, resistance: null };

    const sourcesRaw = Array.isArray(obj["sources"]) ? (obj["sources"] as unknown[]) : [];
    const sources = sourcesRaw.filter((s): s is string => typeof s === "string" && /^https?:\/\//.test(s));

    return {
      ticker,
      generatedAt: typeof obj["generatedAt"] === "string" ? obj["generatedAt"] : new Date().toISOString(),
      analyst: "technical",
      price: {
        current: pickNumber(priceObj["current"], price.current),
        week52High: pickNumberOrNull(priceObj["week52High"]) ?? price.week52High,
        week52Low: pickNumberOrNull(priceObj["week52Low"]) ?? price.week52Low,
        positionInRange: pickNumberOrNull(priceObj["positionInRange"]) ?? price.positionInRange,
      },
      movingAverages: {
        ma50: pickNumberOrNull(maObj["ma50"]) ?? ma.ma50,
        ma200: pickNumberOrNull(maObj["ma200"]) ?? ma.ma200,
        priceVsMa50: pickEnum(maObj["priceVsMa50"], ["above", "below", "at"] as const, ma.priceVsMa50),
        priceVsMa200: pickEnum(maObj["priceVsMa200"], ["above", "below", "at"] as const, ma.priceVsMa200),
      },
      rsi: {
        value: pickNumberOrNull(rsiObj["value"]) ?? rsi.value,
        signal: pickEnum(rsiObj["signal"], ["overbought", "oversold", "neutral"] as const, rsi.signal),
      },
      macd: pickEnum(obj["macd"], ["bullish_crossover", "bearish_crossover", "neutral"] as const, floor?.macd ?? "neutral"),
      volume: pickEnum(obj["volume"], ["above_average", "below_average", "average"] as const, floor?.volume ?? "average"),
      keyLevels: {
        support: pickNumberOrNull(klObj["support"]) ?? kl.support,
        resistance: pickNumberOrNull(klObj["resistance"]) ?? kl.resistance,
      },
      pattern: typeof obj["pattern"] === "string" ? (obj["pattern"] as string).slice(0, 200) : null,
      technicalView: typeof obj["technicalView"] === "string" && obj["technicalView"].length > 0
        ? (obj["technicalView"] as string).slice(0, 600)
        : floor?.technicalView ?? "Deterministic technical floor: indicators computed from price history; LLM prose unavailable.",
      sources: sources.length > 0 ? sources : (floor?.sources ?? ["https://finance.yahoo.com/"]),
    };
  },
  buildUserPrompt(inputs) {
    return [
      `User: ${inputs.step.userId}`,
      `Job: ${inputs.step.jobId}`,
      `Step: ${inputs.step.id}`,
      `Ticker: ${inputs.step.ticker}`,
      "The numeric technical indicators (MA50, MA200, RSI, MACD, week52, keyLevels) have been pre-computed server-side and are provided in `indicators`. Do NOT recompute them.",
      "Your task: write the `technicalView` prose (max 600 chars) and identify the `pattern` (max 200 chars, or null) based on the provided indicators.",
      "Copy the pre-computed indicator values directly into the output JSON. Do not invent or modify numeric fields.",
      "Schema requirements: analyst='technical'; use null only where the schema allows it; sources must be valid URLs.",
      "Required JSON fields: ticker, generatedAt, analyst, price{current,week52High,week52Low,positionInRange}, movingAverages{ma50,ma200,priceVsMa50,priceVsMa200}, rsi{value,signal}, macd, volume, keyLevels{support,resistance}, pattern, technicalView, sources.",
      "Allowed enums: priceVsMa50/priceVsMa200 above|below|at; rsi.signal overbought|oversold|neutral; macd bullish_crossover|bearish_crossover|neutral; volume above_average|below_average|average.",
      JSON.stringify(inputs.data, null, 2),
    ].join("\n\n");
  },
});
