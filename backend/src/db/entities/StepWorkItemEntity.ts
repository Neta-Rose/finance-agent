import { EntitySchema } from "typeorm";
import type { ModelTier, StepKind, StepWorkItemStatus } from "../../services/stepQueue/types.js";

export interface StepWorkItemEntity {
  id: string;
  tickerWorkItemId: string;
  jobId: string;
  userId: string;
  kind: StepKind;
  status: StepWorkItemStatus;
  attempts: number;
  modelTierUsed: ModelTier | null;
  costAccruedCents: number;
  inputArtifactPaths: string[];
  outputArtifactPath: string | null;
  lastError: string | null;
  ownerLockId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export const StepWorkItemEntitySchema = new EntitySchema<StepWorkItemEntity>({
  name: "StepWorkItem",
  tableName: "step_work_items",
  columns: {
    id: {
      type: "uuid",
      primary: true,
    },
    tickerWorkItemId: {
      name: "ticker_work_item_id",
      type: "uuid",
    },
    jobId: {
      name: "job_id",
      type: "varchar",
      length: 128,
    },
    userId: {
      name: "user_id",
      type: "varchar",
      length: 128,
    },
    kind: {
      type: "varchar",
      length: 64,
    },
    status: {
      type: "varchar",
      length: 32,
    },
    attempts: {
      type: "integer",
      default: 0,
    },
    modelTierUsed: {
      name: "model_tier_used",
      type: "varchar",
      length: 32,
      nullable: true,
    },
    costAccruedCents: {
      name: "cost_accrued_cents",
      type: "integer",
      default: 0,
    },
    inputArtifactPaths: {
      name: "input_artifact_paths",
      type: "text",
      array: true,
      default: () => "'{}'",
    },
    outputArtifactPath: {
      name: "output_artifact_path",
      type: "text",
      nullable: true,
    },
    lastError: {
      name: "last_error",
      type: "text",
      nullable: true,
    },
    ownerLockId: {
      name: "owner_lock_id",
      type: "uuid",
      nullable: true,
    },
    startedAt: {
      name: "started_at",
      type: "timestamptz",
      nullable: true,
    },
    completedAt: {
      name: "completed_at",
      type: "timestamptz",
      nullable: true,
    },
    createdAt: {
      name: "created_at",
      type: "timestamptz",
    },
  },
});
