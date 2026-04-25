import { promises as fs } from "fs";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import {
  assessStrategyBaselineForTicker,
  type StrategyTrustLevel,
} from "./strategyBaselineService.js";
import { readState, transitionState, writeState } from "./stateService.js";

export interface BaselineCoverageTicker {
  ticker: string;
  trustLevel: StrategyTrustLevel;
  issues: string[];
}

export interface BaselineCoverageSummary {
  totalTickers: number;
  valid: number;
  stale: number;
  provisional: number;
  invalid: number;
  completedTickers: string[];
  blockingTickers: BaselineCoverageTicker[];
  refreshCandidates: BaselineCoverageTicker[];
  tickers: BaselineCoverageTicker[];
}

export function isBaselineTrustCovered(trustLevel: StrategyTrustLevel): boolean {
  return trustLevel === "valid" || trustLevel === "stale";
}

export async function listPortfolioTickers(ws: UserWorkspace): Promise<string[]> {
  const raw = await fs.readFile(ws.portfolioFile, "utf-8");
  const portfolio = PortfolioFileSchema.parse(JSON.parse(raw));
  const ordered = Object.values(portfolio.accounts)
    .flat()
    .map((position) => position.ticker);
  return Array.from(new Set(ordered));
}

export async function summarizeBaselineCoverage(
  ws: UserWorkspace,
  tickers?: string[]
): Promise<BaselineCoverageSummary> {
  const orderedTickers = tickers ?? (await listPortfolioTickers(ws));
  const assessments = await Promise.all(
    orderedTickers.map(async (ticker) => {
      const assessment = await assessStrategyBaselineForTicker(ws, ticker);
      return {
        ticker,
        trustLevel: assessment.trustLevel,
        issues: assessment.issues,
      } satisfies BaselineCoverageTicker;
    })
  );

  const summary: BaselineCoverageSummary = {
    totalTickers: assessments.length,
    valid: 0,
    stale: 0,
    provisional: 0,
    invalid: 0,
    completedTickers: [],
    blockingTickers: [],
    refreshCandidates: [],
    tickers: assessments,
  };

  for (const item of assessments) {
    if (item.trustLevel === "valid") {
      summary.valid += 1;
      summary.completedTickers.push(item.ticker);
      continue;
    }
    if (item.trustLevel === "stale") {
      summary.stale += 1;
      summary.completedTickers.push(item.ticker);
      summary.refreshCandidates.push(item);
      continue;
    }
    if (item.trustLevel === "provisional") {
      summary.provisional += 1;
      summary.blockingTickers.push(item);
      continue;
    }
    summary.invalid += 1;
    summary.blockingTickers.push(item);
  }

  return summary;
}

export async function syncStateToBaselineCoverage(
  ws: UserWorkspace,
  options?: {
    lastFullReportAt?: string | null;
    enqueueBlockingTickers?: boolean;
  }
): Promise<BaselineCoverageSummary> {
  const summary = await summarizeBaselineCoverage(ws);
  const current = await readState(ws.userId);
  const updates: Parameters<typeof writeState>[1] = {};

  const hasBootstrapProgress = current.state === "BOOTSTRAPPING" || current.bootstrapProgress !== null;
  if (hasBootstrapProgress) {
    updates.bootstrapProgress = {
      total: summary.totalTickers,
      completed: summary.completedTickers.length,
      completedTickers: summary.completedTickers,
    };
  }

  if (options?.lastFullReportAt) {
    updates.lastFullReportAt = options.lastFullReportAt;
  }

  if (options?.enqueueBlockingTickers && summary.blockingTickers.length > 0) {
    const pending = new Set(current.pendingDeepDives ?? []);
    for (const item of summary.blockingTickers) {
      pending.add(item.ticker);
    }
    updates.pendingDeepDives = Array.from(pending);
  }

  if (Object.keys(updates).length > 0) {
    await writeState(ws.userId, updates);
  }

  if (current.state === "BOOTSTRAPPING" && summary.blockingTickers.length === 0) {
    await transitionState(ws.userId, "ACTIVE", "baseline_coverage_completed");
    await writeState(ws.userId, { bootstrapProgress: null });
  }

  return summary;
}
