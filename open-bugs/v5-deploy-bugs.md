# Bug Report: v5 Deploy — Synthesis Schema Failure, Budget Enforcement Gap, Observability Gaps

**Date discovered:** 2026-05-07
**Status:** Open
**Context:** Post-v4 deploy. `example6` triggered a full report at 10:22 UTC. All 4 tickers (QQQ, SOFI, TEVA.TA, ONDS) failed at the `synthesis` step. Analyst and debate steps all completed successfully.

---

## Bug 1 — Synthesis Step Returns String at Root, Fails Zod

### Symptom

```
job_20260507_102230_8461e1
user: example6
action: full_report
status: failed
failure_reason: Ticker work failed: QQQ, SOFI, TEVA.TA, ONDS
```

All 4 tickers had the same `step_work_items.last_error`:

```json
[{ "code": "invalid_type", "expected": "object", "received": "string", "path": [], "message": "Expected object, received string" }]
```

The path `[]` means the root of the parsed value is a string, not an object. This is different from every previous schema bug: prior iterations failed on missing nested fields (`rateEnvironment`, `movingAverages`, etc.); this one fails because the root itself is a primitive string. The self-correcting retry (H2.1) fired but also returned a string on both attempts.

### Root Cause Analysis

`makePromptHandler` at `executor.ts:617` calls `handler.call(prompt, model, step, inputs)` and passes the return value directly to `handler.validate()` → `StrategySchema.safeParse(raw)`. The error means `raw` is a JSON string (e.g., `"{ \"ticker\": \"QQQ\", ... }"`) rather than a parsed object.

There are two plausible origins:

**Path A — LLM double-serializes.** The model receives a `json_object` / `json_schema` instruction, returns a JSON payload whose root value is a string (the entire strategy object serialized again as a string literal). Seen with models that overfit to "return JSON" instructions by quoting the output.

**Path B — OpenRouter response parsing.** The `handler.call` implementation extracts the LLM response content. If a model returns the JSON inside a tool_call `input` field and the extraction path is wrong, the raw string is returned instead of the parsed `input` object.

In both cases the self-correcting retry re-sent the string back to the model as `typeof raw === "string" ? raw : JSON.stringify(raw)` which is correct, but the model produced another string both times — suggesting the underlying cause is structural, not a one-off hallucination.

### Why Schema Enforcement Keeps Failing Across Iterations

This is the fourth distinct schema-validation failure class across v1–v5:

| Version | Failure class |
|---------|--------------|
| v1–v2 | Analyst steps: missing nested objects entirely (Flash-class models) |
| v3 | Debate step: `note` field typed `string\|undefined` instead of `string\|null` (TypeScript exactOptionalPropertyTypes) |
| v3 | Various handler `normalizeRaw` gaps — missing fallback defaults for required fields |
| v5 | Synthesis step: root value is a string, not an object |

The systemic problem: **schema enforcement is only applied after the fact** (Zod `safeParse` on the LLM response). The LLM has no binding contract to return an object at the root. Even `response_format: { type: "json_object" }` via OpenRouter only guarantees parseable JSON — a JSON string `"\"...\""`  is valid JSON.

**What native schema enforcement actually provides (and what we're missing):**

- **Anthropic structured outputs (`tool_use` mode):** When Claude is invoked with a tool definition, the `input` field of the tool_call response is a parsed object guaranteed to be an object at root. No double-serialization possible. This is the correct API to use for synthesis and all structured steps on Sonnet-class models.
- **OpenAI / OpenRouter `response_format: { type: "json_schema", json_schema: { schema: <zod-to-json-schema> } }:** Forces the model to produce output matching the JSON Schema at the root level. Supported by some but not all routed models.
- **Current system:** Uses `json_object` or plain prompting depending on the model. Neither enforces root type.

**Recommended fix:** For synthesis (and all `makePromptHandler` steps), pass the Zod schema through `zod-to-json-schema` and use the model's native structured-output API where available (Claude tool_use, OpenAI json_schema mode). Add a hard `normalizeRaw` guard in every handler: if `typeof raw === "string"`, attempt `JSON.parse(raw)` before Zod validation. This is a one-line safety net for the double-serialization case and would have caught this failure.

```typescript
// In the executor, before handler.validate():
if (typeof raw === "string") {
  try { raw = JSON.parse(raw); } catch { /* let Zod report the failure */ }
}
```

This is not a substitute for native structured outputs but eliminates the entire double-serialization class of failures immediately.

---

## Bug 2 — Budget Is Enforced at Job Admission Only; No Per-Step Cap

### Symptom

`example6` had a 200-point daily budget ($0.20). The job was admitted (0 prior spend in the 24h window). During execution, 49 LLM calls ran across analyst + debate + synthesis steps, spending **$1.09** (1090 points) before the synthesis step failed for unrelated reasons. The budget system allowed 5× the daily cap to be spent in a single job.

### How the Current System Works

`ensurePointsBudgetAvailable()` is called once: at job admission (`admitOrReuseStepQueueJob`). It checks `dailyBudgetPoints - SUM(cost_usd in last 24h) * 1000 > 0`. If the gate passes, the job runs without any mid-execution budget check. Individual steps and LLM calls record cost in `llm_requests` but nothing reads this during execution to pause or abort.

### What Should Happen

The budget must be enforced at the **step level**, not the job level. The intended behavior:

1. Before executing each step, check remaining balance.
2. If the step would start with 0 remaining points (budget exhausted), mark the job `paused` with `pause_reason: "points_budget_exhausted"` and exit. The step queue executor picks it up tomorrow when the 24h window shifts.
3. If the step completes and its cost pushes the running total over budget, that is acceptable — a single step can modestly overshoot (the user accepts this). The next step will be gated.
4. Hard cap intent: budget + single-digit overshoot. With a 200-point budget, the maximum observable daily spend should be ≤ $0.22–0.23 (one expensive step over the line). $0.25 is already too much for a 200-point budget.

### Implementation Scope (not implementing — documenting)

- `executor.ts`: Before `claimNextPendingStep` executes a step, call `ensurePointsBudgetAvailable`. If exhausted, don't mark the step as started — instead update the job row to `paused` and set `paused_at = NOW()`, `pause_reason = "points_budget_exhausted"`.
- The watchdog or daily scheduler already has logic to resume `paused` jobs (`reconcilePausedJobStates`). Ensure it re-checks budget before re-admitting.
- The file-system job record (`.json` file in `users/[id]/data/jobs/`) should also be updated to `paused` so the dashboard shows the right state.
- A paused job should show the user a clear message: "Daily budget reached — will continue tomorrow at [windowEnd time]."

---

## Gap 3 — No Time-Until-Reset or Reset Date Visible

### Symptom

When a user's budget is exhausted, neither the admin panel nor the user dashboard shows when the window resets. The user sees "budget exhausted" with no actionable time information.

### What's Needed

**For users (Settings page / balance pill):**
- Current: `"43 pts"` or `"exhausted"`.
- Needed: `"Resets in 6h 12m"` or `"Resets at 22:30 tonight"`.
- `windowEnd` is already computed in `buildPointsBalanceSnapshot()` — it's in the API response but not surfaced in the UI.

**For admin (user detail row):**
- Show `windowEnd` timestamp alongside the balance for any user who is exhausted.
- This lets admin judge whether to grant a one-time credit or just wait.

---

## Gap 4 — Admin Cannot Grant One-Time Budget Credits

### Symptom

`example6`'s budget was changed from 200 → 500 points permanently to fix the immediate exhaustion. The admin wanted to give a one-time +300 point boost without touching the base daily budget. No such mechanism exists.

### What's Needed

A one-time credit mechanism: admin grants user X an additional Y points that apply **only to the current 24h window** and do not change `dailyBudgetPoints`.

**Implementation approach:**
- New DB table or column: `user_points_credits(user_id, points, granted_at, expires_at)`. Credits are summed along with `dailyBudgetPoints` when computing remaining balance.
- Admin endpoint: `POST /api/admin/users/:userId/budget/credit { points: number }` — inserts a credit with `expires_at = NOW() + 24h`.
- `buildPointsBalanceSnapshot()` adds `SUM(active credits)` to `dailyBudgetPoints` for the balance calculation.
- Admin UI: a "Grant Credit" button next to each user's budget row in the admin panel.

---

## Gap 5 — No Logging Observability; Schema Failures Are Invisible to Admin

### Symptom

`example6`'s full report failed silently from the admin's perspective. The admin panel shows job status (`failed`) and a summarized `failure_reason` string, but:
- No visibility into which specific step kind failed.
- No visibility into the Zod validation error (what the model returned, what schema expected).
- No visibility into the self-correcting retry: did it fire? Did the retry also fail? What did the model return on retry?
- Cost observability exists (`llm_requests`) but schema/structural failures are only in `step_lifecycle_events` — not surfaced in the admin UI.

### What's Needed

**Short term — Admin observability in the existing UI:**
- Job detail drill-down: show per-ticker step status with `last_error` (already in `step_work_items`).
- When a step fails with a Zod error, record: the raw LLM response string (truncated), the normalized value passed to Zod, and the specific Zod errors. Currently only a summary is written to `step_lifecycle_events`.
- Schema failure rate metric: ratio of steps with `errorClass = "zod"` in `step_lifecycle_events`. A spike in this metric precedes job-level failures.

**Medium term — Structured log stream:**
- All `logger.warn` / `logger.error` calls in `executor.ts`, handler files, and the step queue are currently swallowed into `journalctl`. They are not queryable, not alertable, not retainable beyond systemd's journal rotation window.
- Need a structured log sink: write JSON-line logs to a file or a DB table (`system_logs`?) that admin can query by `user_id`, `job_id`, `step_kind`, `level`.

**Long term — Log aggregation platform:**
- **ELK/ECK (Elasticsearch + Kibana):** Self-hosted, strong for structured JSON logs, good dashboarding. ECK is the Kubernetes operator variant — if the platform ever moves to k8s this is the natural path.
- **Splunk:** Enterprise log platform, more powerful query language (SPL), higher operational cost. Appropriate if the platform grows to multi-tenant scale.
- Minimum viable: ship logs to a managed service (Datadog, Logtail, Better Stack) before self-hosting ELK. They accept JSON-line input over HTTP with zero infrastructure overhead.
- In the interim: a `/api/admin/logs` endpoint that queries `step_lifecycle_events` filtered by job/user/error class would give the admin 80% of the value with zero new infrastructure.

---

## Summary Table

| # | Area | Severity | Impact |
|---|------|----------|--------|
| 1 | Synthesis step: root string instead of object | High | All synthesis steps fail for affected model/model-tier combos; no verdicts produced |
| 2 | Budget enforced at admission only | High | Users can spend 5–10× their daily budget in a single job run |
| 3 | No time-until-reset display | Medium | Users and admin can't judge when budget clears without manual math |
| 4 | No one-time credit mechanism | Medium | Admin must permanently change base budget to grant temporary relief |
| 5 | Schema failures invisible in admin UI; no structured logging | High | Failures are silent; no way to detect schema regression before users report it |

---

## Notes on Recurrence of Schema Failures

This is now the **fourth distinct class** of schema validation failure. The pattern is clear: the existing normalization + Zod pipeline is not robust enough as the primary enforcement layer. Each iteration fixes the known failure class but exposes the next unknown class.

Schema validation must move upstream — using the model's native structured-output API (Anthropic tool_use, OpenRouter json_schema mode) so the model is contractually bound at the API level, not just prompted. The Zod `normalizeRaw` layer should be a safety net, not the primary mechanism.

The `json_object` response format (currently used) only guarantees parseable JSON — it does not guarantee the schema, and it does not prevent a model from returning a string literal as the root JSON value.
