import { DEFAULT_POINTS_BUDGET, type PointsBudgetConfig } from "../types/index.js";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { MODEL_TIERS, type ModelTier } from "./stepQueue/types.js";
import { isModelTier } from "./stepQueue/modelTier.js";

export interface AdminDefaults {
  modelTier: ModelTier;
  pointsBudget: PointsBudgetConfig;
}

export interface AdminDefaultsPatch {
  modelTier?: ModelTier;
  pointsBudget?: Partial<PointsBudgetConfig>;
}

const DEFAULTS: AdminDefaults = {
  modelTier: "balanced",
  pointsBudget: { ...DEFAULT_POINTS_BUDGET },
};

function normalizeDailyBudgetPoints(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_POINTS_BUDGET.dailyBudgetPoints;
  return Math.round(parsed * 1_000_000) / 1_000_000;
}

function normalizeDefaults(input: AdminDefaultsPatch): AdminDefaults {
  return {
    modelTier: isModelTier(input.modelTier) ? input.modelTier : DEFAULTS.modelTier,
    pointsBudget: {
      dailyBudgetPoints: normalizeDailyBudgetPoints(input.pointsBudget?.dailyBudgetPoints),
    },
  };
}

async function ensureAdminDefaultsTable(): Promise<void> {
  const ds = await getApplicationDataSource();
  await ds.query(
    `CREATE TABLE IF NOT EXISTS admin_defaults (
       key TEXT PRIMARY KEY,
       value JSONB NOT NULL,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_by TEXT NOT NULL DEFAULT 'system'
     )`
  );
}

export async function getAdminDefaults(): Promise<AdminDefaults> {
  if (!isApplicationDatabaseConfigured()) return { ...DEFAULTS, pointsBudget: { ...DEFAULTS.pointsBudget } };
  await ensureAdminDefaultsTable();
  const ds = await getApplicationDataSource();
  const rows = await ds.query(
    `SELECT key, value FROM admin_defaults WHERE key IN ('modelTier', 'pointsBudget')`
  ) as Array<{ key: string; value: unknown }>;
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const stored: Partial<AdminDefaults> = {};
  const modelTier = byKey.get("modelTier");
  const pointsBudget = byKey.get("pointsBudget");
  if (modelTier !== undefined) stored.modelTier = modelTier as ModelTier;
  if (pointsBudget !== undefined) stored.pointsBudget = pointsBudget as PointsBudgetConfig;
  return normalizeDefaults(stored);
}

export async function updateAdminDefaults(
  patch: AdminDefaultsPatch,
  updatedBy = "admin"
): Promise<AdminDefaults> {
  if (patch.modelTier !== undefined && !isModelTier(patch.modelTier)) {
    throw new Error(`modelTier must be one of ${MODEL_TIERS.join(", ")}`);
  }
  const current = await getAdminDefaults();
  const next = normalizeDefaults({
    ...current,
    ...patch,
    pointsBudget: {
      ...current.pointsBudget,
      ...patch.pointsBudget,
    },
  });

  if (!isApplicationDatabaseConfigured()) return next;
  await ensureAdminDefaultsTable();
  const ds = await getApplicationDataSource();
  await ds.query(
    `INSERT INTO admin_defaults (key, value, updated_at, updated_by)
     VALUES
       ('modelTier', $1::jsonb, NOW(), $3),
       ('pointsBudget', $2::jsonb, NOW(), $3)
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(next.modelTier), JSON.stringify(next.pointsBudget), updatedBy.slice(0, 128)]
  );
  return next;
}
