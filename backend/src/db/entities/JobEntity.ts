import { EntitySchema } from "typeorm";
import type { JsonValue } from "../../types/index.js";
import type { JobAction, JobSource, JobStatus, ModelTier } from "../../services/stepQueue/types.js";

export interface JobEntity {
  id: string;
  userId: string;
  action: JobAction;
  status: JobStatus;
  source: JobSource;
  modelTier: ModelTier;
  notifyPerTicker: boolean;
  budgetAdmittedAt: Date | null;
  triggeredAt: Date;
  startedAt: Date | null;
  pausedAt: Date | null;
  completedAt: Date | null;
  pauseReason: string | null;
  failureReason: string | null;
  result: JsonValue | null;
}

export const JobEntitySchema = new EntitySchema<JobEntity>({
  name: "Job",
  tableName: "jobs",
  columns: {
    id: {
      type: "varchar",
      length: 128,
      primary: true,
    },
    userId: {
      name: "user_id",
      type: "varchar",
      length: 128,
    },
    action: {
      type: "varchar",
      length: 64,
    },
    status: {
      type: "varchar",
      length: 32,
    },
    source: {
      type: "varchar",
      length: 64,
    },
    modelTier: {
      name: "model_tier",
      type: "varchar",
      length: 32,
    },
    notifyPerTicker: {
      name: "notify_per_ticker",
      type: "boolean",
      default: false,
    },
    budgetAdmittedAt: {
      name: "budget_admitted_at",
      type: "timestamptz",
      nullable: true,
    },
    triggeredAt: {
      name: "triggered_at",
      type: "timestamptz",
    },
    startedAt: {
      name: "started_at",
      type: "timestamptz",
      nullable: true,
    },
    pausedAt: {
      name: "paused_at",
      type: "timestamptz",
      nullable: true,
    },
    completedAt: {
      name: "completed_at",
      type: "timestamptz",
      nullable: true,
    },
    pauseReason: {
      name: "pause_reason",
      type: "text",
      nullable: true,
    },
    failureReason: {
      name: "failure_reason",
      type: "text",
      nullable: true,
    },
    result: {
      type: "jsonb",
      nullable: true,
    },
  },
});
