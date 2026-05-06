import { EntitySchema } from "typeorm";

export type ToolCallCategory = "read" | "action";
export type ToolCallResultStatus = "success" | "error" | "rejected";

export interface ToolCallEntity {
  id: string;
  conversationId: string;
  turnIndex: number;
  toolName: string;
  category: ToolCallCategory;
  argsJson: Record<string, unknown>;
  resultStatus: ToolCallResultStatus;
  resultLatencyMs: number;
  costPoints: string;
  auditNote: string | null;
  occurredAt: Date;
}

export const ToolCallEntitySchema = new EntitySchema<ToolCallEntity>({
  name: "ToolCall",
  tableName: "tool_calls",
  columns: {
    id: { type: "uuid", primary: true },
    conversationId: { name: "conversation_id", type: "varchar", length: 64 },
    turnIndex: { name: "turn_index", type: "integer" },
    toolName: { name: "tool_name", type: "varchar", length: 64 },
    category: { type: "varchar", length: 16 },
    argsJson: { name: "args_json", type: "jsonb" },
    resultStatus: { name: "result_status", type: "varchar", length: 16 },
    resultLatencyMs: { name: "result_latency_ms", type: "integer", default: 0 },
    costPoints: { name: "cost_points", type: "numeric", precision: 18, scale: 6 },
    auditNote: { name: "audit_note", type: "text", nullable: true },
    occurredAt: { name: "occurred_at", type: "timestamptz" },
  },
});
