# Production report — v3 bugfixes (debate handler + chat UX)

**Date:** 2026-05-06
**Context:** Post-v2 iteration 3 — fixes for open-bugs/v3-deploy-bugs.md

---

## Bug 1 & 2 — Debate handler fails Zod on every ticker (CRITICAL)

**Root cause:** `debate.normalizeRaw` was a shallow pass-through that only set `ticker`, `generatedAt`, and `analyst`. The LLM returned:
- `dataPoint: null` or `dataPoint: 42` (schema requires `string ≤200`)
- `responseToBear: "..."` exceeding 300 chars
- `bullRounds` / `bearRounds` with wrong length (not exactly 2)
- Non-URL strings in `sources`

**Fix:** Complete rewrite of `debate.ts` `normalizeRaw` with:
- JSON.parse when the LLM returns the entire response as a string
- `coerceDataPoint()` — converts null/number/object to bounded string
- `pickStrOrNull()` — truncates `responseToBear`/`responseToBull` to 300 chars
- `pickStr()` — truncates `thesis`/`concern` to 400 chars
- `normalizeEvidence()` — ensures 1–5 items, valid URLs, non-empty strings
- `ensureExactlyTwo()` — guarantees exactly 2 bull rounds and 2 bear rounds
- URL filter on `sources`
- Deterministic fallback text for every field

**Self-correcting retry wired into executor:** `executeClaimedStep` now calls `isFeatureEnabled("self_correcting_retry_enabled")` and, on Zod failure, re-prompts the model once with the validation error message and malformed output. The combined call counts as one logical attempt. A `schema_invalid_pre_retry` lifecycle event is written before the retry so admin can see the LLM succeeded but output was unusable (Bug 5 fix).

**Prompt hardened:** Added explicit CRITICAL constraints to the debate prompt:
- `dataPoint` must be a non-empty string (max 200 chars), never null or number
- `responseToBear`/`responseToBull` max 300 chars
- `thesis`/`concern` max 400 chars

---

## Bug 3 — Controls page not discoverable

**Fix:** Added a "Controls & Jobs" button to the Settings page that navigates to `/controls`. The route still exists; it's now reachable from the main nav flow.

---

## Bug 4 — Chat confirmation requires two confirmations

**Root cause:** The model asked its own "Should I proceed?" question before emitting the `tool_call` block. The user's "Proceed" didn't satisfy the app-level confirmation store (no pending tool call yet). Then the model emitted the `tool_call`, the app proposed "Reply 'yes' to confirm", and the user had to confirm again.

**Fix:** Updated the persona prompt and tool manifest instructions to tell the model:
- For action tools: emit the `tool_call` block immediately when the user requests the action
- Do NOT ask "should I proceed?" — the system handles confirmation
- For read tools: call freely without asking for confirmation

---

## Bug 5 — LLM observability marks schema-invalid outputs as success

**Fix:** When Zod validation fails before the self-correcting retry, a `step_lifecycle_events` row is written with `error_class='zod'` and `error_message='schema_invalid_pre_retry: ...'`. This makes the failure visible in admin observability even when the LLM transport layer reported success.

---

## Files changed

```
EDITED
  backend/src/services/stepQueue/handlers/debate.ts    (complete normalizeRaw rewrite)
  backend/src/services/stepQueue/executor.ts           (+ self-correcting retry + schema_invalid event)
  backend/src/services/chat/personaPrompt.ts           (+ no-double-confirm instruction)
  backend/src/services/chat/agentChat.ts               (+ tool manifest instruction update)
  frontend/src/pages/Settings.tsx                      (+ Controls & Jobs button)
```

---

## VPS actions after deploy

```bash
cd /root/clawd && git pull origin main && ./deploy.sh

# Re-trigger example5 full report
curl -X POST http://localhost:8081/api/admin/users/example5/jobs \
  -H "X-Admin-Key: $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"action":"full_report"}'

# Re-trigger soofke TSM deep dive
curl -X POST http://localhost:8081/api/admin/users/soofke/jobs \
  -H "X-Admin-Key: $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"action":"deep_dive","ticker":"TSM"}'

# Verify debate steps complete
psql "$APP_DATABASE_URL" -c "
  SELECT s.kind, s.status, e.error_class, e.error_message
  FROM step_work_items s
  LEFT JOIN step_lifecycle_events e ON e.step_id = s.id
  WHERE s.created_at > NOW() - INTERVAL '10 minutes'
    AND s.kind = 'debate'
  ORDER BY s.created_at DESC;"

# Verify example5 exits BOOTSTRAPPING
# (check users/example5/data/state.json after job completes)
```
