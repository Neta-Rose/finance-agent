import { EntitySchema } from "typeorm";

export type CorporateActionType = "split" | "dividend";

export interface CorporateActionEntity {
  id: string;
  userId: string | null;
  ticker: string;
  exchange: string;
  actionType: CorporateActionType;
  ratioOrAmount: string;
  currency: string;
  effectiveDate: Date;
  source: string;
  revertedAt: Date | null;
  revertedReason: string | null;
  createdAt: Date;
}

export const CorporateActionEntitySchema = new EntitySchema<CorporateActionEntity>({
  name: "CorporateAction",
  tableName: "corporate_actions",
  columns: {
    id: { type: "uuid", primary: true },
    userId: { name: "user_id", type: "varchar", length: 64, nullable: true },
    ticker: { type: "varchar", length: 32 },
    exchange: { type: "varchar", length: 16 },
    actionType: { name: "action_type", type: "varchar", length: 16 },
    ratioOrAmount: { name: "ratio_or_amount", type: "numeric", precision: 20, scale: 8 },
    currency: { type: "varchar", length: 8 },
    effectiveDate: { name: "effective_date", type: "date" },
    source: { type: "varchar", length: 64 },
    revertedAt: { name: "reverted_at", type: "timestamptz", nullable: true },
    revertedReason: { name: "reverted_reason", type: "text", nullable: true },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
});
