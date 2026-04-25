import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { UserWorkspace } from "../middleware/userIsolation.js";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "baseline-coverage-"));
const usersDir = path.join(testRoot, "users");
process.env["USERS_DIR"] = usersDir;

interface TestContext {
  ws: UserWorkspace;
  summarizeBaselineCoverage: typeof import("./baselineCoverageService.js")["summarizeBaselineCoverage"];
  syncStateToBaselineCoverage: typeof import("./baselineCoverageService.js")["syncStateToBaselineCoverage"];
  readState: typeof import("./stateService.js")["readState"];
}

async function setupWorkspace(userId: string): Promise<TestContext> {
  const [{ buildWorkspace }, baselineCoverageService, stateService] = await Promise.all([
    import("../middleware/userIsolation.js"),
    import("./baselineCoverageService.js"),
    import("./stateService.js"),
  ]);

  const ws = buildWorkspace(userId, usersDir);
  await fs.mkdir(ws.tickersDir, { recursive: true });
  await writeJson(ws.portfolioFile, {
    meta: { currency: "ILS", transactionFeeILS: 0, note: "test" },
    accounts: {
      main: [
        { ticker: "MSFT", exchange: "NASDAQ", shares: 5, unitAvgBuyPrice: 100, unitCurrency: "USD" },
        { ticker: "AAPL", exchange: "NASDAQ", shares: 4, unitAvgBuyPrice: 100, unitCurrency: "USD" },
        { ticker: "TSM", exchange: "NYSE", shares: 3, unitAvgBuyPrice: 100, unitCurrency: "USD" },
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
    summarizeBaselineCoverage: baselineCoverageService.summarizeBaselineCoverage,
    syncStateToBaselineCoverage: baselineCoverageService.syncStateToBaselineCoverage,
    readState: stateService.readState,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function strategyFor(ticker: string, overrides: Record<string, unknown>) {
  return {
    ticker,
    updatedAt: new Date().toISOString(),
    version: 2,
    verdict: "ADD",
    confidence: "high",
    reasoning: `${ticker} thesis remains favorable.`,
    timeframe: "months",
    positionSizeILS: 2000,
    positionWeightPct: 20,
    entryConditions: ["Add on strength"],
    exitConditions: ["Reduce on thesis break"],
    catalysts: [
      {
        description: "Scheduled review",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        triggered: false,
      },
    ],
    bullCase: "Execution remains strong.",
    bearCase: "Cycle risk remains.",
    lastDeepDiveAt: new Date().toISOString(),
    deepDiveTriggeredBy: "full_report",
    ...overrides,
  };
}

test("summarizeBaselineCoverage returns blocking and refresh candidates in portfolio order", async () => {
  const ctx = await setupWorkspace("baseline-summary");
  const staleDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();

  await writeJson(ctx.ws.strategyFile("MSFT"), strategyFor("MSFT", {}));
  await writeJson(
    ctx.ws.strategyFile("AAPL"),
    strategyFor("AAPL", {
      reasoning: "Pending initial analysis",
      confidence: "low",
      timeframe: "undefined",
      lastDeepDiveAt: null,
      deepDiveTriggeredBy: null,
      metadata: {
        source: "bootstrap",
        status: "provisional",
        generatedAt: new Date().toISOString(),
        userGuidanceApplied: true,
      },
    })
  );
  await writeJson(
    ctx.ws.strategyFile("TSM"),
    strategyFor("TSM", {
      updatedAt: staleDate,
      lastDeepDiveAt: staleDate,
      metadata: {
        source: "deep_dive",
        status: "validated",
        generatedAt: staleDate,
        userGuidanceApplied: false,
      },
    })
  );

  const summary = await ctx.summarizeBaselineCoverage(ctx.ws);
  assert.equal(summary.totalTickers, 3);
  assert.equal(summary.valid, 1);
  assert.equal(summary.provisional, 1);
  assert.equal(summary.stale, 1);
  assert.deepEqual(summary.completedTickers, ["MSFT", "TSM"]);
  assert.deepEqual(summary.blockingTickers.map((item) => item.ticker), ["AAPL"]);
  assert.deepEqual(summary.refreshCandidates.map((item) => item.ticker), ["TSM"]);
});

test("syncStateToBaselineCoverage advances bootstrapping user once blockers are cleared", async () => {
  const ctx = await setupWorkspace("baseline-sync");
  const now = new Date().toISOString();

  await writeJson(ctx.ws.strategyFile("MSFT"), strategyFor("MSFT", {}));
  await writeJson(ctx.ws.strategyFile("AAPL"), strategyFor("AAPL", {}));
  await writeJson(ctx.ws.strategyFile("TSM"), strategyFor("TSM", {}));

  const summary = await ctx.syncStateToBaselineCoverage(ctx.ws, {
    lastFullReportAt: now,
    enqueueBlockingTickers: true,
  });
  const state = await ctx.readState(ctx.ws.userId);

  assert.equal(summary.blockingTickers.length, 0);
  assert.equal(state.state, "ACTIVE");
  assert.equal(state.bootstrapProgress, null);
  assert.equal(state.lastFullReportAt, now);
});
