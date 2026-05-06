import { randomUUID } from "crypto";
import type { DataSource } from "typeorm";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import type { TransactionType } from "../db/entities/PositionTransactionEntity.js";

/**
 * Transaction store — Phase 7, task 7.2.
 *
 * Spec: design.md §11; J1.1–J1.4, J2.1–J2.3, NFR6.8.
 *
 * Append-only with tombstone semantics. Every read for cost-basis computation
 * filters `superseded_at IS NULL`. The FIFO algorithm runs in application code
 * because Postgres cannot express partial-fill lot matching portably.
 */

export type { TransactionType } from "../db/entities/PositionTransactionEntity.js";

export interface TransactionRecord {
  id: string;
  userId: string;
  ticker: string;
  exchange: string;
  account: string;
  transactionType: TransactionType;
  quantity: number;
  unitPrice: number;
  unitCurrency: string;
  feesIls: number;
  fxRate: number | null;
  transactionAt: string;
  note: string | null;
  lotId: string | null;
  supersededBy: string | null;
  supersededAt: string | null;
  createdAt: string;
}

export interface InsertTransactionInput {
  userId: string;
  ticker: string;
  exchange: string;
  account: string;
  transactionType: TransactionType;
  quantity: number;
  unitPrice: number;
  unitCurrency: string;
  feesIls?: number;
  fxRate?: number | null;
  transactionAt: string;
  note?: string | null;
  lotId?: string | null;
  id?: string;
}

export interface OpenLot {
  lotId: string;
  ticker: string;
  exchange: string;
  account: string;
  acquiredAt: string;
  quantityRemaining: number;
  unitCostIls: number;
}

export interface FifoComputation {
  ticker: string;
  costBasisIls: number;
  realizedPlIls: number;
  unrealizedPlIls: number;
  openLots: OpenLot[];
}

export type FifoError =
  | { kind: "oversold"; ticker: string; sellTransactionId: string; missingShares: number }
  | { kind: "missing_split"; ticker: string; transactionId: string };

export type FifoResult =
  | { ok: true; computation: FifoComputation }
  | { ok: false; error: FifoError };

interface TransactionRow {
  id: string;
  user_id: string;
  ticker: string;
  exchange: string;
  account: string;
  transaction_type: TransactionType;
  quantity: string;
  unit_price: string;
  unit_currency: string;
  fees_ils: string;
  fx_rate: string | null;
  transaction_at: Date | string;
  note: string | null;
  lot_id: string | null;
  superseded_by: string | null;
  superseded_at: Date | string | null;
  created_at: Date | string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fromRow(row: TransactionRow): TransactionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    ticker: row.ticker,
    exchange: row.exchange,
    account: row.account,
    transactionType: row.transaction_type,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    unitCurrency: row.unit_currency,
    feesIls: Number(row.fees_ils),
    fxRate: row.fx_rate !== null ? Number(row.fx_rate) : null,
    transactionAt: toIso(row.transaction_at) ?? new Date().toISOString(),
    note: row.note,
    lotId: row.lot_id,
    supersededBy: row.superseded_by,
    supersededAt: toIso(row.superseded_at),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
  };
}

const SELECT_COLUMNS = `id, user_id, ticker, exchange, account, transaction_type,
  quantity, unit_price, unit_currency, fees_ils, fx_rate, transaction_at,
  note, lot_id, superseded_by, superseded_at, created_at`;

// ---------------------------------------------------------------------------
// ILS conversion helper
// ---------------------------------------------------------------------------

function toIls(
  unitPrice: number,
  unitCurrency: string,
  exchange: string,
  fxRate: number | null,
  fallbackFxRate = 3.7
): number {
  if (exchange === "TASE" || unitCurrency === "ILS" || unitCurrency === "ILA") {
    return unitPrice;
  }
  const rate = fxRate ?? fallbackFxRate;
  return unitPrice * rate;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function insertTransaction(input: InsertTransactionInput): Promise<TransactionRecord> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("insertTransaction requires the application database");
  }
  const ds = await getApplicationDataSource();
  const id = input.id ?? randomUUID();
  const rows = (await ds.query(
    `INSERT INTO position_transactions
       (id, user_id, ticker, exchange, account, transaction_type, quantity,
        unit_price, unit_currency, fees_ils, fx_rate, transaction_at, note, lot_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
     RETURNING ${SELECT_COLUMNS}`,
    [
      id, input.userId, input.ticker.toUpperCase(), input.exchange, input.account,
      input.transactionType, input.quantity, input.unitPrice, input.unitCurrency,
      input.feesIls ?? 0, input.fxRate ?? null, input.transactionAt,
      input.note ?? null, input.lotId ?? null,
    ]
  )) as TransactionRow[];
  return fromRow(rows[0]!);
}

export async function listTransactions(
  userId: string,
  options?: { ticker?: string; includeSuperseded?: boolean; limit?: number }
): Promise<TransactionRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const params: unknown[] = [userId];
  let where = `user_id = $1`;
  if (options?.ticker) {
    params.push(options.ticker.toUpperCase());
    where += ` AND ticker = $${params.length}`;
  }
  if (!options?.includeSuperseded) {
    where += ` AND superseded_at IS NULL`;
  }
  params.push(options?.limit ?? 500);
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM position_transactions
      WHERE ${where}
      ORDER BY transaction_at ASC, id ASC
      LIMIT $${params.length}`,
    params
  )) as TransactionRow[];
  return rows.map(fromRow);
}

export async function editTransaction(
  ds: DataSource,
  userId: string,
  transactionId: string,
  patch: Partial<Pick<InsertTransactionInput, "quantity" | "unitPrice" | "unitCurrency" | "feesIls" | "transactionAt" | "note">>
): Promise<TransactionRecord> {
  return ds.transaction(async (mgr) => {
    const before = (await mgr.query(
      `SELECT ${SELECT_COLUMNS} FROM position_transactions
        WHERE id = $1 AND user_id = $2 AND superseded_at IS NULL
        FOR UPDATE`,
      [transactionId, userId]
    )) as TransactionRow[];
    if (before.length === 0) throw new Error("transaction_not_found_or_superseded");
    const old = before[0]!;
    const newId = randomUUID();
    const now = new Date().toISOString();

    await mgr.query(
      `INSERT INTO position_transactions
         (id, user_id, ticker, exchange, account, transaction_type, quantity,
          unit_price, unit_currency, fees_ils, fx_rate, transaction_at, note, lot_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())`,
      [
        newId, userId, old.ticker, old.exchange, old.account, old.transaction_type,
        patch.quantity ?? old.quantity,
        patch.unitPrice ?? old.unit_price,
        patch.unitCurrency ?? old.unit_currency,
        patch.feesIls ?? old.fees_ils,
        old.fx_rate,
        patch.transactionAt ?? old.transaction_at,
        patch.note ?? old.note,
        old.lot_id,
      ]
    );
    await mgr.query(
      `UPDATE position_transactions SET superseded_by = $1, superseded_at = $2 WHERE id = $3`,
      [newId, now, transactionId]
    );
    const updated = (await mgr.query(
      `SELECT ${SELECT_COLUMNS} FROM position_transactions WHERE id = $1`,
      [newId]
    )) as TransactionRow[];
    return fromRow(updated[0]!);
  });
}

export async function deleteTransaction(
  ds: DataSource,
  userId: string,
  transactionId: string
): Promise<{ tombstoneId: string }> {
  return ds.transaction(async (mgr) => {
    const before = (await mgr.query(
      `SELECT ${SELECT_COLUMNS} FROM position_transactions
        WHERE id = $1 AND user_id = $2 AND superseded_at IS NULL
        FOR UPDATE`,
      [transactionId, userId]
    )) as TransactionRow[];
    if (before.length === 0) throw new Error("transaction_not_found_or_superseded");
    const old = before[0]!;
    const tombId = randomUUID();
    const now = new Date().toISOString();

    await mgr.query(
      `INSERT INTO position_transactions
         (id, user_id, ticker, exchange, account, transaction_type, quantity,
          unit_price, unit_currency, fees_ils, transaction_at, note, created_at)
       VALUES ($1,$2,$3,$4,$5,'transfer_out',0,0,'ILS',0,$6,'tombstone',NOW())`,
      [tombId, userId, old.ticker, old.exchange, old.account, now]
    );
    await mgr.query(
      `UPDATE position_transactions SET superseded_by = $1, superseded_at = $2 WHERE id = $3`,
      [tombId, now, transactionId]
    );
    return { tombstoneId: tombId };
  });
}

// ---------------------------------------------------------------------------
// FIFO cost-basis computation (J1.3, J1.4, J2.1, NFR6.8)
// ---------------------------------------------------------------------------

export async function computeFifoForTicker(
  userId: string,
  ticker: string,
  livePriceIls?: number
): Promise<FifoResult> {
  if (!isApplicationDatabaseConfigured()) {
    return { ok: true, computation: { ticker, costBasisIls: 0, realizedPlIls: 0, unrealizedPlIls: 0, openLots: [] } };
  }
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM position_transactions
      WHERE user_id = $1 AND ticker = $2 AND superseded_at IS NULL
      ORDER BY transaction_at ASC, id ASC`,
    [userId, ticker.toUpperCase()]
  )) as TransactionRow[];

  const openLots: OpenLot[] = [];
  let realizedPlIls = 0;

  for (const row of rows) {
    const qty = Number(row.quantity);
    const price = Number(row.unit_price);
    const fees = Number(row.fees_ils);
    const fxRate = row.fx_rate !== null ? Number(row.fx_rate) : null;
    const unitCostIls = toIls(price, row.unit_currency, row.exchange, fxRate);

    switch (row.transaction_type) {
      case "buy":
      case "transfer_in": {
        openLots.push({
          lotId: row.id,
          ticker,
          exchange: row.exchange,
          account: row.account,
          acquiredAt: toIso(row.transaction_at) ?? new Date().toISOString(),
          quantityRemaining: qty,
          unitCostIls: unitCostIls + (qty > 0 ? fees / qty : 0),
        });
        break;
      }
      case "sell":
      case "transfer_out": {
        if (qty === 0) break; // tombstone row
        const sellPriceIls = toIls(price, row.unit_currency, row.exchange, fxRate);
        const perShareFee = qty > 0 ? fees / qty : 0;
        let toClose = qty;
        while (toClose > 1e-9 && openLots.length > 0) {
          const head = openLots[0]!;
          const closing = Math.min(head.quantityRemaining, toClose);
          const proceedsIls = (sellPriceIls - perShareFee) * closing;
          const costClosedIls = head.unitCostIls * closing;
          realizedPlIls += proceedsIls - costClosedIls;
          head.quantityRemaining -= closing;
          toClose -= closing;
          if (head.quantityRemaining <= 1e-9) openLots.shift();
        }
        if (toClose > 1e-9) {
          return { ok: false, error: { kind: "oversold", ticker, sellTransactionId: row.id, missingShares: toClose } };
        }
        break;
      }
      case "split": {
        return { ok: false, error: { kind: "missing_split", ticker, transactionId: row.id } };
      }
      case "dividend":
        break; // dividends do not affect cost basis (§11.1)
    }
  }

  const costBasisIls = openLots.reduce((sum, lot) => sum + lot.unitCostIls * lot.quantityRemaining, 0);
  const totalOpenQty = openLots.reduce((sum, lot) => sum + lot.quantityRemaining, 0);
  const unrealizedPlIls = livePriceIls !== undefined
    ? livePriceIls * totalOpenQty - costBasisIls
    : 0;

  return {
    ok: true,
    computation: {
      ticker,
      costBasisIls: round2(costBasisIls),
      realizedPlIls: round2(realizedPlIls),
      unrealizedPlIls: round2(unrealizedPlIls),
      openLots,
    },
  };
}

/**
 * Replay synthetic opening lots from migration_archive into position_transactions.
 * Called by the Phase 7 replay script.
 */
export async function replayOpeningLot(input: {
  userId: string;
  ticker: string;
  exchange: string;
  account: string;
  shares: number;
  unitAvgBuyPrice: number;
  unitCurrency: string;
  transactionAt: string;
}): Promise<TransactionRecord> {
  return insertTransaction({
    userId: input.userId,
    ticker: input.ticker,
    exchange: input.exchange,
    account: input.account,
    transactionType: "transfer_in",
    quantity: input.shares,
    unitPrice: input.unitAvgBuyPrice,
    unitCurrency: input.unitCurrency,
    feesIls: 0,
    transactionAt: input.transactionAt,
    note: "synthetic_opening_lot",
  });
}
