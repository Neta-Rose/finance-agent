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
delete process.env["USE_STEP_QUEUE"];
delete process.env["USE_STEP_QUEUE_USERS"];

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

test("step queue feature flags default off", async () => {
  assert.equal(isStepQueueServiceEnabled(), false);
  assert.equal(await isStepQueueEnabledForUser("missing-user"), false);
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

test("handler registry exposes all seven step handlers", () => {
  assert.deepEqual(registeredStepKinds().sort(), [
    "analyst.fundamentals",
    "analyst.macro",
    "analyst.risk",
    "analyst.sentiment",
    "analyst.technical",
    "debate",
    "synthesis",
  ]);
});

test("technical handler validates and persists deterministic artifact", async () => {
  const ws = await setupWorkspace("handler-technical");
  const step = claimedStep("analyst.technical", "AAPL");
  const handler = handlerFor("analyst.technical");
  const inputs = await handler.gatherInputs(step, ws);
  const prompt = handler.buildPrompt(inputs, "balanced");
  const raw = await handler.call(prompt, { tier: "balanced", primary: "stub", fallback: null }, step, inputs);
  const validated = handler.validate(raw, prompt.schema);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const artifactPath = await handler.persistArtifact(validated.artifact, ws, step);
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf-8")) as { analyst?: string; ticker?: string };
  assert.equal(artifact.analyst, "technical");
  assert.equal(artifact.ticker, "AAPL");
});

test("risk handler validates and persists deterministic artifact", async () => {
  const ws = await setupWorkspace("handler-risk");
  const step = claimedStep("analyst.risk", "AAPL");
  const handler = handlerFor("analyst.risk");
  const inputs = await handler.gatherInputs(step, ws);
  const prompt = handler.buildPrompt(inputs, "balanced");
  const raw = await handler.call(prompt, { tier: "balanced", primary: "stub", fallback: null }, step, inputs);
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

test("debate handler validates and persists deterministic artifact", async () => {
  const ws = await setupWorkspace("handler-debate");
  const step = claimedStep("debate", "AAPL");
  const handler = handlerFor("debate");
  const inputs = deterministicInputs(step, ws);
  const prompt = handler.buildPrompt(inputs, "cheap");
  const raw = await handler.call(prompt, { tier: "cheap", primary: "stub", fallback: null }, step, inputs);
  const validated = handler.validate(raw, prompt.schema);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const artifactPath = await handler.persistArtifact(validated.artifact, ws, step);
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf-8")) as { ticker?: string; analyst?: string };
  assert.equal(artifact.ticker, "AAPL");
  assert.equal(artifact.analyst, "debate");
});

test("synthesis handler validates and persists deterministic strategy", async () => {
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
  const raw = await handler.call(prompt, { tier: "cheap", primary: "stub", fallback: null }, step, inputs);
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
  const raw = await handler.call(prompt, { tier: "cheap", primary: "stub", fallback: null }, step, inputs);
  const validated = handler.validate(raw, prompt.schema);
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
