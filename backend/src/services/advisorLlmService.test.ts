import test from "node:test";
import assert from "node:assert/strict";
import { runQuickCheckAdvisor } from "./advisorLlmService.js";

test("runQuickCheckAdvisor returns null when proxy call fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 500 })) as typeof fetch;

  try {
    const result = await runQuickCheckAdvisor({
      userId: "missing-user",
      ticker: "AAPL",
      verdict: "HOLD",
      confidence: "medium",
      reasoning: "Test",
      catalysts: [],
      signals: [],
      strategyHealth: [],
      sentimentSummary: "No news",
    });
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
