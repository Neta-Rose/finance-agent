import { EntitySchema } from "typeorm";
import type { ModelTier, StepKind } from "../../services/stepQueue/types.js";

export interface ModelTierAssignmentEntity {
  tier: ModelTier;
  stepKind: StepKind;
  model: string;
  fallback: string | null;
  updatedAt: Date;
  updatedBy: string;
}

export const ModelTierAssignmentEntitySchema = new EntitySchema<ModelTierAssignmentEntity>({
  name: "ModelTierAssignment",
  tableName: "model_tier_assignments",
  columns: {
    tier: {
      type: "varchar",
      length: 32,
      primary: true,
    },
    stepKind: {
      name: "step_kind",
      type: "varchar",
      length: 64,
      primary: true,
    },
    model: {
      type: "varchar",
      length: 255,
    },
    fallback: {
      type: "varchar",
      length: 255,
      nullable: true,
    },
    updatedAt: {
      name: "updated_at",
      type: "timestamptz",
    },
    updatedBy: {
      name: "updated_by",
      type: "varchar",
      length: 128,
    },
  },
});
