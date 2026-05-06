import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import type { StepKind } from "./stepQueue/types.js";

/**
 * Analyst pipeline configuration service.
 *
 * Allows users to disable specific analyst step kinds to save budget points.
 * Disabled steps are skipped during job expansion; the pipeline still runs
 * with the remaining steps.
 *
 * Default: all analyst steps enabled.
 * Debate and synthesis cannot be disabled (they depend on analyst outputs).
 */

/** Step kinds that can be toggled by the user. */
export const TOGGLEABLE_STEP_KINDS: StepKind[] = [
  "analyst.fundamentals",
  "analyst.technical",
  "analyst.sentiment",
  "analyst.macro",
  "analyst.risk",
];

/** Step kinds that are always required and cannot be disabled. */
export const REQUIRED_STEP_KINDS: StepKind[] = ["debate", "synthesis"];

/** Approximate budget points cost per step kind (used for UI display). */
export const STEP_KIND_COST_POINTS: Record<string, number> = {
  "analyst.fundamentals": 8,
  "analyst.technical": 5,
  "analyst.sentiment": 6,
  "analyst.macro": 5,
  "analyst.risk": 3,
  "debate": 15,
  "synthesis": 12,
};

export interface AnalystConfigEntry {
  stepKind: StepKind;
  enabled: boolean;
  costPoints: number;
  toggleable: boolean;
}

export async function getUserAnalystConfig(userId: string): Promise<AnalystConfigEntry[]> {
  if (!isApplicationDatabaseConfigured()) {
    return TOGGLEABLE_STEP_KINDS.map((k) => ({
      stepKind: k,
      enabled: true,
      costPoints: STEP_KIND_COST_POINTS[k] ?? 5,
      toggleable: true,
    }));
  }

  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT step_kind, enabled FROM user_analyst_config WHERE user_id = $1`,
    [userId]
  )) as Array<{ step_kind: string; enabled: boolean }>;

  const configMap = new Map(rows.map((r) => [r.step_kind, r.enabled]));

  return TOGGLEABLE_STEP_KINDS.map((k) => ({
    stepKind: k,
    enabled: configMap.get(k) ?? true, // default enabled
    costPoints: STEP_KIND_COST_POINTS[k] ?? 5,
    toggleable: true,
  }));
}

export async function setAnalystStepEnabled(
  userId: string,
  stepKind: StepKind,
  enabled: boolean
): Promise<void> {
  if (!TOGGLEABLE_STEP_KINDS.includes(stepKind)) {
    throw new Error(`Step kind ${stepKind} cannot be toggled`);
  }
  if (!isApplicationDatabaseConfigured()) return;

  const ds = await getApplicationDataSource();
  await ds.query(
    `INSERT INTO user_analyst_config (user_id, step_kind, enabled, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, step_kind) DO UPDATE
       SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    [userId, stepKind, enabled]
  );
}

/**
 * Returns the set of step kinds that are enabled for a user.
 * Used by the expansion function to filter the pipeline.
 */
export async function getEnabledStepKinds(userId: string): Promise<Set<StepKind>> {
  const config = await getUserAnalystConfig(userId);
  const enabled = new Set<StepKind>(
    config.filter((c) => c.enabled).map((c) => c.stepKind)
  );
  // Always include required steps
  for (const k of REQUIRED_STEP_KINDS) {
    enabled.add(k as StepKind);
  }
  return enabled;
}
