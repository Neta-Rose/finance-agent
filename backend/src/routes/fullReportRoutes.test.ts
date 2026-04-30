import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { UserWorkspace } from "../middleware/userIsolation.js";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "full-report-routes-"));
const usersDir = path.join(testRoot, "users");
process.env["USERS_DIR"] = usersDir;

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function setupUser(userId: string): Promise<UserWorkspace> {
  const { buildWorkspace } = await import("../middleware/userIsolation.js");
  const ws = buildWorkspace(userId, usersDir);
  await fs.mkdir(ws.root, { recursive: true });
  await fs.mkdir(ws.reportsDir, { recursive: true });
  await fs.mkdir(ws.tickersDir, { recursive: true });
  return ws;
}

async function invokeRouterJson(
  url: string,
  ws: UserWorkspace
): Promise<{ statusCode: number; body: unknown }> {
  const reportsRouter = (await import("./reports.js")).default as unknown as {
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

    reportsRouter.handle(req, res, (error?: unknown) => {
      if (error) reject(error);
      else reject(new Error(`Route fell through without response for ${url}`));
    });
  });
}

test("GET /reports/strategy/:ticker returns repaired canonical strategy", async () => {
  const ws = await setupUser("route-strategy-repair");
  await writeJson(ws.strategyFile("TSM"), {
    ticker: "tsm",
    updatedAt: new Date().toISOString(),
    version: 1,
    verdict: "hold",
    confidence: "medium",
    reasoning: "Repair through route.",
    timeframe: "month",
    positionSizeILS: "1000",
    positionWeightPct: "5",
    entryConditions: "Add on strength",
    exitConditions: [],
    catalysts: ["Scheduled review"],
    bullCase: null,
    bearCase: null,
    lastDeepDiveAt: null,
    deepDiveTriggeredBy: "full_report",
    metadata: {
      source: "bootstrap_analysis",
      status: "valid",
      generatedAt: new Date().toISOString(),
      userGuidanceApplied: false,
    },
  });

  const result = await invokeRouterJson("/reports/strategy/TSM", ws);
  assert.equal(result.statusCode, 200);

  const body = result.body as {
    ticker: string;
    timeframe: string;
    entryConditions: string[];
    catalysts: Array<{ description: string }>;
    metadata?: { source?: string; status?: string };
  };
  assert.equal(body.ticker, "TSM");
  assert.equal(body.timeframe, "months");
  assert.deepEqual(body.entryConditions, ["Add on strength"]);
  assert.equal(body.metadata?.source, "bootstrap");
  assert.equal(body.metadata?.status, "validated");
  assert.equal(body.catalysts[0]?.description, "Scheduled review");
});

test("GET /reports/strategy/:ticker returns 422 for unrecoverable strategy", async () => {
  const ws = await setupUser("route-strategy-invalid");
  await fs.mkdir(path.dirname(ws.strategyFile("NVDA")), { recursive: true });
  await fs.writeFile(ws.strategyFile("NVDA"), "{bad json", "utf-8");

  const result = await invokeRouterJson("/reports/strategy/NVDA", ws);
  assert.equal(result.statusCode, 422);

  const body = result.body as { error?: string; details?: string[] };
  assert.equal(body.error, "Strategy is not valid");
  assert.ok((body.details ?? []).some((detail) => detail.includes("Invalid JSON")));
});
