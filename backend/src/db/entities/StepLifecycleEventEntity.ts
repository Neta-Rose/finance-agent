import { EntitySchema } from "typeorm";

export interface StepLifecycleEventEntity {
  id: number;
  stepId: string;
  fromStatus: string | null;
  toStatus: string;
  attemptN: number | null;
  modelUsed: string | null;
  tierUsed: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  occurredAt: Date;
}

export const StepLifecycleEventEntitySchema = new EntitySchema<StepLifecycleEventEntity>({
  name: "StepLifecycleEvent",
  tableName: "step_lifecycle_events",
  columns: {
    id: {
      type: "bigint",
      primary: true,
      generated: "increment",
    },
    stepId: {
      name: "step_id",
      type: "uuid",
    },
    fromStatus: {
      name: "from_status",
      type: "varchar",
      length: 32,
      nullable: true,
    },
    toStatus: {
      name: "to_status",
      type: "varchar",
      length: 32,
    },
    attemptN: {
      name: "attempt_n",
      type: "integer",
      nullable: true,
    },
    modelUsed: {
      name: "model_used",
      type: "varchar",
      length: 255,
      nullable: true,
    },
    tierUsed: {
      name: "tier_used",
      type: "varchar",
      length: 32,
      nullable: true,
    },
    errorClass: {
      name: "error_class",
      type: "varchar",
      length: 64,
      nullable: true,
    },
    errorMessage: {
      name: "error_message",
      type: "text",
      nullable: true,
    },
    occurredAt: {
      name: "occurred_at",
      type: "timestamptz",
    },
  },
});
