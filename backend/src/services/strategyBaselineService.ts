import { promises as fs } from "fs";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import {
  StrategySchema,
  type Strategy,
  type StrategyMetadata,
} from "../schemas/index.js";
import type { Exchange } from "../types/index.js";
import { getPrice, getUsdIlsRate } from "./priceService.js";

const STALE_DAYS_BY_TIMEFRAME: Record<Strategy["timeframe"], number> = {
  week: 14,
  months: 120,
  long_term: 365,
  undefined: 60,
};

export type StrategyTrustLevel = "valid" | "provisional" | "stale" | "invalid";

export interface StrategyBaselineAssessment {
  trustLevel: StrategyTrustLevel;
  strategy: Strategy | null;
  issues: string[];
  isPortfolioTicker: boolean;
}

interface PortfolioPositionSnapshot {
  found: boolean;
  exchange: Exchange | null;
  shares: number;
  currentILS: number | null;
  weightPct: number | null;
}

export function buildStrategyMetadata(
  source: StrategyMetadata["source"],
  status: StrategyMetadata["status"],
  generatedAt: string,
  userGuidanceApplied = false
): StrategyMetadata {
  return {
    source,
    status,
    generatedAt,
    userGuidanceApplied,
  };
}

function isRecent(isoDate: string | null, days: number): boolean {
  if (!isoDate) return false;
  const parsed = new Date(isoDate).getTime();
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= days * 24 * 60 * 60 * 1000;
}

function hasFutureCatalyst(strategy: Strategy): boolean {
  return (strategy.catalysts ?? []).some(
    (c) => c.expiresAt !== null && !c.triggered && new Date(c.expiresAt).getTime() >= Date.now()
  );
}

function inferMetadata(strategy: Strategy): StrategyMetadata {
  if (strategy.metadata) return strategy.metadata;

  const placeholderReasoning =
    strategy.reasoning === "Pending initial analysis" ||
    strategy.reasoning === "Pending exploratory deep dive analysis";

  if (placeholderReasoning) {
    return buildStrategyMetadata(
      strategy.deepDiveTriggeredBy === "manual_exploration" ? "manual_exploration" : "bootstrap",
      "provisional",
      strategy.updatedAt,
      false
    );
  }

  if (strategy.deepDiveTriggeredBy === "new_ideas") {
    return buildStrategyMetadata("new_ideas", "validated", strategy.updatedAt, false);
  }

  if (strategy.lastDeepDiveAt !== null) {
    return buildStrategyMetadata("deep_dive", "validated", strategy.updatedAt, false);
  }

  return buildStrategyMetadata("migration", "validated", strategy.updatedAt, false);
}

function isPlaceholderStrategy(strategy: Strategy): boolean {
  return (
    strategy.reasoning === "Pending initial analysis" ||
    strategy.reasoning === "Pending exploratory deep dive analysis" ||
    strategy.timeframe === "undefined"
  );
}

function classifyTrustLevel(strategy: Strategy, issues: string[]): StrategyTrustLevel {
  const metadata = inferMetadata(strategy);

  if (metadata.status === "provisional" || isPlaceholderStrategy(strategy)) {
    return "provisional";
  }

  if (!hasFutureCatalyst(strategy)) {
    issues.push("Strategy has no future-dated catalyst");
  }

  if (strategy.lastDeepDiveAt === null) {
    issues.push("Strategy has never recorded a deep dive");
    return "provisional";
  }

  const stalenessWindow = STALE_DAYS_BY_TIMEFRAME[strategy.timeframe] ?? 90;
  if (!isRecent(strategy.updatedAt, stalenessWindow)) {
    issues.push(`Strategy baseline is older than ${stalenessWindow} days`);
    return "stale";
  }

  if (strategy.confidence === "low" && !isRecent(strategy.lastDeepDiveAt, 30)) {
    issues.push("Low-confidence strategy has not been refreshed recently");
    return "stale";
  }

  if (!hasFutureCatalyst(strategy) && !isRecent(strategy.lastDeepDiveAt, 90)) {
    issues.push("Strategy lacks forward catalyst coverage and recent deep-dive refresh");
    return "stale";
  }

  return "valid";
}

async function readPortfolioPosition(
  ws: UserWorkspace,
  ticker: string
): Promise<PortfolioPositionSnapshot> {
  try {
    const raw = await fs.readFile(ws.portfolioFile, "utf-8");
    const portfolio = PortfolioFileSchema.parse(JSON.parse(raw));
    const usdIlsRate = await getUsdIlsRate();

    let shares = 0;
    let exchange: Exchange | null = null;
    let totalPortfolioILS = 0;
    const positions = Object.values(portfolio.accounts).flat();
    const priceByTicker = new Map<string, number>();

    for (const pos of positions) {
      if (pos.ticker === ticker) {
        exchange = pos.exchange;
        shares += pos.shares;
      }
      if (!priceByTicker.has(pos.ticker)) {
        const price = await getPrice(pos.ticker, pos.exchange, usdIlsRate);
        priceByTicker.set(pos.ticker, price.priceILS);
      }
    }

    if (!exchange || shares <= 0) {
      return {
        found: false,
        exchange: null,
        shares: 0,
        currentILS: null,
        weightPct: null,
      };
    }

    for (const pos of positions) {
      totalPortfolioILS += (priceByTicker.get(pos.ticker) ?? 0) * pos.shares;
    }

    const currentILS = (priceByTicker.get(ticker) ?? 0) * shares;
    const weightPct =
      currentILS > 0 && totalPortfolioILS > 0
        ? Math.round((currentILS / totalPortfolioILS) * 10000) / 100
        : null;

    return {
      found: true,
      exchange,
      shares,
      currentILS: Math.round(currentILS * 100) / 100,
      weightPct,
    };
  } catch {
    return {
      found: false,
      exchange: null,
      shares: 0,
      currentILS: null,
      weightPct: null,
    };
  }
}

export async function assessStrategyBaselineForTicker(
  ws: UserWorkspace,
  ticker: string
): Promise<StrategyBaselineAssessment> {
  const strategyPath = ws.strategyFile(ticker);
  let raw: string;

  try {
    raw = await fs.readFile(strategyPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        trustLevel: "invalid",
        strategy: null,
        issues: ["Strategy file not found"],
        isPortfolioTicker: false,
      };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      trustLevel: "invalid",
      strategy: null,
      issues: [`Invalid strategy JSON: ${err instanceof Error ? err.message : String(err)}`],
      isPortfolioTicker: false,
    };
  }

  const result = StrategySchema.safeParse(parsed);
  if (!result.success) {
    return {
      trustLevel: "invalid",
      strategy: null,
      issues: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
      isPortfolioTicker: false,
    };
  }

  const portfolioPosition = await readPortfolioPosition(ws, ticker);
  const issues: string[] = [];
  const strategy: Strategy = {
    ...result.data,
    entryConditions: [...(result.data.entryConditions ?? [])],
    exitConditions: [...(result.data.exitConditions ?? [])],
    catalysts: [...(result.data.catalysts ?? [])],
    metadata: inferMetadata(result.data),
  };

  if (!portfolioPosition.found) {
    issues.push("Ticker not found in portfolio");
  } else {
    if (
      portfolioPosition.currentILS !== null &&
      portfolioPosition.currentILS > 0 &&
      strategy.positionSizeILS !== portfolioPosition.currentILS
    ) {
      strategy.positionSizeILS = portfolioPosition.currentILS;
      issues.push("Strategy position size is stale relative to portfolio");
    }

    if (
      portfolioPosition.weightPct !== null &&
      strategy.positionWeightPct !== portfolioPosition.weightPct
    ) {
      strategy.positionWeightPct = portfolioPosition.weightPct;
      issues.push("Strategy position weight is stale relative to portfolio");
    }
  }

  const trustLevel = classifyTrustLevel(strategy, issues);
  return {
    trustLevel,
    strategy,
    issues,
    isPortfolioTicker: portfolioPosition.found,
  };
}
