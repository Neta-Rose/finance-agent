import { randomUUID } from "crypto";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import type { ConcentrationEntry } from "../db/entities/PortfolioRiskSnapshotEntity.js";

export type { ConcentrationEntry } from "../db/entities/PortfolioRiskSnapshotEntity.js";

/**
 * Portfolio-risk store — append-only snapshots of cross-position
 * concentration metrics (design §4.10, L3).
 *
 * Newest snapshot per user feeds the `getRiskSummary` chat tool and the
 * dashboard portfolio-risk card. Older rows are kept for trend analysis;
 * pruning is owned by the retention loop in Phase 9 (admin retention).
 */

export interface PortfolioRiskSnapshotRecord {
  id: string;
  userId: string;
  snapshotAt: string;
  totalValueIls: number;
  concentrationBySingleNamePct: ConcentrationEntry[];
  concentrationBySectorPct: ConcentrationEntry[];
  concentrationByCurrencyPct: ConcentrationEntry[];
  concentrationByAssetClassPct: ConcentrationEntry[];
  largestSinglePositionTicker: string | null;
  largestSinglePositionPct: number | null;
}

export interface InsertPortfolioRiskInput {
  userId: string;
  totalValueIls: number;
  concentrationBySingleNamePct: ConcentrationEntry[];
  concentrationBySectorPct: ConcentrationEntry[];
  concentrationByCurrencyPct: ConcentrationEntry[];
  concentrationByAssetClassPct: ConcentrationEntry[];
  largestSinglePositionTicker: string | null;
  largestSinglePositionPct: number | null;
  /** Optional UUID; generated if omitted. */
  id?: string;
}

interface Row {
  id: string;
  user_id: string;
  snapshot_at: Date | string;
  total_value_ils: string;
  concentration_by_single_name_pct: ConcentrationEntry[];
  concentration_by_sector_pct: ConcentrationEntry[];
  concentration_by_currency_pct: ConcentrationEntry[];
  concentration_by_asset_class_pct: ConcentrationEntry[];
  largest_single_position_ticker: string | null;
  largest_single_position_pct: string | null;
}

function fromRow(row: Row): PortfolioRiskSnapshotRecord {
  return {
    id: row.id,
    userId: row.user_id,
    snapshotAt: (row.snapshot_at instanceof Date ? row.snapshot_at : new Date(row.snapshot_at)).toISOString(),
    totalValueIls: Number(row.total_value_ils),
    concentrationBySingleNamePct: row.concentration_by_single_name_pct ?? [],
    concentrationBySectorPct: row.concentration_by_sector_pct ?? [],
    concentrationByCurrencyPct: row.concentration_by_currency_pct ?? [],
    concentrationByAssetClassPct: row.concentration_by_asset_class_pct ?? [],
    largestSinglePositionTicker: row.largest_single_position_ticker,
    largestSinglePositionPct:
      row.largest_single_position_pct === null ? null : Number(row.largest_single_position_pct),
  };
}

const SELECT_COLUMNS = `id, user_id, snapshot_at, total_value_ils,
  concentration_by_single_name_pct, concentration_by_sector_pct,
  concentration_by_currency_pct, concentration_by_asset_class_pct,
  largest_single_position_ticker, largest_single_position_pct`;

export async function insertPortfolioRiskSnapshot(
  input: InsertPortfolioRiskInput
): Promise<PortfolioRiskSnapshotRecord> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("insertPortfolioRiskSnapshot requires the application database");
  }
  const ds = await getApplicationDataSource();
  const id = input.id ?? randomUUID();
  const rows = (await ds.query(
    `INSERT INTO portfolio_risk_snapshots
       (id, user_id, snapshot_at, total_value_ils,
        concentration_by_single_name_pct, concentration_by_sector_pct,
        concentration_by_currency_pct, concentration_by_asset_class_pct,
        largest_single_position_ticker, largest_single_position_pct)
     VALUES ($1, $2, NOW(), $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)
     RETURNING ${SELECT_COLUMNS}`,
    [
      id,
      input.userId,
      input.totalValueIls,
      JSON.stringify(input.concentrationBySingleNamePct),
      JSON.stringify(input.concentrationBySectorPct),
      JSON.stringify(input.concentrationByCurrencyPct),
      JSON.stringify(input.concentrationByAssetClassPct),
      input.largestSinglePositionTicker,
      input.largestSinglePositionPct,
    ]
  )) as Row[];
  return fromRow(rows[0]!);
}

export async function getLatestPortfolioRiskSnapshot(
  userId: string
): Promise<PortfolioRiskSnapshotRecord | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM portfolio_risk_snapshots
      WHERE user_id = $1
      ORDER BY snapshot_at DESC
      LIMIT 1`,
    [userId]
  )) as Row[];
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function listPortfolioRiskSnapshots(
  userId: string,
  options?: { limit?: number }
): Promise<PortfolioRiskSnapshotRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const limit = options?.limit ?? 30;
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM portfolio_risk_snapshots
      WHERE user_id = $1
      ORDER BY snapshot_at DESC
      LIMIT $2`,
    [userId, limit]
  )) as Row[];
  return rows.map(fromRow);
}
