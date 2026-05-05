import { promises as fs } from "fs";
import type { z } from "zod";
import { RiskReportSchema } from "../../../schemas/analysts.js";
import { PortfolioFileSchema } from "../../../schemas/portfolio.js";
import { gatherCommonInputs, makePromptHandler, persistReportArtifact } from "../handlerUtils.js";
import type { ClaimedStepWorkItem } from "../types.js";

type RiskArtifact = z.infer<typeof RiskReportSchema>;

async function computeRiskInputs(step: ClaimedStepWorkItem, portfolioPath: string): Promise<RiskArtifact> {
  const portfolio = PortfolioFileSchema.parse(JSON.parse(await fs.readFile(portfolioPath, "utf-8")));
  const usdIlsRate = 3.7;
  const allPositions = Object.entries(portfolio.accounts).flatMap(([account, positions]) =>
    positions.map((position) => ({ account, ...position }))
  );
  const positionCostBasisILS = (position: typeof allPositions[number]) => {
    const avgPriceILS = position.exchange === "TASE"
      ? position.unitAvgBuyPrice
      : position.unitAvgBuyPrice * usdIlsRate;
    return avgPriceILS * position.shares;
  };
  const totalValueILS = allPositions.reduce((sum, position) => sum + positionCostBasisILS(position), 0);
  const targetPositions = allPositions.filter((position) => position.ticker === step.ticker);
  if (targetPositions.length === 0) {
    return {
      ticker: step.ticker,
      generatedAt: new Date().toISOString(),
      analyst: "risk",
      livePrice: 0,
      livePriceCurrency: "USD",
      livePriceSource: "not_in_portfolio",
      shares: { main: 0, second: 0, total: 0 },
      positionValueILS: 0,
      portfolioWeightPct: 0,
      plILS: 0,
      plPct: 0,
      avgPricePaid: 0,
      concentrationFlag: false,
      riskFacts: `Ticker ${step.ticker} is not currently held in this portfolio. Use this as input, then write an analyst risk assessment.`,
    };
  }

  const first = targetPositions[0]!;
  const totalShares = targetPositions.reduce((sum, position) => sum + position.shares, 0);
  const avgPricePaid =
    targetPositions.reduce((sum, position) => sum + position.unitAvgBuyPrice * position.shares, 0) /
    Math.max(totalShares, 1);
  const avgPriceILS = first.exchange === "TASE" ? avgPricePaid : avgPricePaid * usdIlsRate;
  const costBasisILS = avgPriceILS * totalShares;
  const portfolioWeightPct = totalValueILS > 0 ? (costBasisILS / totalValueILS) * 100 : 0;

  return {
    ticker: step.ticker,
    generatedAt: new Date().toISOString(),
    analyst: "risk",
    livePrice: avgPricePaid,
    livePriceCurrency: first.exchange === "TASE" ? "ILS" : "USD",
    livePriceSource: "portfolio_cost_basis_reference",
    shares: {
      main: targetPositions.filter((position) => position.account === "main").reduce((sum, position) => sum + position.shares, 0),
      second: targetPositions.filter((position) => position.account !== "main").reduce((sum, position) => sum + position.shares, 0),
      total: totalShares,
    },
    positionValueILS: costBasisILS,
    portfolioWeightPct,
    plILS: 0,
    plPct: 0,
    avgPricePaid,
    concentrationFlag: portfolioWeightPct >= 20,
    riskFacts: `Reference risk inputs: weight ${portfolioWeightPct.toFixed(1)}%, shares ${totalShares}, average paid ${avgPricePaid}. Explain concentration, downside, and sizing risk from these inputs.`,
  };
}

function pickFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pickInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return fallback;
}

function pickStringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export const riskHandler = makePromptHandler({
  kind: "analyst.risk",
  analyst: "risk",
  schema: RiskReportSchema,
  schemaName: "RiskReportSchema",
  async gatherData(step, ws) {
    return {
      ...(await gatherCommonInputs(step, ws)),
      computedRiskInputs: await computeRiskInputs(step, ws.portfolioFile),
    };
  },
  artifactPath: persistReportArtifact("risk"),
  normalizeRaw(raw, inputs) {
    const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const computed = (inputs?.data["computedRiskInputs"] && typeof inputs.data["computedRiskInputs"] === "object"
      ? inputs.data["computedRiskInputs"]
      : {}) as Partial<RiskArtifact>;

    const ticker = inputs?.step.ticker ?? (typeof obj["ticker"] === "string" ? (obj["ticker"] as string) : computed.ticker ?? "UNKNOWN");

    const sharesObj = obj["shares"] && typeof obj["shares"] === "object" ? (obj["shares"] as Record<string, unknown>) : {};
    const computedShares = computed.shares ?? { main: 0, second: 0, total: 0 };

    const riskFactsRaw = obj["riskFacts"];
    const riskFacts = typeof riskFactsRaw === "string" && riskFactsRaw.length > 0
      ? riskFactsRaw.slice(0, 400)
      : (computed.riskFacts ?? "Deterministic risk floor: numeric fields computed from portfolio; LLM prose unavailable.").slice(0, 400);

    return {
      ticker,
      generatedAt: typeof obj["generatedAt"] === "string" ? obj["generatedAt"] : new Date().toISOString(),
      analyst: "risk",
      livePrice: pickFiniteNumber(obj["livePrice"], computed.livePrice ?? 0),
      livePriceCurrency: pickStringOrFallback(obj["livePriceCurrency"], computed.livePriceCurrency ?? "USD"),
      livePriceSource: pickStringOrFallback(obj["livePriceSource"], computed.livePriceSource ?? "portfolio_cost_basis_reference"),
      shares: {
        main: pickInt(sharesObj["main"], computedShares.main),
        second: pickInt(sharesObj["second"], computedShares.second),
        total: pickInt(sharesObj["total"], computedShares.total),
      },
      positionValueILS: pickFiniteNumber(obj["positionValueILS"], computed.positionValueILS ?? 0),
      portfolioWeightPct: pickFiniteNumber(obj["portfolioWeightPct"], computed.portfolioWeightPct ?? 0),
      plILS: pickFiniteNumber(obj["plILS"], computed.plILS ?? 0),
      plPct: pickFiniteNumber(obj["plPct"], computed.plPct ?? 0),
      avgPricePaid: pickFiniteNumber(obj["avgPricePaid"], computed.avgPricePaid ?? 0),
      concentrationFlag: typeof obj["concentrationFlag"] === "boolean"
        ? (obj["concentrationFlag"] as boolean)
        : (computed.concentrationFlag ?? false),
      riskFacts,
    };
  },
  buildUserPrompt(inputs) {
    return [
      `User: ${inputs.step.userId}`,
      `Job: ${inputs.step.jobId}`,
      `Step: ${inputs.step.id}`,
      `Ticker: ${inputs.step.ticker}`,
      "Analyze portfolio risk for this position. Use computedRiskInputs and live portfolio context as the source of truth for numeric sizing fields.",
      "You must perform risk interpretation; do not merely echo the computed inputs.",
      "Schema requirements: analyst='risk'; all numeric fields are required; riskFacts must be a concise analyst risk assessment.",
      "Required JSON fields: ticker, generatedAt, analyst, livePrice, livePriceCurrency, livePriceSource, shares{main,second,total}, positionValueILS, portfolioWeightPct, plILS, plPct, avgPricePaid, concentrationFlag, riskFacts.",
      "Copy required numeric/share fields from computedRiskInputs unless live context provides a better current value. Keep riskFacts under 400 characters.",
      JSON.stringify(inputs.data, null, 2),
    ].join("\n\n");
  },
});
