import { EntitySchema } from "typeorm";

export interface EscalationHistoryEntity {
  userId: string;
  ticker: string;
  signalSetFingerprint: string;
  jobId: string;
  signals: string[];
  createdAt: Date;
}

export const EscalationHistoryEntitySchema = new EntitySchema<EscalationHistoryEntity>({
  name: "EscalationHistory",
  tableName: "escalation_history",
  columns: {
    userId: { name: "user_id", type: "varchar", length: 64, primary: true },
    ticker: { type: "varchar", length: 32, primary: true },
    signalSetFingerprint: {
      name: "signal_set_fingerprint",
      type: "varchar",
      length: 64,
      primary: true,
    },
    jobId: { name: "job_id", type: "varchar", length: 128 },
    signals: { type: "jsonb" },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
});
