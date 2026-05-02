import { promises as fs } from "fs";
import type { z } from "zod";
import type { UserWorkspace } from "../../../middleware/userIsolation.js";
import { RiskReportSchema } from "../../../schemas/analysts.js";
import { PortfolioFileSchema } from "../../../schemas/portfolio.js";
import type { BuiltPrompt, StepHandler, StepInputs, ValidationResult } from "../handlers.js";
import { persistReportArtifact, validateWithSchema } from "../handlerUtils.js";
import type { ClaimedStepWorkItem, ModelTier } from "../types.js";

type RiskArtifact = z.infer<typeof RiskReportSchema>;

async function buildRiskArtifact(step: ClaimedStepWorkItem, ws: UserWorkspace): Promise<RiskArtifact> {
  const portfolio = PortfolioFileSchema.parse(JSON.parse(await fs.readFile(ws.portfolioFile, "utf-8")));
  const usdIlsRate = 3.7;
  const allPositions = Object.entries(portfolio.accounts).flatMap(([account, positions]) =>
    positions.map((position) => ({ account, ...position }))
  );
  const targetPositions = allPositions.filter((position) => position.ticker === step.ticker);
  if (targetPositions.length === 0) throw new Error(`Ticker ${step.ticker} is not in portfolio`);

  const positionCostBasisILS = (position: typeof allPositions[number]) => {
    const avgPriceILS = position.exchange === "TASE"
      ? position.unitAvgBuyPrice
      : position.unitAvgBuyPrice * usdIlsRate;
    return avgPriceILS * position.shares;
  };
  const totalValueILS = allPositions.reduce((sum, position) => sum + positionCostBasisILS(position), 0);
  const first = targetPositions[0]!;
  const totalShares = targetPositions.reduce((sum, position) => sum + position.shares, 0);
  const avgPricePaid =
    targetPositions.reduce((sum, position) => sum + position.unitAvgBuyPrice * position.shares, 0) /
    Math.max(totalShares, 1);
  const avgPriceILS = first.exchange === "TASE" ? avgPricePaid : avgPricePaid * usdIlsRate;
  const costBasisILS = avgPriceILS * totalShares;
  const positionValueILS = costBasisILS;
  const plILS = positionValueILS - costBasisILS;
  const plPct = costBasisILS > 0 ? (plILS / costBasisILS) * 100 : 0;
  const portfolioWeightPct = totalValueILS > 0 ? (positionValueILS / totalValueILS) * 100 : 0;

  return {
    ticker: step.ticker,
    generatedAt: new Date().toISOString(),
    analyst: "risk",
    livePrice: avgPricePaid,
    livePriceCurrency: first.exchange === "TASE" ? "ILS" : "USD",
    livePriceSource: "portfolio_cost_basis_proxy",
    shares: {
      main: targetPositions.filter((position) => position.account === "main").reduce((sum, position) => sum + position.shares, 0),
      second: targetPositions.filter((position) => position.account !== "main").reduce((sum, position) => sum + position.shares, 0),
      total: totalShares,
    },
    positionValueILS,
    portfolioWeightPct,
    plILS,
    plPct,
    avgPricePaid,
    concentrationFlag: portfolioWeightPct >= 20,
    riskFacts: `Deterministic risk snapshot using portfolio cost basis and fixed USD/ILS fallback ${usdIlsRate} to avoid blocking on external providers. Weight ${portfolioWeightPct.toFixed(1)}%, proxy P/L ${plPct.toFixed(1)}%, total shares ${totalShares}.`,
  };
}

export const riskHandler: StepHandler<RiskArtifact> = {
  kind: "analyst.risk",
  async gatherInputs(step: ClaimedStepWorkItem, ws: UserWorkspace): Promise<StepInputs> {
    return {
      step,
      workspace: ws,
      gatheredAt: new Date().toISOString(),
      data: {
        artifact: await buildRiskArtifact(step, ws),
      },
    };
  },
  buildPrompt(): BuiltPrompt {
    return {
      system: "Deterministic risk handler; no LLM prompt is used.",
      user: "Deterministic risk handler; no LLM prompt is used.",
      schema: RiskReportSchema,
    };
  },
  async call(_prompt: BuiltPrompt, _model: { tier: ModelTier; primary: string; fallback: string | null }, _step?: ClaimedStepWorkItem, inputs?: StepInputs): Promise<unknown> {
    if (!inputs) throw new Error("Risk handler requires gathered inputs");
    return inputs.data["artifact"];
  },
  validate(raw: unknown): ValidationResult<RiskArtifact> {
    return validateWithSchema(RiskReportSchema, raw);
  },
  async persistArtifact(artifact: RiskArtifact, ws: UserWorkspace, step: ClaimedStepWorkItem): Promise<string> {
    return persistReportArtifact<RiskArtifact>("risk")(artifact, ws, step);
  },
};
