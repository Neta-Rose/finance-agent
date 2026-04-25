import test from "node:test";
import assert from "node:assert/strict";
import {
  isBudgetAdmittedJob,
  requiresBudgetAdmission,
} from "./jobAdmissionService.js";

test("requiresBudgetAdmission only applies to agent-managed long-running jobs", () => {
  assert.equal(requiresBudgetAdmission({ action: "deep_dive" }), true);
  assert.equal(requiresBudgetAdmission({ action: "full_report" }), true);
  assert.equal(requiresBudgetAdmission({ action: "quick_check" }), false);
  assert.equal(requiresBudgetAdmission({ action: "daily_brief" }), false);
});

test("isBudgetAdmittedJob requires both eligible action and admission timestamp", () => {
  assert.equal(
    isBudgetAdmittedJob({ action: "deep_dive", budget_admitted_at: "2026-04-25T00:00:00.000Z" }),
    true
  );
  assert.equal(
    isBudgetAdmittedJob({ action: "full_report", budget_admitted_at: null }),
    false
  );
  assert.equal(
    isBudgetAdmittedJob({ action: "quick_check", budget_admitted_at: "2026-04-25T00:00:00.000Z" }),
    false
  );
});
