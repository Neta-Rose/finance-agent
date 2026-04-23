import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { UserWorkspace } from "../middleware/userIsolation.js";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "quick-check-service-"));
const usersDir = path.join(testRoot, "users");
process.env["USERS_DIR"] = usersDir;

interface TestContext {
  ws: UserWorkspace;
  performQuickCheck: typeof import("./quickCheckService.js")["performQuickCheck"];
}

async function setupWorkspace(userId: string): Promise<TestContext> {
  const [{ buildWorkspace }, quickCheckService] = await Promise.all([
    import("../middleware/userIsolation.js"),
    import("./quickCheckService.js"),
  ]);

  const ws = buildWorkspace(userId, usersDir);
  await fs.mkdir(ws.reportsDir, { recursive: true });
  await fs.mkdir(ws.tickersDir, { recursive: true });
  return {
    ws,
    performQuickCheck: quickCheckService.performQuickCheck,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

test("performQuickCheck degrades invalid strategy baseline without throwing", async () => {
  const ctx = await setupWorkspace("quick-check-invalid");
  await writeJson(ctx.ws.portfolioFile, {
    meta: { currency: "ILS", transactionFeeILS: 0, note: "test" },
    accounts: {
      main: [
        {
          ticker: "TSM",
          exchange: "NYSE",
          shares: 5,
          unitAvgBuyPrice: 100,
          unitCurrency: "USD",
        },
      ],
    },
  });

  await fs.mkdir(path.dirname(ctx.ws.strategyFile("TSM")), { recursive: true });
  await fs.writeFile(ctx.ws.strategyFile("TSM"), "{bad json", "utf-8");

  const result = await ctx.performQuickCheck(ctx.ws, "TSM", { queueDeepDive: false });
  assert.equal(result.baseline_trust, "invalid");
  assert.equal(result.needs_escalation, true);
  assert.equal(result.score, 0);
  assert.equal(result.used_llm, false);
  assert.ok(result.strategy_health.some((issue) => issue.includes("Invalid strategy JSON")));
});
