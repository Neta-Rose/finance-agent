import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "feed-service-"));
process.env["USERS_DIR"] = path.join(testRoot, "users");

test("appendFeedEvent stores newest market news events first", async () => {
  const { appendFeedEvent, listFeedEvents } = await import("./feedService.js");

  await appendFeedEvent("feed-user", {
    kind: "market_news",
    ticker: "AAPL",
    title: "Apple event",
    summary: "A fresh headline arrived.",
    source: "percolation",
    url: "https://example.com/apple",
  });

  await appendFeedEvent("feed-user", {
    kind: "market_news",
    ticker: "MSFT",
    title: "Microsoft event",
    summary: "Another headline arrived.",
    source: "percolation",
    url: "https://example.com/microsoft",
  });

  const items = await listFeedEvents("feed-user", 10);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.ticker, "MSFT");
  assert.equal(items[1]?.ticker, "AAPL");

  const stored = JSON.parse(
    await fs.readFile(path.join(process.env["USERS_DIR"]!, "feed-user", "feed", "events.json"), "utf-8")
  ) as Array<{ kind: string }>;
  assert.equal(stored[0]?.kind, "market_news");
});

test("buildReportFeedItems marks negative quick checks with red tone", async () => {
  const { buildReportFeedItems } = await import("./feedService.js");
  const items = buildReportFeedItems([
    {
      batchId: "batch_1",
      triggeredAt: new Date().toISOString(),
      date: "2026-04-12",
      mode: "quick_check",
      tickers: ["AAPL"],
      tickerCount: 1,
      jobId: "job_1",
      entries: {
        AAPL: {
          ticker: "AAPL",
          mode: "quick_check",
          verdict: "REDUCE",
          confidence: "high",
          reasoning: "Something changed",
          timeframe: "immediate",
          analystTypes: ["quick_check"],
          hasBullCase: false,
          hasBearCase: false,
        },
      },
    },
  ]);

  assert.equal(items[0]?.tone, "rose");
});
