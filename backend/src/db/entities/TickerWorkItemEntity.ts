import { EntitySchema } from "typeorm";
import type { TickerWorkItemStatus } from "../../services/stepQueue/types.js";

export interface TickerWorkItemEntity {
  id: string;
  jobId: string;
  userId: string;
  ticker: string;
  status: TickerWorkItemStatus;
  position: number;
  startedAt: Date | null;
  completedAt: Date | null;
  failureReason: string | null;
  skipReason: string | null;
}

export const TickerWorkItemEntitySchema = new EntitySchema<TickerWorkItemEntity>({
  name: "TickerWorkItem",
  tableName: "ticker_work_items",
  columns: {
    id: {
      type: "uuid",
      primary: true,
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
    ticker: {
      type: "varchar",
      length: 32,
    },
    status: {
      type: "varchar",
      length: 32,
    },
    position: {
      type: "integer",
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
    failureReason: {
      name: "failure_reason",
      type: "text",
      nullable: true,
    },
    skipReason: {
      name: "skip_reason",
      type: "text",
      nullable: true,
    },
  },
});
