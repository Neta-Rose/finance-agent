import { promises as fs } from "fs";
import path from "path";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { Job, JsonValue } from "../types/index.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import { getPricesParallel, getUsdIlsRate } from "./priceService.js";
import { performQuickCheck, type QuickCheckOutcome } from "./quickCheckService.js";
import { updateJob } from "./jobService.js";
import { readState, writeState } from "./stateService.js";
import { getUserPlan } from "./profileService.js";
import { publishNotification } from "./notificationService.js";

export type DailyBriefTruthState =
  | "calm_trusted"
  | "action_needed"
  | "coverage_incomplete"
  | "confidence_degraded";

interface DailyBriefEntry {
  ticker: string;
  currentILS: number;
  quickCheck: QuickCheckOutcome;
}

interface DailyBriefNarrative {
  truthState: DailyBriefTruthState;
  headline: string;
  today: string;
  tomorrow: string;
  marketView: string;
  securityNote: string;
  dashboardPath: string;
}

export interface DailyBriefResult {
  generatedAt: string;
  truthState: DailyBriefTruthState;
  totalChecked: number;
  escalated: number;
  onTrack: number;
  summary: DailyBriefNarrative;
  highlights: string[];
  tickers: Array<{
    ticker: string;
    score: number;
    needsEscalation: boolean;
    escalationReason: string | null;
    verdict: string;
    confidence: string;
  }>;
}

const DEFAULT_AUTO_DEEP_DIVE_LIMIT = Number(process.env["DAILY_BRIEF_AUTO_DEEP_DIVE_LIMIT"] ?? 1);

interface DailyBriefTruthSummary {
  truthState: DailyBriefTruthState;
  valid: number;
  provisional: number;
  stale: number;
  invalid: number;
  escalated: Array<{ ticker: string; reason: string | null }>;
}

function formatEscalations(items: Array<{ ticker: string; reason: string | null }>, limit = 3): string {
  return items
    .slice(0, limit)
    .map((item) => `${item.ticker}: ${item.reason ?? "needs deeper review now"}`)
    .join(" | ");
}

export function classifyDailyBriefTruth(entries: DailyBriefEntry[]): DailyBriefTruthSummary {
  let valid = 0;
  let provisional = 0;
  let stale = 0;
  let invalid = 0;

  for (const entry of entries) {
    switch (entry.quickCheck.baseline_trust) {
      case "valid":
        valid += 1;
        break;
      case "provisional":
        provisional += 1;
        break;
      case "stale":
        stale += 1;
        break;
      case "invalid":
        invalid += 1;
        break;
    }
  }

  const escalated = entries
    .filter((entry) => entry.quickCheck.needs_escalation)
    .map((entry) => ({
      ticker: entry.ticker,
      reason: entry.quickCheck.escalation_reason,
    }));

  let truthState: DailyBriefTruthState;
  if (invalid > 0 || provisional > 0) {
    truthState = "coverage_incomplete";
  } else if (escalated.length > 0) {
    truthState = "action_needed";
  } else if (stale > 0) {
    truthState = "confidence_degraded";
  } else {
    truthState = "calm_trusted";
  }

  return {
    truthState,
    valid,
    provisional,
    stale,
    invalid,
    escalated,
  };
}

export function buildDailyBriefNarrative(
  result: Omit<DailyBriefResult, "truthState" | "summary" | "highlights">,
  truth: DailyBriefTruthSummary
): DailyBriefNarrative {
  const topEscalations = result.tickers.filter((item) => item.needsEscalation).slice(0, 4);
  const strongest = result.tickers
    .filter((item) => !item.needsEscalation)
    .slice(0, 3)
    .map((item) => item.ticker);

  let headline: string;
  let today: string;
  let tomorrow: string;
  let marketView: string;
  let securityNote: string;

  if (truth.truthState === "coverage_incomplete") {
    const missing = truth.invalid + truth.provisional;
    headline = `Coverage is incomplete today. ${missing} monitored position${missing === 1 ? "" : "s"} still need a trustworthy baseline before the portfolio can be called calm.`;
    today =
      truth.escalated.length > 0
        ? `Act on the live pressure first: ${formatEscalations(truth.escalated, 2)}. Separate from that, baseline coverage is still incomplete on part of the monitored slice.`
        : `No calm call today: ${missing} monitored position${missing === 1 ? "" : "s"} still have missing or provisional strategy coverage.`;
    tomorrow = `Tomorrow the priority is to complete baseline coverage before leaning on routine calm-vs-action messaging.`;
    marketView = `From your portfolio’s angle, the issue is trust coverage, not just market movement: the system is still missing enough validated baseline context on part of the monitored slice.`;
    securityNote = `You are not being given false reassurance. The brief is withholding a calm verdict until baseline coverage is complete.`;
  } else if (truth.truthState === "action_needed") {
    headline = `${result.escalated} monitored position${result.escalated === 1 ? "" : "s"} need action today while ${truth.valid} ${truth.valid === 1 ? "position remains" : "positions remain"} under trusted coverage.`;
    today = `Today’s pressure points are ${formatEscalations(truth.escalated)}.`;
    tomorrow = `Tomorrow the focus is finishing deeper review on ${topEscalations.map((item) => item.ticker).join(", ")} and confirming whether any thesis updates are needed.`;
    marketView = `From your portfolio’s angle, risk is concentrated rather than broad: most monitored names are stable, but the flagged positions need immediate follow-through.`;
    securityNote =
      strongest.length > 0
        ? `Trusted coverage remains in place for ${strongest.join(", ")} while the out-of-tolerance names are escalated instead of being smoothed over.`
        : `Trusted coverage is intact on the non-flagged slice, and the out-of-tolerance names are escalated instead of being ignored.`;
  } else if (truth.truthState === "confidence_degraded") {
    headline = `Coverage is running, but confidence is degraded today. ${truth.stale} monitored position${truth.stale === 1 ? "" : "s"} have stale strategy baselines.`;
    today = `There is no clean calm verdict yet because part of the monitored slice needs a strategy refresh before the brief can speak with full confidence.`;
    tomorrow = `Tomorrow the priority is refreshing the stale baselines so routine monitoring can return to a trustworthy calm-vs-action read.`;
    marketView = `From your portfolio’s angle, the market picture may be fine, but strategy freshness is lagging behind current conditions.`;
    securityNote = `The brief is staying honest: it is not calling the portfolio calm while baseline confidence is degraded.`;
  } else {
    headline = `Portfolio check is calm today. ${result.totalChecked} monitored position${result.totalChecked === 1 ? "" : "s"} are covered by trusted baseline strategy.`;
    today = `Today there are no urgent thesis breaks across the monitored slice. Core holdings are holding their planned posture under trusted coverage.`;
    tomorrow = `Tomorrow the priority is routine monitoring only unless prices, catalysts, or news create a new escalation trigger.`;
    marketView = `From your portfolio’s angle, the current backdrop supports the plan: no concentrated stress is showing up in the monitored holdings and baseline coverage is healthy.`;
    securityNote =
      strongest.length > 0
        ? `You are not flying blind: ${strongest.join(", ")} remain aligned with plan, and the monitored slice is covered by trusted baseline strategy.`
        : `You are not flying blind: the monitored slice remains within plan and backed by trusted baseline coverage.`;
  }

  return {
    truthState: truth.truthState,
    headline,
    today,
    tomorrow,
    marketView,
    securityNote,
    dashboardPath: "/portfolio",
  };
}

export function buildDailyHighlights(
  result: Omit<DailyBriefResult, "truthState" | "summary" | "highlights">,
  truth: DailyBriefTruthSummary
): string[] {
  const highlights: string[] = [];
  if (truth.truthState === "coverage_incomplete") {
    highlights.push("Coverage incomplete");
    highlights.push(`${truth.invalid + truth.provisional}/${result.totalChecked} need baseline trust`);
  } else if (truth.truthState === "confidence_degraded") {
    highlights.push("Confidence degraded");
    highlights.push(`${truth.stale}/${result.totalChecked} baselines are stale`);
  } else if (truth.truthState === "action_needed") {
    highlights.push("Action needed");
    highlights.push(`${result.escalated} escalated for review`);
  } else {
    highlights.push("Calm with trusted coverage");
    highlights.push(`${result.onTrack}/${result.totalChecked} on track`);
  }

  if (result.escalated > 0) {
    for (const item of result.tickers.filter((entry) => entry.needsEscalation).slice(0, 2)) {
      highlights.push(`${item.ticker} needs attention`);
    }
  } else if (truth.truthState === "calm_trusted") {
    highlights.push("No urgent thesis breaks");
  }
  return highlights.slice(0, 4);
}

export function selectDailyBriefAutoDeepDiveTickers(
  entries: DailyBriefEntry[],
  limit = DEFAULT_AUTO_DEEP_DIVE_LIMIT
): string[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];

  return entries
    .filter((entry) => entry.quickCheck.needs_escalation)
    .sort((left, right) => {
      if (left.quickCheck.score !== right.quickCheck.score) {
        return left.quickCheck.score - right.quickCheck.score;
      }
      return right.currentILS - left.currentILS;
    })
    .slice(0, limit)
    .map((entry) => entry.ticker);
}

async function topPortfolioTickers(
  ws: UserWorkspace,
  limit: number
): Promise<Array<{ ticker: string; currentILS: number }>> {
  const raw = await fs.readFile(ws.portfolioFile, "utf-8");
  const portfolio = PortfolioFileSchema.parse(JSON.parse(raw));
  const usdIlsRate = await getUsdIlsRate();
  const flat = Object.values(portfolio.accounts).flat();
  const unique = Array.from(
    new Map(flat.map((pos) => [`${pos.ticker}:${pos.exchange}`, pos])).values()
  );
  const prices = await getPricesParallel(
    unique.map((pos) => ({ ticker: pos.ticker, exchange: pos.exchange })),
    usdIlsRate
  );

  const totals = new Map<string, number>();
  for (const pos of flat) {
    const livePriceILS = prices.get(pos.ticker)?.priceILS ?? 0;
    const currentILS = livePriceILS * pos.shares;
    totals.set(pos.ticker, (totals.get(pos.ticker) ?? 0) + currentILS);
  }

  return Array.from(totals.entries())
    .map(([ticker, currentILS]) => ({ ticker, currentILS }))
    .sort((a, b) => b.currentILS - a.currentILS)
    .slice(0, limit === Number.POSITIVE_INFINITY ? undefined : limit);
}

export async function getDailyBriefCoverageLimit(ws: UserWorkspace): Promise<number> {
  const plan = await getUserPlan(ws.userId);
  if (plan === "pro") return Number.POSITIVE_INFINITY;
  return 10;
}

async function appendDailyBriefBatch(
  ws: UserWorkspace,
  job: Job,
  result: DailyBriefResult
): Promise<void> {
  const batchId = `batch_${job.id}_daily_brief`;
  const indexDir = path.join(ws.reportsDir, "index");
  await fs.mkdir(indexDir, { recursive: true });

  const metaPath = path.join(indexDir, "meta.json");
  let meta: {
    totalBatches: number;
    totalPages: number;
    lastUpdated: string | null;
    newestBatchId: string | null;
    pageSize?: number;
  } = {
    totalBatches: 0,
    totalPages: 1,
    lastUpdated: null,
    newestBatchId: null,
    pageSize: 10,
  };
  try {
    meta = JSON.parse(await fs.readFile(metaPath, "utf-8")) as typeof meta;
  } catch {}

  const pagePath = path.join(indexDir, "page-001.json");
  let page: {
    page: number;
    totalPages: number;
    batches: Array<{ batchId: string } & Record<string, unknown>>;
  } = {
    page: 1,
    totalPages: 1,
    batches: [],
  };
  try {
    page = JSON.parse(await fs.readFile(pagePath, "utf-8")) as typeof page;
  } catch {}

  page.batches = page.batches.filter((entry) => entry.batchId !== batchId);
  page.batches.unshift({
    batchId,
    triggeredAt: result.generatedAt,
    date: result.generatedAt.slice(0, 10),
    mode: "daily_brief",
    tickers: result.tickers.map((item) => item.ticker),
    tickerCount: result.tickers.length,
    jobId: job.id,
    summary: {
      truthState: result.summary.truthState,
      headline: result.summary.headline,
      today: result.summary.today,
      tomorrow: result.summary.tomorrow,
      marketView: result.summary.marketView,
      securityNote: result.summary.securityNote,
      dashboardPath: result.summary.dashboardPath,
    },
    highlights: result.highlights,
    entries: Object.fromEntries(
      result.tickers.map((item) => [
        item.ticker,
        {
          ticker: item.ticker,
          mode: "daily_brief",
          verdict: item.verdict,
          confidence: item.confidence,
          reasoning: item.escalationReason ?? "On track",
          timeframe: "immediate",
          analystTypes: ["quick_check"],
          hasBullCase: false,
          hasBearCase: false,
        },
      ])
    ),
  });
  page.batches = page.batches.slice(0, meta.pageSize ?? 10);

  meta.totalBatches = Math.max(meta.totalBatches, page.batches.length);
  meta.totalPages = 1;
  meta.lastUpdated = result.generatedAt;
  meta.newestBatchId = batchId;

  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  await fs.writeFile(pagePath, JSON.stringify(page, null, 2), "utf-8");

  const escalatedTickers = result.tickers
    .filter((item) => item.needsEscalation)
    .slice(0, 4)
    .map((item) => item.ticker);

  await publishNotification({
    userId: ws.userId,
    category: "daily_brief",
    title: "Daily brief",
    body:
      escalatedTickers.length > 0
        ? `${result.summary.headline} Today: ${result.summary.today}`
        : `${result.summary.headline} ${result.summary.securityNote}`,
    ticker: result.tickers[0]?.ticker ?? null,
    batchId,
  });
}

export async function runDailyBriefJob(
  ws: UserWorkspace,
  job: Job
): Promise<Job> {
  const startedAt = new Date().toISOString();
  await updateJob(ws, job.id, {
    status: "running",
    started_at: startedAt,
  });

  try {
    const state = await readState(ws.userId);
    if (state.state !== "ACTIVE") {
      throw new Error("Portfolio is not active for daily briefs");
    }

    const coverageLimit = await getDailyBriefCoverageLimit(ws);
    const topTickers = await topPortfolioTickers(ws, coverageLimit);
    const entries: DailyBriefEntry[] = [];
    for (const item of topTickers) {
      const quickCheck = await performQuickCheck(ws, item.ticker, { queueDeepDive: false });
      entries.push({
        ticker: item.ticker,
        currentILS: item.currentILS,
        quickCheck,
      });
    }

    const autoQueueTickers = new Set(selectDailyBriefAutoDeepDiveTickers(entries));
    for (const entry of entries) {
      if (!autoQueueTickers.has(entry.ticker)) continue;
      entry.quickCheck = await performQuickCheck(ws, entry.ticker, { queueDeepDive: true });
    }

    const baseResult = {
      generatedAt: new Date().toISOString(),
      totalChecked: entries.length,
      escalated: entries.filter((entry) => entry.quickCheck.needs_escalation).length,
      onTrack: entries.filter((entry) => !entry.quickCheck.needs_escalation).length,
      tickers: entries
        .sort((a, b) => b.currentILS - a.currentILS)
        .map((entry) => ({
          ticker: entry.ticker,
          score: entry.quickCheck.score,
          needsEscalation: entry.quickCheck.needs_escalation,
          escalationReason: entry.quickCheck.escalation_reason,
          verdict: entry.quickCheck.verdict,
          confidence: entry.quickCheck.confidence,
        })),
    };
    const truth = classifyDailyBriefTruth(entries);
    const result: DailyBriefResult = {
      ...baseResult,
      truthState: truth.truthState,
      summary: buildDailyBriefNarrative(baseResult, truth),
      highlights: buildDailyHighlights(baseResult, truth),
    };

    const completed = await updateJob(ws, job.id, {
      status: "completed",
      completed_at: result.generatedAt,
      result: result as unknown as JsonValue,
      error: null,
    });

    await appendDailyBriefBatch(ws, completed, result);
    await writeState(ws.userId, { lastDailyAt: result.generatedAt });
    return completed;
  } catch (err) {
    return updateJob(ws, job.id, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: err instanceof Error ? err.message.slice(0, 490) : "Daily brief failed",
    });
  }
}
