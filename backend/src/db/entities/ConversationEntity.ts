import { EntitySchema } from "typeorm";

export type ConversationChannel = "dashboard" | "telegram" | "whatsapp";
export type ConversationTerminationReason =
  | "model_final"
  | "max_turns"
  | "token_cap"
  | "points_budget_exhausted"
  | "user_cancelled"
  | "error";

export interface ConversationEntity {
  id: string;
  userId: string;
  channel: ConversationChannel;
  startedAt: Date;
  endedAt: Date | null;
  turnCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: string;
  terminationReason: ConversationTerminationReason | null;
  toolCallCount: number;
  model: string | null;
}

export const ConversationEntitySchema = new EntitySchema<ConversationEntity>({
  name: "Conversation",
  tableName: "conversations",
  columns: {
    id: { type: "varchar", length: 64, primary: true },
    userId: { name: "user_id", type: "varchar", length: 64 },
    channel: { type: "varchar", length: 16 },
    startedAt: { name: "started_at", type: "timestamptz" },
    endedAt: { name: "ended_at", type: "timestamptz", nullable: true },
    turnCount: { name: "turn_count", type: "integer", default: 0 },
    totalTokensIn: { name: "total_tokens_in", type: "integer", default: 0 },
    totalTokensOut: { name: "total_tokens_out", type: "integer", default: 0 },
    totalCostUsd: { name: "total_cost_usd", type: "numeric", precision: 14, scale: 6 },
    terminationReason: { name: "termination_reason", type: "varchar", length: 32, nullable: true },
    toolCallCount: { name: "tool_call_count", type: "integer", default: 0 },
    model: { type: "varchar", length: 255, nullable: true },
  },
});
