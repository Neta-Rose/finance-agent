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

export const fundamentalsHandler = makePromptHandler({
  kind: "analyst.fundamentals",
  analyst: "fundamentals",
  schema: FundamentalsReportSchema,
  schemaName: "FundamentalsReportSchema",
  gatherData: async (step, ws) => {
    const common = await gatherCommonInputs(step, ws);
    const position = common["position"] as { exchange?: string } | null | undefined;
    const exchange = position?.exchange ?? "NYSE";
    const fundamentalsFacts = await getFundamentalsFacts(step.ticker, exchange);
    return { ...common, fundamentalsFacts };
  },
  artifactPath: persistReportArtifact("fundamentals"),
  enrichArtifact(raw, inputs) {
    // Authoritative ticker from step context — guard against LLM returning a missing or wrong ticker.
    return { ...raw, ticker: inputs?.step.ticker ?? raw.ticker };
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
