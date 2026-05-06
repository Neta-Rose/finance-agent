import { promises as fs } from "fs";
import type { UserWorkspace } from "../../middleware/userIsolation.js";
import { listPortfolioTickers } from "../baselineCoverageService.js";
import { listTrackedAssets } from "../trackedAssetService.js";
import { loadStrategyFile } from "../strategyFileService.js";
import { readStrategy } from "../strategyStore.js";
import { isApplicationDatabaseConfigured } from "../../db/applicationDataSource.js";
import { getEnabledStepKinds } from "../analystConfigService.js";
import {
  ANALYST_STEP_KINDS,
  STEP_KINDS,
  type ExpandedJobWork,
  type ExpandedTickerWork,
  type JobAction,
  type StepKind,
} from "./types.js";

const FULL_DEEP_DIVE_STEPS: StepKind[] = [...STEP_KINDS].filter(
  (k) => k !== "quick_check.evaluate" && k !== "tracking.evaluate" && k !== "chat_agent"
);
const LIGHT_PASS_STEPS: StepKind[] = [...ANALYST_STEP_KINDS];
const QUICK_CHECK_STEPS: StepKind[] = ["quick_check.evaluate"];
const TRACKING_STEPS: StepKind[] = ["tracking.evaluate"];

/**
 * Asset-class-aware step-kind selection (M2.2, M2.3).
 * Also filters by the user's enabled analyst config.
 */
export function selectStepKindsForAssetClass(
  assetClass: string,
  fullDeepDive: boolean,
  enabledStepKinds?: Set<StepKind>
): StepKind[] {
  if (!fullDeepDive) {
    const lightPass = [...LIGHT_PASS_STEPS];
    return enabledStepKinds
      ? lightPass.filter((k) => enabledStepKinds.has(k))
      : lightPass;
  }

  let base = [...FULL_DEEP_DIVE_STEPS];
  if (assetClass === "bond" || assetClass === "etf") {
    base = base.filter((k) => k !== "analyst.technical");
  }
  return enabledStepKinds
    ? base.filter((k) => enabledStepKinds.has(k))
    : base;
}

/**
 * Resolve the asset class for a ticker from the strategies table (DB-first)
 * or fall back to "equity".
 */
async function resolveAssetClass(userId: string, ticker: string): Promise<string> {
  if (!isApplicationDatabaseConfigured()) return "equity";
  try {
    const record = await readStrategy(userId, ticker);
    return record?.assetClass ?? "equity";
  } catch {
    return "equity";
  }
}

export interface ExpansionOptions {
  action: JobAction;
  ticker?: string | undefined;
  escalationTickers?: ReadonlySet<string>;
}

async function strategyRequiresFullDeepDive(
  ws: UserWorkspace,
  ticker: string,
  escalationTickers: ReadonlySet<string>
): Promise<boolean> {
  if (escalationTickers.has(ticker)) return true;

  try {
    await fs.access(ws.strategyFile(ticker));
  } catch {
    return true;
  }

  const loaded = await loadStrategyFile(ws.strategyFile(ticker), {
    repair: false,
    tickerHint: ticker,
  });
  if (!loaded.valid || !loaded.strategy) return true;
  return loaded.strategy.lastDeepDiveAt === null;
}

export async function expandStepQueueJob(
  ws: UserWorkspace,
  options: ExpansionOptions
): Promise<ExpandedJobWork> {
  const escalationTickers = options.escalationTickers ?? new Set<string>();

  // deep_dive: single ticker, full pipeline with asset-class dispatch
  if (options.action === "deep_dive") {
    const ticker = options.ticker;
    if (!ticker) throw new Error("deep_dive requires a ticker");
    const assetClass = await resolveAssetClass(ws.userId, ticker);
    const enabledStepKinds = await getEnabledStepKinds(ws.userId);
    const stepKinds = selectStepKindsForAssetClass(assetClass, true, enabledStepKinds);
    return {
      action: options.action,
      tickers: [{
        ticker,
        position: 0,
        fullDeepDive: true,
        stepKinds,
      }],
    };
  }

  // full_report: all held tickers, mix of light-pass and full deep-dive
  if (options.action === "full_report") {
    const tickers = await listPortfolioTickers(ws);
    const enabledStepKinds = await getEnabledStepKinds(ws.userId);
    const expanded: ExpandedTickerWork[] = [];
    for (const [index, ticker] of tickers.entries()) {
      const fullDeepDive = await strategyRequiresFullDeepDive(ws, ticker, escalationTickers);
      const assetClass = await resolveAssetClass(ws.userId, ticker);
      const stepKinds = selectStepKindsForAssetClass(assetClass, fullDeepDive, enabledStepKinds);
      expanded.push({
        ticker,
        position: index,
        fullDeepDive,
        stepKinds,
      });
    }
    return { action: options.action, tickers: expanded };
  }

  // daily_brief: quick_check for each held position + tracking.evaluate for each tracked asset
  if (options.action === "daily_brief") {
    const [heldTickers, trackedAssets] = await Promise.all([
      listPortfolioTickers(ws),
      listTrackedAssets(ws.userId),
    ]);
    const expanded: ExpandedTickerWork[] = [];
    let position = 0;
    for (const ticker of heldTickers) {
      expanded.push({
        ticker,
        position: position++,
        fullDeepDive: false,
        stepKinds: QUICK_CHECK_STEPS,
      });
    }
    for (const asset of trackedAssets.filter((a) => a.status === "active")) {
      expanded.push({
        ticker: asset.ticker,
        position: position++,
        fullDeepDive: false,
        stepKinds: TRACKING_STEPS,
      });
    }
    return { action: options.action, tickers: expanded };
  }

  // quick_check: single ticker
  if (options.action === "quick_check") {
    const ticker = options.ticker;
    if (!ticker) throw new Error("quick_check requires a ticker");
    return {
      action: options.action,
      tickers: [{
        ticker,
        position: 0,
        fullDeepDive: false,
        stepKinds: QUICK_CHECK_STEPS,
      }],
    };
  }

  // Fallback for any future action
  return { action: options.action, tickers: [] };
}
