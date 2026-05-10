import { randomUUID } from "crypto";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../../db/applicationDataSource.js";
import type { ConversationChannel, ConversationTerminationReason } from "../../db/entities/ConversationEntity.js";
import type { TurnRole } from "../../db/entities/ConversationTurnEntity.js";
import { getFeatureValue } from "../featureFlagService.js";
import { unwrapMutationRows } from "../dbUtils.js";

/**
 * Conversation store — Phase 5, task 5.8; saved-chat lifecycle extended in M001/S04.
 *
 * Spec: design.md §4.11; C2.1, C2.2, C2.3, NFR6.2, NFR6.4.
 *
 * Persists every conversation turn, tool call, and conversation summary.
 * `appendToolCall` writes the audit row BEFORE the handler executes (NFR6.4).
 */

const DEFAULT_SAVED_CHAT_TTL_DAYS = 7;
const MAX_SAVED_CHAT_TITLE_LENGTH = 160;

type ConversationStoreErrorCode =
  | "DATABASE_UNAVAILABLE"
  | "DATABASE_ERROR"
  | "INVALID_TITLE"
  | "INVALID_CONVERSATION_ID"
  | "CONVERSATION_NOT_FOUND"
  | "MALFORMED_ROW";

export class ConversationStoreError extends Error {
  constructor(readonly code: ConversationStoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(`conversation_store_${code}: ${message}`, options);
    this.name = "ConversationStoreError";
  }
}

interface QueryRunnerLike {
  query<T = unknown>(sql: string, params: unknown[]): Promise<T>;
}

interface DataSourceLike extends QueryRunnerLike {
  transaction<T>(run: (manager: QueryRunnerLike) => Promise<T>): Promise<T>;
}

export interface ConversationStoreDeps {
  databaseConfigured: () => boolean;
  dataSourceProvider: () => Promise<DataSourceLike>;
  featureValueProvider: <T>(name: string, userId?: string) => Promise<T | undefined>;
  now: () => Date;
  idFactory: () => string;
}

const defaultDeps: ConversationStoreDeps = {
  databaseConfigured: isApplicationDatabaseConfigured,
  dataSourceProvider: async () => getApplicationDataSource() as unknown as DataSourceLike,
  featureValueProvider: getFeatureValue,
  now: () => new Date(),
  idFactory: () => `conv_${Date.now()}_${randomUUID().slice(0, 8)}`,
};

export interface ConversationRecord {
  id: string;
  userId: string;
  channel: ConversationChannel;
  title: string | null;
  startedAt: string;
  updatedAt: string;
  lastActivityAt: string;
  archivedAt: string | null;
  expiresAt: string | null;
  endedAt: string | null;
  turnCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  terminationReason: ConversationTerminationReason | null;
  toolCallCount: number;
  model: string | null;
}

export type SavedConversationMetadata = ConversationRecord;
export type SavedConversationAccessState = "active" | "archived" | "expired";

export interface SavedConversationLoadResult extends SavedConversationMetadata {
  accessState: SavedConversationAccessState;
  isArchived: boolean;
  isExpired: boolean;
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
// Saved-chat lifecycle
// ---------------------------------------------------------------------------

export async function createSavedConversation(
  input: {
    userId: string;
    title?: string | null;
    model?: string | null;
    ttlDays?: number;
  },
  deps: ConversationStoreDeps = defaultDeps
): Promise<SavedConversationMetadata> {
  return withStoreErrors("createSavedConversation", async () => {
    const ds = await requireDataSource(deps);
    const ttlDays = input.ttlDays ?? coerceTtlDays(
      await deps.featureValueProvider<unknown>("chat_conversation_ttl_days", input.userId)
    );
    const expiresAt = addDays(deps.now(), coerceTtlDays(ttlDays));
    const title = normalizeOptionalTitle(input.title);
    const rows = await ds.query(
      `INSERT INTO conversations
         (id, user_id, channel, started_at, updated_at, turn_count, total_tokens_in, total_tokens_out,
          total_cost_usd, tool_call_count, model, title, expires_at)
       VALUES ($1, $2, $3, NOW(), NOW(), 0, 0, 0, 0, 0, $4, $5, $6)
       RETURNING ${conversationSelectColumns()}`,
      [deps.idFactory(), input.userId, "dashboard", input.model ?? null, title, expiresAt]
    ) as Array<Record<string, unknown>>;
    return fromSavedConversationRow(rows[0]);
  });
}

export async function listSavedDashboardConversations(
  userId: string,
  deps: ConversationStoreDeps = defaultDeps
): Promise<SavedConversationMetadata[]> {
  return withStoreErrors("listSavedDashboardConversations", async () => {
    const ds = await requireDataSource(deps);
    const rows = await ds.query(
      `SELECT ${conversationSelectColumns()}
         FROM conversations
        WHERE user_id = $1
          AND channel = 'dashboard'
          AND archived_at IS NULL
        ORDER BY updated_at DESC, started_at DESC`,
      [userId]
    ) as Array<Record<string, unknown>>;
    return rows.map(fromSavedConversationRow);
  });
}

export async function loadConversationForUser(
  input: { userId: string; conversationId: string },
  deps: ConversationStoreDeps = defaultDeps
): Promise<SavedConversationLoadResult | null> {
  return withStoreErrors("loadConversationForUser", async () => {
    const conversationId = normalizeConversationId(input.conversationId);
    const ds = await requireDataSource(deps);
    const rows = await ds.query(
      `SELECT ${conversationSelectColumns()}
         FROM conversations
        WHERE id = $1 AND user_id = $2
        LIMIT 1`,
      [conversationId, input.userId]
    ) as Array<Record<string, unknown>>;
    if (!rows[0]) return null;
    return withAccessState(fromSavedConversationRow(rows[0]), deps.now());
  });
}

export async function renameSavedConversation(
  input: { userId: string; conversationId: string; title: string },
  deps: ConversationStoreDeps = defaultDeps
): Promise<SavedConversationMetadata> {
  return withStoreErrors("renameSavedConversation", async () => {
    const title = normalizeRequiredTitle(input.title);
    const conversationId = normalizeConversationId(input.conversationId);
    const ds = await requireDataSource(deps);
    const rawRows = await ds.query(
      `UPDATE conversations
          SET title = $1,
              updated_at = NOW()
        WHERE id = $2 AND user_id = $3
          AND channel = 'dashboard'
          AND archived_at IS NULL
       RETURNING ${conversationSelectColumns()}`,
      [title, conversationId, input.userId]
    );
    const rows = unwrapMutationRows<Record<string, unknown>>(rawRows);
    if (rows.length === 0) {
      throw new ConversationStoreError("CONVERSATION_NOT_FOUND", "conversation was not found for user");
    }
    return fromSavedConversationRow(rows[0]);
  });
}

export async function archiveSavedConversation(
  input: { userId: string; conversationId: string },
  deps: ConversationStoreDeps = defaultDeps
): Promise<SavedConversationMetadata> {
  return withStoreErrors("archiveSavedConversation", async () => {
    const conversationId = normalizeConversationId(input.conversationId);
    const ds = await requireDataSource(deps);
    const rawRows = await ds.query(
      `UPDATE conversations
          SET archived_at = COALESCE(archived_at, NOW()),
              updated_at = NOW()
        WHERE id = $1 AND user_id = $2
          AND channel = 'dashboard'
       RETURNING ${conversationSelectColumns()}`,
      [conversationId, input.userId]
    );
    const rows = unwrapMutationRows<Record<string, unknown>>(rawRows);
    if (rows.length === 0) {
      throw new ConversationStoreError("CONVERSATION_NOT_FOUND", "conversation was not found for user");
    }
    return fromSavedConversationRow(rows[0]);
  });
}

// ---------------------------------------------------------------------------
// Create / load
// ---------------------------------------------------------------------------

export async function createConversation(input: {
  userId: string;
  channel: ConversationChannel;
  model?: string | null;
  title?: string | null;
  expiresAt?: Date | null;
}): Promise<ConversationRecord> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("createConversation requires the application database");
  }
  const ds = await getApplicationDataSource();
  const id = `conv_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const rows = await ds.query(
    `INSERT INTO conversations
       (id, user_id, channel, started_at, updated_at, turn_count, total_tokens_in, total_tokens_out,
        total_cost_usd, tool_call_count, model, title, expires_at)
     VALUES ($1, $2, $3, NOW(), NOW(), 0, 0, 0, 0, 0, $4, $5, $6)
     RETURNING ${conversationSelectColumns()}`,
    [id, input.userId, input.channel, input.model ?? null, normalizeOptionalTitle(input.title), input.expiresAt ?? null]
  ) as Array<Record<string, unknown>>;
  return fromRow(rows[0]!);
}

export async function loadConversation(conversationId: string): Promise<ConversationRecord | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  const ds = await getApplicationDataSource();
  const rows = await ds.query(
    `SELECT ${conversationSelectColumns()}
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
    // Increment turn_count and get the new index atomically.
    // unwrapMutationRows handles TypeORM's [rows, rowCount] UPDATE RETURNING shape.
    const rawUpdated = await manager.query(
      `UPDATE conversations
          SET turn_count = turn_count + 1,
              total_tokens_in = total_tokens_in + $2,
              total_tokens_out = total_tokens_out + $3,
              total_cost_usd = total_cost_usd + $4,
              updated_at = NOW()
        WHERE id = $1
        RETURNING turn_count`,
      [
        conversationId,
        input.tokensIn ?? 0,
        input.tokensOut ?? 0,
        input.costUsd ?? 0,
      ]
    );
    const updatedRows = unwrapMutationRows<{ turn_count: number }>(rawUpdated);
    if (updatedRows.length === 0) {
      throw new Error(`conversation_not_found: ${conversationId}`);
    }
    const turnIndex = updatedRows[0]!.turn_count - 1;

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
            updated_at = NOW(),
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
    `UPDATE conversations SET tool_call_count = tool_call_count + 1, updated_at = NOW() WHERE id = $1`,
    [conversationId]
  );
}

// ---------------------------------------------------------------------------
// Row mappers / helpers
// ---------------------------------------------------------------------------

function conversationSelectColumns(): string {
  return `id, user_id, channel, title, started_at, updated_at, archived_at, expires_at,
          ended_at, turn_count, total_tokens_in, total_tokens_out, total_cost_usd,
          termination_reason, tool_call_count, model`;
}

function normalizeRequiredTitle(title: string): string {
  const normalized = title.trim();
  if (normalized.length === 0) {
    throw new ConversationStoreError("INVALID_TITLE", "saved chat title cannot be blank");
  }
  if (normalized.length > MAX_SAVED_CHAT_TITLE_LENGTH) {
    throw new ConversationStoreError(
      "INVALID_TITLE",
      `saved chat title cannot exceed ${MAX_SAVED_CHAT_TITLE_LENGTH} characters`
    );
  }
  return normalized;
}

function normalizeOptionalTitle(title: string | null | undefined): string | null {
  if (title === null || title === undefined) return null;
  const normalized = title.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > MAX_SAVED_CHAT_TITLE_LENGTH) {
    throw new ConversationStoreError(
      "INVALID_TITLE",
      `saved chat title cannot exceed ${MAX_SAVED_CHAT_TITLE_LENGTH} characters`
    );
  }
  return normalized;
}

function normalizeConversationId(conversationId: string): string {
  const normalized = conversationId.trim();
  if (normalized.length === 0 || normalized.length > 64) {
    throw new ConversationStoreError("INVALID_CONVERSATION_ID", "conversation id is invalid");
  }
  return normalized;
}

function coerceTtlDays(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return DEFAULT_SAVED_CHAT_TTL_DAYS;
  return Math.floor(numeric);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

async function requireDataSource(deps: ConversationStoreDeps): Promise<DataSourceLike> {
  if (!deps.databaseConfigured()) {
    throw new ConversationStoreError("DATABASE_UNAVAILABLE", "application database is not configured");
  }
  return deps.dataSourceProvider();
}

async function withStoreErrors<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ConversationStoreError) throw error;
    throw new ConversationStoreError("DATABASE_ERROR", `${operation} failed`, { cause: error });
  }
}

function fromRow(row: Record<string, unknown>): ConversationRecord {
  return fromSavedConversationRow(row);
}

function fromSavedConversationRow(row: Record<string, unknown> | undefined): SavedConversationMetadata {
  if (!row) {
    throw new ConversationStoreError("MALFORMED_ROW", "conversation row is missing");
  }
  const id = requiredString(row, "id");
  const userId = requiredString(row, "user_id");
  const title = optionalString(row, "title");
  const startedAt = requiredIso(row, "started_at");
  const updatedAt = requiredIso(row, "updated_at");
  return {
    id,
    userId,
    channel: requiredString(row, "channel") as ConversationChannel,
    title,
    startedAt,
    updatedAt,
    lastActivityAt: updatedAt,
    archivedAt: optionalIso(row, "archived_at"),
    expiresAt: optionalIso(row, "expires_at"),
    endedAt: optionalIso(row, "ended_at"),
    turnCount: safeNonNegativeInteger(row["turn_count"]),
    totalTokensIn: safeNonNegativeInteger(row["total_tokens_in"]),
    totalTokensOut: safeNonNegativeInteger(row["total_tokens_out"]),
    totalCostUsd: safeNonNegativeNumber(row["total_cost_usd"]),
    terminationReason: optionalString(row, "termination_reason") as ConversationTerminationReason | null,
    toolCallCount: safeNonNegativeInteger(row["tool_call_count"]),
    model: optionalString(row, "model"),
  };
}

function withAccessState(row: SavedConversationMetadata, now: Date): SavedConversationLoadResult {
  const isArchived = row.archivedAt !== null;
  const isExpired = row.expiresAt !== null && new Date(row.expiresAt).getTime() <= now.getTime();
  const accessState: SavedConversationAccessState = isArchived ? "archived" : isExpired ? "expired" : "active";
  return {
    ...row,
    accessState,
    isArchived,
    isExpired,
  };
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConversationStoreError("MALFORMED_ROW", `conversation row field ${field} is invalid`);
  }
  return value;
}

function optionalString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new ConversationStoreError("MALFORMED_ROW", `conversation row field ${field} is invalid`);
  }
  return value;
}

function requiredIso(row: Record<string, unknown>, field: string): string {
  const iso = optionalIso(row, field);
  if (!iso) {
    throw new ConversationStoreError("MALFORMED_ROW", `conversation row field ${field} is invalid`);
  }
  return iso;
}

function optionalIso(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new ConversationStoreError("MALFORMED_ROW", `conversation row field ${field} is invalid`);
  }
  return date.toISOString();
}

function safeNonNegativeInteger(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
}

function safeNonNegativeNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return numeric;
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

export const conversationStoreInternals = {
  DEFAULT_SAVED_CHAT_TTL_DAYS,
  MAX_SAVED_CHAT_TITLE_LENGTH,
  coerceTtlDays,
};
