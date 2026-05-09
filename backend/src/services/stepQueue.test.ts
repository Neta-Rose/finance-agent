import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { StepInputs } from "./stepQueue/handlers.js";
import type { ClaimedStepWorkItem } from "./stepQueue/types.js";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "step-queue-"));
const usersDir = path.join(testRoot, "users");
process.env["USERS_DIR"] = usersDir;
process.env["OPENROUTER_API_KEY"] = process.env["OPENROUTER_API_KEY"] ?? "test-openrouter-key";
delete process.env["USE_STEP_QUEUE"];

const [{ buildWorkspace }, { expandStepQueueJob }, { isStepQueueServiceEnabled, isStepQueueEnabledForUser }, { handlerFor, registeredStepKinds }, { resolveTerminalJobStatus }] =
  await Promise.all([
    import("../middleware/userIsolation.js"),
    import("./stepQueue/expansion.js"),
    import("./stepQueue/featureFlag.js"),
    import("./stepQueue/handlers.js"),
    import("./stepQueue/executor.js"),
  ]);

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function setupWorkspace(userId: string): Promise<UserWorkspace> {
  const ws = buildWorkspace(userId, usersDir);
  await fs.mkdir(ws.root, { recursive: true });
  await fs.mkdir(ws.tickersDir, { recursive: true });
  await fs.mkdir(ws.reportsDir, { recursive: true });
  await writeJson(path.join(ws.root, "profile.json"), {});
  await fs.writeFile(ws.userMdFile, "Risk tolerance: medium\n", "utf-8");
  await writeJson(ws.portfolioFile, {
    meta: { currency: "ILS", transactionFeeILS: 5, note: "" },
    accounts: {
      main: [
        { ticker: "AAPL", exchange: "NASDAQ", shares: 1, unitAvgBuyPrice: 100, unitCurrency: "USD" },
        { ticker: "MSFT", exchange: "NASDAQ", shares: 1, unitAvgBuyPrice: 100, unitCurrency: "USD" },
      ],
    },
  });
  return ws;
}

function validStrategy(ticker: string, lastDeepDiveAt: string | null): Record<string, unknown> {
  return {
    ticker,
    updatedAt: "2026-04-30T00:00:00.000Z",
    version: 1,
    verdict: "BUY",
    confidence: "medium",
    reasoning: "Valid strategy fixture.",
    timeframe: "months",
    positionSizeILS: 1000,
    positionWeightPct: 10,
    entryConditions: [],
    exitConditions: [],
    catalysts: [],
    bullCase: null,
    bearCase: null,
    lastDeepDiveAt,
    deepDiveTriggeredBy: "fixture",
  };
}

function claimedStep(kind: ClaimedStepWorkItem["kind"], ticker: string): ClaimedStepWorkItem {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    tickerWorkItemId: "00000000-0000-4000-8000-000000000002",
    jobId: "job_test",
    userId: "queue-user",
    ticker,
    kind,
    status: "running",
    attempts: 1,
    modelTierUsed: "balanced",
    costAccruedCents: 0,
    inputArtifactPaths: [],
    outputArtifactPath: null,
    lastError: null,
    ownerLockId: "00000000-0000-4000-8000-000000000003",
    startedAt: new Date("2026-05-01T00:00:00.000Z"),
    completedAt: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
  };
}

function deterministicInputs(step: ClaimedStepWorkItem, ws: UserWorkspace): StepInputs {
  return {
    step,
    workspace: ws,
    gatheredAt: "2026-05-01T00:00:00.000Z",
    data: {
      price: { priceNative: 123, priceILS: 455, currency: "USD" },
      analystArtifacts: {
        fundamentals: {
          fundamentalView: "Revenue trend is stable but valuation evidence is incomplete.",
          sources: ["https://finance.yahoo.com/quote/AAPL"],
        },
        technical: {
          technicalView: "Price trend is neutral versus recent moving averages.",
          sources: ["https://finance.yahoo.com/quote/AAPL/history"],
        },
        sentiment: {
          sentimentView: "No strong sentiment shift was detected.",
          sources: ["https://example.com/news/aapl"],
        },
        macro: {
          macroView: "Macro context is mixed and should not drive a high-conviction call.",
          sources: ["https://example.com/macro/aapl"],
        },
        risk: {
          positionValueILS: 1000,
          portfolioWeightPct: 12,
          plPct: -8,
          riskFacts: "Weight 12.0%, P/L -8.0%, total shares 1.",
          sources: ["https://finance.yahoo.com/quote/AAPL"],
        },
      },
    },
  };
}

let llmFetchCount = 0;

function mockLlmJsonOnce(json: unknown): void {
  llmFetchCount = 0;
  globalThis.fetch = (async () => {
    llmFetchCount += 1;
    return new Response(
      JSON.stringify({
        model: "stub-model",
        choices: [{ message: { content: JSON.stringify(json) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
}

function assertLlmCalledOnce(): void {
  assert.equal(llmFetchCount, 1);
}

function technicalFixture(ticker: string): Record<string, unknown> {
  return {
    ticker,
    generatedAt: "2026-05-01T00:00:00.000Z",
    analyst: "technical",
    price: { current: 123, week52High: 150, week52Low: 90, positionInRange: 55 },
    movingAverages: { ma50: 120, ma200: 110, priceVsMa50: "above", priceVsMa200: "above" },
    rsi: { value: 52, signal: "neutral" },
    macd: "neutral",
    volume: "average",
    keyLevels: { support: 110, resistance: 150 },
    pattern: null,
    technicalView: "Model technical read is neutral with price above key moving averages.",
    sources: ["https://finance.yahoo.com/quote/AAPL"],
  };
}

function sentimentFixture(ticker: string): Record<string, unknown> {
  return {
    ticker,
    generatedAt: "2026-05-01T00:00:00.000Z",
    analyst: "sentiment",
    analystActions: [],
    insiderTransactions: [],
    majorNews: [
      {
        headline: "Recent coverage remains balanced",
        summary: "Available news does not show a decisive narrative break.",
        sentiment: "neutral",
        date: "2026-05-01",
      },
    ],
    shortInterest: "unknown",
    narrativeShift: "stable",
    sentimentView: "Model sentiment read is stable with no strong directional shift.",
    sources: ["https://example.com/news"],
  };
}

function macroFixture(ticker: string): Record<string, unknown> {
  return {
    ticker,
    generatedAt: "2026-05-01T00:00:00.000Z",
    analyst: "macro",
    rateEnvironment: { relevantBank: "Federal Reserve", currentRate: null, direction: "holding", relevance: "neutral" },
    sectorPerformance: { sectorName: "Technology", performanceVsMarket30d: null, trend: "in-line" },
    currency: { usdIls: 3.7, trend: "stable", impactOnPosition: "neutral" },
    geopolitical: { relevantFactor: null, riskLevel: "none" },
    marketRegime: "mixed",
    macroView: "Model macro read is mixed and should not drive the position alone.",
    sources: ["https://example.com/macro"],
  };
}

function riskFixture(ticker: string): Record<string, unknown> {
  return {
    ticker,
    generatedAt: "2026-05-01T00:00:00.000Z",
    analyst: "risk",
    livePrice: 123,
    livePriceCurrency: "USD",
    livePriceSource: "live_price_context",
    shares: { main: 1, second: 0, total: 1 },
    positionValueILS: 455,
    portfolioWeightPct: 12,
    plILS: 0,
    plPct: 0,
    avgPricePaid: 100,
    concentrationFlag: false,
    riskFacts: "Model risk read: position size is moderate and should stay within target limits.",
  };
}

function debateFixture(ticker: string): Record<string, unknown> {
  return {
    ticker,
    generatedAt: "2026-05-01T00:00:00.000Z",
    analyst: "debate",
    bullRounds: [
      {
        round: 1,
        thesis: "The bull case is that fundamentals are stable enough to keep exposure.",
        evidence: [{ source: "https://finance.yahoo.com/quote/AAPL", claim: "Fundamentals are stable.", dataPoint: "Fundamentals artifact" }],
        responseToBear: "Sizing discipline addresses the main risk.",
      },
      {
        round: 2,
        thesis: "Technical and sentiment evidence do not force an exit.",
        evidence: [{ source: "https://example.com/news", claim: "Narrative is stable.", dataPoint: "Sentiment artifact" }],
        responseToBear: "A neutral setup supports waiting for a stronger catalyst.",
      },
    ],
    bearRounds: [
      {
        round: 1,
        concern: "The bear case is that evidence is too mixed for adding capital.",
        evidence: [{ source: "https://example.com/macro", claim: "Macro is mixed.", dataPoint: "Macro artifact" }],
        responseToBull: "Stable fundamentals alone are not enough for a BUY.",
      },
      {
        round: 2,
        concern: "Position risk matters if confidence stays low.",
        evidence: [{ source: "https://finance.yahoo.com/quote/AAPL", claim: "Weight is meaningful.", dataPoint: "Risk artifact" }],
        responseToBull: "The position should remain capped until evidence improves.",
      },
    ],
    bullFinalVerdict: "HOLD",
    bearFinalVerdict: "HOLD",
    keyDisagreement: "Whether mixed evidence is enough to keep holding without adding.",
    synthesisGuidance: "Use a low-confidence HOLD with explicit catalyst requirements.",
    sources: ["https://finance.yahoo.com/quote/AAPL"],
  };
}

function strategyFixture(ticker: string, tracking = false): Record<string, unknown> {
  return {
    ticker,
    updatedAt: "2026-05-01T00:00:00.000Z",
    version: 1,
    verdict: "HOLD",
    confidence: "low",
    reasoning: "Model synthesis: evidence is mixed, so keep the position provisional.",
    timeframe: "months",
    positionSizeILS: tracking ? 0 : 455,
    positionWeightPct: tracking ? 0 : 12,
    entryConditions: ["Add only after a fresh catalyst confirms upside."],
    exitConditions: ["Reduce if the thesis weakens or position risk grows."],
    catalysts: [{ description: "Next earnings update", expiresAt: "2026-06-15T00:00:00.000Z", triggered: false }],
    bullCase: "Upside remains possible if fundamentals improve.",
    bearCase: "Evidence remains mixed and sizing risk matters.",
    lastDeepDiveAt: "2026-05-01T00:00:00.000Z",
    deepDiveTriggeredBy: "step_queue",
    metadata: {
      source: tracking ? "deep_dive" : "full_report",
      status: "validated",
      generatedAt: "2026-05-01T00:00:00.000Z",
      userGuidanceApplied: false,
    },
    assetScope: tracking ? "tracking" : "portfolio",
    trackingStatus: tracking ? "active" : undefined,
    stance: tracking ? "candidate" : undefined,
    potentialScore: tracking ? 72 : undefined,
    urgencyScore: tracking ? 55 : undefined,
    urgencyLabel: tracking ? "medium" : undefined,
    portfolioFitScore: tracking ? 65 : undefined,
    suggestedAllocationPct: tracking ? 2 : undefined,
    suggestedAllocationILS: tracking ? 5000 : undefined,
    actionCatalysts: tracking
      ? [{ description: "Breakout confirmation", expiresAt: "2026-06-01T00:00:00.000Z", triggered: false }]
      : [],
    avoidConditions: tracking ? ["Avoid if valuation expands without matching evidence."] : [],
    nextReviewAt: tracking ? "2026-06-01T00:00:00.000Z" : undefined,
  };
}

test("step queue is globally enabled unless explicitly disabled", async () => {
  delete process.env["USE_STEP_QUEUE"];
  assert.equal(isStepQueueServiceEnabled(), true);
  assert.equal(await isStepQueueEnabledForUser("missing-user"), true);

  process.env["USE_STEP_QUEUE"] = "false";
  assert.equal(isStepQueueServiceEnabled(), false);
  assert.equal(await isStepQueueEnabledForUser("missing-user"), false);
  delete process.env["USE_STEP_QUEUE"];
});

test("terminal job status is completed only when no ticker failed", () => {
  assert.equal(resolveTerminalJobStatus({ total: 10, completed: 10, failed: 0, skipped: 0 }), "completed");
  assert.equal(resolveTerminalJobStatus({ total: 10, completed: 9, failed: 1, skipped: 0 }), "partial_completed");
  assert.equal(resolveTerminalJobStatus({ total: 1, completed: 0, failed: 1, skipped: 0 }), "failed");
  assert.equal(resolveTerminalJobStatus({ total: 0, completed: 0, failed: 0, skipped: 0 }), "failed");
});

test("full_report expansion mixes light pass and full deep dive per ticker", async () => {
  const ws = await setupWorkspace("expansion-mixed");
  await writeJson(ws.strategyFile("AAPL"), validStrategy("AAPL", "2026-04-01T00:00:00.000Z"));

  const expanded = await expandStepQueueJob(ws, { action: "full_report" });

  assert.equal(expanded.tickers.length, 2);
  assert.deepEqual(expanded.tickers[0]?.stepKinds, [
    "analyst.fundamentals",
    "analyst.technical",
    "analyst.sentiment",
    "analyst.macro",
    "analyst.risk",
  ]);
  assert.equal(expanded.tickers[0]?.fullDeepDive, false);
  assert.equal(expanded.tickers[1]?.ticker, "MSFT");
  assert.equal(expanded.tickers[1]?.stepKinds.length, 7);
  assert.equal(expanded.tickers[1]?.fullDeepDive, true);
});

test("deep_dive expansion always creates seven steps for the requested ticker", async () => {
  const ws = await setupWorkspace("expansion-deep-dive");
  await writeJson(ws.strategyFile("AAPL"), validStrategy("AAPL", "2026-04-01T00:00:00.000Z"));

  const expanded = await expandStepQueueJob(ws, { action: "deep_dive", ticker: "AAPL" });

  assert.equal(expanded.tickers.length, 1);
  assert.equal(expanded.tickers[0]?.ticker, "AAPL");
  assert.equal(expanded.tickers[0]?.stepKinds.length, 7);
  assert.equal(expanded.tickers[0]?.fullDeepDive, true);
});

test("escalation tickers force full deep dive during full_report expansion", async () => {
  const ws = await setupWorkspace("expansion-escalated");
  await writeJson(ws.strategyFile("AAPL"), validStrategy("AAPL", "2026-04-01T00:00:00.000Z"));
  await writeJson(ws.strategyFile("MSFT"), validStrategy("MSFT", "2026-04-01T00:00:00.000Z"));

  const expanded = await expandStepQueueJob(ws, {
    action: "full_report",
    escalationTickers: new Set(["MSFT"]),
  });

  assert.equal(expanded.tickers[0]?.stepKinds.length, 5);
  assert.equal(expanded.tickers[1]?.stepKinds.length, 7);
});

test("handler registry exposes all nine step handlers", () => {
  assert.deepEqual(registeredStepKinds().sort(), [
    "analyst.fundamentals",
    "analyst.macro",
    "analyst.risk",
    "analyst.sentiment",
    "analyst.technical",
    "debate",
    "quick_check.evaluate",
    "synthesis",
    "tracking.evaluate",
  ]);
});

test("technical handler validates and persists LLM artifact", async () => {
  const ws = await setupWorkspace("handler-technical");
  const step = claimedStep("analyst.technical", "AAPL");
  const handler = handlerFor("analyst.technical");
  const inputs = await handler.gatherInputs(step, ws);
  const prompt = handler.buildPrompt(inputs, "balanced");
  mockLlmJsonOnce(technicalFixture("AAPL"));
  const raw = await handler.call(prompt, { tier: "balanced", primary: "stub", fallback: null }, step, inputs);
  assertLlmCalledOnce();
  const validated = handler.validate(raw, prompt.schema);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const artifactPath = await handler.persistArtifact(validated.artifact, ws, step);
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf-8")) as { analyst?: string; ticker?: string };
  assert.equal(artifact.analyst, "technical");
  assert.equal(artifact.ticker, "AAPL");
});

test("sentiment handler validates and persists LLM artifact", async () => {
  const ws = await setupWorkspace("handler-sentiment");
  const step = claimedStep("analyst.sentiment", "AAPL");
  const handler = handlerFor("analyst.sentiment");
  const inputs = deterministicInputs(step, ws);
  const prompt = handler.buildPrompt(inputs, "balanced");
  mockLlmJsonOnce(sentimentFixture("AAPL"));
  const raw = await handler.call(prompt, { tier: "balanced", primary: "stub", fallback: null }, step, inputs);
  assertLlmCalledOnce();
  const validated = handler.validate(raw, prompt.schema, inputs);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const artifactPath = await handler.persistArtifact(validated.artifact, ws, step);
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf-8")) as { ticker?: string; analyst?: string };
  assert.equal(artifact.ticker, "AAPL");
  assert.equal(artifact.analyst, "sentiment");
});

test("macro handler validates and persists LLM artifact", async () => {
  const ws = await setupWorkspace("handler-macro");
  const step = claimedStep("analyst.macro", "AAPL");
  const handler = handlerFor("analyst.macro");
  const inputs = deterministicInputs(step, ws);
  const prompt = handler.buildPrompt(inputs, "balanced");
  mockLlmJsonOnce(macroFixture("AAPL"));
  const raw = await handler.call(prompt, { tier: "balanced", primary: "stub", fallback: null }, step, inputs);
  assertLlmCalledOnce();
  const validated = handler.validate(raw, prompt.schema, inputs);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const artifactPath = await handler.persistArtifact(validated.artifact, ws, step);
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf-8")) as { ticker?: string; analyst?: string };
  assert.equal(artifact.ticker, "AAPL");
  assert.equal(artifact.analyst, "macro");
});

test("risk handler validates and persists LLM artifact", async () => {
  const ws = await setupWorkspace("handler-risk");
  const step = claimedStep("analyst.risk", "AAPL");
  const handler = handlerFor("analyst.risk");
  const inputs = await handler.gatherInputs(step, ws);
  const prompt = handler.buildPrompt(inputs, "balanced");
  mockLlmJsonOnce(riskFixture("AAPL"));
  const raw = await handler.call(prompt, { tier: "balanced", primary: "stub", fallback: null }, step, inputs);
  assertLlmCalledOnce();
  const validated = handler.validate(raw, prompt.schema);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const artifactPath = await handler.persistArtifact(validated.artifact, ws, step);
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf-8")) as { ticker?: string; analyst?: string };
  assert.equal(artifact.ticker, "AAPL");
  assert.equal(artifact.analyst, "risk");
});

test("fundamentals normalizer recovers missing ticker from step inputs", async () => {
  const ws = await setupWorkspace("handler-fundamentals-normalize");
  const step = claimedStep("analyst.fundamentals", "AAPL");
  const handler = handlerFor("analyst.fundamentals");
  const inputs = {
    ...deterministicInputs(step, ws),
    data: { position: null, price: null, currentStrategy: null, userProfile: null },
  };
  const prompt = handler.buildPrompt(inputs, "cheap");
  const validated = handler.validate({ sources: ["https://finance.yahoo.com/"] }, prompt.schema, inputs);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal((validated.artifact as { ticker?: string }).ticker, "AAPL");
});

test("debate handler validates and persists LLM artifact", async () => {
  const ws = await setupWorkspace("handler-debate");
  const step = claimedStep("debate", "AAPL");
  const handler = handlerFor("debate");
  const inputs = deterministicInputs(step, ws);
  const prompt = handler.buildPrompt(inputs, "cheap");
  mockLlmJsonOnce(debateFixture("AAPL"));
  const raw = await handler.call(prompt, { tier: "cheap", primary: "stub", fallback: null }, step, inputs);
  assertLlmCalledOnce();
  const validated = handler.validate(raw, prompt.schema);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const artifactPath = await handler.persistArtifact(validated.artifact, ws, step);
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf-8")) as { ticker?: string; analyst?: string };
  assert.equal(artifact.ticker, "AAPL");
  assert.equal(artifact.analyst, "debate");
});

test("synthesis handler validates and persists LLM strategy", async () => {
  const ws = await setupWorkspace("handler-synthesis");
  const step = claimedStep("synthesis", "AAPL");
  const handler = handlerFor("synthesis");
  const inputs = deterministicInputs(step, ws);
  inputs.data["debate"] = {
    bullFinalVerdict: "HOLD",
    bearFinalVerdict: "HOLD",
    keyDisagreement: "Whether the evidence is enough for a confident add.",
    synthesisGuidance: "Keep the output provisional until richer evidence exists.",
  };
  const prompt = handler.buildPrompt(inputs, "cheap");
  mockLlmJsonOnce(strategyFixture("AAPL"));
  const raw = await handler.call(prompt, { tier: "cheap", primary: "stub", fallback: null }, step, inputs);
  assertLlmCalledOnce();
  const validated = handler.validate(raw, prompt.schema);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const artifactPath = await handler.persistArtifact(validated.artifact, ws, step);
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf-8")) as { ticker?: string; metadata?: { status?: string } };
  assert.equal(artifactPath, ws.strategyFile("AAPL"));
  assert.equal(artifact.ticker, "AAPL");
  assert.equal(artifact.metadata?.status, "validated");
});

test("synthesis handler writes tracking fields for non-held deep dive ideas", async () => {
  const ws = await setupWorkspace("handler-synthesis-tracking");
  const step = claimedStep("synthesis", "GOOGL");
  const handler = handlerFor("synthesis");
  const inputs = deterministicInputs(step, ws);
  inputs.data["portfolioContext"] = {
    isHeld: false,
    totalPortfolioILS: 250000,
    heldTickers: ["AAPL", "MSFT"],
    targetPositionILS: 0,
    targetWeightPct: 0,
  };
  inputs.data["price"] = {
    priceNative: 180,
    priceILS: 666,
    currency: "USD",
  };
  inputs.data["analystArtifacts"] = {
    ...inputs.data["analystArtifacts"] as Record<string, unknown>,
    risk: {
      positionValueILS: 0,
      portfolioWeightPct: 0,
      plPct: 0,
      riskFacts: "Ticker GOOGL is not currently held in this portfolio. Risk snapshot is watchlist-style with 0% current portfolio weight.",
    },
    fundamentals: {
      fundamentalView: "Revenue trend is improving and valuation looks fair.",
      valuation: { assessment: "fair" },
    },
    technical: {
      technicalView: "Price is near support.",
      price: { current: 180 },
      keyLevels: { support: 175, resistance: 210 },
    },
    sentiment: {
      sentimentView: "Narrative is improving.",
      narrativeShift: "improving",
      majorNews: [{ sentiment: "positive", headline: "Cloud demand improves" }],
    },
  };
  inputs.data["debate"] = {
    bullFinalVerdict: "BUY",
    bearFinalVerdict: "HOLD",
    keyDisagreement: "Whether valuation leaves enough upside.",
    synthesisGuidance: "Track as a candidate if portfolio sizing stays conservative.",
  };

  const prompt = handler.buildPrompt(inputs, "cheap");
  mockLlmJsonOnce(strategyFixture("GOOGL", true));
  const raw = await handler.call(prompt, { tier: "cheap", primary: "stub", fallback: null }, step, inputs);
  assertLlmCalledOnce();
  const validated = handler.validate(raw, prompt.schema, inputs);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const strategy = validated.artifact as {
    assetScope?: string;
    trackingStatus?: string;
    stance?: string | null;
    potentialScore?: number | null;
    urgencyScore?: number | null;
    portfolioFitScore?: number | null;
    suggestedAllocationPct?: number | null;
    suggestedAllocationILS?: number | null;
    actionCatalysts?: unknown[];
    avoidConditions?: unknown[];
  };
  assert.equal(strategy.assetScope, "tracking");
  assert.equal(strategy.trackingStatus, "active");
  assert.equal(strategy.stance, "candidate");
  assert.ok((strategy.potentialScore ?? -1) >= 0 && (strategy.potentialScore ?? 101) <= 100);
  assert.ok((strategy.urgencyScore ?? -1) >= 0 && (strategy.urgencyScore ?? 101) <= 100);
  assert.ok((strategy.portfolioFitScore ?? -1) >= 0 && (strategy.portfolioFitScore ?? 101) <= 100);
  assert.ok((strategy.suggestedAllocationPct ?? 0) > 0);
  assert.ok((strategy.suggestedAllocationILS ?? 0) > 0);
  assert.ok((strategy.actionCatalysts ?? []).length > 0);
  assert.ok((strategy.avoidConditions ?? []).length > 0);
});

// ── Phase 2: new expansion and handler tests ─────────────────────────────────

test("daily_brief expansion creates quick_check steps for held tickers", async () => {
  const ws = await setupWorkspace("expansion-daily-brief");
  await writeJson(ws.strategyFile("AAPL"), validStrategy("AAPL", "2026-04-01T00:00:00.000Z"));
  await writeJson(ws.strategyFile("MSFT"), validStrategy("MSFT", "2026-04-01T00:00:00.000Z"));

  const expanded = await expandStepQueueJob(ws, { action: "daily_brief" });

  // Both held tickers should get quick_check.evaluate steps
  assert.equal(expanded.action, "daily_brief");
  assert.ok(expanded.tickers.length >= 2, "should have at least 2 tickers");
  for (const ticker of expanded.tickers) {
    assert.deepEqual(ticker.stepKinds, ["quick_check.evaluate"]);
    assert.equal(ticker.fullDeepDive, false);
  }
});

test("quick_check expansion creates a single quick_check.evaluate step", async () => {
  const ws = await setupWorkspace("expansion-quick-check");
  await writeJson(ws.strategyFile("AAPL"), validStrategy("AAPL", "2026-04-01T00:00:00.000Z"));

  const expanded = await expandStepQueueJob(ws, { action: "quick_check", ticker: "AAPL" });

  assert.equal(expanded.action, "quick_check");
  assert.equal(expanded.tickers.length, 1);
  assert.equal(expanded.tickers[0]?.ticker, "AAPL");
  assert.deepEqual(expanded.tickers[0]?.stepKinds, ["quick_check.evaluate"]);
  assert.equal(expanded.tickers[0]?.fullDeepDive, false);
});

test("full_report expansion does not include quick_check or tracking steps", async () => {
  const ws = await setupWorkspace("expansion-full-report-no-qc");
  await writeJson(ws.strategyFile("AAPL"), validStrategy("AAPL", "2026-04-01T00:00:00.000Z"));

  const expanded = await expandStepQueueJob(ws, { action: "full_report" });

  for (const ticker of expanded.tickers) {
    assert.ok(
      !ticker.stepKinds.includes("quick_check.evaluate"),
      "full_report should not include quick_check.evaluate"
    );
    assert.ok(
      !ticker.stepKinds.includes("tracking.evaluate"),
      "full_report should not include tracking.evaluate"
    );
  }
});

test("quick_check.evaluate handler produces a valid artifact without LLM", async () => {
  const ws = await setupWorkspace("handler-quick-check");
  const step = claimedStep("quick_check.evaluate", "AAPL");
  await writeJson(ws.strategyFile("AAPL"), validStrategy("AAPL", "2026-04-01T00:00:00.000Z"));

  const { executeQuickCheckStep } = await import("./stepQueue/handlers/quickCheck.js");
  const result = await executeQuickCheckStep(step, ws);

  assert.equal(result.ticker, "AAPL");
  assert.ok(typeof result.score === "number" && result.score >= 0 && result.score <= 100);
  assert.ok(Array.isArray(result.signals));
  assert.ok(typeof result.signalSetFingerprint === "string" && result.signalSetFingerprint.length > 0);
  assert.ok(typeof result.shouldEscalate === "boolean");
  assert.ok(typeof result.snoozeSuppressed === "boolean");

  // Artifact should be persisted
  const artifactPath = path.join(ws.reportsDir, "AAPL", "quick_check.json");
  const raw = JSON.parse(await fs.readFile(artifactPath, "utf-8")) as { ticker?: string };
  assert.equal(raw.ticker, "AAPL");
});

test("quick_check.evaluate signals stale strategy (no deep dive ever)", async () => {
  const ws = await setupWorkspace("handler-quick-check-stale");
  const step = claimedStep("quick_check.evaluate", "AAPL");
  // Strategy with no lastDeepDiveAt
  await writeJson(ws.strategyFile("AAPL"), validStrategy("AAPL", null));

  const { executeQuickCheckStep } = await import("./stepQueue/handlers/quickCheck.js");
  const result = await executeQuickCheckStep(step, ws);

  assert.ok(result.signals.some((s) => s.includes("no_deep_dive_ever")));
  assert.ok(result.score < 100, "score should be reduced for stale strategy");
});

test("quick_check.evaluate signals expired catalyst", async () => {
  const ws = await setupWorkspace("handler-quick-check-expired");
  const step = claimedStep("quick_check.evaluate", "AAPL");
  const strategyWithExpiredCatalyst = {
    ...validStrategy("AAPL", "2026-04-01T00:00:00.000Z"),
    catalysts: [
      { description: "Earnings beat", expiresAt: "2020-01-01T00:00:00.000Z", triggered: false },
    ],
  };
  await writeJson(ws.strategyFile("AAPL"), strategyWithExpiredCatalyst);

  const { executeQuickCheckStep } = await import("./stepQueue/handlers/quickCheck.js");
  const result = await executeQuickCheckStep(step, ws);

  assert.ok(result.signals.some((s) => s.includes("catalyst_expired")));
  assert.ok(result.score < 100);
});

test("tracking.evaluate handler produces a valid artifact without LLM", async () => {
  const ws = await setupWorkspace("handler-tracking-evaluate");
  const step = claimedStep("tracking.evaluate", "GOOGL");
  await writeJson(ws.strategyFile("GOOGL"), {
    ...validStrategy("GOOGL", null),
    assetScope: "tracking",
    trackingStatus: "active",
  });

  const { executeTrackingEvaluateStep } = await import("./stepQueue/handlers/dailyBrief.js");
  const result = await executeTrackingEvaluateStep(step, ws);

  assert.equal(result.ticker, "GOOGL");
  assert.ok(Array.isArray(result.signals));
  assert.ok(typeof result.shouldEscalate === "boolean");
  assert.ok(typeof result.signalSetFingerprint === "string");

  // Artifact should be persisted
  const artifactPath = path.join(ws.reportsDir, "GOOGL", "tracking_evaluate.json");
  const raw = JSON.parse(await fs.readFile(artifactPath, "utf-8")) as { ticker?: string };
  assert.equal(raw.ticker, "GOOGL");
});

test("tracking.evaluate never escalates muted assets", async () => {
  const ws = await setupWorkspace("handler-tracking-muted");
  const step = claimedStep("tracking.evaluate", "TSLA");
  await writeJson(ws.strategyFile("TSLA"), {
    ...validStrategy("TSLA", null),
    assetScope: "tracking",
    trackingStatus: "muted",
  });

  const { executeTrackingEvaluateStep } = await import("./stepQueue/handlers/dailyBrief.js");
  const result = await executeTrackingEvaluateStep(step, ws);

  assert.equal(result.shouldEscalate, false);
  assert.deepEqual(result.signals, []);
});

test("quick_check.evaluate normalizer recovers missing strategy gracefully", async () => {
  const ws = await setupWorkspace("handler-quick-check-missing-strategy");
  const step = claimedStep("quick_check.evaluate", "NVDA");
  // No strategy file written — should produce a signal and not throw

  const { executeQuickCheckStep } = await import("./stepQueue/handlers/quickCheck.js");
  const result = await executeQuickCheckStep(step, ws);

  assert.equal(result.ticker, "NVDA");
  assert.ok(result.signals.includes("strategy_invalid_or_missing"));
  assert.equal(result.score, 0);
});
