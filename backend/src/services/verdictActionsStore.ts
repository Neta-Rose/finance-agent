import { randomUUID } from "crypto";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import type { VerdictDecision } from "../db/entities/VerdictActionEntity.js";

export type { VerdictDecision } from "../db/entities/VerdictActionEntity.js";

/**
 * Verdict-action store — followed/dismissed/partial_acted records (§4.8, L1).
 *
 * Each row is an immutable user decision attached to the strategy version
 * that was active when the user pressed the button. We never delete or update
 * — corrections are new rows.
 */

export interface VerdictActionRecord {
  id: string;
  userId: string;
  ticker: string;
  strategyVersion: number;
  decision: VerdictDecision;
  note: string | null;
  actedAt: string;
}

export interface RecordVerdictActionInput {
  userId: string;
  ticker: string;
  strategyVersion: number;
  decision: VerdictDecision;
  note?: string | null;
  /** Optional UUID; generated when omitted. */
  id?: string;
}

interface Row {
  id: string;
  user_id: string;
  ticker: string;
  strategy_version: number;
  decision: VerdictDecision;
  note: string | null;
  acted_at: Date | string;
}

const SELECT_COLUMNS = `id, user_id, ticker, strategy_version, decision, note, acted_at`;
const NOTE_MAX_CHARS = 800;

function fromRow(row: Row): VerdictActionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    ticker: row.ticker,
    strategyVersion: row.strategy_version,
    decision: row.decision,
    note: row.note,
    actedAt: (row.acted_at instanceof Date ? row.acted_at : new Date(row.acted_at)).toISOString(),
  };
}

export async function recordVerdictAction(
  input: RecordVerdictActionInput
): Promise<VerdictActionRecord> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("recordVerdictAction requires the application database");
  }
  const ds = await getApplicationDataSource();
  const id = input.id ?? randomUUID();
  const note = input.note === undefined || input.note === null
    ? null
    : input.note.slice(0, NOTE_MAX_CHARS);
  const rows = (await ds.query(
    `INSERT INTO verdict_actions
       (id, user_id, ticker, strategy_version, decision, note, acted_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING ${SELECT_COLUMNS}`,
    [id, input.userId, input.ticker.toUpperCase(), input.strategyVersion, input.decision, note]
  )) as Row[];
  return fromRow(rows[0]!);
}

export async function listVerdictActions(
  userId: string,
  options?: { ticker?: string; limit?: number }
): Promise<VerdictActionRecord[]> {
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
    `SELECT ${SELECT_COLUMNS} FROM verdict_actions WHERE ${where}
      ORDER BY acted_at DESC LIMIT $${params.length}`,
    params
  )) as Row[];
  return rows.map(fromRow);
}
