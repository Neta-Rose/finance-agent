import { StrategySchema } from "../../../schemas/strategy.js";
import { atomicWriteJson } from "../artifactIO.js";
import { gatherAnalystArtifacts, gatherCommonInputs, makePromptHandler, readJsonIfExists } from "../handlerUtils.js";

export const synthesisHandler = makePromptHandler({
  kind: "synthesis",
  analyst: "synthesis",
  schema: StrategySchema,
  schemaName: "StrategySchema",
  async gatherData(step, ws) {
    return {
      ...(await gatherCommonInputs(step, ws)),
      analystArtifacts: await gatherAnalystArtifacts(ws, step.ticker),
      debate: await readJsonIfExists(ws.reportFile(step.ticker, "debate")),
    };
  },
  async artifactPath(artifact, ws, step) {
    const filePath = ws.strategyFile(step.ticker);
    await atomicWriteJson(filePath, artifact);
    return filePath;
  },
  buildUserPrompt(inputs) {
    return [
      `User: ${inputs.step.userId}`,
      `Job: ${inputs.step.jobId}`,
      `Step: ${inputs.step.id}`,
      `Ticker: ${inputs.step.ticker}`,
      "Produce the final strategy.json. Obey Clawd hard rules: down >30% with no near-term catalyst is not HOLD; up >100% needs take-profit exit conditions; HOLD needs a dated catalyst unless position weight <1%.",
      "Use live price/portfolio data for positionSizeILS and positionWeightPct. Do not use average price as current value.",
      "Schema requirements: output exactly StrategySchema JSON; metadata.source should be full_report or deep_dive where applicable.",
      JSON.stringify(inputs.data, null, 2),
    ].join("\n\n");
  },
});
