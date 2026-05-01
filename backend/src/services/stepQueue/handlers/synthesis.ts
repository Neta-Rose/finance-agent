import { StrategySchema } from "../../../schemas/strategy.js";
import { atomicWriteJson } from "../artifactIO.js";
import { gatherAnalystArtifacts, gatherCommonInputs, makePromptHandler, readJsonIfExists } from "../handlerUtils.js";

type StrategyVerdict = "BUY" | "ADD" | "HOLD" | "REDUCE" | "SELL" | "CLOSE";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function verdictValue(value: unknown, fallback: StrategyVerdict): StrategyVerdict {
  return typeof value === "string" && ["BUY", "ADD", "HOLD", "REDUCE", "SELL", "CLOSE"].includes(value)
    ? value as StrategyVerdict
    : fallback;
}

function buildStrategy(inputs: { step: { ticker: string }; data: Record<string, unknown> }) {
  const now = new Date().toISOString();
  const artifacts = asRecord(inputs.data["analystArtifacts"]);
  const risk = asRecord(artifacts["risk"]);
  const fundamentals = asRecord(artifacts["fundamentals"]);
  const technical = asRecord(artifacts["technical"]);
  const sentiment = asRecord(artifacts["sentiment"]);
  const debate = asRecord(inputs.data["debate"]);
  const price = asRecord(inputs.data["price"]);
  const positionValueILS = typeof risk["positionValueILS"] === "number" ? risk["positionValueILS"] : 0;
  const positionWeightPct = typeof risk["portfolioWeightPct"] === "number" ? risk["portfolioWeightPct"] : 0;
  const plPct = typeof risk["plPct"] === "number" ? risk["plPct"] : null;
  const bearVerdict = verdictValue(debate["bearFinalVerdict"], "HOLD");
  const bullVerdict = verdictValue(debate["bullFinalVerdict"], "HOLD");
  const forcedRiskVerdict: StrategyVerdict =
    positionWeightPct >= 25 || (plPct !== null && plPct <= -30) ? "REDUCE" : bullVerdict;
  const verdict = forcedRiskVerdict === "REDUCE" ? "REDUCE" : bearVerdict === "REDUCE" || bearVerdict === "SELL" ? "HOLD" : bullVerdict;
  const currentPrice = typeof price["priceNative"] === "number" ? price["priceNative"] : null;
  const riskFacts = stringValue(risk["riskFacts"], "Risk facts are limited.");
  const fundamentalView = stringValue(fundamentals["fundamentalView"], "Fundamental evidence is limited.");
  const technicalView = stringValue(technical["technicalView"], "Technical evidence is neutral.");
  const sentimentView = stringValue(sentiment["sentimentView"], "Sentiment evidence is stable.");
  const keyDisagreement = stringValue(debate["keyDisagreement"], "Evidence is not strong enough for a high-confidence change.");
  const reasoning = [
    `Provisional step-queue synthesis for ${inputs.step.ticker}.`,
    riskFacts,
    fundamentalView,
    technicalView,
    sentimentView,
    keyDisagreement,
  ].join(" ").slice(0, 800);
  const exitConditions = [
    "Reduce if the position exceeds the target portfolio risk budget.",
    "Reassess if fresh data invalidates the current thesis.",
  ];
  if (plPct !== null && plPct > 100) {
    exitConditions.unshift("Take partial profit if momentum fades after a gain above 100%.");
  }

  return {
    ticker: inputs.step.ticker,
    updatedAt: now,
    version: 1,
    verdict,
    confidence: "low",
    reasoning,
    timeframe: "months",
    positionSizeILS: positionValueILS,
    positionWeightPct,
    entryConditions: currentPrice === null ? [] : [`Only add after fresh confirmation near current price ${currentPrice}.`],
    exitConditions,
    catalysts: [],
    bullCase: stringValue(debate["synthesisGuidance"], fundamentalView).slice(0, 600),
    bearCase: riskFacts.slice(0, 600),
    lastDeepDiveAt: now,
    deepDiveTriggeredBy: "step_queue",
    metadata: {
      source: "full_report",
      status: "provisional",
      generatedAt: now,
      userGuidanceApplied: false,
    },
  };
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
  async callRaw(inputs) {
    return buildStrategy(inputs);
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
