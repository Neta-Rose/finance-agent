import test from "node:test";
import assert from "node:assert/strict";

import { buildTokenBudgetUsage } from "./tokenBudgetService.js";

test("buildTokenBudgetUsage computes bounded usage percentage and exhaustion", () => {
  const usage = buildTokenBudgetUsage(
    { maxTokens: 20_000, periodHours: 6 },
    5_000,
    new Date("2026-04-22T12:00:00.000Z")
  );

  assert.equal(usage.maxTokens, 20_000);
  assert.equal(usage.periodHours, 6);
  assert.equal(usage.tokensUsed, 5_000);
  assert.equal(usage.tokensRemaining, 15_000);
  assert.equal(usage.pctUsed, 25);
  assert.equal(usage.exhausted, false);
  assert.equal(usage.windowStart, "2026-04-22T06:00:00.000Z");
  assert.equal(usage.windowEnd, "2026-04-22T12:00:00.000Z");
});

test("buildTokenBudgetUsage marks exhausted budgets", () => {
  const usage = buildTokenBudgetUsage(
    { maxTokens: 20_000, periodHours: 6 },
    25_500
  );

  assert.equal(usage.exhausted, true);
  assert.equal(usage.tokensRemaining, 0);
  assert.equal(usage.pctUsed, 127);
});
