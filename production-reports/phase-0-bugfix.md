# Production report — Phase 0: full-report schema validation bugfix

**Date:** 2026-05-05
**Initiative:** Platform Stabilization and Assistant
**Spec:** `open-bugs/full-report-schema-validation-failure.md`
**Tasks:** 0.1 (code), 0.2 (operational — VPS)

---

## Problem

Job `job_20260504_124827_7e7c16` for `example3` failed every ticker because four analyst handlers had been edited (uncommitted) to remove their deterministic floors and rely on raw LLM output. `google/gemini-2.5-flash` returns valid JSON but does not reliably produce the nested object structure the Zod schemas require. The residual `normalizeRaw` only filled `ticker | generatedAt | analyst` — nested objects like `price`, `movingAverages`, `rsi`, `rateEnvironment`, `sectorPerformance`, `currency` were omitted entirely. Zod failed every step. After 3 retries each, the job failed and the user remained in `BOOTSTRAPPING` with zero completed tickers.

Blast radius: all users on the `balanced` tier (default) — `example3`, `GayZbeng`, `neta`, `noam`.

---

## Pattern applied

The bug report suggested `{ ...deterministicDefaults, ...llmOutput, ticker, generatedAt, analyst }`. Blind spread is fragile because a wrong-typed LLM value (`livePrice: null`) overrides a valid deterministic number. I followed the per-field type-checked merge pattern already in `fundamentals.ts`:

```ts
return {
  ticker,
  generatedAt: typeof obj["generatedAt"] === "string" ? obj["generatedAt"] : new Date().toISOString(),
  analyst: "technical",
  price: {
    current: pickNumber(priceObj["current"], floor.price.current),
    week52High: pickNumberOrNull(priceObj["week52High"]) ?? floor.price.week52High,
    // …
  },
}
```

For each field: take the LLM value if it's a sound type, else fall back to the deterministic floor. Same end behavior for missing fields, also robust to bad-typed values.

---

## Per-handler details

**`technical.ts`** — added `buildTechnicalFloor()` computing from `inputs.data.history` candles:
- MA50, MA200 via simple moving average
- RSI(14) via Wilder's gains/losses ratio
- MACD signal via comparing current vs prior bar EMA12 − EMA26
- 52-week high/low and `positionInRange` from the full series
- `keyLevels.support/resistance` from min/max of the last 30 bars
- `priceVsMa50/200` derived from current price vs MA with 0.1% epsilon
- `volume` marked `"average"` (price history doesn't surface volume; full computation lands in Phase 4)

**`macro.ts`** — added `buildMacroFloor()` with neutral defaults: `Bank of Israel` for TASE / `Federal Reserve` otherwise; `usdIls` from `inputs.data.usdIlsRate`; rate direction `holding`, sector trend `in-line`, currency trend `stable`, geopolitical risk `low`, market regime `mixed`. Real macro feeds land in Phase 4 with `macroSource.ts`.

**`sentiment.ts`** — added `sanitizeAnalystActions`, `sanitizeInsiderTransactions`, `sanitizeMajorNews` for per-row type-checking; `shortInterest` defaults to `"unknown"`, `narrativeShift` to `"stable"`. Real polarity classification lands in Phase 4 with `sentimentSource.ts`.

**`risk.ts`** — tightened the existing `{ ...computedRiskInputs, ...llmOutput }` pattern to per-field merge. Guards against `livePrice: null` — `pickFiniteNumber` rejects non-finite values and falls back to the computed value.

---

## What is intentionally not in this fix

[I2.1] mandates the risk artifact be fully computable even when the LLM call **throws entirely**. That requires executor changes belonging in Phase 4 (Task 4.6: `prose_fallback_used = true`, `error_class = '<analyst>_prose_fallback'`). This fix covers the documented bug class — schema-validation failures from incomplete LLM JSON.

---

## Files changed

```
backend/src/services/stepQueue/handlers/technical.ts   (rewritten — deterministic floor + per-field merge)
backend/src/services/stepQueue/handlers/macro.ts       (rewritten — deterministic floor + per-field merge)
backend/src/services/stepQueue/handlers/sentiment.ts   (rewritten — sanitizers + per-field merge)
backend/src/services/stepQueue/handlers/risk.ts        (per-field merge tightened, no shape change)
```

---

## Verification on VPS (Task 0.2)

```bash
cd /root/clawd && git pull origin main && ./deploy.sh

# Find users stuck in BOOTSTRAPPING with no completed tickers
for u in $(ls /root/clawd/users); do
  s=/root/clawd/users/$u/data/state.json
  [ -f "$s" ] \
    && [ "$(jq -r '.state // empty' "$s")" = "BOOTSTRAPPING" ] \
    && [ "$(jq -r '.bootstrapProgress.completed // empty' "$s")" = "0" ] \
    && echo "STUCK: $u"
done

# Re-issue full_report for each stuck user
curl -X POST http://localhost:8081/api/admin/users/<USER_ID>/jobs \
  -H "X-Admin-Key: $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"action":"full_report"}'

# Confirm zero new Zod failures since the deploy
psql "$APP_DATABASE_URL" -c "
  SELECT step_id, error_class, error_message, occurred_at
  FROM step_lifecycle_events
  WHERE error_class LIKE 'zod_%'
    AND occurred_at > NOW() - INTERVAL '15 minutes'
  ORDER BY occurred_at DESC;"

# Confirm completion
psql "$APP_DATABASE_URL" -c "
  SELECT id, user_id, action, status, completed_at, failure_reason
  FROM jobs
  WHERE action = 'full_report'
    AND triggered_at > NOW() - INTERVAL '30 minutes'
  ORDER BY triggered_at DESC;"
```

**Rollback:** `git revert` the four handler files and redeploy. No DB state to undo.
