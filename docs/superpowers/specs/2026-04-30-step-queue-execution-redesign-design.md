# Step-Queue Execution Redesign — Design Spec

**Date:** 2026-04-30
**Status:** Approved for implementation
**Scope:** Execution core for `full_report` and `deep_dive`. Replaces the agent-orchestrated trigger-file pipeline with a backend-owned step queue.
**Relationship to prior plan:** Implements items #3 (resumable deep-dive state machine), #5 (per-user single-flight queue), #6 (job-truth model), and #9 (per-step observability) from [`docs/core-stabilization-plan.md`](../../core-stabilization-plan.md).

---

## 1. Problem

The current architecture lets the LLM agent own workflow orchestration. Concretely, the agent reads `HEARTBEAT.md` and the trigger directory, decides what to run, runs it, and updates job state. Three failure classes follow from that contract.

### 1.1 Cognitive overload of the orchestrating model

A `full_report` for a 10-ticker portfolio is 60+ steps' worth of work in one agent session. Cheap or mid-tier models cannot reliably hold that workflow. **Confirmed evidence (user `soofke`, 2026-04-27):** the agent (driving model `clawd-soofke/deepseek/deepseek-v3.2`) hallucinated writing a Python analysis script (`full_report_analysis.py`, `full_report_simple.py`), tried to `exec` it, was blocked by the OpenClaw sandbox, and self-paused after 6 minutes 51 seconds with `error: "execution_constraints: Unable to run detailed market analysis due to system restrictions."` The job has been stuck in this state for 3+ days at the time of writing.

### 1.2 State divergence between truth sources

Job state is split across `full_report_state.json` and `data/jobs/job_*.json`. Both can be written by the agent and the backend. Soofke's two files currently disagree (`status: "running"` in state.json vs `status: "paused"` in job.json), and the divergence has been stable for 3 days because neither writer has reconciled.

### 1.3 Resume that is not resume

The current pipeline cannot resume mid-job. A heartbeat tick re-discovers triggers and re-orchestrates from prose contracts; if a run times out, "resume" means re-reading the workspace and guessing what to do. Mid-step resume after a budget pause is not a supported transition.

### 1.4 Auxiliary symptoms

- Agent calls `Read` on the triggers directory, hitting `EISDIR` errors (logs).
- 21-hour gap observed between trigger creation and pickup.
- `cron wakeup` repeatedly logs `Could not wake agent: <userId>` for the active user.

---

## 2. Goals

1. **100% of valid `deep_dive` and `full_report` runs succeed.** "Valid" means: ticker exists, market data is available, OpenRouter has credit. Failure rate becomes a function of external services and prompts, not the orchestration substrate.
2. **A `full_report` is never cancelled by budget exhaustion.** Pause and resume across day boundaries is the normal case, not an error.
3. **Step-level resume.** If ticker `QQQ`'s `analyst.sentiment` (step 3 of 7) pauses on day 1, the run continues from `QQQ`'s `analyst.sentiment` on day 2 — not from the start of `QQQ`, and not from the start of the report.
4. **Failure isolation per ticker.** A permanently failing analyst step on one ticker fails that ticker only; the other 9 continue.
5. **Single source of operational truth.** No two systems writing the same status field.
6. **Admin observability.** Real-time per-step status, per-step cost, per-tier spend dashboards.
7. **Safe rollout.** New system runs alongside the old one behind a per-user flag; reversible until retirement.

## 3. Non-goals

- Replacing the chat agent. Telegram chat and `quick_check` continue to use OpenClaw with `HEARTBEAT.md`.
- Replacing the workspace artifact format. `fundamentals.json`, `strategy.json`, etc. keep their schemas and paths.
- Adding new analyst types or new portfolio data sources.
- Implementing per-user custom model bundles (deferred future hook).
- Setting daily cost caps. Cost is recorded; caps are deferred until real distributions are observed.

---

## 4. Architecture overview

Two stores, sharp boundary:

| Concern | Store | Why |
|---|---|---|
| **Operational state** — Jobs, ticker work items, step work items, attempts, locks, cost accrual | **Postgres** (TypeORM, joins existing `ObservabilityRequestEntity` + `UserPointsBudgetEntity`) | Relational, transactional, query-heavy, machine-only |
| **Artifacts** — `fundamentals.json`, `technical.json`, `sentiment.json`, `macro.json`, `risk.json`, `debate.json`, `strategy.json` | **User workspace files** (`users/<id>/data/reports/<TICKER>/`) | User-visible, read by chat agent, already what the UI fetches |

The state-divergence bug is structurally impossible after this redesign: there is exactly one writer for operational state (the backend step executor) and operational state never lives in the workspace. Files `full_report_state.json` and `data/jobs/job_*.json` are retired.

The step executor is a backend service that runs as a `setInterval` (~500 ms cadence). On each tick it claims the oldest pending step from a running job (`SELECT ... FOR UPDATE SKIP LOCKED`), invokes the matching handler, validates the output, persists the artifact, advances the job state, and exits. There is no agent wakeup, no trigger file, no markdown contract.

The chat agent is unchanged in role. It reads workspace artifacts for context but never writes operational state.

---

## 5. Object model & Postgres schema

Three new TypeORM entities. All keyed to existing `userId` strings (no users table — users remain file-backed in `users/<id>/`).

### 5.1 `JobEntity`

```sql
CREATE TABLE jobs (
  id                    TEXT PRIMARY KEY,                 -- job_YYYYMMDD_HHMMSS_xxxxxx
  user_id               TEXT NOT NULL,
  action                TEXT NOT NULL,                    -- 'full_report' | 'deep_dive' | ...
  status                TEXT NOT NULL,                    -- 'pending'|'running'|'paused'|'completed'|'failed'|'cancelled'|'superseded'
  source                TEXT NOT NULL,                    -- 'dashboard_action' | 'auto_brief' | 'admin'
  model_tier            TEXT NOT NULL,                    -- 'free'|'cheap'|'balanced'|'expensive', copied from profile.json at admit time
  notify_per_ticker     BOOLEAN NOT NULL DEFAULT false,
  budget_admitted_at    TIMESTAMP,
  triggered_at          TIMESTAMP NOT NULL DEFAULT now(),
  started_at            TIMESTAMP,
  paused_at             TIMESTAMP,
  completed_at          TIMESTAMP,
  pause_reason          TEXT,                             -- 'budget_exhausted' | 'manual' | 'deploy'
  failure_reason        TEXT,
  result                JSONB
);
CREATE INDEX idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX idx_jobs_status_triggered ON jobs(status, triggered_at);
```

### 5.2 `TickerWorkItemEntity`

```sql
CREATE TABLE ticker_work_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id               TEXT NOT NULL,
  ticker                TEXT NOT NULL,
  status                TEXT NOT NULL,                    -- 'pending'|'running'|'paused'|'completed'|'failed'|'skipped'
  position              INT NOT NULL,                     -- ordering within job
  started_at            TIMESTAMP,
  completed_at          TIMESTAMP,
  failure_reason        TEXT,
  skip_reason           TEXT
);
CREATE INDEX idx_tickers_job ON ticker_work_items(job_id);
```

### 5.3 `StepWorkItemEntity`

```sql
CREATE TABLE step_work_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker_work_item_id   UUID NOT NULL REFERENCES ticker_work_items(id) ON DELETE CASCADE,
  job_id                TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id               TEXT NOT NULL,
  kind                  TEXT NOT NULL,                    -- enum, see Section 6
  status                TEXT NOT NULL,                    -- 'pending'|'running'|'completed'|'failed'
  attempts              INT NOT NULL DEFAULT 0,
  model_tier_used       TEXT,                             -- last attempt's tier (may differ from job.model_tier after escalation)
  cost_accrued_cents    INT NOT NULL DEFAULT 0,
  input_artifact_paths  TEXT[] NOT NULL DEFAULT '{}',
  output_artifact_path  TEXT,                             -- e.g. users/soofke/data/reports/QQQ/sentiment.json
  last_error            TEXT,
  owner_lock_id         UUID,                             -- non-null while running, with TTL via started_at
  started_at            TIMESTAMP,
  completed_at          TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_steps_status_created ON step_work_items(status, created_at);
CREATE INDEX idx_steps_lock ON step_work_items(owner_lock_id) WHERE owner_lock_id IS NOT NULL;
```

### 5.4 `StepLifecycleEventEntity` (append-only audit log)

```sql
CREATE TABLE step_lifecycle_events (
  id              BIGSERIAL PRIMARY KEY,
  step_id         UUID NOT NULL REFERENCES step_work_items(id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  attempt_n       INT,
  model_used      TEXT,
  tier_used       TEXT,
  error_class     TEXT,                                   -- 'zod' | 'network' | 'timeout' | 'rate_limit' | 'gather_inputs'
  error_message   TEXT,
  occurred_at     TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_step_events_step ON step_lifecycle_events(step_id, occurred_at);
```

### 5.5 `ModelTierAssignmentEntity`

```sql
CREATE TABLE model_tier_assignments (
  tier        TEXT NOT NULL CHECK (tier IN ('free','cheap','balanced','expensive')),
  step_kind   TEXT NOT NULL,
  model       TEXT NOT NULL,
  fallback    TEXT,
  updated_at  TIMESTAMP NOT NULL DEFAULT now(),
  updated_by  TEXT NOT NULL DEFAULT 'admin',
  PRIMARY KEY (tier, step_kind)
);
```

### 5.6 Existing entities, augmented

`ObservabilityRequestEntity` gains a nullable `step_id UUID` column referencing `step_work_items(id)`. Chat-agent calls remain `null`. Existing reads/writes are unaffected.

### 5.7 Per-user file-backed state

`users/<userId>/profile.json` gains one field: `modelTier: 'free'|'cheap'|'balanced'|'expensive'` (default `'balanced'`). The legacy `data/config.json` `modelProfile` field is retained for the duration of the rollout but is no longer read by the new executor.

---

## 6. Step taxonomy & expansion rules

Seven step kinds, each producing exactly one artifact:

| Kind | Artifact | Inputs | Purpose |
|---|---|---|---|
| `analyst.fundamentals` | `fundamentals.json` | yahoo-finance2, optional financials cache | numeric/financial reasoning |
| `analyst.technical` | `technical.json` | yahoo-finance2 candles + backend-computed indicators | price action, indicators |
| `analyst.sentiment` | `sentiment.json` | exa.ai search + contents | tone, news, narrative shift |
| `analyst.macro` | `macro.json` | rates / sector / currency data | macro context |
| `analyst.risk` | `risk.json` | `portfolio.json` + live price | position-specific risk narrative |
| `debate` | `debate.json` | the 5 analyst JSONs | bull vs bear, 2 rounds each, in one bounded LLM call |
| `synthesis` | `strategy.json` | analyst JSONs + `debate.json` + `portfolio.json` + `USER.md` | final Zod-valid `StrategySchema` |

**Artifact schemas** are unchanged from the existing `backend/src/schemas/analysts.ts` and `backend/src/schemas/strategy.ts`. New: `debate.json` schema (replaces today's `bull_case.json`/`bear_case.json` two-round files; carries both sides' two rounds + final positions in one document).

### 6.1 Job → step expansion rules

Expansion is decided **per-ticker**, not per-job. At job admission time, each ticker is independently classified into one of two regimes:

- **Full deep-dive (7 steps).** Triggered when any of the following holds for that ticker:
  - `strategy.json` does not exist
  - `strategy.json` exists but `lastDeepDiveAt === null` (baseline placeholder)
  - `conditionEngine` would escalate this ticker (catalyst expired, stale verdict, low confidence past 30 days, etc. — existing logic, see [`conditionEngine.ts`](../../../backend/src/services/conditionEngine.ts))
- **Light pass (5 analyst steps).** A valid `strategy.json` exists with non-null `lastDeepDiveAt` and `conditionEngine` does not flag the ticker. Only the 5 analyst steps fire; `debate` and `synthesis` are not enqueued for this ticker on this job.

Implications:

- **First-time `full_report`** (a brand-new user; no `strategy.json` files exist anywhere) → every ticker takes the full deep-dive path. Soofke's case: 10 tickers × 7 steps = 70 step rows.
- **Routine `full_report`** (everything fresh and validated) → every ticker takes the light path. 10 tickers × 5 steps = 50 step rows.
- **Mixed** (most tickers fresh, two stale) → the two stale tickers get 7 steps, the rest get 5. Single job, mixed step counts per ticker.
- **Standalone `deep_dive`** → always 7 steps × 1 ticker, regardless of the ticker's existing strategy state.

Expansion is performed once at job admission time. Step rows are inserted in a single transaction with the parent job. The executor never invents steps mid-run.

### 6.2 Job-level concurrency

The existing `USER_AGENT_JOB_CONCURRENCY = 1` rule is preserved. At most one `running` job per user. Other jobs queued by the dispatcher remain `pending` until the active one terminates.

### 6.3 Global concurrency

The executor enforces a global `MAX_INFLIGHT_STEPS` cap (default 4) across all users to remain polite to OpenRouter and to bound the backend's outbound request rate. Configurable via env var.

---

## 7. Step executor & handler interface

### 7.1 The handler interface (γ → δ open/closed seam)

```typescript
interface StepHandler {
  kind: StepKind;
  gatherInputs(step: StepWorkItem, ws: UserWorkspace): Promise<StepInputs>;
  buildPrompt(inputs: StepInputs, tier: ModelTier): { system: string; user: string; schema: ZodSchema };
  call(prompt: BuiltPrompt, model: ResolvedModel): Promise<unknown>;       // γ today, δ later
  validate(raw: unknown, schema: ZodSchema): Result<Artifact, ZodError>;
  persistArtifact(artifact: Artifact, ws: UserWorkspace): Promise<string>; // returns absolute path
}
```

**γ implementation of `call`** (default): single LLM completion, no tools, schema enforced as JSON-mode constraint, lives in `backend/src/services/llm/oneshotCall.ts`.

**δ implementation of `call`** (per-step opt-in, future): tool-use loop with backend-controlled tool allowlist (e.g. `exa_search`, `exa_get_contents`), capped iterations, capped per-call cost. Lives in `backend/src/services/llm/toolUseCall.ts`. A step type is promoted γ → δ by changing one config line in its handler module. The orchestrator, queue, persistence, and validation are untouched.

### 7.2 Handler modules

One file per kind under `backend/src/services/steps/`:

- `analyst.fundamentals.ts`
- `analyst.technical.ts`
- `analyst.sentiment.ts`
- `analyst.macro.ts`
- `analyst.risk.ts`
- `debate.ts`
- `synthesis.ts`

Each ~100–250 LOC. Each tested independently (unit + step-integration).

### 7.3 Executor loop

```typescript
async function tick(): Promise<void> {
  if (inflight() >= MAX_INFLIGHT_STEPS) return;

  const step = await db.tx(t => t.query(`
    UPDATE step_work_items SET status = 'running', owner_lock_id = $1, started_at = now()
    WHERE id = (
      SELECT s.id FROM step_work_items s
      JOIN jobs j ON j.id = s.job_id
      WHERE s.status = 'pending' AND j.status = 'running'
      ORDER BY s.created_at ASC
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `, [newLockId()]));
  if (!step) return;

  const handler = handlerFor(step.kind);
  const ws      = workspaceFor(step.user_id);
  const model   = resolveModel(step.kind, step.user_id, step.model_tier_used);

  try {
    const inputs   = await handler.gatherInputs(step, ws);
    const prompt   = handler.buildPrompt(inputs, model.tier);
    const raw      = await handler.call(prompt, model);
    const artifact = handler.validate(raw, prompt.schema).orThrow();
    const path     = await handler.persistArtifact(artifact, ws);
    await markCompleted(step, path);
    await advance(step);                          // next sibling, or advance ticker, or advance job
  } catch (err) {
    await handleFailure(step, err);               // retry / escalate / fail
  }
}

setInterval(tick, 500);
```

### 7.4 Atomic artifact writes

`persistArtifact` writes to `<path>.tmp`, `fsync`s, then renames. Readers (chat agent, UI, downstream steps) never see partial JSON. A crash between write and rename leaves the `.tmp` file orphaned; a startup sweep deletes orphan `.tmp` older than 1 hour.

### 7.5 Lock TTL

A step row in `running` status with `started_at` older than 10 minutes is considered abandoned. A startup-time sweep + a periodic sweeper (every 60s) reset such rows to `pending` (clearing `owner_lock_id`). The sweeper runs in the same backend process.

### 7.6 Retry & tier escalation

| Trigger | Action |
|---|---|
| ZodError on output | retry same tier (LLM mis-shaped JSON; usually transient) |
| Network or HTTP 5xx | retry same tier with exponential backoff: 1s, 4s, 16s |
| HTTP 429 | retry same tier with longer backoff: 30s, 2m, 8m |
| 3 consecutive ZodErrors at current tier | escalate one tier up (`free` does not escalate to `cheap`; see 7.7), reset attempt counter |
| 3 failures at the highest applicable tier | step fails → ticker fails → other tickers continue |

The "ticker fails on permanent step failure" rule applies to all step kinds. We do not run `synthesis` with N−1 analysts; synthesis quality is non-negotiable.

### 7.7 Free-tier exception

`free` tier does not escalate to paid tiers. A step that exhausts retries at `free` fails directly. Free users opt out of cost; the system honors that. Free-tier rate-limit failures (common with OpenRouter `:free` models) follow the same backoff schedule.

---

## 8. Model tiers & admin configuration

Four tiers: `free`, `cheap`, `balanced`, `expensive`. Default `balanced`. Per-user setting in `profile.json`. Per-`(tier, step_kind)` model in PG. Both admin-editable.

### 8.1 Resolver

```typescript
function resolveModel(stepKind: StepKind, userId: string, lastTierUsed?: ModelTier): ResolvedModel {
  const tier = lastTierUsed ?? readUserTier(userId);
  const row  = modelTierAssignments.get(tier, stepKind);
  return {
    tier,
    primary:  `clawd-${userId}/${row.model}`,
    fallback: row.fallback ? `clawd-${userId}/${row.fallback}` : null,
  };
}
```

The `clawd-<userId>/<model>` namespace continues to flow through the existing `llmProxy.ts` to OpenRouter with attribution intact.

### 8.2 Default tier matrix

Initial values; admin edits each cell independently.

| Step kind | free | cheap | balanced (default) | expensive |
|---|---|---|---|---|
| `analyst.fundamentals` | 8B-class `:free` | deepseek-v3.2 | gemini-2.5-flash | claude-sonnet-4-6 |
| `analyst.technical` | 8B-class `:free` | deepseek-v3.2 | gemini-2.5-flash | claude-sonnet-4-6 |
| `analyst.sentiment` | strongest free | gemini-2.5-flash | gemini-2.5-flash | claude-sonnet-4-6 |
| `analyst.macro` | strongest free | deepseek-v3.2 | gemini-2.5-flash | claude-sonnet-4-6 |
| `analyst.risk` | 8B-class `:free` | deepseek-v3.2 | gemini-2.5-flash | claude-sonnet-4-6 |
| `debate` | strongest free | gemini-2.5-flash | claude-sonnet-4-6 | claude-opus-4-7 |
| `synthesis` | strongest free | gemini-2.5-flash | claude-sonnet-4-6 | claude-opus-4-7 |

### 8.3 Admin panel: `/admin/models`

A 4 × 7 grid. Each cell: model dropdown (populated from cached `https://openrouter.ai/api/v1/models`) + optional fallback dropdown. Save → UPSERT row. The `updated_by` column captures the admin user. A toggle at the top of the page disables the `free` tier globally (useful if OpenRouter free pool degrades).

### 8.4 Admin panel: `/admin/users` extension

Existing user list grows one column: `Tier` (dropdown). Save patches `users/<id>/profile.json`.

### 8.5 Per-step prompt shape

Identical structure across kinds, parameterized by step:

```
SYSTEM:
  You are the {step.label} for portfolio user {userId}.
  Output one JSON object that strictly matches the provided Zod schema.
  Do not write code. Do not invoke tools. Do not produce prose outside JSON.
  Reasoning is internal; output is JSON only.

USER:
  Ticker: {ticker}
  Strategy (current): {strategy.json or null}
  USER.md profile excerpt: {risk tolerance, position cap, holding period}
  Data:
    {step-specific gathered inputs}
  
  Produce the JSON now.
```

The "do not write code, do not invoke tools" line is non-negotiable — it is the structural close of the soofke Python-script door at the prompt level. The schema is passed inline every call (not assumed in training).

---

## 9. Pause / resume / recovery

### 9.1 Pause

Three reasons, all expressed as a single PG status flip:

| `pause_reason` | Trigger | Resume condition |
|---|---|---|
| `budget_exhausted` | (When daily caps ship) projected next-step cost exceeds remaining headroom. No-op for `free` and during initial pilot. | Daily cron at user-TZ rollover flips back to `running` |
| `manual` | User or admin click | Manual resume click |
| `deploy` | Backend SIGTERM | Auto-resume on next backend startup |

A pause is a status change on `JobEntity` plus `paused_at`. In-flight step rows are released by the transaction-end semantics of `FOR UPDATE SKIP LOCKED`; they remain `running` until lock TTL clears them or they complete naturally.

### 9.2 Resume

The executor never asks "what was running." It asks "what is the next pending step." Resume = flip `JobEntity.status` from `paused` to `running`. The next `tick()` claims the next pending step row, whose `kind`, `input_artifact_paths`, and `output_artifact_path` describe everything that needs to happen. **No state reconstruction.**

This delivers the step-level resume guarantee:

> A `full_report` paused on day 1 mid-`analyst.sentiment` for ticker QQQ resumes on day 2 from `analyst.sentiment` for QQQ. Not from QQQ's start. Not from the report's start.

### 9.3 Cancel vs pause

Cancel is a different transition with a different meaning. A `full_report` is **never** cancelled by budget exhaustion or by step failure. Cancel is reserved for:

- User explicitly clicks Cancel
- Admin cancels via `/admin/jobs`
- Portfolio becomes empty (no tickers to analyze)
- User account is archived

A cancelled job is terminal. A paused job is alive.

### 9.4 Idempotency

- Artifact writes are atomic (`.tmp` + rename).
- LLM cost is recorded only on completed responses; a crash mid-call may double-charge by one call (~$0.001 to $0.05). Acceptable.
- Step retries overwrite their own artifact; no append, no merge.

---

## 10. Soofke-specific recovery path

Three phases. Phase 0 ships independently of the redesign and is reversible.

### 10.1 Phase 0 — defensive truth fix (this week, ~½ day)

1. Add a backend startup reconciler: any job in `paused` status whose `state.json` claims `running` gets `state.json` rewritten to match. (Lives in `backend/src/services/stateService.ts` or successor.)
2. Delete soofke's hallucinated artifacts: `data/jobs/full_report_analysis.py`, `full_report_simple.py`, `data/reports/full_report_basic_20260427_1147.json`.
3. Mark soofke's stuck job `superseded` with `failure_reason: "Replaced by step-queue execution; see new full_report"`.
4. Add a one-line banner in `/controls` when a user has a `superseded` job: *"Your previous Full Report ran into a system issue and didn't complete. A new run will be available soon. Your portfolio data and existing strategies are untouched."*

This PR ships independently, unblocks the dashboard immediately, and does not depend on the new system.

### 10.2 Phase 1 — migration (when the redesign lands)

Idempotent admin script:

```typescript
async function migrateUserToStepQueue(userId: string): Promise<MigrationReport> {
  // 1. UPDATE jobs SET status='superseded' WHERE user_id=$1 AND status IN ('running','paused')
  // 2. For each ticker in portfolio.json: ensure strategy.json exists; if missing or invalid, write baseline placeholder.
  // 3. Set USE_STEP_QUEUE=true on the user's profile.json.
}
```

No data is destroyed. Existing strategy files stay untouched. Run on a workspace copy first; rollback = flip flag back to false and re-mark old jobs as `paused`.

### 10.3 Phase 2 — clean re-run

soofke (or admin via `/admin/jobs`) clicks "Full Report" in `/controls`. Dispatcher creates 1 `JobEntity` + 10 `TickerWorkItem` + 70 `StepWorkItem` rows. Executor processes them. Progress visible per-step in the UI. Completes within 1–2 days at `balanced` tier (target $0.50/user/day envelope).

If a single ticker's step permanently fails after escalation, that ticker's `TickerWorkItem` ends in `failed` status with a clear reason; the other 9 tickers complete. soofke gets 9 working strategies plus a diagnostic line for the 10th — replacing the silent "execution_constraints" failure of Apr 27.

---

## 11. Observability & admin panel

### 11.1 Per-step instrumentation

- `ObservabilityRequestEntity.step_id` FK populated for every step-scoped LLM call.
- `step_lifecycle_events` row written on every status transition.
- Materialized view `step_daily_rollup`: `(user_id, day, kind, tier, count_total, count_completed, count_failed, p50_seconds, p95_seconds, sum_cost_cents)`. Refreshed nightly.
- Materialized view `failure_clusters`: per-day grouping of failed steps by `(kind, error_class)`. Drives prompt iteration.

### 11.2 Admin panel additions

| Screen | Purpose |
|---|---|
| `/admin/jobs` | Live job inspector. Filter by user/status/action. Drill-down: ticker progress, per-step status, per-step cost, error trail. Buttons: Pause / Resume / Cancel (job), Retry (step). |
| `/admin/models` | 4 × 7 tier matrix; OpenRouter model picker; audit log. |
| `/admin/cost` | Per-user daily spend (last 30 days line chart); per-step-kind cost distribution (box plot); per-tier spend share (donut). |

### 11.3 User UI additions

- `/controls` active-job card grows a `notify_per_ticker` checkbox (default off). Toggleable while job is in `running` / `paused` / `pending`. On each ticker completion, if checked and Telegram is wired, post a templated message (no LLM call): `✓ {TICKER} · {verdict} ({confidence}) · {n}/{N} tickers · est. {hh:mm} remaining`.
- `/settings` model-tier dropdown (`free` / `cheap` / `balanced` / `expensive`). When set to `free`, a one-line warning: *"Free models are slower and produce lower-quality output. Some analyses may fail and require retry."*

### 11.4 Cost caps (deferred)

Infrastructure is built (`UserPointsBudgetEntity` exists; the budget gate function is wired into `tick()` but starts as a no-op when no cap is set). After 1–2 weeks of pilot data, admin sets per-user daily caps based on observed distributions.

---

## 12. Failure modes catalog

### 12.1 External services

| Failure | Effect | Recovery |
|---|---|---|
| OpenRouter 5xx | LLM call retries with backoff; if persistent, step fails after 6 attempts → ticker fails | Auto on restoration |
| OpenRouter 429 | Longer-backoff retry | Auto |
| Yahoo Finance down | `gatherInputs` fails *before* LLM call; no cost | Auto |
| exa.ai down | `gatherInputs` fails *before* LLM call (sentiment, optional macro) | Auto |

Pre-LLM failures cost zero. This is structural, not an optimization.

### 12.2 Infrastructure

| Failure | Effect | Recovery |
|---|---|---|
| Postgres down | `tick()` query fails; logged; sleep 5 s and retry. No state changes during outage. | Auto |
| Backend crash mid-step | Lock TTL expires; step re-claimed; one duplicate LLM call possible (≤$0.05) | Auto |
| Backend deploy | 60 s graceful drain; in-flight steps complete; new claims paused; resume on startup | Auto |
| Disk full | Artifact write fails; step fails; ticker fails | Operational alert; existing infra |

### 12.3 LLM

| Failure | Effect | Recovery |
|---|---|---|
| Persistent ZodError | 6 attempts (3 + 3 escalated). Step fails → ticker fails. Full chain in `/admin/jobs`. | Admin reviews lifecycle events, edits handler prompt, clicks "Retry Step" (re-runs that step in place without restarting the job). |
| Prompt injection from exa content | LLM tries off-spec output | Bounded structurally: no exec tools available in γ; output schema strictly enforced; system prompt frames data passages as reference. Worst case = ZodError. **Cannot escape into shell, files, or code execution because those tools do not exist in γ.** |
| Hallucinated number / URL | Validates Zod-shape but is wrong | Out-of-scope to detect mechanically. Calibrated by tier (expensive hallucinates less). Light cross-field sanity checks where cheap (e.g., synthesis rejects `positionWeightPct` outside `[0, 100]`, or `positionSizeILS < 0`; fundamentals rejects `revenueGrowthYoY > 1000`). Hallucinated qualitative content is accepted. |

### 12.4 User actions

| Failure | Effect | Recovery |
|---|---|---|
| User cancels mid-step | Job → `cancelled`. Next tick skips claiming from this job. Currently-running step completes (cost recorded; artifact kept for any future re-run). | One-way; user re-triggers a new job |
| Account archived mid-job | Existing archive flow + new `UPDATE jobs SET status='cancelled' WHERE user_id=$1` | Idempotent |
| Bad ticker (delisted / typo) | yahoo-finance2 returns no data; ticker fails fast with clear message | User edits portfolio; admin removes ticker |
| Empty portfolio | Job creation API returns 400 | User adds positions |

### 12.5 Migration

| Risk | Mitigation |
|---|---|
| Migration script bug | Run on workspace copy first; script is read-mostly (writes only baseline placeholders for missing strategies) |
| New executor produces worse outputs | Per-user feature flag; both paths coexist 2 weeks |
| Need to roll back a user | Admin button: flag off + cancel any in-flight step-queue jobs for that user |

---

## 13. Explicit non-behaviors

To prevent scope creep during implementation, the system explicitly does **not** do the following:

- **No automatic prompt evolution.** Failing prompts are admin-edited.
- **No automatic tier escalation paid out of `free`.** Free users stay free.
- **No silent fallback model search.** Only the configured `fallback` field is tried.
- **No partial-strategy synthesis.** If any of the 5 analyst steps fail permanently, the ticker fails. Synthesis is never run with degraded inputs.
- **No agent writes to operational state.** The chat agent reads workspace artifacts; it never writes job/ticker/step rows.

---

## 14. Rollout plan

Four PRs, each independently shippable and each leaving the system in a better state.

### PR 1 — Phase 0 defensive fixes (~½ day)

- Backend startup reconciler for status divergence
- Delete hallucinated soofke artifacts
- Mark soofke's stuck job `superseded`
- `/controls` banner for users with superseded jobs

Independent of the redesign. Ships immediately.

### PR 2 — PG schema + executor + handler interface + 2 stub handlers (~1.5 weeks)

- TypeORM entities + migration SQL
- `tick()` loop, lock sweeper, executor service
- `StepHandler` interface + `oneshotCall` (γ implementation)
- `analyst.fundamentals` and `synthesis` handlers (the bookends)
- Per-user feature flag `USE_STEP_QUEUE`; defaults to `false`
- Step-integration test harness with fixture recording

No production user opted in. Pure additive.

### PR 3 — Remaining handlers + exa wrapper + admin pages (~1.5 weeks)

- `analyst.technical`, `analyst.sentiment`, `analyst.macro`, `analyst.risk`, `debate` handlers
- `exaService.ts` with day-keyed cache
- `/admin/jobs`, `/admin/models`, `/admin/cost` screens
- `/controls` notify-per-ticker checkbox
- `/settings` tier dropdown
- Dev users flip flag on; iterate prompts on real Zod failures

### PR 4 — Soofke migration + production cutover (~3 days)

- Migration script
- Run on staging copy
- Migrate soofke; queue her `full_report`; observe completion
- Migrate remaining users in batches of 1–2
- Follow-up cleanup PR (post-rollout) retires `agentJobDispatcher` heartbeat path, `fullReportService.scanTicker`, `state.json` writes, and trigger files

**Total calendar time:** ~3–4 weeks for one engineer, with soofke unblocked at the end of week 1 by PR 1 alone.

---

## 15. Backward compatibility & safety property

The chat agent reads workspace artifact files for context (`fundamentals.json`, `strategy.json`, etc.). **Their formats and paths do not change.** The agent does not know whether the artifact was written by an OpenClaw skill or by a backend step. This means:

- We can flip individual users between systems without affecting their chat experience.
- Pre-redesign artifacts remain valid; users' historical strategies are not invalidated.
- Telegram briefings, condition-engine escalation, dashboard verdicts — all unchanged.

The only formats that change shape are the operational state files (`full_report_state.json`, `data/jobs/job_*.json`), which were never user-visible nor part of the agent's context. Their retirement is invisible.

---

## 16. Open questions deferred to implementation

- **Schedule cadence for `step_daily_rollup` materialized-view refresh.** Nightly is the default; may need adjustment if admin dashboard latency is poor.
- **Exact OpenRouter model IDs** for the default tier matrix. Picked at PR 3 time based on then-current OpenRouter listings; admin edits any cell post-launch.
- **Per-job model-tier override.** Currently job inherits from user's `profile.json` at admit time. Future hook: admin override per-job in `/admin/jobs`.
- **`debate.json` schema specifics.** The artifact replaces today's split bull/bear files; finalized in PR 3 against existing analyst-prompt conventions.

---

## 17. References

- [`docs/core-stabilization-plan.md`](../../core-stabilization-plan.md) — items #3, #5, #6, #9 of the prior plan.
- [`backend/src/schemas/strategy.ts`](../../../backend/src/schemas/strategy.ts) — `StrategySchema`.
- [`backend/src/schemas/analysts.ts`](../../../backend/src/schemas/analysts.ts) — analyst output schemas.
- [`backend/src/db/applicationDataSource.ts`](../../../backend/src/db/applicationDataSource.ts) — TypeORM data source.
- [`backend/src/db/entities/ObservabilityRequestEntity.ts`](../../../backend/src/db/entities/ObservabilityRequestEntity.ts) — existing per-LLM-request record (will gain `step_id` FK).
- [`backend/src/db/entities/UserPointsBudgetEntity.ts`](../../../backend/src/db/entities/UserPointsBudgetEntity.ts) — existing per-user budget envelope.
- [`backend/src/services/llmProxy.ts`](../../../backend/src/services/llmProxy.ts) — OpenRouter routing through `clawd-<userId>/...` namespace.
- [`HEARTBEAT.md`](../../../HEARTBEAT.md) — chat-agent contract; will be narrowed to chat-only post-rollout.
