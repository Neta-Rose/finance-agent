import { FundamentalsReportSchema } from "../../../schemas/analysts.js";
import { gatherCommonInputs, makePromptHandler, persistReportArtifact } from "../handlerUtils.js";

export const fundamentalsHandler = makePromptHandler({
  kind: "analyst.fundamentals",
  analyst: "fundamentals",
  schema: FundamentalsReportSchema,
  schemaName: "FundamentalsReportSchema",
  gatherData: gatherCommonInputs,
  artifactPath: persistReportArtifact("fundamentals"),
  buildUserPrompt(inputs) {
    return [
      `User: ${inputs.step.userId}`,
      `Job: ${inputs.step.jobId}`,
      `Step: ${inputs.step.id}`,
      `Ticker: ${inputs.step.ticker}`,
      "Analyze fundamentals from the provided portfolio, price, and current strategy context.",
      "Schema requirements: analyst='fundamentals'; sources must be valid URLs; use unknown/null where data is unavailable.",
      JSON.stringify(inputs.data, null, 2),
    ].join("\n\n");
  },
});
