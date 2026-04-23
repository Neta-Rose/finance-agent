import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { UserWorkspace } from "../middleware/userIsolation.js";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "strategy-baseline-"));
const usersDir = path.join(testRoot, "users");
process.env["USERS_DIR"] = usersDir;

interface TestContext {
  ws: UserWorkspace;
  assessStrategyBaselineForTicker: typeof import("./strategyBaselineService.js")["assessStrategyBaselineForTicker"];
  buildStrategyMetadata: typeof import("./strategyBaselineService.js")["buildStrategyMetadata"];
}

async function setupWorkspace(userId: string): Promise<TestContext> {
  const [{ buildWorkspace }, baselineService] = await Promise.all([
    import("../middleware/userIsolation.js"),
    import("./strategyBaselineService.js"),
  ]);

  const ws = buildWorkspace(userId, usersDir);
  await fs.mkdir(ws.tickersDir, { recursive: true });

  return {
    ws,
    assessStrategyBaselineForTicker: baselineService.assessStrategyBaselineForTicker,
    buildStrategyMetadata: baselineService.buildStrategyMetadata,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function portfolioFor(ticker: string) {
  return {
    meta: { currency: "ILS", transactionFeeILS: 0, note: "test" },
    accounts: {
      main: [
        {
          ticker,
          exchange: "NASDAQ",
          shares: 5,
          unitAvgBuyPrice: 100,
          unitCurrency: "USD",
        },
      ],
    },
  };
}

test("assessStrategyBaselineForTicker classifies bootstrap placeholder as provisional", async () => {
  const ctx = await setupWorkspace("strategy-bootstrap");
  const generatedAt = new Date().toISOString();

  await writeJson(ctx.ws.portfolioFile, portfolioFor("AAPL"));
  await writeJson(ctx.ws.strategyFile("AAPL"), {
    ticker: "AAPL",
    updatedAt: generatedAt,
    version: 1,
    verdict: "HOLD",
    confidence: "low",
    reasoning: "Pending initial analysis",
    timeframe: "undefined",
    positionSizeILS: 0,
    positionWeightPct: 0,
    entryConditions: [],
    exitConditions: [],
    catalysts: [],
    bullCase: null,
    bearCase: null,
    lastDeepDiveAt: null,
    deepDiveTriggeredBy: null,
    metadata: ctx.buildStrategyMetadata("bootstrap", "provisional", generatedAt, true),
  });

  const result = await ctx.assessStrategyBaselineForTicker(ctx.ws, "AAPL");
  assert.equal(result.trustLevel, "provisional");
  assert.equal(result.strategy?.metadata?.source, "bootstrap");
  assert.equal(result.strategy?.metadata?.userGuidanceApplied, true);
});

test("assessStrategyBaselineForTicker treats healthy legacy strategy as valid", async () => {
  const ctx = await setupWorkspace("strategy-valid");
  const now = new Date().toISOString();

  await writeJson(ctx.ws.portfolioFile, portfolioFor("MSFT"));
  await writeJson(ctx.ws.strategyFile("MSFT"), {
    ticker: "MSFT",
    updatedAt: now,
    version: 2,
    verdict: "ADD",
    confidence: "high",
    reasoning: "Thesis remains favorable.",
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
    lastDeepDiveAt: now,
    deepDiveTriggeredBy: "full_report",
  });

  const result = await ctx.assessStrategyBaselineForTicker(ctx.ws, "MSFT");
  assert.equal(result.trustLevel, "valid");
  assert.equal(result.strategy?.metadata?.source, "deep_dive");
});

test("assessStrategyBaselineForTicker marks old validated strategy as stale", async () => {
  const ctx = await setupWorkspace("strategy-stale");
  const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();

  await writeJson(ctx.ws.portfolioFile, portfolioFor("NVDA"));
  await writeJson(ctx.ws.strategyFile("NVDA"), {
    ticker: "NVDA",
    updatedAt: oldDate,
    version: 2,
    verdict: "HOLD",
    confidence: "medium",
    reasoning: "Still constructive but needs refresh.",
    timeframe: "months",
    positionSizeILS: 3000,
    positionWeightPct: 30,
    entryConditions: [],
    exitConditions: [],
    catalysts: [
      {
        description: "Old catalyst",
        expiresAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        triggered: false,
      },
    ],
    bullCase: "Demand remains durable.",
    bearCase: "Multiple compression remains possible.",
    lastDeepDiveAt: oldDate,
    deepDiveTriggeredBy: "quick_check",
    metadata: ctx.buildStrategyMetadata("deep_dive", "validated", oldDate, false),
  });

  const result = await ctx.assessStrategyBaselineForTicker(ctx.ws, "NVDA");
  assert.equal(result.trustLevel, "stale");
  assert.ok(result.issues.some((issue) => issue.includes("older than")));
});

test("assessStrategyBaselineForTicker marks malformed strategy as invalid", async () => {
  const ctx = await setupWorkspace("strategy-invalid");
  await writeJson(ctx.ws.portfolioFile, portfolioFor("TSM"));
  await fs.mkdir(path.dirname(ctx.ws.strategyFile("TSM")), { recursive: true });
  await fs.writeFile(ctx.ws.strategyFile("TSM"), "{bad json", "utf-8");

  const result = await ctx.assessStrategyBaselineForTicker(ctx.ws, "TSM");
  assert.equal(result.trustLevel, "invalid");
  assert.equal(result.strategy, null);
  assert.ok(result.issues.some((issue) => issue.includes("Invalid strategy JSON")));
});
