import { randomUUID } from "crypto";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { unwrapMutationRows } from "./dbUtils.js";

/**
 * Snooze store — `ticker_snoozes` (design §4.9, L2).
 *
 * Suppresses re-escalation on a matching signal-set until `snoozeUntil`.
 * The fingerprint is a stable hash computed by the caller (see snooze §13.1).
 */

export interface TickerSnoozeRecord {
  id: string;
  userId: string;
  ticker: string;
  snoozeUntil: string;
  signalSetFingerprint: string;
  reason: string | null;
  createdAt: string;
}

export interface CreateSnoozeInput {
  userId: string;
  ticker: string;
  snoozeUntil: string;
  signalSetFingerprint: string;
  reason?: string | null;
  /** Optional UUID; one is generated if omitted. */
  id?: string;
}

interface Row {
  id: string;
  user_id: string;
  ticker: string;
  snooze_until: Date | string;
  signal_set_fingerprint: string;
  reason: string | null;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function fromRow(row: Row): TickerSnoozeRecord {
  return {
    id: row.id,
    userId: row.user_id,
    ticker: row.ticker,
    snoozeUntil: toIso(row.snooze_until),
    signalSetFingerprint: row.signal_set_fingerprint,
    reason: row.reason,
    createdAt: toIso(row.created_at),
  };
}

const SELECT_COLUMNS = `id, user_id, ticker, snooze_until, signal_set_fingerprint, reason, created_at`;

export async function createSnooze(input: CreateSnoozeInput): Promise<TickerSnoozeRecord> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("createSnooze requires the application database");
  }
  const ds = await getApplicationDataSource();
  const id = input.id ?? randomUUID();
  const rows = (await ds.query(
    `INSERT INTO ticker_snoozes
       (id, user_id, ticker, snooze_until, signal_set_fingerprint, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING ${SELECT_COLUMNS}`,
    [
      id,
      input.userId,
      input.ticker.toUpperCase(),
      input.snoozeUntil,
      input.signalSetFingerprint,
      input.reason ?? null,
    ]
  )) as Row[];
  return fromRow(rows[0]!);
}

/**
 * Find an active snooze (snoozeUntil > now) matching the fingerprint.
 * Returns null if none. Used by quick-check before admitting a deep dive.
 */
export async function findActiveSnooze(
  userId: string,
  ticker: string,
  signalSetFingerprint: string
): Promise<TickerSnoozeRecord | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM ticker_snoozes
      WHERE user_id = $1
        AND ticker = $2
        AND signal_set_fingerprint = $3
        AND snooze_until > NOW()
      ORDER BY snooze_until DESC
      LIMIT 1`,
    [userId, ticker.toUpperCase(), signalSetFingerprint]
  )) as Row[];
  return rows[0] ? fromRow(rows[0]) : null;
}

/** All active snoozes for a user. Used for the snooze admin / dashboard view. */
export async function listActiveSnoozes(userId: string): Promise<TickerSnoozeRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM ticker_snoozes
      WHERE user_id = $1 AND snooze_until > NOW()
      ORDER BY snooze_until DESC`,
    [userId]
  )) as Row[];
  return rows.map(fromRow);
}

/** Cancel a snooze by setting its `snooze_until` to now. */
export async function cancelSnooze(userId: string, snoozeId: string): Promise<boolean> {
  if (!isApplicationDatabaseConfigured()) return false;
  const ds = await getApplicationDataSource();
  const raw = await ds.query(
    `UPDATE ticker_snoozes
        SET snooze_until = NOW()
      WHERE user_id = $1 AND id = $2 AND snooze_until > NOW()
      RETURNING id`,
    [userId, snoozeId]
  );
  return unwrapMutationRows<{ id: string }>(raw).length > 0;
}
