import { FundamentalsReportSchema } from "../../../schemas/analysts.js";
import { gatherCommonInputs, makePromptHandler, persistReportArtifact } from "../handlerUtils.js";
import { getFundamentalsFacts } from "../../dataSources/fundamentalsSource.js";

/**
 * fundamentals handler — Phase 4 synthesizer.
 *
 * Deterministic facts (EPS, revenue, P/E, analyst consensus) are fetched
 * server-side from yahoo-finance2. The LLM produces only `fundamentalView`
 * prose. [I1.1]
 */

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

export const fundamentalsHandler = makePromptHandler({
  kind: "analyst.fundamentals",
  analyst: "fundamentals",
  schema: FundamentalsReportSchema,
  schemaName: "FundamentalsReportSchema",
  gatherData: async (step, ws) => {
    const common = await gatherCommonInputs(step, ws);
    // Pre-compute deterministic fundamentals facts. [I1.1]
    const position = common["position"] as { exchange?: string } | null | undefined;
    const exchange = position?.exchange ?? "NYSE";
    const fundamentalsFacts = await getFundamentalsFacts(step.ticker, exchange);
    return { ...common, fundamentalsFacts };
  },
  artifactPath: persistReportArtifact("fundamentals"),
  normalizeRaw(raw, inputs) {
    const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const valuation = obj["valuation"] && typeof obj["valuation"] === "object" ? obj["valuation"] as Record<string, unknown> : {};
    const consensus = obj["analystConsensus"] && typeof obj["analystConsensus"] === "object" ? obj["analystConsensus"] as Record<string, unknown> : {};
    return {
      ticker: typeof obj["ticker"] === "string" ? obj["ticker"] : inputs?.step.ticker,
      generatedAt: typeof obj["generatedAt"] === "string" ? obj["generatedAt"] : new Date().toISOString(),
      analyst: "fundamentals",
      earnings: {
        result: "unknown",
        epsActual: null,
        epsExpected: null,
        revenueActualM: null,
        revenueExpectedM: null,
        ...(obj["earnings"] && typeof obj["earnings"] === "object" ? obj["earnings"] as Record<string, unknown> : {}),
      },
      revenueGrowthYoY: typeof obj["revenueGrowthYoY"] === "number" ? obj["revenueGrowthYoY"] : null,
      marginTrend: enumValue(obj["marginTrend"], ["improving", "declining", "stable", "unknown"] as const, "unknown"),
      guidance: enumValue(obj["guidance"], ["raised", "lowered", "maintained", "unknown"] as const, "unknown"),
      valuation: {
        pe: typeof valuation["pe"] === "number" ? valuation["pe"] : null,
        sectorAvgPe: typeof valuation["sectorAvgPe"] === "number" ? valuation["sectorAvgPe"] : null,
        assessment: enumValue(valuation["assessment"], ["cheap", "fair", "expensive", "unknown"] as const, "unknown"),
      },
      analystConsensus: {
        buy: typeof consensus["buy"] === "number" ? consensus["buy"] : 0,
        hold: typeof consensus["hold"] === "number" ? consensus["hold"] : 0,
        sell: typeof consensus["sell"] === "number" ? consensus["sell"] : 0,
        avgTargetPrice: typeof consensus["avgTargetPrice"] === "number" ? consensus["avgTargetPrice"] : null,
        currency: typeof consensus["currency"] === "string" ? consensus["currency"] : "unknown",
      },
      balanceSheet: enumValue(obj["balanceSheet"], ["healthy", "concerning", "unknown"] as const, "unknown"),
      insiderActivity: enumValue(obj["insiderActivity"], ["buying", "selling", "none", "unknown"] as const, "unknown"),
      fundamentalView: typeof obj["fundamentalView"] === "string" ? obj["fundamentalView"] : "Low-cost model returned partial fundamentals; missing fields were defaulted to unknown.",
      sources: (() => {
        const raw = Array.isArray(obj["sources"]) ? (obj["sources"] as unknown[]) : [];
        const valid = raw.filter((s): s is string => typeof s === "string" && /^https?:\/\//.test(s));
        return valid.length > 0 ? valid : ["https://finance.yahoo.com/"];
      })(),
    };
  },
  buildUserPrompt(inputs) {
    return [
      `User: ${inputs.step.userId}`,
      `Job: ${inputs.step.jobId}`,
      `Step: ${inputs.step.id}`,
      `Ticker: ${inputs.step.ticker}`,
      "Deterministic fundamentals facts (EPS, revenue, P/E, analyst consensus) are pre-computed in `fundamentalsFacts`. Copy them into the output JSON.",
      "Your task: write the `fundamentalView` prose (max 600 chars) interpreting the fundamentals.",
      "Schema requirements: analyst='fundamentals'; include every required key. For unavailable numeric data use null. For enums use unknown where allowed. sources must be valid URLs.",
      JSON.stringify(inputs.data, null, 2),
    ].join("\n\n");
  },
});
