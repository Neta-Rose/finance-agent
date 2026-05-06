import { EntitySchema } from "typeorm";

export type VerdictDecision = "followed" | "dismissed" | "partial_acted";

export interface VerdictActionEntity {
  id: string;
  userId: string;
  ticker: string;
  strategyVersion: number;
  decision: VerdictDecision;
  note: string | null;
  actedAt: Date;
}

export const VerdictActionEntitySchema = new EntitySchema<VerdictActionEntity>({
  name: "VerdictAction",
  tableName: "verdict_actions",
  columns: {
    id: { type: "uuid", primary: true },
    userId: { name: "user_id", type: "varchar", length: 64 },
    ticker: { type: "varchar", length: 32 },
    strategyVersion: { name: "strategy_version", type: "integer" },
    decision: { type: "varchar", length: 16 },
    note: { type: "text", nullable: true },
    actedAt: { name: "acted_at", type: "timestamptz" },
  },
});
