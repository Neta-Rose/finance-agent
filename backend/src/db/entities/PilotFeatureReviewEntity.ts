import { EntitySchema } from "typeorm";
import type { PilotFeatureReviewStatus } from "../../schemas/pilotFeature.js";

export interface PilotFeatureReviewEntity {
  featureId: string;
  status: PilotFeatureReviewStatus;
  adminComment: string | null;
  incorrectDescription: boolean;
  updatedAt: Date;
  updatedBy: string;
}

export const PilotFeatureReviewEntitySchema = new EntitySchema<PilotFeatureReviewEntity>({
  name: "PilotFeatureReview",
  tableName: "pilot_feature_reviews",
  columns: {
    featureId: {
      name: "feature_id",
      type: "text",
      primary: true,
    },
    status: {
      type: "varchar",
      length: 32,
    },
    adminComment: {
      name: "admin_comment",
      type: "text",
      nullable: true,
    },
    incorrectDescription: {
      name: "incorrect_description",
      type: "boolean",
      default: false,
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
