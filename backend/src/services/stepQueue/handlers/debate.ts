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
  enrichArtifact(raw, inputs) {
    // Authoritative ticker from step context — guard against LLM returning wrong ticker.
    return { ...raw, ticker: inputs?.step.ticker ?? raw.ticker };
  },
  artifactPath: persistReportArtifact("debate"),
  buildUserPrompt(inputs) {
    return [
      `User: ${inputs.step.userId}`,
      `Job: ${inputs.step.jobId}`,
      `Step: ${inputs.step.id}`,
      `Ticker: ${inputs.step.ticker}`,
      "Run a real bounded bull/bear debate using the five analyst artifacts and current portfolio context.",
      "Produce exactly two bull rounds and exactly two bear rounds. Each round needs thesis/concern, evidence (1–5 items), and responseToBear/responseToBull (null for round 1).",
      "Do not mechanically summarize. Challenge weak evidence, weigh risk, and cite specific artifact claims.",
      "CRITICAL: dataPoint must be a non-empty string (max 200 chars). Never use null or a number for dataPoint.",
      "CRITICAL: responseToBear and responseToBull must be strings or null, max 300 chars each.",
      "CRITICAL: thesis and concern must be strings, max 400 chars each.",
      "Schema requirements: analyst='debate'; evidence sources must be valid URLs (https://...).",
      "Required JSON fields: ticker, generatedAt, analyst, bullRounds[2], bearRounds[2], bullFinalVerdict, bearFinalVerdict, keyDisagreement, synthesisGuidance, sources.",
      "Allowed verdict enums: BUY|ADD|HOLD|REDUCE|SELL|CLOSE.",
      JSON.stringify(inputs.data, null, 2),
    ].join("\n\n");
  },
});
