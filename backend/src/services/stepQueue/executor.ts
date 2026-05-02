import { randomUUID } from "crypto";
import type { DataSource } from "typeorm";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../../db/applicationDataSource.js";
import { buildWorkspace } from "../../middleware/userIsolation.js";
import { logger } from "../logger.js";
import { resolveConfiguredPath } from "../paths.js";
import { isStepQueueServiceEnabled } from "./featureFlag.js";
import { handlerFor } from "./handlers.js";
import { resolveStepModel } from "./modelTier.js";
import { isStepKind, type ClaimedStepWorkItem, type JobStatus, type StepErrorClass } from "./types.js";

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;
const TICK_INTERVAL_MS = 500;
const SWEEP_INTERVAL_MS = 60_000;

let loopTimer: NodeJS.Timeout | null = null;
let sweepTimer: NodeJS.Timeout | null = null;
let runningTicks = 0;
const inflightSteps = new Set<string>();

export interface TerminalTickerCounts {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
}

export function resolveTerminalJobStatus(counts: TerminalTickerCounts): JobStatus {
  if (counts.total <= 0) return "failed";
  if (counts.failed <= 0) return "completed";
  return counts.completed + counts.skipped > 0 ? "partial_completed" : "failed";
}

function maxInflightSteps(): number {
  const parsed = Number(process.env["MAX_INFLIGHT_STEPS"] ?? "4");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 4;
}

function lockTtlMs(): number {
  const parsed = Number(process.env["STEP_QUEUE_LOCK_TTL_MS"] ?? String(DEFAULT_LOCK_TTL_MS));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_LOCK_TTL_MS;
}

function dateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return new Date(String(value));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mutationRows<T extends Record<string, unknown>>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    Array.isArray(result[0]) &&
    (typeof result[1] === "number" || result.length === 2)
  ) {
    return result[0] as T[];
  }
  return Array.isArray(result) ? result as T[] : [];
}

function mapClaimedStep(row: Record<string, unknown>): ClaimedStepWorkItem {
  const kind = String(row["kind"]);
  if (!isStepKind(kind)) {
    throw new Error(`Unknown step kind claimed from database: ${kind}`);
  }

  return {
    id: String(row["id"]),
    tickerWorkItemId: String(row["ticker_work_item_id"]),
    jobId: String(row["job_id"]),
    userId: String(row["user_id"]),
    ticker: String(row["ticker"]),
    kind,
    status: "running",
    attempts: Number(row["attempts"] ?? 0),
    modelTierUsed: row["model_tier_used"] === null ? null : String(row["model_tier_used"]) as ClaimedStepWorkItem["modelTierUsed"],
    costAccruedCents: Number(row["cost_accrued_cents"] ?? 0),
    inputArtifactPaths: stringArray(row["input_artifact_paths"]),
    outputArtifactPath: row["output_artifact_path"] === null ? null : String(row["output_artifact_path"]),
    lastError: row["last_error"] === null ? null : String(row["last_error"]),
    ownerLockId: row["owner_lock_id"] === null ? null : String(row["owner_lock_id"]),
    startedAt: dateOrNull(row["started_at"]),
    completedAt: dateOrNull(row["completed_at"]),
    createdAt: new Date(String(row["created_at"])),
  };
}

async function recordLifecycle(
  ds: DataSource,
  params: {
    stepId: string;
    fromStatus: string | null;
    toStatus: string;
    attemptN: number | null;
    modelUsed?: string | null;
    tierUsed?: string | null;
    errorClass?: StepErrorClass | null;
    errorMessage?: string | null;
  }
): Promise<void> {
  await ds.query(
    `INSERT INTO step_lifecycle_events
       (step_id, from_status, to_status, attempt_n, model_used, tier_used, error_class, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.stepId,
      params.fromStatus,
      params.toStatus,
      params.attemptN,
      params.modelUsed ?? null,
      params.tierUsed ?? null,
      params.errorClass ?? null,
      params.errorMessage ?? null,
    ]
  );
}

export async function claimNextPendingStep(
  ds: DataSource,
  ownerLockId = randomUUID()
): Promise<ClaimedStepWorkItem | null> {
  const result = await ds.query(
    `WITH next_step AS (
       SELECT s.id
       FROM step_work_items s
       JOIN jobs j ON j.id = s.job_id
       JOIN ticker_work_items t ON t.id = s.ticker_work_item_id
       WHERE s.status = 'pending'
         AND j.status = 'running'
         AND t.status = 'running'
         AND (
           s.kind LIKE 'analyst.%'
           OR (
             s.kind = 'debate'
             AND NOT EXISTS (
               SELECT 1
               FROM step_work_items dep
               WHERE dep.ticker_work_item_id = s.ticker_work_item_id
                 AND dep.kind LIKE 'analyst.%'
                 AND dep.status <> 'completed'
             )
           )
           OR (
             s.kind = 'synthesis'
             AND EXISTS (
               SELECT 1
               FROM step_work_items dep
               WHERE dep.ticker_work_item_id = s.ticker_work_item_id
                 AND dep.kind = 'debate'
                 AND dep.status = 'completed'
             )
           )
         )
       ORDER BY
         t.position ASC,
         CASE s.kind
           WHEN 'analyst.fundamentals' THEN 1
           WHEN 'analyst.technical' THEN 2
           WHEN 'analyst.sentiment' THEN 3
           WHEN 'analyst.macro' THEN 4
           WHEN 'analyst.risk' THEN 5
           WHEN 'debate' THEN 6
           WHEN 'synthesis' THEN 7
           ELSE 99
         END,
         s.created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE step_work_items s
        SET status = 'running',
            owner_lock_id = $1,
            started_at = NOW(),
            attempts = s.attempts + 1,
            last_error = NULL
       FROM next_step, ticker_work_items t
      WHERE s.id = next_step.id
        AND t.id = s.ticker_work_item_id
      RETURNING s.*, t.ticker`,
    [ownerLockId]
  );

  const row = mutationRows<Record<string, unknown>>(result)[0];
  if (!row) return null;
  const step = mapClaimedStep(row);
  await recordLifecycle(ds, {
    stepId: step.id,
    fromStatus: "pending",
    toStatus: "running",
    attemptN: step.attempts,
    tierUsed: step.modelTierUsed,
  });
  return step;
}

async function markStepCompleted(ds: DataSource, step: ClaimedStepWorkItem, outputPath: string): Promise<void> {
  await ds.query(
    `UPDATE step_work_items
        SET status = 'completed',
            output_artifact_path = $2,
            owner_lock_id = NULL,
            completed_at = NOW()
      WHERE id = $1`,
    [step.id, outputPath]
  );
  await recordLifecycle(ds, {
    stepId: step.id,
    fromStatus: "running",
    toStatus: "completed",
    attemptN: step.attempts,
    tierUsed: step.modelTierUsed,
  });
}

async function finalizeJobIfTickerWorkClosed(ds: DataSource, jobId: string): Promise<void> {
  const rows = await ds.query(
    `SELECT
       COUNT(*)::int AS total,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::int AS completed,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int AS failed,
       SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END)::int AS skipped,
       SUM(CASE WHEN status NOT IN ('completed', 'failed', 'skipped') THEN 1 ELSE 0 END)::int AS open,
       COALESCE(array_agg(ticker ORDER BY position) FILTER (WHERE status = 'completed'), '{}') AS completed_tickers,
       COALESCE(array_agg(ticker ORDER BY position) FILTER (WHERE status = 'failed'), '{}') AS failed_tickers,
       COALESCE(array_agg(ticker ORDER BY position) FILTER (WHERE status = 'skipped'), '{}') AS skipped_tickers
     FROM ticker_work_items
     WHERE job_id = $1`,
    [jobId]
  ) as Array<{
    total: number;
    completed: number;
    failed: number;
    skipped: number;
    open: number;
    completed_tickers: string[];
    failed_tickers: string[];
    skipped_tickers: string[];
  }>;
  const row = rows[0];
  if (!row || row.open > 0) return;

  const status = resolveTerminalJobStatus(row);
  const failureReason =
    status === "completed"
      ? null
      : row.failed_tickers.length > 0
        ? `Ticker work failed: ${row.failed_tickers.join(", ")}`
        : "No ticker work completed";

  await ds.query(
    `UPDATE jobs
        SET status = $2,
            completed_at = NOW(),
            failure_reason = $3,
            result = jsonb_build_object(
              'completed_at', NOW(),
              'status', $2,
              'totalTickers', $4::int,
              'completedTickers', $5::text[],
              'failedTickers', $6::text[],
              'skippedTickers', $7::text[]
            )
      WHERE id = $1
        AND status = 'running'`,
    [
      jobId,
      status,
      failureReason,
      row.total,
      row.completed_tickers,
      row.failed_tickers,
      row.skipped_tickers,
    ]
  );
}

async function advanceAfterStepCompletion(ds: DataSource, step: ClaimedStepWorkItem): Promise<void> {
  const incompleteStepRows = await ds.query(
    `SELECT COUNT(*)::int AS count
       FROM step_work_items
      WHERE ticker_work_item_id = $1
        AND status <> 'completed'`,
    [step.tickerWorkItemId]
  ) as Array<{ count: number }>;
  if ((incompleteStepRows[0]?.count ?? 0) > 0) return;

  await ds.query(
    `UPDATE ticker_work_items
        SET status = 'completed',
            completed_at = NOW(),
            failure_reason = NULL,
            skip_reason = NULL
      WHERE id = $1
        AND status <> 'completed'`,
    [step.tickerWorkItemId]
  );

  await finalizeJobIfTickerWorkClosed(ds, step.jobId);
}

async function markBlockedPendingStepsFailed(ds: DataSource, step: ClaimedStepWorkItem, reason: string): Promise<void> {
  const result = await ds.query(
    `UPDATE step_work_items
        SET status = 'failed',
            owner_lock_id = NULL,
            completed_at = NOW(),
            last_error = $2
      WHERE ticker_work_item_id = $1
        AND status = 'pending'
      RETURNING id, attempts`,
    [step.tickerWorkItemId, reason]
  );
  const rows = mutationRows<{ id: string; attempts: number } & Record<string, unknown>>(result);

  await Promise.all(
    rows.map((row) =>
      recordLifecycle(ds, {
        stepId: row.id,
        fromStatus: "pending",
        toStatus: "failed",
        attemptN: row.attempts,
        errorClass: "handler",
        errorMessage: reason,
      })
    )
  );
}

export async function reconcileStepQueueTerminalStates(ds: DataSource): Promise<{ blockedSteps: number; updatedJobs: number }> {
  await ds.query(
    `UPDATE ticker_work_items
        SET failure_reason = NULL,
            skip_reason = NULL
      WHERE status = 'completed'
        AND (failure_reason IS NOT NULL OR skip_reason IS NOT NULL)`
  );

  const blockedResult = await ds.query(
    `UPDATE step_work_items s
        SET status = 'failed',
            owner_lock_id = NULL,
            completed_at = NOW(),
            last_error = 'Blocked by failed ticker work item during reconciliation'
       FROM ticker_work_items t
      WHERE t.id = s.ticker_work_item_id
        AND t.status = 'failed'
        AND s.status = 'pending'
      RETURNING s.id, s.attempts`
  );
  const blockedRows = mutationRows<{ id: string; attempts: number } & Record<string, unknown>>(blockedResult);
  await Promise.all(
    blockedRows.map((row) =>
      recordLifecycle(ds, {
        stepId: row.id,
        fromStatus: "pending",
        toStatus: "failed",
        attemptN: row.attempts,
        errorClass: "handler",
        errorMessage: "Blocked by failed ticker work item during reconciliation",
      })
    )
  );

  const jobRows = await ds.query(
    `SELECT
       job_id,
       COUNT(*)::int AS total,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::int AS completed,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int AS failed,
       SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END)::int AS skipped,
       SUM(CASE WHEN status NOT IN ('completed', 'failed', 'skipped') THEN 1 ELSE 0 END)::int AS open,
       COALESCE(array_agg(ticker ORDER BY position) FILTER (WHERE status = 'completed'), '{}') AS completed_tickers,
       COALESCE(array_agg(ticker ORDER BY position) FILTER (WHERE status = 'failed'), '{}') AS failed_tickers,
       COALESCE(array_agg(ticker ORDER BY position) FILTER (WHERE status = 'skipped'), '{}') AS skipped_tickers
     FROM ticker_work_items
     GROUP BY job_id`
  ) as Array<{
    job_id: string;
    total: number;
    completed: number;
    failed: number;
    skipped: number;
    open: number;
    completed_tickers: string[];
    failed_tickers: string[];
    skipped_tickers: string[];
  }>;

  let updatedJobs = 0;
  for (const row of jobRows) {
    if (row.open > 0) continue;
    const status = resolveTerminalJobStatus(row);
    const failureReason =
      status === "completed"
        ? null
        : row.failed_tickers.length > 0
          ? `Ticker work failed: ${row.failed_tickers.join(", ")}`
          : "No ticker work completed";
    const result = await ds.query(
      `UPDATE jobs
          SET status = $2,
              completed_at = COALESCE(completed_at, NOW()),
              failure_reason = $3,
              result = jsonb_build_object(
                'completed_at', COALESCE(completed_at, NOW()),
                'status', $2,
                'totalTickers', $4::int,
                'completedTickers', $5::text[],
                'failedTickers', $6::text[],
                'skippedTickers', $7::text[]
              )
        WHERE id = $1
          AND status IN ('running', 'completed', 'partial_completed', 'failed')
          AND status <> $2
      RETURNING id`,
      [
        row.job_id,
        status,
        failureReason,
        row.total,
        row.completed_tickers,
        row.failed_tickers,
        row.skipped_tickers,
      ]
    );
    updatedJobs += mutationRows<Record<string, unknown>>(result).length;
  }

  return { blockedSteps: blockedRows.length, updatedJobs };
}

async function markStepFailed(
  ds: DataSource,
  step: ClaimedStepWorkItem,
  error: unknown,
  errorClass: StepErrorClass
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const permanent = step.attempts >= 3;
  await ds.query(
    `UPDATE step_work_items
        SET status = $2,
            owner_lock_id = NULL,
            completed_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE completed_at END,
            last_error = $3
      WHERE id = $1`,
    [step.id, permanent ? "failed" : "pending", message.slice(0, 2000)]
  );
  await recordLifecycle(ds, {
    stepId: step.id,
    fromStatus: "running",
    toStatus: permanent ? "failed" : "pending",
    attemptN: step.attempts,
    tierUsed: step.modelTierUsed,
    errorClass,
    errorMessage: message.slice(0, 2000),
  });

  if (!permanent) return;

  await ds.query(
    `UPDATE ticker_work_items
        SET status = 'failed',
            completed_at = NOW(),
            failure_reason = $2
      WHERE id = $1`,
    [step.tickerWorkItemId, message.slice(0, 2000)]
  );
  await markBlockedPendingStepsFailed(ds, step, "Blocked by failed prerequisite step");
  await finalizeJobIfTickerWorkClosed(ds, step.jobId);
}

export async function sweepAbandonedRunningSteps(ds: DataSource, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - lockTtlMs()).toISOString();
  const result = await ds.query(
    `UPDATE step_work_items
        SET status = 'pending',
            owner_lock_id = NULL,
            last_error = 'Step lock expired before completion'
      WHERE status = 'running'
        AND started_at < $1::timestamptz
      RETURNING id, attempts`,
    [cutoff]
  );
  const rows = mutationRows<{ id: string; attempts: number } & Record<string, unknown>>(result);

  await Promise.all(
    rows.map((row) =>
      recordLifecycle(ds, {
        stepId: row.id,
        fromStatus: "running",
        toStatus: "pending",
        attemptN: row.attempts,
        errorClass: "timeout",
        errorMessage: "Step lock expired before completion",
      })
    )
  );
  return rows.length;
}

async function executeClaimedStep(ds: DataSource, step: ClaimedStepWorkItem): Promise<void> {
  const handler = handlerFor(step.kind);
  const ws = buildWorkspace(step.userId, USERS_DIR);
  const model = await resolveStepModel(ds, step.userId, step.kind, step.modelTierUsed ?? "balanced");
  const inputs = await handler.gatherInputs(step, ws);
  const prompt = handler.buildPrompt(inputs, model.tier);
  const raw = await handler.call(prompt, model, step, inputs);
  const validation = handler.validate(raw, prompt.schema, inputs);
  if (!validation.ok) {
    throw validation.error;
  }
  const outputPath = await handler.persistArtifact(validation.artifact, ws, step);
  await markStepCompleted(ds, step, outputPath);
  await advanceAfterStepCompletion(ds, step);
}

export async function runStepQueueTick(): Promise<void> {
  if (!isApplicationDatabaseConfigured()) return;
  if (inflightSteps.size >= maxInflightSteps()) return;

  const ds = await getApplicationDataSource();
  const step = await claimNextPendingStep(ds);
  if (!step) return;

  inflightSteps.add(step.id);
  try {
    await executeClaimedStep(ds, step);
  } catch (err) {
    const errorClass: StepErrorClass = err instanceof Error && err.name === "ZodError" ? "zod" : "handler";
    await markStepFailed(ds, step, err, errorClass);
    logger.warn(`Step queue step failed: step=${step.id} kind=${step.kind} user=${step.userId} error=${String(err)}`);
  } finally {
    inflightSteps.delete(step.id);
  }
}

export function startStepQueueExecutor(): void {
  if (!isStepQueueServiceEnabled()) {
    logger.info("Step queue executor disabled; USE_STEP_QUEUE is not enabled");
    return;
  }
  if (!isApplicationDatabaseConfigured()) {
    logger.warn("Step queue executor disabled; APP_DATABASE_URL is not configured");
    return;
  }
  if (loopTimer) return;

  void getApplicationDataSource()
    .then((ds) => reconcileStepQueueTerminalStates(ds))
    .then((result) => {
      if (result.blockedSteps > 0 || result.updatedJobs > 0) {
        logger.warn(`Step queue reconciled terminal state: blocked_steps=${result.blockedSteps} updated_jobs=${result.updatedJobs}`);
      }
    })
    .catch((err) => logger.warn(`Step queue terminal reconciliation failed: ${err instanceof Error ? err.message : String(err)}`));

  loopTimer = setInterval(() => {
    if (runningTicks >= maxInflightSteps()) return;
    runningTicks += 1;
    void runStepQueueTick()
      .catch((err) => logger.warn(`Step queue tick failed: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        runningTicks -= 1;
      });
  }, TICK_INTERVAL_MS);

  sweepTimer = setInterval(() => {
    void getApplicationDataSource()
      .then((ds) => sweepAbandonedRunningSteps(ds))
      .then((count) => {
        if (count > 0) logger.warn(`Step queue swept ${count} abandoned running step(s)`);
      })
      .catch((err) => logger.warn(`Step queue sweep failed: ${err instanceof Error ? err.message : String(err)}`));
  }, SWEEP_INTERVAL_MS);

  logger.info("Step queue executor started");
}

export function stopStepQueueExecutorForTests(): void {
  if (loopTimer) clearInterval(loopTimer);
  if (sweepTimer) clearInterval(sweepTimer);
  loopTimer = null;
  sweepTimer = null;
  runningTicks = 0;
  inflightSteps.clear();
}
