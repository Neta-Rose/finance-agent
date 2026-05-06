import { EntitySchema } from "typeorm";

export interface ReportIndexEntity {
  batchId: string;
  ticker: string;
  dailySection: string | null;
  entry: Record<string, unknown>;
}

export const ReportIndexEntitySchema = new EntitySchema<ReportIndexEntity>({
  name: "ReportIndex",
  tableName: "report_index",
  columns: {
    batchId: { name: "batch_id", type: "varchar", length: 128, primary: true },
    ticker: { type: "varchar", length: 32, primary: true },
    dailySection: { name: "daily_section", type: "varchar", length: 16, nullable: true },
    entry: { type: "jsonb" },
  },
});
