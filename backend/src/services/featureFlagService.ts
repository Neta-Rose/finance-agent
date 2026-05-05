import type { DataSource } from "typeorm";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { logger } from "./logger.js";

/**
 * Feature flag service — reads / writes / seeds rows in `feature_flags`.
 *
 * Spec: design.md §4.15. Phase 1 task 1.2.
 *
 * Two row shapes:
 *   • boolean toggle: `enabled` is the value, `value_json` is null
 *   • configured value: `value_json` holds the value, `enabled` is true if the
 *     value is "active" (always true for value rows; per-user disable can be
 *     expressed by inserting a scoped row with `enabled = false`)
 *
 * Resolution order: per-user scoped row → global row → built-in default.
 */

// -----------------------------------------------------------------------------
// Default flag set (Phase 1; per tasks.md 1.2 and design §3 row 7).
// -----------------------------------------------------------------------------

interface BooleanFlagDefault {
  kind: "boolean";
  name: string;
  enabled: boolean;
}
interface ValueFlagDefault {
  kind: "value";
  name: string;
  value: unknown;
}
type FlagDefault = BooleanFlagDefault | ValueFlagDefault;

const DEFAULT_FLAGS: readonly FlagDefault[] = [
  // Phase-gated rollout switches. All defaults match the as-deployed state at
  // start of Phase 1: only the legacy job runners and the self-correcting retry
  // are on; everything else lights up as later phases ship.
  { kind: "boolean", name: "chat_agent_enabled", enabled: false },
  { kind: "boolean", name: "output_filter_enabled", enabled: false },
  { kind: "boolean", name: "structured_outputs_enabled", enabled: false },
  { kind: "boolean", name: "self_correcting_retry_enabled", enabled: true },
  { kind: "boolean", name: "asset_class_dispatch_enabled", enabled: false },
  { kind: "boolean", name: "transactions_ledger_enabled", enabled: false },
  { kind: "boolean", name: "snooze_enabled", enabled: false },
  { kind: "boolean", name: "legacy_job_runners_enabled", enabled: true },

  // Admin-configurable scalar values (defaults from design §3 row 7).
  { kind: "value", name: "max_turns", value: 12 },
  { kind: "value", name: "conversation_token_cap", value: 120000 },
  { kind: "value", name: "search_web_max_results", value: 8 },
  { kind: "value", name: "max_wait_for_job_sec", value: 600 },
  { kind: "value", name: "max_snooze_days", value: 180 },

  // List-shaped configuration. Empty by default — startup guards in Phase 5/8
  // will refuse to start the relevant subsystem with empty values when their
  // feature flag is enabled, so an empty list cannot silently allow access.
  { kind: "value", name: "forbidden_pattern_list", value: [] },
  { kind: "value", name: "cors_allow_list", value: [] },

  // Daily-brief coverage limit (N3 — replaces the fake `pro` plan check). The
  // initial value mirrors the legacy hardcoded constant; admin can tune at
  // runtime once the dashboard exposes it.
  { kind: "value", name: "coverage_limit", value: 10 },
];

// -----------------------------------------------------------------------------
// Reader helpers
// -----------------------------------------------------------------------------

interface FeatureFlagRow {
  flag_name: string;
  scope_user_id: string | null;
  enabled: boolean;
  value_json: unknown;
  updated_by: string;
  updated_at: Date;
}

async function readScopedRow(
  ds: DataSource,
  flagName: string,
  userId: string | null
): Promise<FeatureFlagRow | null> {
  if (userId === null) {
    const rows = await ds.query<FeatureFlagRow[]>(
      `SELECT flag_name, scope_user_id, enabled, value_json, updated_by, updated_at
         FROM feature_flags
        WHERE flag_name = $1 AND scope_user_id IS NULL
        LIMIT 1`,
      [flagName]
    );
    return rows[0] ?? null;
  }
  const rows = await ds.query<FeatureFlagRow[]>(
    `SELECT flag_name, scope_user_id, enabled, value_json, updated_by, updated_at
       FROM feature_flags
      WHERE flag_name = $1 AND scope_user_id = $2
      LIMIT 1`,
    [flagName, userId]
  );
  return rows[0] ?? null;
}

function defaultFor(name: string): FlagDefault | undefined {
  return DEFAULT_FLAGS.find((flag) => flag.name === name);
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Resolve a boolean toggle flag. Returns the per-user row first, then the
 * global row, then the built-in default. Returns `false` if the DB is not
 * configured AND there is no built-in default for the name.
 */
export async function isFeatureEnabled(name: string, userId?: string): Promise<boolean> {
  const builtIn = defaultFor(name);
  const fallback = builtIn?.kind === "boolean" ? builtIn.enabled : false;

  if (!isApplicationDatabaseConfigured()) return fallback;

  try {
    const ds = await getApplicationDataSource();
    if (userId) {
      const scoped = await readScopedRow(ds, name, userId);
      if (scoped) return scoped.enabled;
    }
    const global = await readScopedRow(ds, name, null);
    if (global) return global.enabled;
    return fallback;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`feature_flag_read_failed name=${name} error=${message}`);
    return fallback;
  }
}

/**
 * Resolve a value-shaped flag. Generic so callers can declare the expected
 * shape; the DB cannot enforce shape, so the caller is responsible for
 * defensive parsing of the result.
 */
export async function getFeatureValue<T>(name: string, userId?: string): Promise<T | undefined> {
  const builtIn = defaultFor(name);
  const fallback = builtIn?.kind === "value" ? (builtIn.value as T) : undefined;

  if (!isApplicationDatabaseConfigured()) return fallback;

  try {
    const ds = await getApplicationDataSource();
    if (userId) {
      const scoped = await readScopedRow(ds, name, userId);
      if (scoped && scoped.value_json !== null && scoped.value_json !== undefined) {
        return scoped.value_json as T;
      }
    }
    const global = await readScopedRow(ds, name, null);
    if (global && global.value_json !== null && global.value_json !== undefined) {
      return global.value_json as T;
    }
    return fallback;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`feature_flag_value_read_failed name=${name} error=${message}`);
    return fallback;
  }
}

export interface SetFeatureFlagInput {
  name: string;
  scopeUserId: string | null;
  enabled: boolean;
  valueJson?: unknown;
  updatedBy: string;
}

/**
 * Upsert a flag row. Used by the admin endpoint and by migration scripts.
 * Each toggle MUST also write an admin_audit_log row (P3.2); that audit row
 * is written by the caller, not by this function, so this stays a pure
 * data-layer helper.
 */
export async function setFeatureFlag(input: SetFeatureFlagInput): Promise<void> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("setFeatureFlag requires the application database to be configured");
  }
  const ds = await getApplicationDataSource();
  const valueJson = input.valueJson === undefined ? null : input.valueJson;

  if (input.scopeUserId === null) {
    // Global row. Use the partial unique index on flag_name WHERE scope_user_id IS NULL.
    const existing = await readScopedRow(ds, input.name, null);
    if (existing) {
      await ds.query(
        `UPDATE feature_flags
            SET enabled = $1,
                value_json = $2::jsonb,
                updated_at = NOW(),
                updated_by = $3
          WHERE flag_name = $4 AND scope_user_id IS NULL`,
        [input.enabled, valueJson === null ? null : JSON.stringify(valueJson), input.updatedBy, input.name]
      );
    } else {
      await ds.query(
        `INSERT INTO feature_flags (flag_name, scope_user_id, enabled, value_json, updated_at, updated_by)
         VALUES ($1, NULL, $2, $3::jsonb, NOW(), $4)`,
        [input.name, input.enabled, valueJson === null ? null : JSON.stringify(valueJson), input.updatedBy]
      );
    }
    return;
  }

  // Scoped row.
  const existing = await readScopedRow(ds, input.name, input.scopeUserId);
  if (existing) {
    await ds.query(
      `UPDATE feature_flags
          SET enabled = $1,
              value_json = $2::jsonb,
              updated_at = NOW(),
              updated_by = $3
        WHERE flag_name = $4 AND scope_user_id = $5`,
      [
        input.enabled,
        valueJson === null ? null : JSON.stringify(valueJson),
        input.updatedBy,
        input.name,
        input.scopeUserId,
      ]
    );
  } else {
    await ds.query(
      `INSERT INTO feature_flags (flag_name, scope_user_id, enabled, value_json, updated_at, updated_by)
       VALUES ($1, $2, $3, $4::jsonb, NOW(), $5)`,
      [
        input.name,
        input.scopeUserId,
        input.enabled,
        valueJson === null ? null : JSON.stringify(valueJson),
        input.updatedBy,
      ]
    );
  }
}

/**
 * Seed the default flag set on startup. Idempotent: existing rows are not
 * modified, so an admin override survives every restart. New names added in
 * later phases are inserted on the next boot.
 */
export async function ensureDefaultFeatureFlags(ds: DataSource): Promise<void> {
  for (const flag of DEFAULT_FLAGS) {
    const enabled = flag.kind === "boolean" ? flag.enabled : true;
    const valueJson = flag.kind === "value" ? JSON.stringify(flag.value) : null;
    await ds.query(
      `INSERT INTO feature_flags (flag_name, scope_user_id, enabled, value_json, updated_at, updated_by)
       SELECT $1, NULL, $2, $3::jsonb, NOW(), 'system_default'
        WHERE NOT EXISTS (
          SELECT 1 FROM feature_flags
           WHERE flag_name = $1 AND scope_user_id IS NULL
        )`,
      [flag.name, enabled, valueJson]
    );
  }
}

/** Test-only helper: wipe all rows. Not exported from the package surface. */
export async function _resetFeatureFlagsForTest(): Promise<void> {
  if (!isApplicationDatabaseConfigured()) return;
  const ds = await getApplicationDataSource();
  await ds.query(`DELETE FROM feature_flags`);
}

// Names of flags this module knows about — exported for type-narrow callers.
export const KNOWN_BOOLEAN_FLAGS = DEFAULT_FLAGS
  .filter((flag): flag is BooleanFlagDefault => flag.kind === "boolean")
  .map((flag) => flag.name);

export const KNOWN_VALUE_FLAGS = DEFAULT_FLAGS
  .filter((flag): flag is ValueFlagDefault => flag.kind === "value")
  .map((flag) => flag.name);
