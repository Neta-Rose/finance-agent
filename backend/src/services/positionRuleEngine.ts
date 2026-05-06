import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { admitOrReuseStepQueueJob } from "./stepQueue/admission.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import { resolveConfiguredPath } from "./paths.js";
import { logger } from "./logger.js";

/**
 * Position-level rule engine — Phase 7, task 7.5.
 *
 * Spec: design.md §10.5; M1.1, M1.2, M1.3.
 *
 * Evaluates `maxSinglePositionPct` and `stopLossThresholdPct` from the
 * `users` table against live position weight and drawdown. Triggers a
 * deep-dive job when a rule fires. Evaluated in code, not in prompts (M1.3).
 *
 * Called from:
 *   - daily-brief expansion (before each ticker is admitted)
 *   - position_transactions insert path (after a new transaction is written)
 */

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");

export interface RuleCheckInput {
  userId: string;
  ticker: string;
  /** Current position weight as a percentage (0–100). */
  positionWeightPct: number;
  /** Drawdown from cost basis as a percentage (0–100, positive = loss). */
  drawdownPct: number;
}

export interface RuleCheckResult {
  triggered: boolean;
  trigger: "max_position_size" | "stop_loss" | null;
  reason: string | null;
  jobId: string | null;
}

export async function evaluatePositionRules(
  input: RuleCheckInput
): Promise<RuleCheckResult> {
  if (!isApplicationDatabaseConfigured()) {
    return { triggered: false, trigger: null, reason: null, jobId: null };
  }

  const ds = await getApplicationDataSource();

  // Read user thresholds from the `users` table (M1.1, M1.2).
  const userRows = (await ds.query(
    `SELECT max_single_position_pct, stop_loss_threshold_pct
       FROM users WHERE user_id = $1 LIMIT 1`,
    [input.userId]
  )) as Array<{ max_single_position_pct: string; stop_loss_threshold_pct: string }>;

  const userRow = userRows[0];
  if (!userRow) return { triggered: false, trigger: null, reason: null, jobId: null };

  const maxPositionPct = Number(userRow.max_single_position_pct);
  const stopLossPct = Number(userRow.stop_loss_threshold_pct);

  let trigger: RuleCheckResult["trigger"] = null;
  let reason: string | null = null;

  if (input.positionWeightPct > maxPositionPct) {
    trigger = "max_position_size";
    reason = `Position weight ${input.positionWeightPct.toFixed(1)}% exceeds max ${maxPositionPct}%`;
  } else if (input.drawdownPct >= stopLossPct) {
    trigger = "stop_loss";
    reason = `Drawdown ${input.drawdownPct.toFixed(1)}% exceeds stop-loss threshold ${stopLossPct}%`;
  }

  if (!trigger) return { triggered: false, trigger: null, reason: null, jobId: null };

  // Admit a deep-dive job (M1.1, M1.2).
  let jobId: string | null = null;
  try {
    const ws = buildWorkspace(input.userId, USERS_DIR);
    const admitted = await admitOrReuseStepQueueJob({
      workspace: ws,
      action: "deep_dive",
      ticker: input.ticker,
      source: "backend_job",
      budgetAdmittedAt: new Date(),
    });
    jobId = admitted.jobId;

    // Write audit row.
    await ds.query(
      `INSERT INTO step_lifecycle_events
         (step_id, from_status, to_status, attempt_n, error_class, error_message, occurred_at)
       VALUES (gen_random_uuid(), NULL, 'pending', NULL, 'rule_triggered', $1, NOW())`,
      [`rule_triggered user=${input.userId} ticker=${input.ticker} trigger=${trigger} reason=${reason} job=${jobId}`]
    );

    logger.info(`Position rule triggered: user=${input.userId} ticker=${input.ticker} trigger=${trigger} reason=${reason} job=${jobId}`);
  } catch (err) {
    logger.warn(`Position rule engine: failed to admit deep dive for ${input.userId}/${input.ticker}: ${(err as Error).message}`);
  }

  return { triggered: true, trigger, reason, jobId };
}
