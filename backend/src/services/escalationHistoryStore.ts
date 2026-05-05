import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";

/**
 * Escalation history store — replaces `users/[id]/data/escalation_history.json`
 * (design §4.5; A2.1, A2.2).
 *
 * Primary key is (user_id, ticker, signal_set_fingerprint) so re-escalation
 * on the same signal-set is suppressed by row uniqueness; insert-or-ignore
 * is the natural shape of the dedupe.
 */

export interface EscalationHistoryRecord {
  userId: string;
  ticker: string;
  signalSetFingerprint: string;
  jobId: string;
  signals: string[];
  createdAt: string;
}

export interface RecordEscalationInput {
  userId: string;
  ticker: string;
  signalSetFingerprint: string;
  jobId: string;
  signals: string[];
}

interface Row {
  user_id: string;
  ticker: string;
  signal_set_fingerprint: string;
  job_id: string;
  signals: string[];
  created_at: Date | string;
}

function fromRow(row: Row): EscalationHistoryRecord {
  return {
    userId: row.user_id,
    ticker: row.ticker,
    signalSetFingerprint: row.signal_set_fingerprint,
    jobId: row.job_id,
    signals: Array.isArray(row.signals) ? row.signals : [],
    createdAt: (row.created_at instanceof Date
      ? row.created_at
      : new Date(row.created_at)).toISOString(),
  };
}

/**
 * Insert one row. Returns `inserted: false` when a row with the same
 * (user, ticker, fingerprint) already exists — caller can use this to skip
 * a duplicate escalation.
 */
export async function recordEscalation(
  input: RecordEscalationInput
): Promise<{ inserted: boolean; record: EscalationHistoryRecord }> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("recordEscalation requires the application database");
  }
  const ds = await getApplicationDataSource();
  const ticker = input.ticker.toUpperCase();

  const inserted = (await ds.query(
    `INSERT INTO escalation_history
       (user_id, ticker, signal_set_fingerprint, job_id, signals, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
     ON CONFLICT (user_id, ticker, signal_set_fingerprint) DO NOTHING
     RETURNING user_id, ticker, signal_set_fingerprint, job_id, signals, created_at`,
    [input.userId, ticker, input.signalSetFingerprint, input.jobId, JSON.stringify(input.signals)]
  )) as Row[];

  if (inserted[0]) return { inserted: true, record: fromRow(inserted[0]) };

  // Existed already — fetch the prior row so the caller has a useful record.
  const existing = (await ds.query(
    `SELECT user_id, ticker, signal_set_fingerprint, job_id, signals, created_at
       FROM escalation_history
      WHERE user_id = $1 AND ticker = $2 AND signal_set_fingerprint = $3
      LIMIT 1`,
    [input.userId, ticker, input.signalSetFingerprint]
  )) as Row[];
  return { inserted: false, record: fromRow(existing[0]!) };
}

export async function listEscalationHistory(
  userId: string,
  options?: { ticker?: string; limit?: number }
): Promise<EscalationHistoryRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const params: unknown[] = [userId];
  let where = `user_id = $1`;
  if (options?.ticker) {
    params.push(options.ticker.toUpperCase());
    where += ` AND ticker = $${params.length}`;
  }
  params.push(options?.limit ?? 100);
  const rows = (await ds.query(
    `SELECT user_id, ticker, signal_set_fingerprint, job_id, signals, created_at
       FROM escalation_history WHERE ${where}
       ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  )) as Row[];
  return rows.map(fromRow);
}

/**
 * True if any row exists for (user, ticker, fingerprint). Cheap predicate
 * used by quick-check escalation logic.
 */
export async function hasEscalation(
  userId: string,
  ticker: string,
  signalSetFingerprint: string
): Promise<boolean> {
  if (!isApplicationDatabaseConfigured()) return false;
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT 1 AS one FROM escalation_history
      WHERE user_id = $1 AND ticker = $2 AND signal_set_fingerprint = $3
      LIMIT 1`,
    [userId, ticker.toUpperCase(), signalSetFingerprint]
  )) as Array<{ one: number }>;
  return rows.length > 0;
}
