import { randomUUID } from "crypto";
import type { DataSource } from "typeorm";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../../db/applicationDataSource.js";
import { buildWorkspace } from "../../middleware/userIsolation.js";
import { logger } from "../logger.js";
import { resolveConfiguredPath } from "../paths.js";
import { isStepQueueServiceEnabled } from "./featureFlag.js";
import { handlerFor } from "./handlers.js";
import { resolveStepModel } from "./modelTier.js";
import { applyStepQueueCompletionEffects } from "./completionEffects.js";
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
           -- Deterministic step kinds: no dependency chain, always claimable
           s.kind = 'quick_check.evaluate'
           OR s.kind = 'tracking.evaluate'
           -- Analyst steps: no dependencies
           OR s.kind LIKE 'analyst.%'
           -- Debate: requires all analyst steps completed
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
           -- Synthesis: requires debate completed
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
           WHEN 'quick_check.evaluate' THEN 0
           WHEN 'tracking.evaluate'    THEN 0
           WHEN 'analyst.fundamentals' THEN 1
           WHEN 'analyst.technical'    THEN 2
           WHEN 'analyst.sentiment'    THEN 3
           WHEN 'analyst.macro'        THEN 4
           WHEN 'analyst.risk'         THEN 5
           WHEN 'debate'               THEN 6
           WHEN 'synthesis'            THEN 7
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

  const result = await ds.query(
    `UPDATE jobs
        SET status = $2::varchar,
            completed_at = NOW(),
            failure_reason = $3,
            result = jsonb_build_object(
              'completed_at', NOW(),
              'status', $2::varchar,
              'totalTickers', $4::int,
              'completedTickers', $5::text[],
              'failedTickers', $6::text[],
              'skippedTickers', $7::text[]
            )
      WHERE id = $1
        AND status = 'running'
      RETURNING id, status`,
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
  const updated = mutationRows<Record<string, unknown>>(result)[0];
  if (updated && (status === "completed" || status === "partial_completed")) {
    await applyStepQueueCompletionEffects(ds, jobId, { publishNotifications: true });
  }
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

export async function reconcileStepQueueTerminalStates(ds: DataSource): Promise<{ repairedSteps: number; repairedTickers: number; blockedSteps: number; updatedJobs: number; appliedEffects: number }> {
  await ds.query(
    `UPDATE ticker_work_items
        SET failure_reason = NULL,
            skip_reason = NULL
      WHERE status = 'completed'
        AND (failure_reason IS NOT NULL OR skip_reason IS NOT NULL)`
  );

  const repairedRows: Array<{ id: string; from_status: string; attempts: number } & Record<string, unknown>> = [];

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

  const repairedTickerResult = await ds.query(
    `UPDATE ticker_work_items t
        SET status = 'completed',
            completed_at = COALESCE(completed_at, NOW()),
            failure_reason = NULL,
            skip_reason = NULL
      WHERE status = 'failed'
        AND NOT EXISTS (
          SELECT 1
            FROM step_work_items s
           WHERE s.ticker_work_item_id = t.id
             AND s.status <> 'completed'
        )
      RETURNING id`
  );
  const repairedTickerRows = mutationRows<Record<string, unknown>>(repairedTickerResult);

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
  let appliedEffects = 0;
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
          SET status = $2::varchar,
              completed_at = COALESCE(completed_at, NOW()),
              failure_reason = $3,
              result = jsonb_build_object(
                'completed_at', COALESCE(completed_at, NOW()),
                'status', $2::varchar,
                'totalTickers', $4::int,
                'completedTickers', $5::text[],
                'failedTickers', $6::text[],
                'skippedTickers', $7::text[]
              )
        WHERE id = $1
          AND status IN ('running', 'completed', 'partial_completed', 'failed')
          AND status <> $2::varchar
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
    if (status === "completed" || status === "partial_completed") {
      try {
        if (await applyStepQueueCompletionEffects(ds, row.job_id, { publishNotifications: false })) {
          appliedEffects += 1;
        }
      } catch (err) {
        logger.warn(`Step queue product effects reconciliation failed for ${row.job_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return {
    repairedSteps: repairedRows.length,
    repairedTickers: repairedTickerRows.length,
    blockedSteps: blockedRows.length,
    updatedJobs,
    appliedEffects,
  };
}

async function markStepFailed(
  ds: DataSource,
  step: ClaimedStepWorkItem,
  error: unknown,
  errorClass: StepErrorClass
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const parentRows = await ds.query(
    `SELECT t.status AS ticker_status,
            j.status AS job_status
       FROM ticker_work_items t
       JOIN jobs j ON j.id = t.job_id
      WHERE t.id = $1`,
    [step.tickerWorkItemId]
  ) as Array<{ ticker_status: string; job_status: string }>;
  const parent = parentRows[0];
  const parentClosed = !parent || parent.ticker_status !== "running" || parent.job_status !== "running";
  const permanent = step.attempts >= 3 || parentClosed;
  const nextStatus = permanent ? "failed" : "pending";
  await ds.query(
    `UPDATE step_work_items
        SET status = $2,
            owner_lock_id = NULL,
            completed_at = CASE WHEN $4::boolean THEN NOW() ELSE completed_at END,
            last_error = $3
      WHERE id = $1`,
    [step.id, nextStatus, message.slice(0, 2000), permanent]
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

  if (!parentClosed) {
    await ds.query(
      `UPDATE ticker_work_items
          SET status = 'failed',
              completed_at = NOW(),
              failure_reason = $2
        WHERE id = $1`,
      [step.tickerWorkItemId, message.slice(0, 2000)]
    );
    await markBlockedPendingStepsFailed(ds, step, "Blocked by failed prerequisite step");
  } else {
    await markBlockedPendingStepsFailed(ds, step, "Blocked by terminal ticker/job state");
  }
  await finalizeJobIfTickerWorkClosed(ds, step.jobId);
}

export async function sweepAbandonedRunningSteps(
  ds: DataSource,
  now = new Date(),
  excludeStepIds: string[] = []
): Promise<number> {
  const cutoff = new Date(now.getTime() - lockTtlMs()).toISOString();
  const params: unknown[] = [cutoff];
  const excludeClause = excludeStepIds.length > 0
    ? `AND id <> ALL($2::uuid[])`
    : "";
  if (excludeStepIds.length > 0) params.push(excludeStepIds);
  const result = await ds.query(
    `UPDATE step_work_items
        SET status = 'pending',
            owner_lock_id = NULL,
            last_error = 'Step lock expired before completion'
      WHERE status = 'running'
        AND started_at < $1::timestamptz
        ${excludeClause}
      RETURNING id, attempts`,
    params
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
  const ws = buildWorkspace(step.userId, USERS_DIR);

  // Deterministic step kinds bypass the LLM round-trip entirely.
  // They compute their result synchronously and persist the artifact directly.
  if (step.kind === "quick_check.evaluate") {
    const { executeQuickCheckStep } = await import("./handlers/quickCheck.js");
    const result = await executeQuickCheckStep(step, ws);
    const outputPath = ws.reportFile(step.ticker, "quick_check");
    await markStepCompleted(ds, step, outputPath);
    await advanceAfterStepCompletion(ds, step);
    void result; // artifact already persisted inside executeQuickCheckStep
    return;
  }

  if (step.kind === "tracking.evaluate") {
    const { executeTrackingEvaluateStep } = await import("./handlers/dailyBrief.js");
    const result = await executeTrackingEvaluateStep(step, ws);
    const outputPath = ws.reportFile(step.ticker, "tracking_evaluate");
    await markStepCompleted(ds, step, outputPath);
    await advanceAfterStepCompletion(ds, step);
    void result; // artifact already persisted inside executeTrackingEvaluateStep
    return;
  }

  // LLM-backed step kinds: gather inputs → build prompt → call LLM → validate → persist.
  const handler = handlerFor(step.kind);
  const model = await resolveStepModel(ds, step.userId, step.kind, step.modelTierUsed ?? "balanced");
  const inputs = await handler.gatherInputs(step, ws);
  const prompt = handler.buildPrompt(inputs, model.tier);

  // Self-correcting retry: on Zod failure, re-prompt the model once with the
  // validation error message and the malformed output (H2.1–H2.3).
  // Gated by feature_flags.self_correcting_retry_enabled (default true).
  const { isFeatureEnabled } = await import("../featureFlagService.js");
  const selfCorrectEnabled = await isFeatureEnabled("self_correcting_retry_enabled");

  let raw = await handler.call(prompt, model, step, inputs);
  let validation = handler.validate(raw, prompt.schema, inputs);

  if (!validation.ok && selfCorrectEnabled) {
    // Record the initial Zod failure for observability (Bug 5 fix).
    const zodSummary = validation.error.errors
      .slice(0, 5)
      .map((e) => `  ${e.path.join(".")}: ${e.message}`)
      .join("\n");

    // Write a lifecycle event so admin can see the LLM succeeded but output was unusable.
    await recordLifecycle(ds, {
      stepId: step.id,
      fromStatus: "running",
      toStatus: "running",
      attemptN: step.attempts,
      modelUsed: model.primary,
      tierUsed: model.tier,
      errorClass: "zod",
      errorMessage: `schema_invalid_pre_retry: ${zodSummary.slice(0, 500)}`,
    });

    const correctionPrompt = {
      ...prompt,
      user: [
        prompt.user,
        "---",
        "Your previous response failed schema validation. Please correct it.",
        "",
        "Validation errors:",
        zodSummary,
        "",
        "Your malformed response was:",
        typeof raw === "string" ? raw : JSON.stringify(raw),
        "",
        "Return only the corrected JSON object. Do not include any explanation or markdown.",
      ].join("\n"),
    };
    const retryRaw = await handler.call(correctionPrompt, model, step, inputs);
    const retryValidation = handler.validate(retryRaw, prompt.schema, inputs);
    if (retryValidation.ok) {
      // Self-correcting retry succeeded — record it and use the corrected output.
      raw = retryRaw;
      validation = retryValidation;
      await recordLifecycle(ds, {
        stepId: step.id,
        fromStatus: "running",
        toStatus: "running",
        attemptN: step.attempts,
        modelUsed: model.primary,
        tierUsed: model.tier,
        errorClass: "zod",
        errorMessage: `zod_self_corrected: ${zodSummary.slice(0, 500)}`,
      });
    }
    // If retry also fails, fall through to throw validation.error below.
    // The combined call counts as one logical attempt (H2.2).
  }

  if (!validation.ok) {
    throw validation.error;
  }

  const outputPath = await handler.persistArtifact(validation.artifact, ws, step);

  // Record schema_mode on the step for observability (H1.4).
  const directParse = prompt.schema.safeParse(raw);
  const schemaMode = directParse.success ? "provider_native" : "normalize_fallback";
  await ds.query(
    `UPDATE step_work_items SET schema_mode = $2 WHERE id = $1`,
    [step.id, schemaMode]
  );

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
    logger.info("Step queue executor disabled; USE_STEP_QUEUE is explicitly disabled");
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
      if (result.repairedSteps > 0 || result.repairedTickers > 0 || result.blockedSteps > 0 || result.updatedJobs > 0) {
        logger.warn(`Step queue reconciled terminal state: repaired_steps=${result.repairedSteps} repaired_tickers=${result.repairedTickers} blocked_steps=${result.blockedSteps} updated_jobs=${result.updatedJobs} applied_effects=${result.appliedEffects}`);
      } else if (result.appliedEffects > 0) {
        logger.info(`Step queue applied pending product effects: applied_effects=${result.appliedEffects}`);
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
      .then((ds) => sweepAbandonedRunningSteps(ds, new Date(), Array.from(inflightSteps)))
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
