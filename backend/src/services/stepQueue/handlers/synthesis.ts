import { StrategySchema, type Strategy } from "../../../schemas/strategy.js";
import { atomicWriteJson } from "../artifactIO.js";
import { gatherAnalystArtifacts, gatherCommonInputs, makePromptHandler, readJsonIfExists } from "../handlerUtils.js";
import { dualWriteStrategy } from "../../strategyExportService.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

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
  normalizeRaw(raw, inputs) {
    // Guard: if the LLM double-serialized (returned a JSON string instead of an object),
    // attempt to parse it before proceeding. This eliminates the entire
    // "root value is a string" failure class (v5 Bug 1).
    let obj: Record<string, unknown>;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      } catch {
        obj = {};
      }
    } else if (!raw || typeof raw !== "object" || !inputs) {
      return raw;
    } else {
      obj = raw as Record<string, unknown>;
    }

    if (!inputs) return obj;

    const portfolioContext = asRecord(inputs.data["portfolioContext"]);
    const isHeld = portfolioContext["isHeld"] !== false;
    const now = new Date().toISOString();
    const metadata = asRecord(obj["metadata"]);
    return {
      ...obj,
      ticker: inputs.step.ticker,
      updatedAt: typeof obj["updatedAt"] === "string" ? obj["updatedAt"] : now,
      deepDiveTriggeredBy: "step_queue",
      metadata: {
        ...metadata,
        source: isHeld ? "full_report" : "deep_dive",
        status: metadata["status"] ?? "validated",
        generatedAt: typeof metadata["generatedAt"] === "string" ? metadata["generatedAt"] : now,
        userGuidanceApplied: metadata["userGuidanceApplied"] === true,
      },
      assetScope: isHeld ? "portfolio" : (obj["assetScope"] ?? "tracking"),
    };
  },
  async artifactPath(artifact, ws, step) {
    const filePath = ws.strategyFile(step.ticker);
    await atomicWriteJson(filePath, artifact);
    await dualWriteStrategy(artifact as Strategy, step.userId);
    return filePath;
  },
  buildUserPrompt(inputs) {
    return [
      `User: ${inputs.step.userId}`,
      `Job: ${inputs.step.jobId}`,
      `Step: ${inputs.step.id}`,
      `Ticker: ${inputs.step.ticker}`,
      "Produce the final strategy.json from the analyst artifacts and debate. This is a model synthesis step, not a template fill.",
      "Obey Clawd hard rules: down >30% with no near-term catalyst is not HOLD; up >100% needs take-profit exit conditions; HOLD needs a dated catalyst unless position weight <1%.",
      "Use live price/portfolio data for positionSizeILS and positionWeightPct. Do not use average price as current value.",
      "For non-held tracked ideas, include tracking fields: trackingStatus, stance, potentialScore, urgencyScore, urgencyLabel, portfolioFitScore, suggestedAllocationPct, suggestedAllocationILS, actionCatalysts, avoidConditions, nextReviewAt.",
      "Schema requirements: output exactly StrategySchema JSON; metadata.source must be full_report for held portfolio positions and deep_dive for non-held tracked ideas.",
      "Required JSON fields: ticker, updatedAt, version, verdict, confidence, reasoning, timeframe, positionSizeILS, positionWeightPct, entryConditions, exitConditions, catalysts, bullCase, bearCase, lastDeepDiveAt, deepDiveTriggeredBy, metadata, assetScope.",
      "Allowed enums: verdict BUY|ADD|HOLD|REDUCE|SELL|CLOSE; confidence high|medium|low; timeframe week|months|years|long_term|undefined; assetScope portfolio|tracking.",
      JSON.stringify(inputs.data, null, 2),
    ].join("\n\n");
  },
});
