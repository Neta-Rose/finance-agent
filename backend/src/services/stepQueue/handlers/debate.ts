import { DebateReportSchema } from "../../../schemas/analysts.js";
import { gatherAnalystArtifacts, gatherCommonInputs, makePromptHandler, persistReportArtifact } from "../handlerUtils.js";

export const debateHandler = makePromptHandler({
  kind: "debate",
  analyst: "debate",
  schema: DebateReportSchema,
  schemaName: "DebateReportSchema",
  async gatherData(step, ws) {
    return {
      ...(await gatherCommonInputs(step, ws)),
      analystArtifacts: await gatherAnalystArtifacts(ws, step.ticker),
    };
  },
  artifactPath: persistReportArtifact("debate"),
  buildUserPrompt(inputs) {
    return [
      `User: ${inputs.step.userId}`,
      `Job: ${inputs.step.jobId}`,
      `Step: ${inputs.step.id}`,
      `Ticker: ${inputs.step.ticker}`,
      "Run a bounded bull/bear debate using only the five analyst artifacts and current portfolio context.",
      "Produce two concise bull rounds, two concise bear rounds, final verdicts from each side, and synthesis guidance.",
      "Schema requirements: analyst='debate'; evidence sources must be valid URLs.",
      JSON.stringify(inputs.data, null, 2),
    ].join("\n\n");
  },
});
