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
  normalizeRaw(raw, inputs) {
    if (!raw || typeof raw !== "object" || !inputs) return raw;
    return {
      ...raw as Record<string, unknown>,
      ticker: inputs.step.ticker,
      generatedAt: typeof (raw as Record<string, unknown>)["generatedAt"] === "string"
        ? (raw as Record<string, unknown>)["generatedAt"]
        : new Date().toISOString(),
      analyst: "debate",
    };
  },
  artifactPath: persistReportArtifact("debate"),
  buildUserPrompt(inputs) {
    return [
      `User: ${inputs.step.userId}`,
      `Job: ${inputs.step.jobId}`,
      `Step: ${inputs.step.id}`,
      `Ticker: ${inputs.step.ticker}`,
      "Run a real bounded bull/bear debate using the five analyst artifacts and current portfolio context.",
      "Produce two concise bull rounds, two concise bear rounds, final verdicts from each side, key disagreement, and synthesis guidance.",
      "Do not mechanically summarize. Challenge weak evidence, weigh risk, and cite specific artifact claims.",
      "Schema requirements: analyst='debate'; evidence sources must be valid URLs.",
      "Required JSON fields: ticker, generatedAt, analyst, bullRounds[2], bearRounds[2], bullFinalVerdict, bearFinalVerdict, keyDisagreement, synthesisGuidance, sources.",
      "Each bull round needs round, thesis, evidence[{source,claim,dataPoint}], responseToBear. Each bear round needs round, concern, evidence[{source,claim,dataPoint}], responseToBull.",
      "Allowed verdict enums: BUY|ADD|HOLD|REDUCE|SELL|CLOSE.",
      JSON.stringify(inputs.data, null, 2),
    ].join("\n\n");
  },
});
