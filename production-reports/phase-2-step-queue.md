# Production report — Phase 2: Step queue absorbs all job actions

**Date:** 2026-05-05
**Initiative:** Platform Stabilization and Assistant
**Tasks:** 2.1–2.7 (code), 2.8 (operational — VPS flag flip)

---

## Goal

Collapse the four legacy job runners (`runDailyBriefJob`, `runQuickCheckJob`, `runFullReportJob`, `runDeepDiveJob`) into the step queue. After this phase, every job action expands into `ticker_work_items` + `step_work_items` rows in Postgres. Legacy runners are kept behind `legacy_job_runners_enabled = true` for one phase as a fallback.

---

## 2.1 — DDL: `jobs.conversation_id`

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_jobs_conversation_id ON jobs (conversation_id)
  WHERE conversation_id IS NOT NULL;
```

Correlates chat-agent-triggered jobs with their conversation (Phase 5). Landing now to keep DDL linear.

`JobAction` extended: `"daily_brief" | "quick_check" | "new_ideas"`.
`JobSource` extended: `"whatsapp_command"`.

---

## 2.2 — `quick_check.evaluate` step kind

New: `backend/src/services/stepQueue/handlers/quickCheck.ts`.

Deterministic — no LLM. Computes a signal set from:
1. Strategy health (provisional/stale baseline, expired catalysts, HOLD without future catalyst)
2. Price drawdown from cost basis (≥30% → strong signal, ≥15% → moderate signal)
3. Sentiment artifact deterioration (reads existing `sentiment.json` if present)

Scores 0–100. Escalates when score < 60 and signals exist. Before escalating: checks snooze suppression, checks budget gate, admits a `deep_dive` job, records escalation in `escalation_history`.

Dispatched directly by the executor via `executeQuickCheckStep` — bypasses the LLM loop entirely.

---

## 2.3 — `tracking.evaluate` step kind

New: `backend/src/services/stepQueue/handlers/dailyBrief.ts`.

Evaluates tracked (non-held) assets during the daily brief. Signals: no deep dive ever, stale deep dive (>30 days), expired catalysts. `trackingStatus === "muted"` → never escalate.

---

## 2.4 — Expansion updated for all four job actions

`backend/src/services/stepQueue/expansion.ts` rewritten:

| Action | Expansion |
|---|---|
| `deep_dive` | Single ticker, full pipeline (7 steps) |
| `full_report` | All held tickers, mix of light-pass (5 analysts) and full deep-dive |
| `daily_brief` | `quick_check.evaluate` per held position + `tracking.evaluate` per active tracked asset |
| `quick_check` | Single ticker, `quick_check.evaluate` only |

`FULL_DEEP_DIVE_STEPS` explicitly excludes `quick_check.evaluate` and `tracking.evaluate`.

---

## 2.5 — `jobTriggerService.ts` routes through step queue

Added `STEP_QUEUE_ACTIONS = new Set(["deep_dive", "full_report", "daily_brief", "quick_check"])`.

- `deep_dive` and `full_report` always use the step queue
- `daily_brief` and `quick_check` use the step queue when `legacy_job_runners_enabled = false`
- All other actions continue through the legacy path

---

## 2.6 — Budget gate at step-queue admission

`admitStepQueueJob` in `admission.ts` calls `ensurePointsBudgetAvailable` before inserting any `step_work_items` rows. On refusal: throws `{ code: "points_budget_exhausted" }` and writes a `step_lifecycle_events` audit row.

---

## 2.7 — Strategies route reads from DB first

`GET /api/strategies` and `GET /api/strategies/:ticker` now prefer the `strategies` table, falling back to JSON file scan if the DB returns nothing or throws.

---

## 2.8 — Daily scheduler uses step queue

`dailySchedulerService.ts` rewritten:
- Reads `legacy_job_runners_enabled` flag at each poll cycle
- When `false`: admits `daily_brief` via `admitOrReuseStepQueueJob`
- When `true`: runs legacy `runDailyBriefJob` inline
- Added `pg_try_advisory_lock` distributed lease to prevent double-firing across replicas

---

## Files changed

```
NEW
  backend/src/services/stepQueue/handlers/quickCheck.ts
  backend/src/services/stepQueue/handlers/dailyBrief.ts

EDITED
  db/application_postgres.sql                          (+ conversation_id column)
  backend/src/services/stepQueue/types.ts              (+ new JobAction/JobSource values, + 2 step kinds)
  backend/src/services/stepQueue/expansion.ts          (rewritten for all 4 actions)
  backend/src/services/stepQueue/handlers.ts           (+ 2 new handlers registered)
  backend/src/services/stepQueue/admission.ts          (+ budget gate)
  backend/src/services/dailySchedulerService.ts        (+ step-queue path + distributed lease)
  backend/src/services/jobTriggerService.ts            (+ STEP_QUEUE_ACTIONS routing)
  backend/src/routes/strategies.ts                     (+ DB-first reader)
```

---

## Operational steps on VPS (Task 2.8)

```bash
cd /root/clawd && ./deploy.sh

# Verify DDL
psql "$APP_DATABASE_URL" -c "\d jobs"
# Should show: conversation_id | character varying(64) | nullable

# Trigger a daily_brief and confirm step-queue rows
curl -X POST http://localhost:8081/api/jobs/trigger \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"daily_brief"}'

psql "$APP_DATABASE_URL" -c "
  SELECT j.id, j.action, j.status, COUNT(t.id) AS tickers, COUNT(s.id) AS steps
  FROM jobs j
  LEFT JOIN ticker_work_items t ON t.job_id = j.id
  LEFT JOIN step_work_items s ON s.job_id = j.id
  WHERE j.triggered_at > NOW() - INTERVAL '5 minutes'
  GROUP BY j.id ORDER BY j.triggered_at DESC;"

# When confident, flip the legacy flag off
psql "$APP_DATABASE_URL" -c "
  UPDATE feature_flags
  SET enabled = false, updated_at = NOW(), updated_by = 'operator'
  WHERE flag_name = 'legacy_job_runners_enabled' AND scope_user_id IS NULL;"
```

**Rollback:**
```sql
UPDATE feature_flags
SET enabled = true, updated_at = NOW(), updated_by = 'operator'
WHERE flag_name = 'legacy_job_runners_enabled' AND scope_user_id IS NULL;
```
