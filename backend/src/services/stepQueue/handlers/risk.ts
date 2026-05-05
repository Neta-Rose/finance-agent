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
    if (!raw || typeof raw !== "object" || !inputs) return raw;
    const computed = inputs.data["computedRiskInputs"] && typeof inputs.data["computedRiskInputs"] === "object"
      ? inputs.data["computedRiskInputs"] as Record<string, unknown>
      : {};
    const riskFacts = (raw as Record<string, unknown>)["riskFacts"];
    return {
      ...computed,
      ...raw as Record<string, unknown>,
      ticker: inputs.step.ticker,
      generatedAt: typeof (raw as Record<string, unknown>)["generatedAt"] === "string"
        ? (raw as Record<string, unknown>)["generatedAt"]
        : new Date().toISOString(),
      analyst: "risk",
      riskFacts: typeof riskFacts === "string" ? riskFacts.slice(0, 400) : String(computed["riskFacts"] ?? "").slice(0, 400),
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
