import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { UserWorkspace } from "../middleware/userIsolation.js";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "full-report-service-"));
const usersDir = path.join(testRoot, "users");
process.env["USERS_DIR"] = usersDir;

interface TestContext {
  ws: UserWorkspace;
  initializeFullReportJob: typeof import("./fullReportService.js")["initializeFullReportJob"];
  reconcileFullReportJob: typeof import("./fullReportService.js")["reconcileFullReportJob"];
  reconcileFailedFullReportJob: typeof import("./fullReportService.js")["reconcileFailedFullReportJob"];
  getFullReportJobProgress: typeof import("./fullReportService.js")["getFullReportJobProgress"];
  readState: typeof import("./stateService.js")["readState"];
}

async function setupWorkspace(userId: string): Promise<TestContext> {
  const [{ buildWorkspace }, fullReportService, stateService] = await Promise.all([
    import("../middleware/userIsolation.js"),
    import("./fullReportService.js"),
    import("./stateService.js"),
  ]);

  const ws = buildWorkspace(userId, usersDir);
  await fs.mkdir(ws.jobsDir, { recursive: true });
  await fs.mkdir(ws.reportsDir, { recursive: true });
  await fs.mkdir(ws.tickersDir, { recursive: true });
  await writeJson(ws.portfolioFile, {
    meta: { currency: "ILS", transactionFeeILS: 0, note: "test" },
    accounts: {
      main: [
        {
          ticker: "TSM",
          exchange: "NYSE",
          shares: 10,
          unitAvgBuyPrice: 100,
          unitCurrency: "USD",
        },
        {
          ticker: "NVDA",
          exchange: "NASDAQ",
          shares: 5,
          unitAvgBuyPrice: 120,
          unitCurrency: "USD",
        },
      ],
    },
  });
  await writeJson(ws.stateFile, {
    userId,
    state: "BOOTSTRAPPING",
    lastFullReportAt: null,
    lastDailyAt: null,
    pendingDeepDives: [],
    bootstrapProgress: null,
  });

  return {
    ws,
    initializeFullReportJob: fullReportService.initializeFullReportJob,
    reconcileFullReportJob: fullReportService.reconcileFullReportJob,
    reconcileFailedFullReportJob: fullReportService.reconcileFailedFullReportJob,
    getFullReportJobProgress: fullReportService.getFullReportJobProgress,
    readState: stateService.readState,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function writeJob(ws: UserWorkspace, triggeredAt: string) {
  const job = {
    id: "job_test_full_report",
    action: "full_report" as const,
    ticker: null,
    status: "pending" as const,
    triggered_at: triggeredAt,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
  };
  await writeJson(ws.jobFile(job.id), job);
  return job;
}

function reportFor(ticker: string, analyst: "fundamentals" | "technical" | "sentiment" | "macro" | "risk") {
  if (analyst === "fundamentals") {
    return {
      ticker,
      generatedAt: new Date().toISOString(),
      analyst,
      earnings: {
        result: "beat",
        epsActual: 1,
        epsExpected: 0.9,
        revenueActualM: 100,
        revenueExpectedM: 98,
      },
      revenueGrowthYoY: 10,
      marginTrend: "improving",
      guidance: "raised",
      valuation: { pe: 15, sectorAvgPe: 18, assessment: "cheap" },
      analystConsensus: { buy: 10, hold: 2, sell: 0, avgTargetPrice: 110, currency: "USD" },
      balanceSheet: "healthy",
      insiderActivity: "none",
      fundamentalView: "Healthy operating momentum.",
      sources: ["https://example.com/fundamentals"],
    };
  }
  if (analyst === "technical") {
    return {
      ticker,
      generatedAt: new Date().toISOString(),
      analyst,
      price: { current: 100, week52High: 120, week52Low: 80, positionInRange: 50 },
      movingAverages: { ma50: 98, ma200: 90, priceVsMa50: "above", priceVsMa200: "above" },
      rsi: { value: 55, signal: "neutral" },
      macd: "bullish_crossover",
      volume: "average",
      keyLevels: { support: 95, resistance: 110 },
      pattern: "Base breakout",
      technicalView: "Constructive chart.",
      sources: ["https://example.com/technical"],
    };
  }
  if (analyst === "sentiment") {
    return {
      ticker,
      generatedAt: new Date().toISOString(),
      analyst,
      analystActions: [],
      insiderTransactions: [],
      majorNews: [],
      shortInterest: "stable",
      narrativeShift: "stable",
      sentimentView: "Stable sentiment.",
      sources: ["https://example.com/sentiment"],
    };
  }
  if (analyst === "macro") {
    return {
      ticker,
      generatedAt: new Date().toISOString(),
      analyst,
      rateEnvironment: {
        relevantBank: "Fed",
        currentRate: 5,
        direction: "holding",
        relevance: "neutral",
      },
      sectorPerformance: {
        sectorName: "Semis",
        performanceVsMarket30d: 1,
        trend: "outperforming",
      },
      currency: {
        usdIls: 3.7,
        trend: "stable",
        impactOnPosition: "neutral",
      },
      geopolitical: {
        relevantFactor: null,
        riskLevel: "low",
      },
      marketRegime: "mixed",
      macroView: "Manageable macro backdrop.",
      sources: ["https://example.com/macro"],
    };
  }
  return {
    ticker,
    generatedAt: new Date().toISOString(),
    analyst,
    livePrice: 100,
    livePriceCurrency: "USD",
    livePriceSource: "test",
    shares: { main: 10, second: 0, total: 10 },
    positionValueILS: 3700,
    portfolioWeightPct: 8.5,
    plILS: 250,
    plPct: 7.2,
    avgPricePaid: 92,
    concentrationFlag: false,
    riskFacts: "Position size is within limits.",
  };
}

function strategyFor(ticker: string) {
  return {
    ticker,
    updatedAt: new Date().toISOString(),
    version: 2,
    verdict: "ADD",
    confidence: "high",
    reasoning: `${ticker} thesis remains favorable.`,
    timeframe: "months",
    positionSizeILS: 3700,
    positionWeightPct: 8.5,
    entryConditions: ["Add on confirmation"],
    exitConditions: ["Reduce on thesis break"],
    catalysts: [
      {
        description: "Scheduled review",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        triggered: false,
      },
    ],
    bullCase: "Strong operating momentum.",
    bearCase: "Cycle risk remains.",
    lastDeepDiveAt: new Date().toISOString(),
    deepDiveTriggeredBy: "full_report",
  };
}

test("initializeFullReportJob queues work and records bootstrap progress", async () => {
  const ctx = await setupWorkspace("full-report-progress");
  const job = await writeJob(ctx.ws, new Date().toISOString());
  const started = await ctx.initializeFullReportJob(ctx.ws, job);
  assert.equal(started.status, "pending");

  const progress = await ctx.getFullReportJobProgress(ctx.ws, started);
  assert.equal(progress?.totalTickers, 2);
  assert.deepEqual(progress?.completedTickers, []);
  assert.deepEqual(progress?.remainingTickers, ["TSM", "NVDA"]);

  const state = await ctx.readState(ctx.ws.userId);
  assert.equal(state.bootstrapProgress?.total, 2);
  assert.equal(state.bootstrapProgress?.completed, 0);
  assert.equal(state.state, "BOOTSTRAPPING");
});

test("reconcileFullReportJob completes bootstrap and updates index", async () => {
  const ctx = await setupWorkspace("full-report-complete");
  const job = await writeJob(ctx.ws, new Date(Date.now() - 5_000).toISOString());
  const started = await ctx.initializeFullReportJob(ctx.ws, job);

  for (const ticker of ["TSM", "NVDA"]) {
    for (const analyst of ["fundamentals", "technical", "sentiment", "macro", "risk"] as const) {
      await writeJson(path.join(ctx.ws.reportsDir, ticker, `${analyst}.json`), reportFor(ticker, analyst));
    }
    await writeJson(ctx.ws.strategyFile(ticker), strategyFor(ticker));
  }

  const completed = await ctx.reconcileFullReportJob(ctx.ws, started);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.result, {
    totalTickers: 2,
    completedTickers: 2,
  });

  const state = await ctx.readState(ctx.ws.userId);
  assert.equal(state.state, "ACTIVE");
  assert.equal(state.bootstrapProgress, null);
  assert.notEqual(state.lastFullReportAt, null);

  const progressFile = await fs
    .readFile(path.join(ctx.ws.reportsDir, "progress.json"), "utf-8")
    .then(() => true)
    .catch(() => false);
  assert.equal(progressFile, false);

  const metaRaw = await fs.readFile(path.join(ctx.ws.reportsDir, "index", "meta.json"), "utf-8");
  const meta = JSON.parse(metaRaw) as { newestBatchId: string | null; totalBatches: number };
  assert.equal(meta.newestBatchId, "batch_job_test_full_report_full_report");
  assert.equal(meta.totalBatches, 1);
});

test("reconcileFullReportJob does not rewrite bootstrap progress for active users", async () => {
  const ctx = await setupWorkspace("full-report-active");
  await writeJson(ctx.ws.stateFile, {
    userId: ctx.ws.userId,
    state: "ACTIVE",
    lastFullReportAt: "2026-04-10T00:00:00.000Z",
    lastDailyAt: null,
    pendingDeepDives: [],
    bootstrapProgress: null,
    onboarding: {
      portfolioSubmittedAt: null,
      positionGuidanceStatus: "not_started",
      positionGuidance: {},
    },
  });

  const job = await writeJob(ctx.ws, new Date(Date.now() - 5_000).toISOString());
  const runningJob = {
    ...job,
    status: "running" as const,
    started_at: new Date(Date.now() - 5_000).toISOString(),
  };
  await writeJson(ctx.ws.jobFile(job.id), runningJob);

  await writeJson(path.join(ctx.ws.reportsDir, "TSM", "fundamentals.json"), reportFor("TSM", "fundamentals"));
  await writeJson(path.join(ctx.ws.reportsDir, "NVDA", "fundamentals.json"), reportFor("NVDA", "fundamentals"));

  await ctx.reconcileFullReportJob(ctx.ws, runningJob);

  const state = await ctx.readState(ctx.ws.userId);
  assert.equal(state.state, "ACTIVE");
  assert.equal(state.bootstrapProgress, null);
  assert.equal(state.lastFullReportAt, "2026-04-10T00:00:00.000Z");
});

test("reconcileFailedFullReportJob marks stale state failed and removes legacy progress", async () => {
  const ctx = await setupWorkspace("full-report-failed-repair");
  const triggeredAt = new Date(Date.now() - 60_000).toISOString();
  const completedAt = new Date().toISOString();
  const job = {
    ...(await writeJob(ctx.ws, triggeredAt)),
    status: "failed" as const,
    started_at: triggeredAt,
    completed_at: completedAt,
    error: "Timed out after 120 min — agent started but did not complete (watchdog)",
  };
  await writeJson(ctx.ws.jobFile(job.id), job);

  await writeJson(path.join(ctx.ws.reportsDir, "full_report_state.json"), {
    version: 1,
    jobId: job.id,
    status: "running",
    triggeredAt,
    startedAt: triggeredAt,
    updatedAt: triggeredAt,
    completedAt: null,
    totalTickers: 2,
    completedTickers: [],
    remainingTickers: ["TSM", "NVDA"],
    currentTicker: "TSM",
    currentStep: "Sentiment",
    completedSteps: 2,
    totalSteps: 10,
    tickers: [
      {
        ticker: "TSM",
        status: "pending",
        completedSteps: 2,
        totalSteps: 5,
        currentStep: "Sentiment",
        strategyReady: false,
      },
      {
        ticker: "NVDA",
        status: "pending",
        completedSteps: 0,
        totalSteps: 5,
        currentStep: "Fundamentals",
        strategyReady: false,
      },
    ],
  });
  await writeJson(path.join(ctx.ws.reportsDir, "progress.json"), {
    startedAt: triggeredAt,
    totalTickers: 2,
    completed: [],
    failed: [],
    remaining: ["TSM", "NVDA"],
  });
  await writeJson(path.join(ctx.ws.triggersDir, `${job.id}.json`), {
    jobId: job.id,
    action: job.action,
  });

  await ctx.reconcileFailedFullReportJob(ctx.ws, job);

  const repairedRaw = await fs.readFile(path.join(ctx.ws.reportsDir, "full_report_state.json"), "utf-8");
  const repaired = JSON.parse(repairedRaw) as {
    status: string;
    completedAt: string | null;
    failureReason?: string | null;
  };
  assert.equal(repaired.status, "failed");
  assert.equal(repaired.completedAt, completedAt);
  assert.match(repaired.failureReason ?? "", /watchdog/i);

  const progressExists = await fs
    .stat(path.join(ctx.ws.reportsDir, "progress.json"))
    .then(() => true)
    .catch(() => false);
  assert.equal(progressExists, false);

  const triggerExists = await fs
    .stat(path.join(ctx.ws.triggersDir, `${job.id}.json`))
    .then(() => true)
    .catch(() => false);
  assert.equal(triggerExists, false);
});

test("repairActiveUserState clears stale bootstrap progress for active users", async () => {
  const ctx = await setupWorkspace("full-report-repair-active");
  const { repairActiveUserState } = await import("./stateService.js");

  await writeJson(ctx.ws.stateFile, {
    userId: ctx.ws.userId,
    state: "ACTIVE",
    lastFullReportAt: null,
    lastDailyAt: null,
    pendingDeepDives: [],
    bootstrapProgress: {
      total: 32,
      completed: 0,
      completedTickers: [],
    },
    onboarding: {
      portfolioSubmittedAt: null,
      positionGuidanceStatus: "not_started",
      positionGuidance: {},
    },
  });

  const changed = await repairActiveUserState(ctx.ws.userId);
  const state = await ctx.readState(ctx.ws.userId);

  assert.equal(changed, true);
  assert.equal(state.state, "ACTIVE");
  assert.equal(state.bootstrapProgress, null);
});

test("getActiveUserEligibility rejects active users with missing portfolio", async () => {
  const ctx = await setupWorkspace("full-report-active-eligibility");
  const { getActiveUserEligibility } = await import("./stateService.js");

  await writeJson(ctx.ws.stateFile, {
    userId: ctx.ws.userId,
    state: "ACTIVE",
    lastFullReportAt: null,
    lastDailyAt: null,
    pendingDeepDives: [],
    bootstrapProgress: null,
    onboarding: {
      portfolioSubmittedAt: null,
      positionGuidanceStatus: "not_started",
      positionGuidance: {},
    },
  });
  await fs.unlink(ctx.ws.portfolioFile);

  const eligibility = await getActiveUserEligibility(ctx.ws.userId);
  assert.deepEqual(eligibility, {
    eligible: false,
    reason: "portfolio missing",
  });
});

test("repairActiveUserState downgrades impossible active users to incomplete", async () => {
  const ctx = await setupWorkspace("full-report-repair-impossible-active");
  const { repairActiveUserState } = await import("./stateService.js");

  await writeJson(ctx.ws.stateFile, {
    userId: ctx.ws.userId,
    state: "ACTIVE",
    lastFullReportAt: null,
    lastDailyAt: null,
    pendingDeepDives: [],
    bootstrapProgress: null,
    onboarding: {
      portfolioSubmittedAt: null,
      positionGuidanceStatus: "not_started",
      positionGuidance: {},
    },
  });
  await fs.unlink(ctx.ws.portfolioFile);

  const changed = await repairActiveUserState(ctx.ws.userId);
  const state = await ctx.readState(ctx.ws.userId);

  assert.equal(changed, true);
  assert.equal(state.state, "INCOMPLETE");
});
