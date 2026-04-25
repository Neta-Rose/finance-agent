import { promises as fs } from "fs";
import path from "path";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { Job, JsonValue, Confidence, Verdict } from "../types/index.js";
import { validateReportFile, validateStrategyFile } from "./validationService.js";
import { updateJob } from "./jobService.js";
import { publishNotification } from "./notificationService.js";
import {
  isBaselineTrustCovered,
  listPortfolioTickers,
  summarizeBaselineCoverage,
  syncStateToBaselineCoverage,
} from "./baselineCoverageService.js";
import type { StrategyTrustLevel } from "./strategyBaselineService.js";

const FULL_REPORT_STEPS = [
  {
    key: "fundamentals",
    label: "Fundamentals",
    filename: "fundamentals.json",
    analyst: "fundamentals",
  },
  {
    key: "technical",
    label: "Technical Analysis",
    filename: "technical.json",
    analyst: "technical",
  },
  {
    key: "sentiment",
    label: "Sentiment",
    filename: "sentiment.json",
    analyst: "sentiment",
  },
  {
    key: "macro",
    label: "Macro",
    filename: "macro.json",
    analyst: "macro",
  },
  {
    key: "risk",
    label: "Portfolio Risk",
    filename: "risk.json",
    analyst: "risk",
  },
] as const;

interface FullReportTickerState {
  ticker: string;
  status: "pending" | "completed";
  completedSteps: number;
  totalSteps: number;
  currentStep: string | null;
  strategyReady: boolean;
  baselineTrust: StrategyTrustLevel;
}

interface FullReportState {
  version: 1;
  jobId: string;
  status: "running" | "completed" | "failed";
  triggeredAt: string;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  totalTickers: number;
  completedTickers: string[];
  remainingTickers: string[];
  currentTicker: string | null;
  currentStep: string | null;
  completedSteps: number;
  totalSteps: number;
  failureReason?: string | null;
  tickers: FullReportTickerState[];
}

interface StrategySnapshot {
  verdict: Verdict;
  confidence: Confidence;
  reasoning: string;
  timeframe: string;
}

function statePath(ws: UserWorkspace): string {
  return path.join(ws.reportsDir, "full_report_state.json");
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function scanTicker(
  ws: UserWorkspace,
  ticker: string,
  triggeredAt: string
): Promise<{
  ticker: string;
  completedSteps: number;
  currentStep: string | null;
  strategyReady: boolean;
}> {
  const cutoff = new Date(triggeredAt).getTime();
  let completedSteps = 0;
  let currentStep: string | null = null;

  for (const step of FULL_REPORT_STEPS) {
    const filePath = path.join(ws.reportsDir, ticker, step.filename);
    try {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs < cutoff) {
        currentStep = step.label;
        break;
      }
      const validation = await validateReportFile(filePath, step.analyst);
      if (!validation.valid) {
        currentStep = step.label;
        break;
      }
      completedSteps += 1;
    } catch {
      currentStep = step.label;
      break;
    }
  }

  let strategyReady = false;
  try {
    const stat = await fs.stat(ws.strategyFile(ticker));
    if (stat.mtimeMs >= cutoff) {
      const validation = await validateStrategyFile(ws.strategyFile(ticker));
      strategyReady = validation.valid;
    }
  } catch {}

  return {
    ticker,
    completedSteps,
    currentStep,
    strategyReady,
  };
}

async function buildState(
  ws: UserWorkspace,
  job: Job,
  tickers: string[]
): Promise<FullReportState> {
  const startedAt = job.started_at ?? new Date().toISOString();
  const [artifactStates, baselineCoverage] = await Promise.all([
    Promise.all(tickers.map((ticker) => scanTicker(ws, ticker, job.triggered_at))),
    summarizeBaselineCoverage(ws, tickers),
  ]);
  const baselineByTicker = new Map(
    baselineCoverage.tickers.map((item) => [item.ticker, item])
  );
  const tickerStates: FullReportTickerState[] = artifactStates.map((artifactState) => {
    const baseline = baselineByTicker.get(artifactState.ticker);
    const baselineTrust = baseline?.trustLevel ?? "invalid";
    const baselineCovered = isBaselineTrustCovered(baselineTrust);
    const strategyComplete = artifactState.completedSteps === FULL_REPORT_STEPS.length;
    const currentStep =
      artifactState.currentStep ??
      (artifactState.strategyReady
        ? baselineCovered
          ? null
          : "Baseline validation"
        : "Strategy validation");
    const completedSteps =
      strategyComplete && baselineCovered
        ? FULL_REPORT_STEPS.length + 1
        : artifactState.completedSteps;
    const totalSteps = FULL_REPORT_STEPS.length + 1;
    const status =
      strategyComplete && baselineCovered ? "completed" : "pending";
    return {
      ticker: artifactState.ticker,
      status,
      completedSteps,
      totalSteps,
      currentStep: status === "completed" ? null : currentStep,
      strategyReady: artifactState.strategyReady,
      baselineTrust,
    };
  });
  const completedTickers = tickerStates
    .filter((ticker) => ticker.status === "completed")
    .map((ticker) => ticker.ticker);
  const remainingTickers = tickerStates
    .filter((ticker) => ticker.status !== "completed")
    .map((ticker) => ticker.ticker);
  const activeTicker = tickerStates.find((ticker) => ticker.status !== "completed") ?? null;
  const completedAt =
    remainingTickers.length === 0 ? new Date().toISOString() : null;

  return {
    version: 1,
    jobId: job.id,
    status: remainingTickers.length === 0 ? "completed" : "running",
    triggeredAt: job.triggered_at,
    startedAt,
    updatedAt: new Date().toISOString(),
    completedAt,
    totalTickers: tickers.length,
    completedTickers,
    remainingTickers,
    currentTicker: activeTicker?.ticker ?? null,
    currentStep: activeTicker?.currentStep ?? null,
    completedSteps: tickerStates.reduce((sum, ticker) => sum + ticker.completedSteps, 0),
    totalSteps: tickerStates.reduce((sum, ticker) => sum + ticker.totalSteps, 0),
    tickers: tickerStates,
  };
}

async function writeFullReportState(ws: UserWorkspace, state: FullReportState): Promise<void> {
  await fs.mkdir(ws.reportsDir, { recursive: true });
  await fs.writeFile(statePath(ws), JSON.stringify(state, null, 2), "utf-8");
}

async function writeLegacyProgressFile(
  ws: UserWorkspace,
  state: FullReportState
): Promise<void> {
  const progressPath = path.join(ws.reportsDir, "progress.json");
  if (state.status === "completed") {
    try {
      await fs.unlink(progressPath);
    } catch {}
    return;
  }

  await fs.writeFile(
    progressPath,
    JSON.stringify(
      {
        startedAt: state.startedAt,
        totalTickers: state.totalTickers,
        completed: state.completedTickers,
        failed: [],
        remaining: state.remainingTickers,
      },
      null,
      2
    ),
    "utf-8"
  );
}

async function readStrategySnapshot(
  ws: UserWorkspace,
  ticker: string
): Promise<StrategySnapshot | null> {
  const raw = await readJsonIfExists<Record<string, unknown>>(ws.strategyFile(ticker));
  if (!raw) return null;
  if (
    typeof raw["verdict"] !== "string" ||
    typeof raw["confidence"] !== "string" ||
    typeof raw["reasoning"] !== "string" ||
    typeof raw["timeframe"] !== "string"
  ) {
    return null;
  }
  return {
    verdict: raw["verdict"] as Verdict,
    confidence: raw["confidence"] as Confidence,
    reasoning: raw["reasoning"] as string,
    timeframe: raw["timeframe"] as string,
  };
}

async function appendFullReportBatch(
  ws: UserWorkspace,
  job: Job,
  tickers: string[]
): Promise<void> {
  const indexDir = path.join(ws.reportsDir, "index");
  await fs.mkdir(indexDir, { recursive: true });
  const batchId = `batch_${job.id}_full_report`;

  const entries = Object.fromEntries(
    (
      await Promise.all(
        tickers.map(async (ticker) => [ticker, await readStrategySnapshot(ws, ticker)] as const)
      )
    )
      .filter((entry) => entry[1] !== null)
      .map(([ticker, strategy]) => [
        ticker,
        {
          ticker,
          mode: "full_report",
          verdict: strategy!.verdict,
          confidence: strategy!.confidence,
          reasoning: strategy!.reasoning,
          timeframe: strategy!.timeframe,
          analystTypes: ["fundamentals", "technical", "sentiment", "macro", "risk"],
          hasBullCase: false,
          hasBearCase: false,
        },
      ])
  );

  const metaPath = path.join(indexDir, "meta.json");
  const pagePath = path.join(indexDir, "page-001.json");
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
    triggeredAt: job.completed_at ?? job.triggered_at,
    date: (job.completed_at ?? job.triggered_at).slice(0, 10),
    mode: "full_report",
    tickers,
    tickerCount: tickers.length,
    jobId: job.id,
    entries,
  });
  page.batches = page.batches.slice(0, meta.pageSize ?? 10);

  meta.totalBatches = Math.max(meta.totalBatches, page.batches.length);
  meta.totalPages = 1;
  meta.lastUpdated = job.completed_at ?? job.triggered_at;
  meta.newestBatchId = batchId;

  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  await fs.writeFile(pagePath, JSON.stringify(page, null, 2), "utf-8");

  await publishNotification({
    userId: ws.userId,
    category: "report",
    title: "Full report",
    body: `Refreshed ${tickers.length} ticker${tickers.length === 1 ? "" : "s"}.`,
    ticker: tickers[0] ?? null,
    batchId,
  });
}

async function updateBootstrapState(
  ws: UserWorkspace,
  state: FullReportState
): Promise<void> {
  await syncStateToBaselineCoverage(ws, {
    lastFullReportAt: state.status === "completed" ? state.completedAt : null,
    enqueueBlockingTickers: state.status === "completed",
  });
}

export async function initializeFullReportJob(
  ws: UserWorkspace,
  job: Job
): Promise<Job> {
  if (job.action !== "full_report") return job;

  const tickers = await listPortfolioTickers(ws);
  const state = await buildState(ws, job, tickers);
  await writeFullReportState(ws, state);
  await writeLegacyProgressFile(ws, state);
  await updateBootstrapState(ws, state);

  const nextJob = await updateJob(ws, job.id, {
    status: state.status === "completed" ? "completed" : "pending",
    started_at: state.status === "completed" ? state.startedAt : null,
    completed_at: state.completedAt,
    result:
      state.status === "completed"
        ? ({
            totalTickers: state.totalTickers,
            completedTickers: state.completedTickers.length,
          } as JsonValue)
        : job.result,
    error: null,
  });

  if (state.status === "completed") {
    await appendFullReportBatch(ws, nextJob, state.completedTickers);
  }
  return nextJob;
}

export async function reconcileFullReportJob(
  ws: UserWorkspace,
  job: Job
): Promise<Job> {
  if (job.action !== "full_report") return job;

  const tickers = await listPortfolioTickers(ws);
  const state = await buildState(ws, job, tickers);
  await writeFullReportState(ws, state);
  await writeLegacyProgressFile(ws, state);
  await updateBootstrapState(ws, state);

  if (state.status !== "completed") {
    if (job.status === "pending") {
      return updateJob(ws, job.id, {
        status: "running",
        started_at: state.startedAt,
        error: null,
      });
    }
    return job;
  }

  const completed = await updateJob(ws, job.id, {
    status: "completed",
    started_at: state.startedAt,
    completed_at: state.completedAt,
    result: {
      totalTickers: state.totalTickers,
      completedTickers: state.completedTickers.length,
    },
    error: null,
  });
  await appendFullReportBatch(ws, completed, state.completedTickers);
  return completed;
}

export async function reconcileFailedFullReportJob(
  ws: UserWorkspace,
  job: Job
): Promise<void> {
  if (job.action !== "full_report" || job.status !== "failed") {
    return;
  }

  const existingState = await readJsonIfExists<FullReportState>(statePath(ws));
  if (existingState && existingState.jobId === job.id && existingState.status !== "completed") {
    const completedAt = job.completed_at ?? existingState.completedAt ?? new Date().toISOString();
    await writeFullReportState(ws, {
      ...existingState,
      status: "failed",
      updatedAt: completedAt,
      completedAt,
      failureReason: job.error ?? existingState.failureReason ?? "Full report failed",
    });
  }

  try {
    await fs.unlink(path.join(ws.reportsDir, "progress.json"));
  } catch {
    // progress file may already be gone
  }

  try {
    await fs.unlink(path.join(ws.triggersDir, `${job.id}.json`));
  } catch {
    // trigger may already be gone
  }
}

export async function getFullReportJobProgress(
  ws: UserWorkspace,
  job: Job
): Promise<{
  pct: number;
  currentTicker: string | null;
  currentStep: string | null;
  completedTickers: string[];
  remainingTickers: string[];
  totalTickers: number;
  completedSteps: number;
  totalSteps: number;
} | null> {
  if (job.action !== "full_report") return null;
  const state = await readJsonIfExists<FullReportState>(statePath(ws));
  if (!state || state.jobId !== job.id) return null;

  const pct =
    state.totalSteps > 0
      ? Math.min(Math.round((state.completedSteps / state.totalSteps) * 100), state.status === "completed" ? 100 : 99)
      : 0;

  return {
    pct,
    currentTicker: state.currentTicker,
    currentStep: state.currentStep,
    completedTickers: state.completedTickers,
    remainingTickers: state.remainingTickers,
    totalTickers: state.totalTickers,
    completedSteps: state.completedSteps,
    totalSteps: state.totalSteps,
  };
}
