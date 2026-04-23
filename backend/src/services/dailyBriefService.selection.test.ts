import test from "node:test";
import assert from "node:assert/strict";

import { selectDailyBriefAutoDeepDiveTickers } from "./dailyBriefService.js";
import type { QuickCheckOutcome } from "./quickCheckService.js";

function quickCheck(ticker: string, score: number, needsEscalation: boolean): QuickCheckOutcome {
  return {
    ticker,
    timestamp: new Date().toISOString(),
    baseline_trust: "valid",
    verdict: "HOLD",
    confidence: "medium",
    sentiment_score: null,
    catalyst_triggered: false,
    unexpected_event: false,
    needs_escalation: needsEscalation,
    escalation_reason: needsEscalation ? "needs review" : null,
    escalated_to_job_id: null,
    used_briefing: false,
    score,
    signals: [],
    strategy_health: [],
    decision: needsEscalation ? "not_safe" : "safe",
    advisor_summary: null,
    advisor_reasons: [],
    used_llm: false,
  };
}

test("selectDailyBriefAutoDeepDiveTickers picks the worst score first", () => {
  const selected = selectDailyBriefAutoDeepDiveTickers(
    [
      { ticker: "AAA", currentILS: 1000, quickCheck: quickCheck("AAA", 60, true) },
      { ticker: "BBB", currentILS: 2000, quickCheck: quickCheck("BBB", 20, true) },
      { ticker: "CCC", currentILS: 5000, quickCheck: quickCheck("CCC", 80, false) },
    ],
    1
  );

  assert.deepEqual(selected, ["BBB"]);
});

test("selectDailyBriefAutoDeepDiveTickers breaks score ties by larger position size", () => {
  const selected = selectDailyBriefAutoDeepDiveTickers(
    [
      { ticker: "AAA", currentILS: 1000, quickCheck: quickCheck("AAA", 25, true) },
      { ticker: "BBB", currentILS: 3000, quickCheck: quickCheck("BBB", 25, true) },
    ],
    1
  );

  assert.deepEqual(selected, ["BBB"]);
});

test("selectDailyBriefAutoDeepDiveTickers respects a zero limit", () => {
  const selected = selectDailyBriefAutoDeepDiveTickers(
    [{ ticker: "AAA", currentILS: 1000, quickCheck: quickCheck("AAA", 10, true) }],
    0
  );

  assert.deepEqual(selected, []);
});
