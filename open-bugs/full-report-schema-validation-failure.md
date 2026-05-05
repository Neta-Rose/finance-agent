# Bug: Full Report Fails — Analyst Schema Validation Failures on Balanced Tier

**Date discovered:** 2026-05-05
**Affected user:** example3 (confirmed); GayZbeng, neta, noam at risk (same default tier)
**Job:** `job_20260504_124827_7e7c16` — `full_report` — triggered 2026-05-04 12:48, failed 12:49
**Status:** Open

---

## Symptom

Full report job completes in ~1 minute with status `failed`. All tickers fail:
```
Ticker work failed: TSLA, NKE, CHTR
Full report failed because one or more analyst steps returned invalid schema
```

`analyst.fundamentals` completes for every ticker. `analyst.technical`, `analyst.sentiment`, `analyst.macro`, `analyst.risk` all fail after 2–3 retries. `debate` and `synthesis` are blocked by the upstream failures. User is stuck in `BOOTSTRAPPING` state with 0 completed tickers, 0 verdicts, and no product value.

---

## Root Cause

### Code state mismatch (committed vs. deployed)

The four failing handlers exist in two versions:

**Committed state** (`f284950` and earlier): Handlers had a **deterministic floor** — they either computed the full artifact server-side or returned safe hard-coded defaults. No LLM involved, always schema-valid.
- `technical.ts`: `buildTechnicalArtifact()` — computed MA50/MA200/week52/RSI from price history
- `macro.ts`: `callRaw()` — returned complete artifact with `rateEnvironment`, `sectorPerformance`, `currency` pre-filled with neutral defaults
- `sentiment.ts`: `callRaw()` — returned complete artifact with `shortInterest: "unknown"`, `narrativeShift: "stable"`, etc.
- `risk.ts`: `buildRiskArtifact()` — computed all fields from portfolio.json, no LLM

**Deployed uncommitted state** (what was running on May 4, still on disk): Deterministic floors were removed and replaced with LLM calls + `normalizeRaw()`. The `normalizeRaw` for technical, macro, and sentiment only sets `ticker`, `generatedAt`, `analyst` — it does NOT fill in required content fields. When `google/gemini-2.5-flash` returns JSON without those nested objects, Zod fails.

### Why fundamentals passes

`fundamentals.ts` has a comprehensive `normalizeRaw()` that reconstructs the entire expected object with safe defaults for every field — `"unknown"` for all enums, `null` for all nullable numbers, `0` for ints. Even an empty LLM response produces a valid artifact. The other four handlers have no equivalent.

### Specific Zod errors observed (from `step_lifecycle_events`)

| Handler | Missing required fields |
|---------|------------------------|
| `analyst.technical` | `price{}`, `movingAverages{}`, `rsi{}` objects entirely absent |
| `analyst.macro` | `rateEnvironment{}`, `sectorPerformance{}`, `currency{}` objects entirely absent |
| `analyst.sentiment` | `shortInterest` (enum), `narrativeShift` (enum) missing or null |
| `analyst.risk` | `livePrice`, `livePriceCurrency`, `livePriceSource` missing |

### Model involved

`google/gemini-2.5-flash` via OpenRouter, used for all 5 analyst step kinds in the `balanced` model tier. `response_format: { type: "json_object" }` guarantees valid JSON but not schema-compliant nested structure. Flash-class models don't reliably produce complex nested JSON matching strict Zod schemas without robust normalization as a safety net.

---

## Blast Radius

All users without an explicit `modelTier` in their `profile.json` default to `balanced` — that is `google/gemini-2.5-flash` for all analyst steps. Currently affected/at-risk:

| User | modelTier | Status |
|------|-----------|--------|
| example3 | balanced (explicit) | BOOTSTRAPPING, stuck |
| GayZbeng | balanced (default, no modelTier set) | At risk |
| neta | balanced (default) | At risk |
| noam | balanced (default) | At risk |
| soofke | cheap (deepseek-v3.2 for most analysts) | Different issue class |

---

## Fix

The old committed code already contains the correct defaults — they live in the old `callRaw`/`buildArtifact` functions. The fix is to make `normalizeRaw` for each broken handler use those same defaults as the fallback base, then overlay the LLM output on top.

**`analyst.technical`:** Restore `buildTechnicalArtifact()` computation (MA50/MA200/week52/RSI from history) as the normalizeRaw base. LLM output overrides individual fields if present.

**`analyst.macro`:** Restore the old `callRaw()` defaults (`rateEnvironment`, `sectorPerformance`, `currency`, `geopolitical` all with neutral values) as the normalizeRaw base.

**`analyst.sentiment`:** Restore the old `callRaw()` defaults (`shortInterest: "unknown"`, `narrativeShift: "stable"`, empty arrays for actions/transactions) as the normalizeRaw base.

**`analyst.risk`:** The uncommitted `normalizeRaw` (spreading `computedRiskInputs` as base) is architecturally correct — needs completing and committing.

Pattern: `{ ...deterministicDefaults, ...llmOutput, ticker, generatedAt, analyst }` — LLM enriches, fallback guarantees validity.

---

## Notes

- The "Repaired completed artifact row during reconciliation" entries in `step_lifecycle_events` are from an older reconciler code path that has since been removed. They are historical artifacts in the DB and do not reflect current behavior.
- `example3`'s `state.json` is stuck in `BOOTSTRAPPING` with `bootstrapProgress.completed: 0`. Needs a new full report job after the handlers are fixed.
- The uncommitted changes to `risk.ts`, `macro.ts`, `sentiment.ts`, `technical.ts`, `executor.ts`, `handlerUtils.ts` (and others) should be reviewed, completed, and committed as a coherent unit before the next deploy.
