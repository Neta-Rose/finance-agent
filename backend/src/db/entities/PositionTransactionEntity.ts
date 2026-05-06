import { EntitySchema } from "typeorm";

export type TransactionType =
  | "buy"
  | "sell"
  | "split"
  | "dividend"
  | "transfer_in"
  | "transfer_out";

export interface PositionTransactionEntity {
  id: string;
  userId: string;
  ticker: string;
  exchange: string;
  account: string;
  transactionType: TransactionType;
  quantity: string;
  unitPrice: string;
  unitCurrency: string;
  feesIls: string;
  fxRate: string | null;
  transactionAt: Date;
  note: string | null;
  lotId: string | null;
  supersededBy: string | null;
  supersededAt: Date | null;
  createdAt: Date;
}

export const PositionTransactionEntitySchema = new EntitySchema<PositionTransactionEntity>({
  name: "PositionTransaction",
  tableName: "position_transactions",
  columns: {
    id: { type: "uuid", primary: true },
    userId: { name: "user_id", type: "varchar", length: 64 },
    ticker: { type: "varchar", length: 32 },
    exchange: { type: "varchar", length: 16 },
    account: { type: "varchar", length: 64 },
    transactionType: { name: "transaction_type", type: "varchar", length: 16 },
    quantity: { type: "numeric", precision: 20, scale: 8 },
    unitPrice: { name: "unit_price", type: "numeric", precision: 20, scale: 8 },
    unitCurrency: { name: "unit_currency", type: "varchar", length: 8 },
    feesIls: { name: "fees_ils", type: "numeric", precision: 18, scale: 4 },
    fxRate: { name: "fx_rate", type: "numeric", precision: 18, scale: 8, nullable: true },
    transactionAt: { name: "transaction_at", type: "timestamptz" },
    note: { type: "text", nullable: true },
    lotId: { name: "lot_id", type: "uuid", nullable: true },
    supersededBy: { name: "superseded_by", type: "uuid", nullable: true },
    supersededAt: { name: "superseded_at", type: "timestamptz", nullable: true },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
});
