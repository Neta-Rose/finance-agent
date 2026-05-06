import type { DataSource } from "typeorm";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../../db/applicationDataSource.js";
import { logger } from "../logger.js";
import { unwrapMutationRows } from "../dbUtils.js";

/**
 * Postgres-only watchdog — replaces the file-based `watchdogService.ts`.
 *
 * Spec: design.md §6.1 scheduler/watchdog; tasks.md 3.1; B1.4.
 *
 * Scans `step_work_items` and `jobs` for stuck rows and applies
 * action-specific timeout policies. No filesystem reads.
 *
 * Timeout policy (minutes):
 *   quick_check.evaluate  →  5
 *   tracking.evaluate     →  5
 *   analyst.*             →  20
 *   debate                →  20
 *   synthesis             →  20
 *   daily_brief           →  60
 *   deep_dive             →  180
 *   full_report           →  240
 *   default               →  60
 */

const ACTION_TIMEOUT_MINUTES: Record<string, number> = {
  "quick_check":  5,
  "daily_brief":  60,
  "deep_dive":    180,
  "full_report":  240,
  "new_ideas":    120,
};

const STEP_KIND_TIMEOUT_MINUTES: Record<string, number> = {
  "quick_check.evaluate": 5,
  "tracking.evaluate":    5,
  "analyst.fundamentals": 20,
  "analyst.technical":    20,
  "analyst.sentiment":    20,
  "analyst.macro":        20,
  "analyst.risk":         20,
  "debate":               20,
  "synthesis":            20,
};

const DEFAULT_STEP_TIMEOUT_MINUTES = 30;
const DEFAULT_JOB_TIMEOUT_MINUTES = 60;

/** Pending jobs that were never picked up: allow 2 × 30-min scheduler cycles. */
const PENDING_JOB_STALE_MINUTES = 90;

const SCAN_INTERVAL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Step-level sweep
// ---------------------------------------------------------------------------

async function sweepStuckSteps(ds: DataSource): Promise<number> {
  // Steps that have been `running` longer than their kind-specific timeout
  // are reset to `pending` so the executor can retry them. The executor's
  // own `sweepAbandonedRunningSteps` handles the lock-TTL case; this sweep
  // handles the case where the lock TTL is generous but the step is genuinely
  // hung (e.g. a provider call that never returned).
  const cases = Object.entries(STEP_KIND_TIMEOUT_MINUTES)
    .map(([kind, minutes]) => `WHEN kind = '${kind}' THEN INTERVAL '${minutes} minutes'`)
    .join("\n         ");
  const defaultInterval = `INTERVAL '${DEFAULT_STEP_TIMEOUT_MINUTES} minutes'`;

  const result = await ds.query(
    `UPDATE step_work_items
        SET status = 'pending',
            owner_lock_id = NULL,
            last_error = 'Watchdog: step exceeded kind-specific timeout, reset to pending'
      WHERE status = 'running'
        AND started_at < NOW() - CASE
         ${cases}
         ELSE ${defaultInterval}
       END
      RETURNING id, kind, user_id, job_id`
  );

  const validRows = unwrapMutationRows<{ id: string; kind: string; user_id: string; job_id: string }>(result);
  for (const row of validRows) {
    logger.warn(
      `Watchdog: reset stuck step step_id=${row.id} kind=${row.kind} user=${row.user_id} job=${row.job_id}`
    );
    await ds.query(
      `INSERT INTO step_lifecycle_events
         (step_id, from_status, to_status, attempt_n, error_class, error_message, occurred_at)
       VALUES ($1, 'running', 'pending', NULL, 'timeout',
               'Watchdog: step exceeded kind-specific timeout, reset to pending', NOW())`,
      [row.id]
    );
  }
  return validRows.length;
}

// ---------------------------------------------------------------------------
// Job-level sweep
// ---------------------------------------------------------------------------

async function sweepStuckJobs(ds: DataSource): Promise<number> {
  // Jobs that have been `running` longer than their action-specific timeout
  // are marked `failed`. This is a last-resort safety net; the step-level
  // sweep above should catch most cases first.
  const cases = Object.entries(ACTION_TIMEOUT_MINUTES)
    .map(([action, minutes]) => `WHEN action = '${action}' THEN INTERVAL '${minutes} minutes'`)
    .join("\n         ");
  const defaultInterval = `INTERVAL '${DEFAULT_JOB_TIMEOUT_MINUTES} minutes'`;

  const result = await ds.query(
    `UPDATE jobs
        SET status = 'failed',
            completed_at = NOW(),
            failure_reason = 'Watchdog: job exceeded action-specific timeout'
      WHERE status = 'running'
        AND started_at < NOW() - CASE
         ${cases}
         ELSE ${defaultInterval}
       END
      RETURNING id, action, user_id`
  );

  const validRows = unwrapMutationRows<{ id: string; action: string; user_id: string }>(result);
  for (const row of validRows) {
    logger.warn(
      `Watchdog: failed stuck job job_id=${row.id} action=${row.action} user=${row.user_id}`
    );
    await ds.query(
      `UPDATE step_work_items
          SET status = 'failed',
              owner_lock_id = NULL,
              completed_at = NOW(),
              last_error = 'Watchdog: parent job timed out'
        WHERE job_id = $1
          AND status IN ('pending', 'running')`,
      [row.id]
    );
  }
  return validRows.length;
}

// ---------------------------------------------------------------------------
// Pending-job sweep (never picked up)
// ---------------------------------------------------------------------------

async function sweepAbandonedPendingJobs(ds: DataSource): Promise<number> {
  const result = await ds.query(
    `UPDATE jobs
        SET status = 'failed',
            completed_at = NOW(),
            failure_reason = 'Watchdog: job was never picked up (pending timeout)'
      WHERE status = 'pending'
        AND triggered_at < NOW() - INTERVAL '${PENDING_JOB_STALE_MINUTES} minutes'
      RETURNING id, action, user_id`
  );

  const validRows = unwrapMutationRows<{ id: string; action: string; user_id: string }>(result);
  for (const row of validRows) {
    logger.warn(
      `Watchdog: abandoned pending job job_id=${row.id} action=${row.action} user=${row.user_id}`
    );
  }
  return validRows.length;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

async function scan(): Promise<void> {
  if (!isApplicationDatabaseConfigured()) return;
  scanning = true;
  try {
    const ds = await getApplicationDataSource();
    const [steps, jobs, pending] = await Promise.all([
      sweepStuckSteps(ds),
      sweepStuckJobs(ds),
      sweepAbandonedPendingJobs(ds),
    ]);
    if (steps > 0 || jobs > 0 || pending > 0) {
      logger.info(
        `Watchdog scan: reset_steps=${steps} failed_jobs=${jobs} abandoned_pending=${pending}`
      );
    }
  } finally {
    scanning = false;
  }
}

let interval: ReturnType<typeof setInterval> | null = null;
let scanning = false; // R9: prevent concurrent sweeps

export function startWatchdog(): void {
  if (interval) return;

  // Delay initial scan 30 s so the server fully starts before touching rows.
  setTimeout(() => {
    scan().catch((err: Error) =>
      logger.error(`Watchdog initial scan error: ${err.message}`)
    );
  }, 30_000);

  interval = setInterval(() => {
    if (scanning) return; // R9: skip if previous sweep is still running
    scan().catch((err: Error) =>
      logger.error(`Watchdog scan error: ${err.message}`)
    );
  }, SCAN_INTERVAL_MS);

  logger.info(
    `Postgres-only watchdog started — scan_interval=${SCAN_INTERVAL_MS / 60000}min`
  );
}

export function stopWatchdog(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
