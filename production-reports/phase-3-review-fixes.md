# Production report — Pre-Phase-4 review fixes

**Date:** 2026-05-05
**Initiative:** Platform Stabilization and Assistant
**Context:** Review pass before Phase 4 implementation

---

## Summary

A review pass before Phase 4 caught 6 issues — one critical, the rest medium severity. All fixed before Phase 4 code was written.

---

## Fix 1 — Critical: `claimNextPendingStep` SQL missing new step kinds

**File:** `backend/src/services/stepQueue/executor.ts`

The `claimNextPendingStep` query only handled `analyst.*`, `debate`, and `synthesis`. The new `quick_check.evaluate` and `tracking.evaluate` step kinds were never claimed, leaving daily-brief and quick-check jobs permanently stuck in `pending`.

**Fix:** Added both kinds to the WHERE clause with priority 0 (before analyst steps). Both have no dependency chain and are always claimable.

```sql
-- Added:
OR s.kind = 'quick_check.evaluate'
OR s.kind = 'tracking.evaluate'
```

---

## Fix 2 — `executeClaimedStep` must bypass LLM for deterministic steps

**File:** `backend/src/services/stepQueue/executor.ts`

The executor ran the full `gatherInputs → buildPrompt → call LLM → validate → persist` loop for all step kinds. The two new deterministic handlers have a `call()` that returns `null` (no LLM), which would have produced a Zod failure.

**Fix:** Added a fast-path at the top of `executeClaimedStep` that dispatches `quick_check.evaluate` and `tracking.evaluate` directly to `executeQuickCheckStep` / `executeTrackingEvaluateStep`, bypassing the LLM loop entirely.

---

## Fix 3 — `DEFAULT_MODEL_TIER_ASSIGNMENTS` type error

**File:** `backend/src/services/stepQueue/modelTier.ts`

`Record<StepKind, string>` now requires entries for all 9 step kinds. The two new deterministic kinds were missing.

**Fix:** Added `"quick_check.evaluate": "none"` and `"tracking.evaluate": "none"` to all four tiers. The value `"none"` is a placeholder — these steps never call the LLM.

---

## Fix 4 — `startupGuards.ts` false-positive on its own file

**File:** `backend/src/services/security/startupGuards.ts`

The original `\bexecSync\b` pattern matched comments and string literals in `startupGuards.ts` itself and in `agentService.ts` (which has `execSync` in comments explaining its absence).

**Fix:** Replaced with a pattern that only matches actual import statements:
```ts
const EXECSYNC_IMPORT_PATTERN =
  /(?:import\s*\{[^}]*\bexecSync\b[^}]*\}|require\s*\(\s*['"]child_process['"]\s*\))/;
```

---

## Fix 5 — `/llm/v1` proxy route still mounted after Phase 3

**File:** `backend/src/app.ts`

The `/llm/v1` proxy route was still mounted after Phase 3. No agent calls it after OpenClaw retirement.

**Fix:** Removed the route mount and import from `app.ts`. The `services/llmProxy.ts` module is kept until Phase 4 deletes `oneshotCall.ts` (which `advisorLlmService.ts` still uses via the legacy path).

---

## Fix 6 — 9 new tests added to `stepQueue.test.ts`

**File:** `backend/src/services/stepQueue.test.ts`

The new step kinds and expansion paths had no test coverage. Handler registry test asserted exactly 7 kinds (now 9).

**Tests added:**
- `daily_brief expansion creates quick_check steps for held tickers`
- `quick_check expansion creates a single quick_check.evaluate step`
- `full_report expansion does not include quick_check or tracking steps`
- `quick_check.evaluate handler produces a valid artifact without LLM`
- `quick_check.evaluate signals stale strategy (no deep dive ever)`
- `quick_check.evaluate signals expired catalyst`
- `tracking.evaluate handler produces a valid artifact without LLM`
- `tracking.evaluate never escalates muted assets`
- `quick_check.evaluate normalizer recovers missing strategy gracefully`

Handler registry test updated from "seven" to "nine" step kinds.
