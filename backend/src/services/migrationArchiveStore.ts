import { randomUUID } from "crypto";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";

/**
 * Migration-archive store — append-only audit of every destructive migration
 * step (design §4.14, P2.2). Migration scripts MUST write a row before
 * removing or transforming user data, so rollback can reconstruct the input.
 */

export type MigrationArchiveReason =
  // Phase 1
  | "user_state_migrated"
  | "strategy_migrated"
  | "report_index_migrated"
  | "notifications_migrated"
  | "escalation_history_migrated"
  | "channel_binding_migrated"
  | "telegram_token_migrated"
  | "synthetic_opening_lot_inserted"
  | "corrupt_input_skipped"
  // Phase 3
  | "openclaw_workspace_file_removed"
  | "openclaw_config_wiped"
  // Phase 8
  | "encrypted_secret_rerotated"
  // Generic
  | "summary_audit"
  | (string & {});

export interface MigrationArchiveRecord {
  id: string;
  userId: string;
  sourcePath: string;
  reason: MigrationArchiveReason;
  payload: unknown;
  archivedAt: string;
}

export interface RecordArchiveInput {
  userId: string;
  sourcePath: string;
  reason: MigrationArchiveReason;
  payload: unknown;
  /** Optional UUID; generated if omitted. */
  id?: string;
}

interface Row {
  id: string;
  user_id: string;
  source_path: string;
  reason: string;
  payload: unknown;
  archived_at: Date | string;
}

function fromRow(row: Row): MigrationArchiveRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sourcePath: row.source_path,
    reason: row.reason as MigrationArchiveReason,
    payload: row.payload,
    archivedAt: (row.archived_at instanceof Date ? row.archived_at : new Date(row.archived_at)).toISOString(),
  };
}

const SELECT_COLUMNS = `id, user_id, source_path, reason, payload, archived_at`;
const SOURCE_PATH_MAX = 512;
const REASON_MAX = 64;

export async function recordArchive(input: RecordArchiveInput): Promise<MigrationArchiveRecord> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("recordArchive requires the application database");
  }
  const ds = await getApplicationDataSource();
  const id = input.id ?? randomUUID();
  const sourcePath = input.sourcePath.slice(0, SOURCE_PATH_MAX);
  const reason = input.reason.slice(0, REASON_MAX);
  const rows = (await ds.query(
    `INSERT INTO migration_archive (id, user_id, source_path, reason, payload, archived_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
     RETURNING ${SELECT_COLUMNS}`,
    [id, input.userId, sourcePath, reason, JSON.stringify(input.payload)]
  )) as Row[];
  return fromRow(rows[0]!);
}

export async function listArchive(
  userId: string,
  options?: { reason?: MigrationArchiveReason; limit?: number }
): Promise<MigrationArchiveRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const params: unknown[] = [userId];
  let where = `user_id = $1`;
  if (options?.reason) {
    params.push(options.reason);
    where += ` AND reason = $${params.length}`;
  }
  params.push(options?.limit ?? 100);
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM migration_archive WHERE ${where}
      ORDER BY archived_at DESC LIMIT $${params.length}`,
    params
  )) as Row[];
  return rows.map(fromRow);
}
