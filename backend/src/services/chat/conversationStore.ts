import { randomUUID } from "crypto";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../../db/applicationDataSource.js";
import type { ConversationChannel, ConversationTerminationReason } from "../../db/entities/ConversationEntity.js";
import type { TurnRole } from "../../db/entities/ConversationTurnEntity.js";

/**
 * Conversation store — Phase 5, task 5.8.
 *
 * Spec: design.md §4.11; C2.1, C2.2, C2.3, NFR6.2, NFR6.4.
 *
 * Persists every conversation turn, tool call, and conversation summary.
 * `appendToolCall` writes the audit row BEFORE the handler executes (NFR6.4).
 */

export interface ConversationRecord {
  id: string;
  userId: string;
  channel: ConversationChannel;
  startedAt: string;
  endedAt: string | null;
  turnCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  terminationReason: ConversationTerminationReason | null;
  toolCallCount: number;
  model: string | null;
}

export interface TurnRecord {
  conversationId: string;
  turnIndex: number;
  role: TurnRole;
  content: unknown;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  createdAt: string;
}

export interface AppendTurnInput {
  role: TurnRole;
  content: unknown;
  model?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  latencyMs?: number;
}

// ---------------------------------------------------------------------------
// Create / load
// ---------------------------------------------------------------------------

export async function createConversation(input: {
  userId: string;
  channel: ConversationChannel;
  model?: string | null;
}): Promise<ConversationRecord> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("createConversation requires the application database");
  }
  const ds = await getApplicationDataSource();
  const id = `conv_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const rows = await ds.query(
    `INSERT INTO conversations
       (id, user_id, channel, started_at, turn_count, total_tokens_in, total_tokens_out,
        total_cost_usd, tool_call_count, model)
     VALUES ($1, $2, $3, NOW(), 0, 0, 0, 0, 0, $4)
     RETURNING id, user_id, channel, started_at, ended_at, turn_count,
               total_tokens_in, total_tokens_out, total_cost_usd,
               termination_reason, tool_call_count, model`,
    [id, input.userId, input.channel, input.model ?? null]
  ) as Array<Record<string, unknown>>;
  return fromRow(rows[0]!);
}

export async function loadConversation(conversationId: string): Promise<ConversationRecord | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  const ds = await getApplicationDataSource();
  const rows = await ds.query(
    `SELECT id, user_id, channel, started_at, ended_at, turn_count,
            total_tokens_in, total_tokens_out, total_cost_usd,
            termination_reason, tool_call_count, model
       FROM conversations WHERE id = $1 LIMIT 1`,
    [conversationId]
  ) as Array<Record<string, unknown>>;
  return rows[0] ? fromRow(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Turn management
// ---------------------------------------------------------------------------

export async function appendTurn(
  conversationId: string,
  input: AppendTurnInput
): Promise<TurnRecord> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("appendTurn requires the application database");
  }
  const ds = await getApplicationDataSource();

  return ds.transaction(async (manager) => {
    // Increment turn_count and get the new index atomically
    const updated = await manager.query(
      `UPDATE conversations
          SET turn_count = turn_count + 1,
              total_tokens_in = total_tokens_in + $2,
              total_tokens_out = total_tokens_out + $3,
              total_cost_usd = total_cost_usd + $4
        WHERE id = $1
        RETURNING turn_count`,
      [
        conversationId,
        input.tokensIn ?? 0,
        input.tokensOut ?? 0,
        input.costUsd ?? 0,
      ]
    ) as Array<{ turn_count: number }>;
    const turnIndex = (updated[0]?.turn_count ?? 1) - 1;

    const rows = await manager.query(
      `INSERT INTO conversation_turns
         (conversation_id, turn_index, role, content, model,
          tokens_in, tokens_out, cost_usd, latency_ms, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, NOW())
       RETURNING conversation_id, turn_index, role, content, model,
                 tokens_in, tokens_out, cost_usd, latency_ms, created_at`,
      [
        conversationId,
        turnIndex,
        input.role,
        JSON.stringify(input.content),
        input.model ?? null,
        input.tokensIn ?? 0,
        input.tokensOut ?? 0,
        input.costUsd ?? 0,
        input.latencyMs ?? 0,
      ]
    ) as Array<Record<string, unknown>>;
    return fromTurnRow(rows[0]!);
  });
}

export async function loadHistory(
  conversationId: string,
  maxTurns = 50
): Promise<TurnRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const rows = await ds.query(
    `SELECT conversation_id, turn_index, role, content, model,
            tokens_in, tokens_out, cost_usd, latency_ms, created_at
       FROM conversation_turns
      WHERE conversation_id = $1
      ORDER BY turn_index ASC
      LIMIT $2`,
    [conversationId, maxTurns]
  ) as Array<Record<string, unknown>>;
  return rows.map(fromTurnRow);
}

// ---------------------------------------------------------------------------
// Finalization
// ---------------------------------------------------------------------------

export async function endConversation(
  conversationId: string,
  reason: ConversationTerminationReason,
  model?: string | null
): Promise<void> {
  if (!isApplicationDatabaseConfigured()) return;
  const ds = await getApplicationDataSource();
  await ds.query(
    `UPDATE conversations
        SET ended_at = NOW(),
            termination_reason = $2,
            model = COALESCE($3, model)
      WHERE id = $1`,
    [conversationId, reason, model ?? null]
  );
}

export async function incrementToolCallCount(conversationId: string): Promise<void> {
  if (!isApplicationDatabaseConfigured()) return;
  const ds = await getApplicationDataSource();
  await ds.query(
    `UPDATE conversations SET tool_call_count = tool_call_count + 1 WHERE id = $1`,
    [conversationId]
  );
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function fromRow(row: Record<string, unknown>): ConversationRecord {
  return {
    id: String(row["id"]),
    userId: String(row["user_id"]),
    channel: String(row["channel"]) as ConversationChannel,
    startedAt: toIso(row["started_at"]),
    endedAt: row["ended_at"] ? toIso(row["ended_at"]) : null,
    turnCount: Number(row["turn_count"] ?? 0),
    totalTokensIn: Number(row["total_tokens_in"] ?? 0),
    totalTokensOut: Number(row["total_tokens_out"] ?? 0),
    totalCostUsd: Number(row["total_cost_usd"] ?? 0),
    terminationReason: (row["termination_reason"] as ConversationTerminationReason | null) ?? null,
    toolCallCount: Number(row["tool_call_count"] ?? 0),
    model: row["model"] ? String(row["model"]) : null,
  };
}

function fromTurnRow(row: Record<string, unknown>): TurnRecord {
  return {
    conversationId: String(row["conversation_id"]),
    turnIndex: Number(row["turn_index"]),
    role: String(row["role"]) as TurnRole,
    content: row["content"],
    model: row["model"] ? String(row["model"]) : null,
    tokensIn: Number(row["tokens_in"] ?? 0),
    tokensOut: Number(row["tokens_out"] ?? 0),
    costUsd: Number(row["cost_usd"] ?? 0),
    latencyMs: Number(row["latency_ms"] ?? 0),
    createdAt: toIso(row["created_at"]),
  };
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date().toISOString();
}
