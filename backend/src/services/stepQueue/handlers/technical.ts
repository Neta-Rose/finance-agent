import { TechnicalReportSchema } from "../../../schemas/analysts.js";
import { gatherTechnicalData, makePromptHandler, persistReportArtifact } from "../handlerUtils.js";
import { computeTechnicalIndicators } from "../../dataSources/marketDataSource.js";

/**
 * technical handler — Phase 4 synthesizer.
 *
 * Deterministic indicators (MA50/MA200/RSI/MACD/week52/keyLevels) are pre-computed
 * server-side from price history and passed in inputs.data["indicators"]. The LLM
 * copies them verbatim and writes `technicalView` prose + `pattern` enum. [I1.2]
 */

export const technicalHandler = makePromptHandler({
  kind: "analyst.technical",
  analyst: "technical",
  schema: TechnicalReportSchema,
  schemaName: "TechnicalReportSchema",
  async gatherData(step, ws) {
    const common = await gatherTechnicalData(step, ws);
    const priceCtx = common["price"] as { priceNative?: number } | null | undefined;
    const livePrice = typeof priceCtx?.priceNative === "number" ? priceCtx.priceNative : undefined;
    const indicators = await computeTechnicalIndicators(step.ticker, livePrice);
    return { ...common, indicators };
  },
  artifactPath: persistReportArtifact("technical"),
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
