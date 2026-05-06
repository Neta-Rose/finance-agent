import { randomUUID } from "crypto";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import type { CorporateActionType } from "../db/entities/CorporateActionEntity.js";
import { logger } from "./logger.js";

/**
 * Corporate actions store — Phase 7, task 7.3.
 *
 * Spec: design.md §12; K1.1–K1.4.
 *
 * Splits rewrite historical position_transactions rows so downstream FIFO
 * sees a self-consistent ledger. Dividends insert zero-quantity rows for
 * audit/tax purposes without affecting cost basis.
 */

export type { CorporateActionType } from "../db/entities/CorporateActionEntity.js";

export interface CorporateActionRecord {
  id: string;
  userId: string | null;
  ticker: string;
  exchange: string;
  actionType: CorporateActionType;
  ratioOrAmount: number;
  currency: string;
  effectiveDate: string;
  source: string;
  revertedAt: string | null;
  revertedReason: string | null;
  createdAt: string;
}

interface ActionRow {
  id: string;
  user_id: string | null;
  ticker: string;
  exchange: string;
  action_type: CorporateActionType;
  ratio_or_amount: string;
  currency: string;
  effective_date: Date | string;
  source: string;
  reverted_at: Date | string | null;
  reverted_reason: string | null;
  created_at: Date | string;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toDateStr(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function fromRow(row: ActionRow): CorporateActionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    ticker: row.ticker,
    exchange: row.exchange,
    actionType: row.action_type,
    ratioOrAmount: Number(row.ratio_or_amount),
    currency: row.currency,
    effectiveDate: toDateStr(row.effective_date),
    source: row.source,
    revertedAt: toIso(row.reverted_at),
    revertedReason: row.reverted_reason,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
  };
}

const SELECT_COLUMNS = `id, user_id, ticker, exchange, action_type, ratio_or_amount,
  currency, effective_date, source, reverted_at, reverted_reason, created_at`;

// ---------------------------------------------------------------------------
// Apply a corporate action (K1.1, K1.2, K1.3)
// ---------------------------------------------------------------------------

export interface ApplyCorporateActionInput {
  ticker: string;
  exchange: string;
  actionType: CorporateActionType;
  ratioOrAmount: number;
  currency: string;
  effectiveDate: string;
  source: string;
  /** null = global (applies to all users holding the ticker) */
  userId: string | null;
}

export async function applyCorporateAction(
  input: ApplyCorporateActionInput
): Promise<{ rewrittenTxns: number; insertedDividendRows: number; skipped: boolean }> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("applyCorporateAction requires the application database");
  }
  const ds = await getApplicationDataSource();

  return ds.transaction(async (mgr) => {
    // K1.3 — idempotency: skip if this exact action already exists and is not reverted.
    const existing = (await mgr.query(
      `SELECT id FROM corporate_actions
        WHERE ticker = $1 AND exchange = $2 AND action_type = $3
          AND effective_date = $4 AND ratio_or_amount = $5
          AND source = $6
          AND ((user_id IS NULL AND $7::varchar IS NULL) OR user_id = $7)
          AND reverted_at IS NULL`,
      [
        input.ticker, input.exchange, input.actionType,
        input.effectiveDate, input.ratioOrAmount, input.source, input.userId,
      ]
    )) as Array<{ id: string }>;
    if (existing.length > 0) return { rewrittenTxns: 0, insertedDividendRows: 0, skipped: true };

    const actionId = randomUUID();
    await mgr.query(
      `INSERT INTO corporate_actions
         (id, user_id, ticker, exchange, action_type, ratio_or_amount, currency, effective_date, source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
      [
        actionId, input.userId, input.ticker, input.exchange, input.actionType,
        input.ratioOrAmount, input.currency, input.effectiveDate, input.source,
      ]
    );

    if (input.actionType === "split") {
      // Rewrite all non-superseded buy/transfer_in/sell/transfer_out rows
      // where transaction_at < effectiveDate (K1.2).
      const targets = (await mgr.query(
        `SELECT id, user_id, ticker, exchange, account, transaction_type,
                quantity, unit_price, unit_currency, fees_ils, fx_rate,
                transaction_at, note, lot_id
           FROM position_transactions
          WHERE ticker = $1 AND exchange = $2
            AND transaction_at < $3
            AND superseded_at IS NULL
            AND ($4::varchar IS NULL OR user_id = $4)`,
        [input.ticker, input.exchange, input.effectiveDate, input.userId]
      )) as Array<Record<string, unknown>>;

      const now = new Date().toISOString();
      let rewritten = 0;
      for (const old of targets) {
        const newId = randomUUID();
        const oldQty = Number(old["quantity"]);
        const oldPrice = Number(old["unit_price"]);
        const newQty = oldQty * input.ratioOrAmount;
        const newPrice = oldPrice / input.ratioOrAmount;
        await mgr.query(
          `INSERT INTO position_transactions
             (id, user_id, ticker, exchange, account, transaction_type,
              quantity, unit_price, unit_currency, fees_ils, fx_rate,
              transaction_at, note, lot_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())`,
          [
            newId, old["user_id"], old["ticker"], old["exchange"], old["account"],
            old["transaction_type"], newQty, newPrice, old["unit_currency"],
            old["fees_ils"], old["fx_rate"] ?? null, old["transaction_at"],
            `[split-rewrite ${actionId} ratio=${input.ratioOrAmount}] ${old["note"] ?? ""}`.slice(0, 500),
            old["lot_id"] ?? null,
          ]
        );
        await mgr.query(
          `UPDATE position_transactions SET superseded_by = $1, superseded_at = $2 WHERE id = $3`,
          [newId, now, old["id"]]
        );
        rewritten += 1;
      }
      logger.info(`Corporate action applied: split ${input.ticker} ratio=${input.ratioOrAmount} rewrote ${rewritten} transactions`);
      return { rewrittenTxns: rewritten, insertedDividendRows: 0, skipped: false };
    }

    // Dividend: insert one zero-quantity row per affected user holding the ticker.
    const holders = (await mgr.query(
      `SELECT DISTINCT user_id, account
         FROM position_transactions
        WHERE ticker = $1 AND exchange = $2
          AND superseded_at IS NULL
          AND transaction_at <= $3
          AND ($4::varchar IS NULL OR user_id = $4)`,
      [input.ticker, input.exchange, input.effectiveDate, input.userId]
    )) as Array<{ user_id: string; account: string }>;

    let inserted = 0;
    for (const row of holders) {
      await mgr.query(
        `INSERT INTO position_transactions
           (id, user_id, ticker, exchange, account, transaction_type,
            quantity, unit_price, unit_currency, fees_ils, transaction_at, note, created_at)
         VALUES ($1,$2,$3,$4,$5,'dividend',0,$6,$7,0,$8,$9,NOW())`,
        [
          randomUUID(), row.user_id, input.ticker, input.exchange, row.account,
          input.ratioOrAmount, input.currency, input.effectiveDate,
          `[dividend ${actionId} amount=${input.ratioOrAmount} ${input.currency}]`,
        ]
      );
      inserted += 1;
    }
    logger.info(`Corporate action applied: dividend ${input.ticker} amount=${input.ratioOrAmount} ${input.currency} inserted ${inserted} rows`);
    return { rewrittenTxns: 0, insertedDividendRows: inserted, skipped: false };
  });
}

// ---------------------------------------------------------------------------
// List / revert
// ---------------------------------------------------------------------------

export async function listCorporateActions(
  options?: { ticker?: string; userId?: string | null; limit?: number }
): Promise<CorporateActionRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const params: unknown[] = [];
  const wheres: string[] = [];
  if (options?.ticker) {
    params.push(options.ticker.toUpperCase());
    wheres.push(`ticker = $${params.length}`);
  }
  if (options?.userId !== undefined) {
    if (options.userId === null) {
      wheres.push(`user_id IS NULL`);
    } else {
      params.push(options.userId);
      wheres.push(`user_id = $${params.length}`);
    }
  }
  params.push(options?.limit ?? 100);
  const where = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM corporate_actions ${where}
      ORDER BY effective_date DESC LIMIT $${params.length}`,
    params
  )) as ActionRow[];
  return rows.map(fromRow);
}

export async function revertCorporateAction(
  actionId: string,
  reason: string
): Promise<void> {
  if (!isApplicationDatabaseConfigured()) return;
  const ds = await getApplicationDataSource();
  await ds.query(
    `UPDATE corporate_actions
        SET reverted_at = NOW(), reverted_reason = $2
      WHERE id = $1 AND reverted_at IS NULL`,
    [actionId, reason.slice(0, 500)]
  );
  logger.info(`Corporate action reverted: ${actionId} reason=${reason}`);
}
