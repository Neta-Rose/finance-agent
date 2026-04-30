import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "strategy-file-service-"));

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

test("loadStrategyFile repairs malformed but salvageable strategy output", async () => {
  const { loadStrategyFile } = await import("./strategyFileService.js");
  const filePath = path.join(testRoot, "repairable", "strategy.json");
  const generatedAt = new Date().toISOString();

  await writeJson(filePath, {
    ticker: "qqq",
    updatedAt: generatedAt,
    version: 1,
    verdict: "hold",
    confidence: "medium",
    reasoning: "Repairable strategy output.",
    timeframe: "month",
    positionSizeILS: "1000",
    positionWeightPct: "5.5",
    entryConditions: "Add on confirmation; Avoid chasing",
    exitConditions: ["Reduce on thesis break"],
    catalysts: ["Scheduled review"],
    bull_case: "Upside remains intact.",
    bear_case: "Multiple compression remains possible.",
    lastDeepDiveAt: null,
    deepDiveTriggeredBy: "full_report",
    metadata: {
      source: "bootstrap_analysis",
      status: "valid",
      generatedAt,
      userGuidanceApplied: true,
    },
  });

  const result = await loadStrategyFile(filePath, { repair: true, tickerHint: "QQQ" });
  assert.equal(result.valid, true);
  assert.equal(result.repaired, true);
  assert.equal(result.strategy?.ticker, "QQQ");
  assert.equal(result.strategy?.timeframe, "months");
  assert.equal(result.strategy?.metadata?.source, "bootstrap");
  assert.equal(result.strategy?.metadata?.status, "validated");
  assert.equal(result.strategy?.metadata?.userGuidanceApplied, true);
  assert.deepEqual(result.strategy?.catalysts, [
    {
      description: "Scheduled review",
      expiresAt: null,
      triggered: false,
    },
  ]);

  const persisted = JSON.parse(await fs.readFile(filePath, "utf-8")) as {
    ticker: string;
    catalysts: Array<{ description: string }>;
  };
  assert.equal(persisted.ticker, "QQQ");
  assert.equal(persisted.catalysts[0]?.description, "Scheduled review");
});

test("loadStrategyFile rejects unrecoverable strategy when ticker cannot be normalized", async () => {
  const { loadStrategyFile } = await import("./strategyFileService.js");
  const filePath = path.join(testRoot, "invalid", "strategy.json");

  await writeJson(filePath, {
    updatedAt: new Date().toISOString(),
    version: 1,
    verdict: "HOLD",
    confidence: "low",
    reasoning: "Ticker missing.",
    timeframe: "months",
    positionSizeILS: 0,
    positionWeightPct: 0,
    entryConditions: [],
    exitConditions: [],
    catalysts: [],
    bullCase: null,
    bearCase: null,
    lastDeepDiveAt: null,
    deepDiveTriggeredBy: "full_report",
    metadata: {
      source: "full_report",
      status: "validated",
      generatedAt: new Date().toISOString(),
      userGuidanceApplied: false,
    },
  });

  const result = await loadStrategyFile(filePath, { repair: true });
  assert.equal(result.valid, false);
  assert.ok((result.errors ?? []).some((error) => error.includes("ticker")));
});
