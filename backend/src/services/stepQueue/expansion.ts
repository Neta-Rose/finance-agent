import { promises as fs } from "fs";
import type { UserWorkspace } from "../../middleware/userIsolation.js";
import { listPortfolioTickers } from "../baselineCoverageService.js";
import { listTrackedAssets } from "../trackedAssetService.js";
import { loadStrategyFile } from "../strategyFileService.js";
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

  // deep_dive: single ticker, full pipeline
  if (options.action === "deep_dive") {
    const ticker = options.ticker;
    if (!ticker) throw new Error("deep_dive requires a ticker");
    return {
      action: options.action,
      tickers: [{
        ticker,
        position: 0,
        fullDeepDive: true,
        stepKinds: FULL_DEEP_DIVE_STEPS,
      }],
    };
  }

  // full_report: all held tickers, mix of light-pass and full deep-dive
  if (options.action === "full_report") {
    const tickers = await listPortfolioTickers(ws);
    const expanded: ExpandedTickerWork[] = [];
    for (const [index, ticker] of tickers.entries()) {
      const fullDeepDive = await strategyRequiresFullDeepDive(ws, ticker, escalationTickers);
      expanded.push({
        ticker,
        position: index,
        fullDeepDive,
        stepKinds: fullDeepDive ? FULL_DEEP_DIVE_STEPS : LIGHT_PASS_STEPS,
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
