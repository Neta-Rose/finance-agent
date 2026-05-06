# Production report — Phase 4: Provider-native structured outputs + self-correcting retry

**Date:** 2026-05-05
**Initiative:** Platform Stabilization and Assistant
**Tasks:** 4.1–4.7 (code), 4.8 (operational — VPS flag flip)

---

## Goal

Make the `full-report-schema-validation-failure` bug class structurally impossible. Shift analysts from "fact-fetcher" to "synthesizer". Replace `oneshotCall.ts` with a typed `LlmProvider` abstraction.

---

## 4.1 — DDL

Appended to `db/application_postgres.sql`:

| Column | Table | Purpose |
|---|---|---|
| `schema_mode` | `step_work_items` | Which structured-output path produced the artifact (`provider_native \| normalize_fallback \| both`) |
| `structured_output_provider` | `step_work_items` | Which provider was used |
| `prose_fallback_used` | `step_work_items` | True when deterministic placeholder prose was used |
| `schema_mode` | `step_lifecycle_events` | Schema mode on each transition |
| `thinking_budget` | `model_tier_assignments` | Extended-thinking budget (0 = disabled) |
| `provider` | `model_tier_assignments` | `openrouter \| anthropic \| openai \| gemini` |
| `conversation_id`, `tool_call_id`, `schema_mode` | `llm_requests` | Phase 5 correlation columns |
| `conversation_token_cap_override` | `user_points_budgets` | Phase 5 per-user cap |

---

## 4.2 — `LlmProvider` abstraction

New: `backend/src/services/chat/llmProviders/{index,openRouterProvider,anthropicProvider,openAiProvider,geminiProvider}.ts`.

`LlmProvider` interface: `invoke(args: ProviderInvokeArgs): Promise<ProviderResult>`. Factory `getLlmProvider(providerName)` dispatches on the `provider` column from `model_tier_assignments`.

Phase 4 ships the `OpenRouterProvider` (real implementation) and stubs for Anthropic, OpenAI, Gemini that fall back to OpenRouter. The real native implementations (tool-use, extended thinking, schema mode) land in Phase 5 when the chat agent ships.

`handlerUtils.ts` updated to use `getLlmProvider("openrouter")` instead of `oneShotJsonCompletion`. `callStepLlm` now returns `result.content` (from the provider) instead of `result.json`.

---

## 4.3 — `structuredOutputs.ts`

New: `backend/src/services/stepQueue/structuredOutputs.ts`.

`callWithStructuredOutput<T>({ provider, model, schema, messages, normalizeRaw? })`:
1. Calls the provider
2. Validates with Zod directly → `schemaMode = 'provider_native'` on success
3. Falls through to `normalizeRaw` if provided → `schemaMode = 'normalize_fallback'` or `'both'`
4. Throws the ZodError if both paths fail (self-correcting retry wrapper handles the re-prompt)

---

## 4.4 — `selfCorrectingRetry.ts`

New: `backend/src/services/stepQueue/selfCorrectingRetry.ts`.

`callWithSelfCorrectingRetry<T>` wraps `callWithStructuredOutput`. On ZodError:
1. Checks `feature_flags.self_correcting_retry_enabled` (default true)
2. Re-invokes the provider with the validation error message and malformed output appended as a corrective user message
3. Returns `{ ...result, selfCorrected: true }` on success
4. Throws the retry's ZodError on second failure — caller counts the combined call as one attempt

---

## 4.5 — Deterministic data sources

Four new modules in `backend/src/services/dataSources/`:

| Module | Facts computed server-side | LLM task |
|---|---|---|
| `marketDataSource.ts` | MA50/MA200/RSI(14)/MACD/week52/keyLevels from price history | `technicalView` prose + `pattern` |
| `macroSource.ts` | USD/ILS rate (live), bank name, neutral defaults for rate/sector | `macroView` prose |
| `sentimentSource.ts` | Exa snippets + deterministic polarity classification | `sentimentView` prose + `narrativeShift` |
| `fundamentalsSource.ts` | EPS/revenue/P/E/analyst consensus from yahoo-finance2 | `fundamentalView` prose |

`cache.ts` provides `TtlCache<T>` with shared instances: 5 min for price history, 30 min for sentiment, 1 hour for fundamentals/macro.

---

## 4.6 — Analyst handlers updated as synthesizers

All four affected handlers (`technical`, `macro`, `sentiment`, `fundamentals`) updated:
- `gatherData` calls the corresponding data source and includes pre-computed facts in `inputs.data`
- `buildUserPrompt` tells the LLM "these facts are pre-computed — copy them, write only the prose"
- `normalizeRaw` continues as defense-in-depth fallback (H1.3)

The executor records `schema_mode` on `step_work_items` after each successful LLM step.

---

## 4.7 — `oneshotCall.ts` deleted

`backend/src/services/llm/oneshotCall.ts` deleted. All analyst steps now route through `getLlmProvider("openrouter")` in `handlerUtils.ts`.

---

## Files changed

```
NEW
  backend/src/services/chat/llmProviders/index.ts
  backend/src/services/chat/llmProviders/openRouterProvider.ts
  backend/src/services/chat/llmProviders/anthropicProvider.ts
  backend/src/services/chat/llmProviders/openAiProvider.ts
  backend/src/services/chat/llmProviders/geminiProvider.ts
  backend/src/services/stepQueue/structuredOutputs.ts
  backend/src/services/stepQueue/selfCorrectingRetry.ts
  backend/src/services/dataSources/cache.ts
  backend/src/services/dataSources/marketDataSource.ts
  backend/src/services/dataSources/macroSource.ts
  backend/src/services/dataSources/sentimentSource.ts
  backend/src/services/dataSources/fundamentalsSource.ts

EDITED
  db/application_postgres.sql                                    (+ Phase 4 ALTERs)
  backend/src/services/stepQueue/handlerUtils.ts                 (+ LlmProvider, - oneshotCall)
  backend/src/services/stepQueue/executor.ts                     (+ schema_mode recording, + deterministic dispatch)
  backend/src/services/stepQueue/modelTier.ts                    (+ new step kinds in DEFAULT_MODEL_TIER_ASSIGNMENTS)
  backend/src/services/stepQueue/handlers/technical.ts           (+ marketDataSource pre-compute)
  backend/src/services/stepQueue/handlers/macro.ts               (+ macroSource pre-compute)
  backend/src/services/stepQueue/handlers/sentiment.ts           (+ sentimentSource pre-compute)
  backend/src/services/stepQueue/handlers/fundamentals.ts        (+ fundamentalsSource pre-compute)

DELETED
  backend/src/services/llm/oneshotCall.ts
```

---

## Operational steps on VPS (Task 4.8)

```bash
cd /root/clawd && ./deploy.sh

# Verify Phase 4 DDL applied
psql "$APP_DATABASE_URL" -c "\d step_work_items"
# Should show: schema_mode, structured_output_provider, prose_fallback_used

psql "$APP_DATABASE_URL" -c "\d model_tier_assignments"
# Should show: thinking_budget, provider

# Flip the structured-outputs flag
psql "$APP_DATABASE_URL" -c "
  UPDATE feature_flags
  SET enabled = true, updated_at = NOW(), updated_by = 'operator'
  WHERE flag_name = 'structured_outputs_enabled' AND scope_user_id IS NULL;"

# Trigger a full report and verify schema_mode is populated
psql "$APP_DATABASE_URL" -c "
  SELECT kind, schema_mode, prose_fallback_used
  FROM step_work_items
  WHERE created_at > NOW() - INTERVAL '10 minutes'
  ORDER BY created_at DESC;"
```

**Rollback:** Flip `structured_outputs_enabled = false`. The handlers fall back to the prior `response_format: { type: "json_object" }` path which is kept for one phase as a safety net.

```sql
UPDATE feature_flags
SET enabled = false, updated_at = NOW(), updated_by = 'operator'
WHERE flag_name = 'structured_outputs_enabled' AND scope_user_id IS NULL;
```
