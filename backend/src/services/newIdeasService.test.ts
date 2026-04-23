import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { UserWorkspace } from "../middleware/userIsolation.js";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "new-ideas-service-"));
const usersDir = path.join(testRoot, "users");
process.env["USERS_DIR"] = usersDir;

interface TestContext {
  ws: UserWorkspace;
  runNewIdeasJob: typeof import("./newIdeasService.js")["runNewIdeasJob"];
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function setupWorkspace(userId: string, tickers: string[]): Promise<TestContext> {
  const [{ buildWorkspace }, newIdeasService] = await Promise.all([
    import("../middleware/userIsolation.js"),
    import("./newIdeasService.js"),
  ]);

  const ws = buildWorkspace(userId, usersDir);
  await fs.mkdir(ws.jobsDir, { recursive: true });
  await fs.mkdir(ws.reportsDir, { recursive: true });

  await writeJson(ws.portfolioFile, {
    meta: { currency: "ILS", transactionFeeILS: 0, note: "test" },
    accounts: {
      main: tickers.map((ticker) => ({
        ticker,
        exchange: "NASDAQ",
        shares: 10,
        unitAvgBuyPrice: 100,
        unitCurrency: "USD",
      })),
    },
  });

  return {
    ws,
    runNewIdeasJob: newIdeasService.runNewIdeasJob,
  };
}

async function writeJob(ws: UserWorkspace, id: string) {
  const job = {
    id,
    action: "new_ideas" as const,
    ticker: null,
    status: "pending" as const,
    triggered_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
  };
  await writeJson(ws.jobFile(job.id), job);
  return job;
}

test("runNewIdeasJob creates deterministic gap-based idea batch", async () => {
  const ctx = await setupWorkspace("new-ideas-basic", ["MSFT", "NVDA"]);
  const job = await writeJob(ctx.ws, "job_test_new_ideas_basic");

  const completed = await ctx.runNewIdeasJob(ctx.ws, job);
  assert.equal(completed.status, "completed");

  const result = completed.result as {
    totalIdeas: number;
    ideas: Array<{ ticker: string }>;
  };

  assert.equal(result.totalIdeas, 4);
  assert.deepEqual(
    result.ideas.map((idea) => idea.ticker),
    ["VOO", "GLD", "GOVT", "EEM"]
  );

  const page = JSON.parse(
    await fs.readFile(path.join(ctx.ws.reportsDir, "index", "page-001.json"), "utf-8")
  ) as {
    batches: Array<{
      batchId: string;
      mode: string;
      tickers: string[];
      entries: Record<string, { hasBullCase: boolean; hasBearCase: boolean }>;
    }>;
  };

  assert.equal(page.batches[0]?.mode, "new_ideas");
  assert.deepEqual(page.batches[0]?.tickers, ["VOO", "GLD", "GOVT", "EEM"]);
  assert.equal(page.batches[0]?.entries["VOO"]?.hasBullCase, true);
  assert.equal(page.batches[0]?.entries["VOO"]?.hasBearCase, true);

  const strategy = JSON.parse(
    await fs.readFile(path.join(ctx.ws.reportsDir, "VOO", "strategy.json"), "utf-8")
  ) as { ticker: string; deepDiveTriggeredBy: string };
  assert.equal(strategy.ticker, "VOO");
  assert.equal(strategy.deepDiveTriggeredBy, "new_ideas");
});

test("runNewIdeasJob excludes already-owned category proxies", async () => {
  const ctx = await setupWorkspace("new-ideas-owned", ["VOO", "GLD", "MSFT"]);
  const job = await writeJob(ctx.ws, "job_test_new_ideas_owned");

  const completed = await ctx.runNewIdeasJob(ctx.ws, job);
  const result = completed.result as {
    ideas: Array<{ ticker: string }>;
  };

  assert.equal(result.ideas.some((idea) => idea.ticker === "VOO"), false);
  assert.equal(result.ideas.some((idea) => idea.ticker === "GLD"), false);
});
