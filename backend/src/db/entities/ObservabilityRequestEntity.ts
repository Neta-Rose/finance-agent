import { EntitySchema } from "typeorm";

export interface ObservabilityRequestEntity {
  id: number;
  userId: string;
  purpose: string;
  ticker: string | null;
  jobId: string | null;
  sourceClass: string;
  analyst: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
  latencyMs: number;
  status: string;
  errorMessage: string | null;
  attributionSource: string;
  rejectionReason: string | null;
  occurredAt: Date;
}

export const ObservabilityRequestEntitySchema = new EntitySchema<ObservabilityRequestEntity>({
  name: "ObservabilityRequest",
  tableName: "llm_requests",
  columns: {
    id: {
      type: "bigint",
      primary: true,
      generated: "increment",
    },
    userId: {
      name: "user_id",
      type: "varchar",
    },
    purpose: {
      type: "varchar",
    },
    ticker: {
      type: "varchar",
      nullable: true,
    },
    jobId: {
      name: "job_id",
      type: "varchar",
      nullable: true,
    },
    sourceClass: {
      name: "source_class",
      type: "varchar",
    },
    analyst: {
      type: "varchar",
    },
    model: {
      type: "varchar",
    },
    tokensIn: {
      name: "tokens_in",
      type: "integer",
    },
    tokensOut: {
      name: "tokens_out",
      type: "integer",
    },
    costUsd: {
      name: "cost_usd",
      type: "numeric",
      precision: 14,
      scale: 6,
    },
    latencyMs: {
      name: "latency_ms",
      type: "integer",
    },
    status: {
      type: "varchar",
    },
    errorMessage: {
      name: "error_message",
      type: "text",
      nullable: true,
    },
    attributionSource: {
      name: "attribution_source",
      type: "varchar",
    },
    rejectionReason: {
      name: "rejection_reason",
      type: "varchar",
      nullable: true,
    },
    occurredAt: {
      name: "occurred_at",
      type: "timestamptz",
    },
  },
});
