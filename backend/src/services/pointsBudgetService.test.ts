import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPointsBalanceSnapshot,
  POINTS_BUDGET_WINDOW_HOURS,
  usdToPoints,
} from "./pointsBudgetService.js";

test("usdToPoints preserves fractional request costs", () => {
  assert.equal(usdToPoints(0), 0);
  assert.equal(usdToPoints(-1), 0);
  assert.equal(usdToPoints(0.5), 500);
  assert.equal(usdToPoints(0.000001), 0.001);
});

test("buildPointsBalanceSnapshot computes bounded remaining points", () => {
  const now = new Date("2026-04-24T12:00:00.000Z");
  const snapshot = buildPointsBalanceSnapshot(
    { dailyBudgetPoints: 500 },
    0.123456,
    now
  );

  assert.equal(snapshot.dailyBudgetPoints, 500);
  assert.equal(snapshot.pointsUsed, 123.456);
  assert.equal(snapshot.pointsRemaining, 376.544);
  assert.equal(snapshot.pctUsed, 25);
  assert.equal(snapshot.exhausted, false);
  assert.equal(
    snapshot.windowStart,
    new Date(now.getTime() - POINTS_BUDGET_WINDOW_HOURS * 3600 * 1000).toISOString()
  );
  assert.equal(snapshot.windowEnd, now.toISOString());
});

test("buildPointsBalanceSnapshot marks exhausted budgets without going negative", () => {
  const snapshot = buildPointsBalanceSnapshot(
    { dailyBudgetPoints: 10 },
    0.025
  );

  assert.equal(snapshot.pointsUsed, 25);
  assert.equal(snapshot.pointsRemaining, 0);
  assert.equal(snapshot.exhausted, true);
  assert.equal(snapshot.pctUsed, 250);
});
