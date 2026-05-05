import { TechnicalReportSchema } from "../../../schemas/analysts.js";
import { gatherTechnicalData, makePromptHandler, persistReportArtifact } from "../handlerUtils.js";

function withRequiredIdentity(raw: unknown, ticker: string): unknown {
  if (!raw || typeof raw !== "object") return raw;
  return {
    ...raw as Record<string, unknown>,
    ticker,
    generatedAt: typeof (raw as Record<string, unknown>)["generatedAt"] === "string"
      ? (raw as Record<string, unknown>)["generatedAt"]
      : new Date().toISOString(),
    analyst: "technical",
  };
}

export const technicalHandler = makePromptHandler({
  kind: "analyst.technical",
  analyst: "technical",
  schema: TechnicalReportSchema,
  schemaName: "TechnicalReportSchema",
  gatherData: gatherTechnicalData,
  artifactPath: persistReportArtifact("technical"),
  normalizeRaw(raw, inputs) {
    return inputs ? withRequiredIdentity(raw, inputs.step.ticker) : raw;
  },
  buildUserPrompt(inputs) {
    return [
      `User: ${inputs.step.userId}`,
      `Job: ${inputs.step.jobId}`,
      `Step: ${inputs.step.id}`,
      `Ticker: ${inputs.step.ticker}`,
      "Analyze technical conditions from the provided live price and price-history context.",
      "You must perform the technical interpretation; the price history is reference data only.",
      "Schema requirements: analyst='technical'; use null only where the schema allows it; sources must be valid URLs.",
      "Required JSON fields: ticker, generatedAt, analyst, price{current,week52High,week52Low,positionInRange}, movingAverages{ma50,ma200,priceVsMa50,priceVsMa200}, rsi{value,signal}, macd, volume, keyLevels{support,resistance}, pattern, technicalView, sources.",
      "Allowed enums: priceVsMa50/priceVsMa200 above|below|at; rsi.signal overbought|oversold|neutral; macd bullish_crossover|bearish_crossover|neutral; volume above_average|below_average|average.",
      JSON.stringify(inputs.data, null, 2),
    ].join("\n\n");
  },
});
