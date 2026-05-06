import { EntitySchema } from "typeorm";

export type FilterSiteOfMatch = "tool_result" | "final_reply";

export interface OutputFilterEventEntity {
  id: string;
  conversationId: string;
  turnIndex: number;
  pattern: string;
  siteOfMatch: FilterSiteOfMatch;
  originalLengthChars: number;
  occurredAt: Date;
}

export const OutputFilterEventEntitySchema = new EntitySchema<OutputFilterEventEntity>({
  name: "OutputFilterEvent",
  tableName: "output_filter_events",
  columns: {
    id: { type: "bigint", primary: true, generated: true },
    conversationId: { name: "conversation_id", type: "varchar", length: 64 },
    turnIndex: { name: "turn_index", type: "integer" },
    pattern: { type: "varchar", length: 128 },
    siteOfMatch: { name: "site_of_match", type: "varchar", length: 16 },
    originalLengthChars: { name: "original_length_chars", type: "integer" },
    occurredAt: { name: "occurred_at", type: "timestamptz" },
  },
});
