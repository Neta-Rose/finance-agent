import { EntitySchema } from "typeorm";

export type TrackedAssetStatus = "active" | "muted" | "archived";

export interface TrackedAssetEntity {
  userId: string;
  ticker: string;
  status: TrackedAssetStatus;
  createdFromJobId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export const TrackedAssetEntitySchema = new EntitySchema<TrackedAssetEntity>({
  name: "TrackedAsset",
  tableName: "tracked_assets",
  columns: {
    userId: {
      name: "user_id",
      type: "varchar",
      length: 128,
      primary: true,
    },
    ticker: {
      type: "varchar",
      length: 32,
      primary: true,
    },
    status: {
      type: "varchar",
      length: 32,
    },
    createdFromJobId: {
      name: "created_from_job_id",
      type: "varchar",
      length: 128,
      nullable: true,
    },
    notes: {
      type: "text",
      nullable: true,
    },
    createdAt: {
      name: "created_at",
      type: "timestamptz",
    },
    updatedAt: {
      name: "updated_at",
      type: "timestamptz",
    },
    archivedAt: {
      name: "archived_at",
      type: "timestamptz",
      nullable: true,
    },
  },
});
