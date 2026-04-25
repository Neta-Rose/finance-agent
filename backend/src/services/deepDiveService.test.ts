import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { UserWorkspace } from "../middleware/userIsolation.js";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deep-dive-service-"));
const usersDir = path.join(testRoot, "users");
process.env["USERS_DIR"] = usersDir;
process.env["OPENCLAW_AGENTS_DIR"] = path.join(testRoot, "openclaw-agents");

interface TestContext {
  ws: UserWorkspace;
  initializeDeepDiveJob: typeof import("./deepDiveService.js")["initializeDeepDiveJob"];
  reconcileDeepDiveJob: typeof import("./deepDiveService.js")["reconcileDeepDiveJob"];
  markDeepDiveJobFailed: typeof import("./deepDiveService.js")["markDeepDiveJobFailed"];
  markDeepDiveJobCancelled: typeof import("./deepDiveService.js")["markDeepDiveJobCancelled"];
  detectDeepDiveExecutionFailureSignal: typeof import("./deepDiveService.js")["detectDeepDiveExecutionFailureSignal"];
  reconcileFailedDeepDiveJob: typeof import("./deepDiveService.js")["reconcileFailedDeepDiveJob"];
  readState: typeof import("./stateService.js")["readState"];
}

async function setupWorkspace(userId: string): Promise<TestContext> {
  const [{ buildWorkspace }, deepDiveService, stateService] = await Promise.all([
    import("../middleware/userIsolation.js"),
    import("./deepDiveService.js"),
    import("./stateService.js"),
  ]);

  const ws = buildWorkspace(userId, usersDir);
  await fs.mkdir(ws.jobsDir, { recursive: true });
  await fs.mkdir(ws.reportsDir, { recursive: true });
  await fs.mkdir(ws.tickersDir, { recursive: true });

  return {
    ws,
    initializeDeepDiveJob: deepDiveService.initializeDeepDiveJob,
    reconcileDeepDiveJob: deepDiveService.reconcileDeepDiveJob,
    markDeepDiveJobFailed: deepDiveService.markDeepDiveJobFailed,
    markDeepDiveJobCancelled: deepDiveService.markDeepDiveJobCancelled,
    detectDeepDiveExecutionFailureSignal: deepDiveService.detectDeepDiveExecutionFailureSignal,
    reconcileFailedDeepDiveJob: deepDiveService.reconcileFailedDeepDiveJob,
    readState: stateService.readState,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function writeJob(
  ws: TestContext["ws"],
  triggeredAt: string
): Promise<{
  id: string;
  action: "deep_dive";
  ticker: "TSM";
  status: "pending";
  triggered_at: string;
  started_at: null;
  completed_at: null;
  result: null;
  error: null;
}> {
  const job = {
    id: "job_test_deep_dive",
    action: "deep_dive" as const,
    ticker: "TSM" as const,
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

function fundamentalsReport() {
  return {
    ticker: "TSM",
    generatedAt: new Date().toISOString(),
    analyst: "fundamentals" as const,
    earnings: {
      result: "beat" as const,
      epsActual: 1,
      epsExpected: 0.9,
      revenueActualM: 100,
      revenueExpectedM: 98,
    },
    revenueGrowthYoY: 10,
    marginTrend: "improving" as const,
    guidance: "raised" as const,
    valuation: {
      pe: 15,
      sectorAvgPe: 18,
      assessment: "cheap" as const,
    },
    analystConsensus: {
      buy: 10,
      hold: 2,
      sell: 0,
      avgTargetPrice: 110,
      currency: "USD",
    },
    balanceSheet: "healthy" as const,
    insiderActivity: "none" as const,
    fundamentalView: "Healthy operating momentum.",
    sources: ["https://example.com/fundamentals"],
  };
}

function technicalReport() {
  return {
    ticker: "TSM",
    generatedAt: new Date().toISOString(),
    analyst: "technical" as const,
    price: {
      current: 100,
      week52High: 120,
      week52Low: 80,
      positionInRange: 50,
    },
    movingAverages: {
      ma50: 98,
      ma200: 90,
      priceVsMa50: "above" as const,
      priceVsMa200: "above" as const,
    },
    rsi: {
      value: 55,
      signal: "neutral" as const,
    },
    macd: "bullish_crossover" as const,
    volume: "average" as const,
    keyLevels: {
      support: 95,
      resistance: 110,
    },
    pattern: "Base breakout",
    technicalView: "Technicals remain constructive.",
    sources: ["https://example.com/technical"],
  };
}

function sentimentReport() {
  return {
    ticker: "TSM",
    generatedAt: new Date().toISOString(),
    analyst: "sentiment" as const,
    analystActions: [],
    insiderTransactions: [],
    majorNews: [],
    shortInterest: "stable" as const,
    narrativeShift: "stable" as const,
    sentimentView: "Sentiment is stable.",
    sources: ["https://example.com/sentiment"],
  };
}

function macroReport() {
  return {
    ticker: "TSM",
    generatedAt: new Date().toISOString(),
    analyst: "macro" as const,
    rateEnvironment: {
      relevantBank: "Fed",
      currentRate: 5,
      direction: "holding" as const,
      relevance: "neutral" as const,
    },
    sectorPerformance: {
      sectorName: "Semis",
      performanceVsMarket30d: 1,
      trend: "outperforming" as const,
    },
    currency: {
      usdIls: 3.7,
      trend: "stable" as const,
      impactOnPosition: "neutral" as const,
    },
    geopolitical: {
      relevantFactor: null,
      riskLevel: "low" as const,
    },
    marketRegime: "mixed" as const,
    macroView: "Macro backdrop is manageable.",
    sources: ["https://example.com/macro"],
  };
}

function riskReport() {
  return {
    ticker: "TSM",
    generatedAt: new Date().toISOString(),
    analyst: "risk" as const,
    livePrice: 100,
    livePriceCurrency: "USD",
    livePriceSource: "test",
    shares: {
      main: 10,
      second: 0,
      total: 10,
    },
    positionValueILS: 3700,
    portfolioWeightPct: 8.5,
    plILS: 250,
    plPct: 7.2,
    avgPricePaid: 92,
    concentrationFlag: false,
    riskFacts: "Position size is within limits.",
  };
}

function bullCaseReport() {
  return {
    ticker: "TSM",
    generatedAt: new Date().toISOString(),
    analyst: "bull" as const,
    round: 2 as const,
    coreThesis: "Execution and demand stay strong.",
    arguments: [
      {
        source: "https://example.com/bull-1",
        claim: "Margins remain resilient.",
        dataPoint: "Gross margin stayed above 50%.",
      },
      {
        source: "https://example.com/bull-2",
        claim: "Capex supports future growth.",
        dataPoint: "Management guided higher investment.",
      },
      {
        source: "https://example.com/bull-3",
        claim: "AI demand remains durable.",
        dataPoint: "Customer order visibility improved.",
      },
    ],
    responseToBear: "Inventory normalization is already reflected.",
    bullVerdict: "ADD" as const,
    conditionToBeWrong: "Utilization drops materially.",
  };
}

function bearCaseReport() {
  return {
    ticker: "TSM",
    generatedAt: new Date().toISOString(),
    analyst: "bear" as const,
    round: 2 as const,
    coreConcern: "Cycle risk remains elevated.",
    arguments: [
      {
        source: "https://example.com/bear-1",
        claim: "Demand can pause after a sharp ramp.",
        dataPoint: "Historical cycles show utilization dips.",
      },
      {
        source: "https://example.com/bear-2",
        claim: "Capex raises execution pressure.",
        dataPoint: "Returns on incremental capacity can compress.",
      },
      {
        source: "https://example.com/bear-3",
        claim: "Geopolitical risk remains non-zero.",
        dataPoint: "Regional headlines still affect sentiment.",
      },
    ],
    responseToBull: "Demand durability is not guaranteed.",
    bearVerdict: "HOLD" as const,
    conditionToBeWrong: "End-market demand accelerates further.",
  };
}

function strategyReport() {
  return {
    ticker: "TSM",
    updatedAt: new Date().toISOString(),
    version: 2,
    verdict: "ADD" as const,
    confidence: "high" as const,
    reasoning: "Deep dive completed with favorable risk/reward.",
    timeframe: "months" as const,
    positionSizeILS: 3700,
    positionWeightPct: 8.5,
    entryConditions: ["Add above 98 on sustained demand evidence"],
    exitConditions: ["Reduce below 90 if thesis weakens"],
    catalysts: [
      {
        description: "Scheduled review",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        triggered: false,
      },
    ],
    bullCase: "Execution and demand stay strong.",
    bearCase: "Cycle risk remains elevated.",
    lastDeepDiveAt: new Date().toISOString(),
    deepDiveTriggeredBy: "quick_check",
  };
}

test("initializeDeepDiveJob ignores stale artifacts from previous runs", async () => {
  const ctx = await setupWorkspace("tester-stale");
  const triggeredAt = new Date().toISOString();
  const job = await writeJob(ctx.ws, triggeredAt);

  const stalePath = path.join(ctx.ws.reportsDir, "TSM", "fundamentals.json");
  await writeJson(stalePath, fundamentalsReport());
  const staleTime = new Date(new Date(triggeredAt).getTime() - 60_000);
  await fs.utimes(stalePath, staleTime, staleTime);

  const queued = await ctx.initializeDeepDiveJob(ctx.ws, job);
  assert.equal(queued.status, "pending");

  const stateRaw = await fs.readFile(
    path.join(ctx.ws.reportsDir, "TSM", "deep_dive_state.json"),
    "utf-8"
  );
  const state = JSON.parse(stateRaw) as {
    completedSteps: number;
    currentStep: string | null;
    steps: Array<{ key: string; status: string; detail: string | null }>;
  };

  assert.equal(state.completedSteps, 0);
  assert.equal(state.currentStep, "Fundamentals");
  const fundamentals = state.steps.find((step) => step.key === "fundamentals");
  assert.equal(fundamentals?.status, "pending");
  assert.equal(fundamentals?.detail, "artifact predates current job");

  const portfolioState = await ctx.readState(ctx.ws.userId);
  assert.deepEqual(portfolioState.pendingDeepDives, ["TSM"]);
});

test("reconcileDeepDiveJob completes when all fresh artifacts exist", async () => {
  const ctx = await setupWorkspace("tester-complete");
  const job = await writeJob(ctx.ws, new Date(Date.now() - 5_000).toISOString());
  const queued = await ctx.initializeDeepDiveJob(ctx.ws, job);

  await writeJson(path.join(ctx.ws.reportsDir, "TSM", "fundamentals.json"), fundamentalsReport());
  await writeJson(path.join(ctx.ws.reportsDir, "TSM", "technical.json"), technicalReport());
  await writeJson(path.join(ctx.ws.reportsDir, "TSM", "sentiment.json"), sentimentReport());
  await writeJson(path.join(ctx.ws.reportsDir, "TSM", "macro.json"), macroReport());
  await writeJson(path.join(ctx.ws.reportsDir, "TSM", "risk.json"), riskReport());
  await writeJson(path.join(ctx.ws.reportsDir, "TSM", "bull_case.json"), bullCaseReport());
  await writeJson(path.join(ctx.ws.reportsDir, "TSM", "bear_case.json"), bearCaseReport());
  await writeJson(ctx.ws.strategyFile("TSM"), strategyReport());

  const completed = await ctx.reconcileDeepDiveJob(ctx.ws, queued);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.result, {
    ticker: "TSM",
    completedSteps: 7,
    totalSteps: 7,
    strategyReady: true,
    verdict: "ADD",
    confidence: "high",
  });

  const stateRaw = await fs.readFile(
    path.join(ctx.ws.reportsDir, "TSM", "deep_dive_state.json"),
    "utf-8"
  );
  const state = JSON.parse(stateRaw) as {
    status: string;
    strategyReady: boolean;
    completedSteps: number;
    completedAt: string | null;
  };
  assert.equal(state.status, "completed");
  assert.equal(state.strategyReady, true);
  assert.equal(state.completedSteps, 7);
  assert.notEqual(state.completedAt, null);

  const indexMetaRaw = await fs.readFile(
    path.join(ctx.ws.reportsDir, "index", "meta.json"),
    "utf-8"
  );
  const indexMeta = JSON.parse(indexMetaRaw) as {
    newestBatchId: string | null;
    totalBatches: number;
  };
  assert.equal(indexMeta.newestBatchId, "batch_job_test_deep_dive_deep_dive");
  assert.equal(indexMeta.totalBatches, 1);

  const portfolioState = await ctx.readState(ctx.ws.userId);
  assert.deepEqual(portfolioState.pendingDeepDives, []);
});

test("reconcileDeepDiveJob keeps undispatched pending deep dives pending", async () => {
  const ctx = await setupWorkspace("tester-pending");
  const job = await writeJob(ctx.ws, new Date(Date.now() - 5_000).toISOString());
  const queued = await ctx.initializeDeepDiveJob(ctx.ws, job);

  const reconciled = await ctx.reconcileDeepDiveJob(ctx.ws, queued);
  assert.equal(reconciled.status, "pending");

  const stateRaw = await fs.readFile(
    path.join(ctx.ws.reportsDir, "TSM", "deep_dive_state.json"),
    "utf-8"
  );
  const state = JSON.parse(stateRaw) as {
    status: string;
    completedSteps: number;
    currentStep: string | null;
  };
  assert.equal(state.status, "pending");
  assert.equal(state.completedSteps, 0);
  assert.equal(state.currentStep, "Fundamentals");
});

test("reconcileDeepDiveJob does not trust running status without started_at", async () => {
  const ctx = await setupWorkspace("tester-undispatched-running");
  const job = await writeJob(ctx.ws, new Date(Date.now() - 5_000).toISOString());
  await writeJson(ctx.ws.jobFile(job.id), {
    ...job,
    status: "running",
    started_at: null,
  });

  const reconciled = await ctx.reconcileDeepDiveJob(ctx.ws, {
    ...job,
    status: "running",
    started_at: null,
  });
  assert.equal(reconciled.status, "pending");

  const stateRaw = await fs.readFile(
    path.join(ctx.ws.reportsDir, "TSM", "deep_dive_state.json"),
    "utf-8"
  );
  const state = JSON.parse(stateRaw) as {
    status: string;
    currentStep: string | null;
    steps: Array<{ key: string; status: string }>;
  };
  assert.equal(state.status, "pending");
  assert.equal(state.currentStep, "Fundamentals");
  assert.equal(state.steps.find((step) => step.key === "fundamentals")?.status, "pending");
});

test("markDeepDiveJobFailed clears pending state and marks deep dive state failed", async () => {
  const ctx = await setupWorkspace("tester-failed");
  const job = await writeJob(ctx.ws, new Date(Date.now() - 5_000).toISOString());
  const queued = await ctx.initializeDeepDiveJob(ctx.ws, job);

  const failed = await ctx.markDeepDiveJobFailed(
    ctx.ws,
    { ...queued, status: "running", started_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() },
    "Failed after 31 min with no deep-dive progress"
  );

  assert.equal(failed.status, "failed");
  assert.match(failed.error ?? "", /no deep-dive progress/i);

  const stateRaw = await fs.readFile(
    path.join(ctx.ws.reportsDir, "TSM", "deep_dive_state.json"),
    "utf-8"
  );
  const state = JSON.parse(stateRaw) as {
    status: string;
    failureReason?: string | null;
    completedAt: string | null;
    steps: Array<{ key: string; status: string }>;
  };
  assert.equal(state.status, "failed");
  assert.match(state.failureReason ?? "", /no deep-dive progress/i);
  assert.notEqual(state.completedAt, null);
  assert.equal(state.steps.find((step) => step.key === "fundamentals")?.status, "failed");

  const portfolioState = await ctx.readState(ctx.ws.userId);
  assert.deepEqual(portfolioState.pendingDeepDives, []);
});

test("markDeepDiveJobCancelled records a terminal cancelled state", async () => {
  const ctx = await setupWorkspace("tester-cancelled");
  const job = await writeJob(ctx.ws, new Date(Date.now() - 5_000).toISOString());
  const queued = await ctx.initializeDeepDiveJob(ctx.ws, job);

  const cancelled = await ctx.markDeepDiveJobCancelled(
    ctx.ws,
    { ...queued, status: "running", started_at: new Date(Date.now() - 60_000).toISOString() },
    "Cancelled by admin"
  );

  assert.equal(cancelled.status, "cancelled");
  assert.match(cancelled.error ?? "", /cancelled by admin/i);

  const stateRaw = await fs.readFile(
    path.join(ctx.ws.reportsDir, "TSM", "deep_dive_state.json"),
    "utf-8"
  );
  const state = JSON.parse(stateRaw) as {
    status: string;
    failureReason?: string | null;
    completedAt: string | null;
  };
  assert.equal(state.status, "cancelled");
  assert.match(state.failureReason ?? "", /cancelled by admin/i);
  assert.notEqual(state.completedAt, null);

  const portfolioState = await ctx.readState(ctx.ws.userId);
  assert.deepEqual(portfolioState.pendingDeepDives, []);
});

test("detectDeepDiveExecutionFailureSignal ignores session text without an authoritative rejection record", async () => {
  const ctx = await setupWorkspace("tester-session-budget");
  const job = await writeJob(ctx.ws, new Date(Date.now() - 5_000).toISOString());
  const runningJob = {
    ...job,
    status: "running" as const,
    started_at: new Date().toISOString(),
  };
  await writeJson(ctx.ws.jobFile(job.id), runningJob);
  const sessionPath = path.join(
    process.env["OPENCLAW_AGENTS_DIR"]!,
    "tester-session-budget",
    "sessions",
    "session-1.jsonl"
  );
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.writeFile(
    sessionPath,
    `{"message":"${job.id}"}\n{"errorMessage":"429 \\"points_budget_exhausted\\""}\n`,
    "utf-8"
  );

  const signal = await ctx.detectDeepDiveExecutionFailureSignal("tester-session-budget", runningJob);
  assert.equal(signal, null);
});

test("reconcileFailedDeepDiveJob repairs stale running deep dive state for a failed job", async () => {
  const ctx = await setupWorkspace("tester-reconcile-failed");
  const job = await writeJob(ctx.ws, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
  const initialized = await ctx.initializeDeepDiveJob(ctx.ws, job);

  await writeJson(ctx.ws.jobFile(initialized.id), {
    ...initialized,
    status: "failed",
    started_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    completed_at: new Date().toISOString(),
    error: "Timed out after 90 min — agent started but did not complete (watchdog)",
  });

  const failedJobRaw = await fs.readFile(ctx.ws.jobFile(initialized.id), "utf-8");
  const failedJob = JSON.parse(failedJobRaw);
  await ctx.reconcileFailedDeepDiveJob(ctx.ws, failedJob);

  const stateRaw = await fs.readFile(
    path.join(ctx.ws.reportsDir, "TSM", "deep_dive_state.json"),
    "utf-8"
  );
  const state = JSON.parse(stateRaw) as {
    status: string;
    failureReason?: string | null;
    completedAt: string | null;
  };
  assert.equal(state.status, "failed");
  assert.match(state.failureReason ?? "", /timed out/i);
  assert.notEqual(state.completedAt, null);

  const portfolioState = await ctx.readState(ctx.ws.userId);
  assert.deepEqual(portfolioState.pendingDeepDives, []);
});
