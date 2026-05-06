import { EntitySchema } from "typeorm";

export interface ReportBatchEntity {
  batchId: string;
  userId: string;
  jobId: string;
  mode: string;
  triggeredAt: Date;
  date: string;
  tickerCount: number;
  summary: Record<string, unknown> | null;
  highlights: Record<string, unknown> | null;
  createdAt: Date;
}

export const ReportBatchEntitySchema = new EntitySchema<ReportBatchEntity>({
  name: "ReportBatch",
  tableName: "report_batches",
  columns: {
    batchId: { name: "batch_id", type: "varchar", length: 128, primary: true },
    userId: { name: "user_id", type: "varchar", length: 64 },
    jobId: { name: "job_id", type: "varchar", length: 128 },
    mode: { type: "varchar", length: 32 },
    triggeredAt: { name: "triggered_at", type: "timestamptz" },
    date: { type: "date" },
    tickerCount: { name: "ticker_count", type: "integer", default: 0 },
    summary: { type: "jsonb", nullable: true },
    highlights: { type: "jsonb", nullable: true },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
});
