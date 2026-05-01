import { promises as fs } from "fs";
import type { UserWorkspace } from "../../middleware/userIsolation.js";
import { listPortfolioTickers } from "../baselineCoverageService.js";
import { loadStrategyFile } from "../strategyFileService.js";
import {
  ANALYST_STEP_KINDS,
  STEP_KINDS,
  type ExpandedJobWork,
  type ExpandedTickerWork,
  type JobAction,
  type StepKind,
} from "./types.js";

const FULL_DEEP_DIVE_STEPS: StepKind[] = [...STEP_KINDS];
const LIGHT_PASS_STEPS: StepKind[] = [...ANALYST_STEP_KINDS];

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
  const tickers =
    options.action === "deep_dive"
      ? [options.ticker]
      : await listPortfolioTickers(ws);

  const normalizedTickers = tickers.filter((ticker): ticker is string => typeof ticker === "string" && ticker.length > 0);
  const expanded: ExpandedTickerWork[] = [];

  for (const [index, ticker] of normalizedTickers.entries()) {
    const fullDeepDive =
      options.action === "deep_dive" ||
      (await strategyRequiresFullDeepDive(ws, ticker, escalationTickers));
    expanded.push({
      ticker,
      position: index,
      fullDeepDive,
      stepKinds: fullDeepDive ? FULL_DEEP_DIVE_STEPS : LIGHT_PASS_STEPS,
    });
  }

  return {
    action: options.action,
    tickers: expanded,
  };
}
