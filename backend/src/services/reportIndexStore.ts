import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";

/**
 * Report index store — replaces `data/reports/index/meta.json` and
 * `data/reports/index/page-NNN.json` (A2.1, A2.2; design §4.3).
 *
 * Two related tables:
 *   • report_batches — one row per (job, run) with summary + highlights
 *   • report_index   — one row per (batch, ticker) with the per-ticker entry
 *
 * Writes are wrapped in a transaction so a partial insert cannot leave the
 * batch row without its index entries.
 */

export interface ReportBatchRecord {
  batchId: string;
  userId: string;
  jobId: string;
  mode: string;
  triggeredAt: string;
  date: string;
  tickerCount: number;
  summary: Record<string, unknown> | null;
  highlights: Record<string, unknown> | null;
  createdAt: string;
}

export interface ReportIndexRecord {
  batchId: string;
  ticker: string;
  dailySection: string | null;
  entry: Record<string, unknown>;
}

export interface PutReportBatchInput {
  batchId: string;
  userId: string;
  jobId: string;
  mode: string;
  triggeredAt: string;
  /** ISO date (YYYY-MM-DD); defaults to the date portion of triggeredAt. */
  date?: string;
  summary?: Record<string, unknown> | null;
  highlights?: Record<string, unknown> | null;
  /** Per-ticker entries. Order is preserved when listed back out. */
  entries: Array<{ ticker: string; dailySection?: string | null; entry: Record<string, unknown> }>;
}

interface BatchRow {
  batch_id: string;
  user_id: string;
  job_id: string;
  mode: string;
  triggered_at: Date | string;
  date: Date | string;
  ticker_count: number;
  summary: Record<string, unknown> | null;
  highlights: Record<string, unknown> | null;
  created_at: Date | string;
}

interface IndexRow {
  batch_id: string;
  ticker: string;
  daily_section: string | null;
  entry: Record<string, unknown>;
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function toDateString(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function batchFromRow(row: BatchRow): ReportBatchRecord {
  return {
    batchId: row.batch_id,
    userId: row.user_id,
    jobId: row.job_id,
    mode: row.mode,
    triggeredAt: toIso(row.triggered_at),
    date: toDateString(row.date),
    tickerCount: row.ticker_count,
    summary: row.summary,
    highlights: row.highlights,
    createdAt: toIso(row.created_at),
  };
}

function indexFromRow(row: IndexRow): ReportIndexRecord {
  return {
    batchId: row.batch_id,
    ticker: row.ticker,
    dailySection: row.daily_section,
    entry: row.entry,
  };
}

export async function putReportBatch(input: PutReportBatchInput): Promise<ReportBatchRecord> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("putReportBatch requires the application database");
  }
  const ds = await getApplicationDataSource();
  const date = input.date ?? toDateString(input.triggeredAt);

  return ds.transaction(async (manager) => {
    const batchRows = (await manager.query(
      `INSERT INTO report_batches
         (batch_id, user_id, job_id, mode, triggered_at, date, ticker_count, summary, highlights, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, NOW())
       ON CONFLICT (batch_id) DO UPDATE SET
         mode = EXCLUDED.mode,
         triggered_at = EXCLUDED.triggered_at,
         date = EXCLUDED.date,
         ticker_count = EXCLUDED.ticker_count,
         summary = EXCLUDED.summary,
         highlights = EXCLUDED.highlights
       RETURNING batch_id, user_id, job_id, mode, triggered_at, date,
                 ticker_count, summary, highlights, created_at`,
      [
        input.batchId,
        input.userId,
        input.jobId,
        input.mode,
        input.triggeredAt,
        date,
        input.entries.length,
        input.summary === undefined || input.summary === null ? null : JSON.stringify(input.summary),
        input.highlights === undefined || input.highlights === null
          ? null
          : JSON.stringify(input.highlights),
      ]
    )) as BatchRow[];

    // Replace all index entries for this batch, in case the caller is rewriting.
    await manager.query(`DELETE FROM report_index WHERE batch_id = $1`, [input.batchId]);

    for (const entry of input.entries) {
      await manager.query(
        `INSERT INTO report_index (batch_id, ticker, daily_section, entry)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [input.batchId, entry.ticker.toUpperCase(), entry.dailySection ?? null, JSON.stringify(entry.entry)]
      );
    }

    return batchFromRow(batchRows[0]!);
  });
}

export async function readReportBatch(batchId: string): Promise<ReportBatchRecord | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT batch_id, user_id, job_id, mode, triggered_at, date,
            ticker_count, summary, highlights, created_at
       FROM report_batches WHERE batch_id = $1 LIMIT 1`,
    [batchId]
  )) as BatchRow[];
  return rows[0] ? batchFromRow(rows[0]) : null;
}

export async function listReportBatches(
  userId: string,
  options?: { mode?: string; limit?: number }
): Promise<ReportBatchRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const params: unknown[] = [userId];
  let where = `user_id = $1`;
  if (options?.mode) {
    params.push(options.mode);
    where += ` AND mode = $${params.length}`;
  }
  params.push(options?.limit ?? 50);
  const rows = (await ds.query(
    `SELECT batch_id, user_id, job_id, mode, triggered_at, date,
            ticker_count, summary, highlights, created_at
       FROM report_batches WHERE ${where}
       ORDER BY triggered_at DESC
       LIMIT $${params.length}`,
    params
  )) as BatchRow[];
  return rows.map(batchFromRow);
}

export async function listReportIndex(batchId: string): Promise<ReportIndexRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT batch_id, ticker, daily_section, entry
       FROM report_index WHERE batch_id = $1
       ORDER BY ticker ASC`,
    [batchId]
  )) as IndexRow[];
  return rows.map(indexFromRow);
}
