import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { UserWorkspace } from "../middleware/userIsolation.js";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "strategies-routes-"));
const usersDir = path.join(testRoot, "users");
process.env["USERS_DIR"] = usersDir;
process.env["APP_DATABASE_URL"] = "";

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function setupUser(userId: string): Promise<UserWorkspace> {
  const { buildWorkspace } = await import("../middleware/userIsolation.js");
  const ws = buildWorkspace(userId, usersDir);
  await fs.mkdir(ws.root, { recursive: true });
  await fs.mkdir(ws.tickersDir, { recursive: true });
  return ws;
}

function strategyFixture(ticker: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticker,
    updatedAt: "2026-05-01T17:25:18.688Z",
    version: 1,
    verdict: "HOLD",
    confidence: "low",
    reasoning: `${ticker} route fixture.`,
    timeframe: "months",
    positionSizeILS: 1000,
    positionWeightPct: 5,
    entryConditions: [],
    exitConditions: [],
    catalysts: [],
    bullCase: null,
    bearCase: null,
    lastDeepDiveAt: null,
    deepDiveTriggeredBy: "step_queue",
    metadata: {
      source: "full_report",
      status: "provisional",
      generatedAt: "2026-05-01T17:25:18.688Z",
      userGuidanceApplied: false,
    },
    ...extra,
  };
}

async function writePortfolio(ws: UserWorkspace, ticker: string): Promise<void> {
  await writeJson(ws.portfolioFile, {
    meta: {
      currency: "ILS",
      transactionFeeILS: 0,
      note: "route test",
    },
    accounts: {
      main: [
        {
          ticker,
          exchange: "NASDAQ",
          shares: 1,
          unitAvgBuyPrice: 100,
          unitCurrency: "USD",
        },
      ],
    },
  });
}

async function invokeRouterJson(
  url: string,
  ws: UserWorkspace
): Promise<{ statusCode: number; body: unknown }> {
  const strategiesRouter = (await import("./strategies.js")).default as unknown as {
    handle: (req: object, res: object, next: (error?: unknown) => void) => void;
  };

  return await new Promise((resolve, reject) => {
    const req = {
      method: "GET",
      url,
      originalUrl: url,
      headers: {},
    };
    const res = {
      locals: { workspace: ws },
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        resolve({ statusCode: this.statusCode, body });
        return this;
      },
    };

    strategiesRouter.handle(req, res, (error?: unknown) => {
      if (error) reject(error);
      else reject(new Error(`Route fell through without response for ${url}`));
    });
  });
}

test("GET /strategies/:ticker accepts dotted exchange suffix tickers", async () => {
  const ws = await setupUser("route-strategy-dotted-ticker");
  await writeJson(ws.strategyFile("ESLT.TA"), {
    ...strategyFixture("ESLT.TA"),
    reasoning: "Dotted ticker route fixture.",
  });

  const result = await invokeRouterJson("/strategies/ESLT.TA", ws);
  assert.equal(result.statusCode, 200);
  assert.equal((result.body as { ticker?: string }).ticker, "ESLT.TA");
});

test("GET /strategies classifies owned strategies as portfolio scope", async () => {
  const ws = await setupUser("route-strategies-portfolio-scope");
  await writePortfolio(ws, "AAPL");
  await writeJson(ws.strategyFile("AAPL"), strategyFixture("AAPL"));

  const result = await invokeRouterJson("/strategies", ws);
  assert.equal(result.statusCode, 200);

  const body = result.body as { strategies?: Array<{ ticker: string; inPortfolio: boolean; scope: string; trackingStatus: string | null }> };
  assert.equal(body.strategies?.[0]?.ticker, "AAPL");
  assert.equal(body.strategies?.[0]?.inPortfolio, true);
  assert.equal(body.strategies?.[0]?.scope, "portfolio");
  assert.equal(body.strategies?.[0]?.trackingStatus, null);
});

test("GET /strategies classifies non-held strategy files as tracking scope", async () => {
  const ws = await setupUser("route-strategies-tracking-scope");
  await writePortfolio(ws, "AAPL");
  await writeJson(ws.strategyFile("GOOGL"), strategyFixture("GOOGL", {
    assetScope: "tracking",
    stance: "candidate",
    potentialScore: 75,
    urgencyScore: 55,
    suggestedAllocationPct: 4,
    suggestedAllocationILS: 12000,
  }));

  const result = await invokeRouterJson("/strategies", ws);
  assert.equal(result.statusCode, 200);

  const body = result.body as {
    strategies?: Array<{
      ticker: string;
      inPortfolio: boolean;
      scope: string;
      trackingStatus: string | null;
      stance: string | null;
      potentialScore: number | null;
      suggestedAllocationPct: number | null;
    }>;
  };
  assert.equal(body.strategies?.[0]?.ticker, "GOOGL");
  assert.equal(body.strategies?.[0]?.inPortfolio, false);
  assert.equal(body.strategies?.[0]?.scope, "tracking");
  assert.equal(body.strategies?.[0]?.trackingStatus, "active");
  assert.equal(body.strategies?.[0]?.stance, "candidate");
  assert.equal(body.strategies?.[0]?.potentialScore, 75);
  assert.equal(body.strategies?.[0]?.suggestedAllocationPct, 4);
});
