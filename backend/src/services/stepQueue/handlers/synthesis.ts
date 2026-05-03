import { StrategySchema } from "../../../schemas/strategy.js";
import { atomicWriteJson } from "../artifactIO.js";
import { gatherAnalystArtifacts, gatherCommonInputs, makePromptHandler, readJsonIfExists } from "../handlerUtils.js";

type StrategyVerdict = "BUY" | "ADD" | "HOLD" | "REDUCE" | "SELL" | "CLOSE";
type TrackingStance = "candidate" | "watch" | "pass" | "avoid";
type UrgencyLabel = "low" | "medium" | "high" | "extra_high";

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

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function urgencyLabel(score: number): UrgencyLabel {
  if (score >= 85) return "extra_high";
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function addDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function inferTrackingStance(params: {
  potentialScore: number;
  portfolioFitScore: number;
  bearVerdict: StrategyVerdict;
  bullVerdict: StrategyVerdict;
}): TrackingStance {
  if (params.bearVerdict === "SELL" || params.bearVerdict === "CLOSE") return "avoid";
  if (params.portfolioFitScore < 35 || params.potentialScore < 35) return "pass";
  if (params.potentialScore >= 70 && params.portfolioFitScore >= 55 && (params.bullVerdict === "BUY" || params.bullVerdict === "ADD")) {
    return "candidate";
  }
  return "watch";
}

function buildTrackingFields(inputs: {
  ticker: string;
  artifacts: Record<string, unknown>;
  debate: Record<string, unknown>;
  price: Record<string, unknown>;
}): Record<string, unknown> {
  const fundamentals = asRecord(inputs.artifacts["fundamentals"]);
  const technical = asRecord(inputs.artifacts["technical"]);
  const sentiment = asRecord(inputs.artifacts["sentiment"]);
  const risk = asRecord(inputs.artifacts["risk"]);
  const portfolioContext = asRecord(inputs.price["portfolioContext"]);
  const totalPortfolioILS = numberValue(portfolioContext["totalPortfolioILS"], 0);
  const bullVerdict = verdictValue(inputs.debate["bullFinalVerdict"], "HOLD");
  const bearVerdict = verdictValue(inputs.debate["bearFinalVerdict"], "HOLD");
  const valuation = asRecord(fundamentals["valuation"]);
  const price = asRecord(technical["price"]);
  const keyLevels = asRecord(technical["keyLevels"]);
  const currentPrice = numberValue(price["current"], numberValue(inputs.price["priceNative"], 0));
  const support = typeof keyLevels["support"] === "number" ? keyLevels["support"] : null;
  const resistance = typeof keyLevels["resistance"] === "number" ? keyLevels["resistance"] : null;
  const majorNews = Array.isArray(sentiment["majorNews"]) ? sentiment["majorNews"] : [];

  let potential = 50;
  if (bullVerdict === "BUY") potential += 18;
  if (bullVerdict === "ADD") potential += 12;
  if (bearVerdict === "REDUCE") potential -= 10;
  if (bearVerdict === "SELL" || bearVerdict === "CLOSE") potential -= 25;
  if (valuation["assessment"] === "cheap") potential += 10;
  if (valuation["assessment"] === "expensive") potential -= 8;
  if (sentiment["narrativeShift"] === "improving") potential += 8;
  if (sentiment["narrativeShift"] === "deteriorating") potential -= 12;
  if (majorNews.some((item) => asRecord(item)["sentiment"] === "positive")) potential += 5;
  if (majorNews.some((item) => asRecord(item)["sentiment"] === "negative")) potential -= 8;

  let portfolioFit = 55;
  if (totalPortfolioILS >= 500000) portfolioFit += 10;
  if (totalPortfolioILS > 0 && totalPortfolioILS < 50000) portfolioFit -= 15;
  if (String(risk["riskFacts"] ?? "").includes("watchlist-style")) portfolioFit -= 5;
  if (bearVerdict === "SELL" || bearVerdict === "CLOSE") portfolioFit -= 25;
  if (bullVerdict === "BUY" || bullVerdict === "ADD") portfolioFit += 5;

  let urgency = 30;
  if (currentPrice > 0 && support !== null && currentPrice <= support * 1.05) urgency += 15;
  if (currentPrice > 0 && resistance !== null && currentPrice >= resistance * 0.95) urgency += 12;
  if (sentiment["narrativeShift"] === "improving" || sentiment["narrativeShift"] === "deteriorating") urgency += 12;
  if (majorNews.length > 0) urgency += 8;
  if (bullVerdict === "BUY" || bearVerdict === "SELL") urgency += 8;

  const potentialScore = clampScore(potential);
  const portfolioFitScore = clampScore(portfolioFit);
  const urgencyScore = clampScore(urgency);
  const stance = inferTrackingStance({ potentialScore, portfolioFitScore, bearVerdict, bullVerdict });
  const allocationCapPct = totalPortfolioILS >= 500000 ? 5 : totalPortfolioILS >= 100000 ? 3 : 1.5;
  const suggestedAllocationPct =
    stance === "candidate"
      ? Math.round(Math.min(allocationCapPct, Math.max(1, portfolioFitScore / 25)) * 10) / 10
      : stance === "watch"
        ? Math.round(Math.min(allocationCapPct / 2, 1.5) * 10) / 10
        : 0;
  const suggestedAllocationILS = Math.round(totalPortfolioILS * (suggestedAllocationPct / 100) * 100) / 100;
  const actionCatalysts = [
    currentPrice > 0 && support !== null
      ? {
          description: `Reassess if ${inputs.ticker} trades near support around ${support}.`,
          expiresAt: addDays(30),
          triggered: false,
        }
      : null,
    currentPrice > 0 && resistance !== null
      ? {
          description: `Watch for confirmed breakout above resistance around ${resistance}.`,
          expiresAt: addDays(30),
          triggered: false,
        }
      : null,
    {
      description: `Refresh after the next material earnings, guidance, or analyst catalyst for ${inputs.ticker}.`,
      expiresAt: addDays(45),
      triggered: false,
    },
  ].filter((item): item is { description: string; expiresAt: string; triggered: false } => item !== null).slice(0, 5);
  const avoidConditions = [
    "Avoid if new evidence weakens the bull thesis before an entry condition is met.",
    "Avoid if the idea would exceed the suggested allocation or crowd existing portfolio risk.",
  ];
  if (valuation["assessment"] === "expensive") {
    avoidConditions.unshift("Avoid chasing if valuation expands without matching earnings or revenue evidence.");
  }

  return {
    assetScope: "tracking",
    trackingStatus: "active",
    stance,
    potentialScore,
    urgencyScore,
    urgencyLabel: urgencyLabel(urgencyScore),
    portfolioFitScore,
    suggestedAllocationPct,
    suggestedAllocationILS,
    actionCatalysts,
    avoidConditions,
    nextReviewAt: addDays(stance === "candidate" ? 14 : 30),
  };
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
  const portfolioContext = asRecord(inputs.data["portfolioContext"]);
  const isHeld = portfolioContext["isHeld"] !== false;
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
  const reasoningPrefix = isHeld
    ? `Step-queue portfolio synthesis for ${inputs.step.ticker}.`
    : `Tracked-idea synthesis for ${inputs.step.ticker}.`;
  const reasoning = [
    reasoningPrefix,
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

  const baseStrategy = {
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
      source: isHeld ? "full_report" : "deep_dive",
      status: "validated",
      generatedAt: now,
      userGuidanceApplied: false,
    },
  };

  if (isHeld) return { ...baseStrategy, assetScope: "portfolio" };

  return {
    ...baseStrategy,
    verdict: "HOLD" as StrategyVerdict,
    positionSizeILS: 0,
    positionWeightPct: 0,
    ...buildTrackingFields({
      ticker: inputs.step.ticker,
      artifacts,
      debate,
      price: {
        ...price,
        portfolioContext,
      },
    }),
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
