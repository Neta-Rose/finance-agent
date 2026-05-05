import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import type { TrackedAssetStatus } from "../db/entities/TrackedAssetEntity.js";

export type { TrackedAssetStatus } from "../db/entities/TrackedAssetEntity.js";

export interface TrackedAsset {
  userId: string;
  ticker: string;
  status: TrackedAssetStatus;
  createdFromJobId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface UpsertTrackedAssetParams {
  userId: string;
  ticker: string;
  status?: TrackedAssetStatus;
  createdFromJobId?: string | null;
  notes?: string | null;
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function fromRow(row: {
  user_id: string;
  ticker: string;
  status: TrackedAssetStatus;
  created_from_job_id: string | null;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
}): TrackedAsset {
  return {
    userId: row.user_id,
    ticker: row.ticker,
    status: row.status,
    createdFromJobId: row.created_from_job_id,
    notes: row.notes,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at).toISOString(),
  };
}

export async function listTrackedAssets(userId: string): Promise<TrackedAsset[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const rows = await ds.query(
    `SELECT user_id, ticker, status, created_from_job_id, notes, created_at, updated_at, archived_at
       FROM tracked_assets
      WHERE user_id = $1
      ORDER BY updated_at DESC`,
    [userId]
  ) as Array<Parameters<typeof fromRow>[0]>;
  return rows.map(fromRow);
}

export async function getTrackedAsset(userId: string, ticker: string): Promise<TrackedAsset | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  const ds = await getApplicationDataSource();
  const rows = await ds.query(
    `SELECT user_id, ticker, status, created_from_job_id, notes, created_at, updated_at, archived_at
       FROM tracked_assets
      WHERE user_id = $1
        AND ticker = $2
      LIMIT 1`,
    [userId, normalizeTicker(ticker)]
  ) as Array<Parameters<typeof fromRow>[0]>;
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function upsertTrackedAsset(params: UpsertTrackedAssetParams): Promise<TrackedAsset> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("Application database is not configured");
  }
  const ds = await getApplicationDataSource();
  const status = params.status ?? "active";
  const rows = await ds.query(
     `INSERT INTO tracked_assets
       (user_id, ticker, status, created_from_job_id, notes, created_at, updated_at, archived_at)
     VALUES ($1, $2, $3::varchar, $4, $5, NOW(), NOW(), CASE WHEN $3::varchar = 'archived' THEN NOW() ELSE NULL END)
     ON CONFLICT (user_id, ticker)
     DO UPDATE SET
       status = EXCLUDED.status,
       created_from_job_id = COALESCE(tracked_assets.created_from_job_id, EXCLUDED.created_from_job_id),
       notes = COALESCE(EXCLUDED.notes, tracked_assets.notes),
       updated_at = NOW(),
       archived_at = CASE WHEN EXCLUDED.status = 'archived' THEN NOW() ELSE NULL END
     RETURNING user_id, ticker, status, created_from_job_id, notes, created_at, updated_at, archived_at`,
    [
      params.userId,
      normalizeTicker(params.ticker),
      status,
      params.createdFromJobId ?? null,
      params.notes ?? null,
    ]
  ) as Array<Parameters<typeof fromRow>[0]>;
  return fromRow(rows[0]!);
}

export async function archiveTrackedAsset(userId: string, ticker: string): Promise<TrackedAsset | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  const ds = await getApplicationDataSource();
  const rows = await ds.query(
    `UPDATE tracked_assets
        SET status = 'archived',
            updated_at = NOW(),
            archived_at = NOW()
      WHERE user_id = $1
        AND ticker = $2
      RETURNING user_id, ticker, status, created_from_job_id, notes, created_at, updated_at, archived_at`,
    [userId, normalizeTicker(ticker)]
  ) as Array<Parameters<typeof fromRow>[0]>;
  return rows[0] ? fromRow(rows[0]) : null;
}
