import test from "node:test";
import assert from "node:assert/strict";
import { StrategySchema } from "./strategy.js";

const baseStrategy = {
  ticker: "GOOGL",
  updatedAt: "2026-05-03T12:00:00.000Z",
  version: 1,
  verdict: "BUY",
  confidence: "medium",
  reasoning: "Schema compatibility fixture.",
  timeframe: "months",
  positionSizeILS: 0,
  positionWeightPct: 0,
  entryConditions: [],
  exitConditions: [],
  catalysts: [],
  bullCase: null,
  bearCase: null,
  lastDeepDiveAt: null,
  deepDiveTriggeredBy: "manual_exploration",
  metadata: {
    source: "manual_exploration",
    status: "validated",
    generatedAt: "2026-05-03T12:00:00.000Z",
    userGuidanceApplied: false,
  },
};

test("StrategySchema accepts existing strategy shape without tracking fields", () => {
  const parsed = StrategySchema.safeParse(baseStrategy);
  assert.equal(parsed.success, true);
});

test("StrategySchema accepts tracked idea fields with bounded scores", () => {
  const parsed = StrategySchema.safeParse({
    ...baseStrategy,
    assetScope: "tracking",
    trackingStatus: "active",
    stance: "candidate",
    potentialScore: 75,
    urgencyScore: 60,
    urgencyLabel: "medium",
    portfolioFitScore: 80,
    suggestedAllocationPct: 4,
    suggestedAllocationILS: 12000,
    actionCatalysts: [
      {
        description: "Review before earnings",
        expiresAt: "2026-06-01T00:00:00.000Z",
        triggered: false,
      },
    ],
    avoidConditions: ["Avoid if valuation expands without earnings growth."],
    nextReviewAt: "2026-05-20T00:00:00.000Z",
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.assetScope, "tracking");
    assert.equal(parsed.data.potentialScore, 75);
    assert.equal(parsed.data.actionCatalysts[0]?.description, "Review before earnings");
  }
});

test("StrategySchema rejects out-of-range tracking scores", () => {
  const parsed = StrategySchema.safeParse({
    ...baseStrategy,
    assetScope: "tracking",
    potentialScore: 101,
  });

  assert.equal(parsed.success, false);
});
