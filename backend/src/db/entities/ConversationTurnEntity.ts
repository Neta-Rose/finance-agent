import { EntitySchema } from "typeorm";

export type TurnRole = "user" | "assistant" | "tool_result" | "system";

export interface ConversationTurnEntity {
  conversationId: string;
  turnIndex: number;
  role: TurnRole;
  content: unknown;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
  latencyMs: number;
  createdAt: Date;
}

export const ConversationTurnEntitySchema = new EntitySchema<ConversationTurnEntity>({
  name: "ConversationTurn",
  tableName: "conversation_turns",
  columns: {
    conversationId: { name: "conversation_id", type: "varchar", length: 64, primary: true },
    turnIndex: { name: "turn_index", type: "integer", primary: true },
    role: { type: "varchar", length: 16 },
    content: { type: "jsonb" },
    model: { type: "varchar", length: 255, nullable: true },
    tokensIn: { name: "tokens_in", type: "integer", default: 0 },
    tokensOut: { name: "tokens_out", type: "integer", default: 0 },
    costUsd: { name: "cost_usd", type: "numeric", precision: 14, scale: 6 },
    latencyMs: { name: "latency_ms", type: "integer", default: 0 },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
});
