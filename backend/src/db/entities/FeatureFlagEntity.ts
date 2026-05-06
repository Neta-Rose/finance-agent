import { EntitySchema } from "typeorm";

export interface FeatureFlagEntity {
  id: string;
  flagName: string;
  scopeUserId: string | null;
  enabled: boolean;
  valueJson: unknown;
  updatedAt: Date;
  updatedBy: string;
}

export const FeatureFlagEntitySchema = new EntitySchema<FeatureFlagEntity>({
  name: "FeatureFlag",
  tableName: "feature_flags",
  columns: {
    id: { type: "bigint", primary: true, generated: true },
    flagName: { name: "flag_name", type: "varchar", length: 64 },
    scopeUserId: { name: "scope_user_id", type: "varchar", length: 64, nullable: true },
    enabled: { type: "boolean" },
    valueJson: { name: "value_json", type: "jsonb", nullable: true },
    updatedAt: { name: "updated_at", type: "timestamptz" },
    updatedBy: { name: "updated_by", type: "varchar", length: 64 },
  },
});
