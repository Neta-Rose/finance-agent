import test from "node:test";
import assert from "node:assert/strict";

import {
  ConversationStoreError,
  archiveSavedConversation,
  createSavedConversation,
  conversationStoreInternals,
  listSavedDashboardConversations,
  loadConversationForUser,
  renameSavedConversation,
  type ConversationStoreDeps,
} from "./conversationStore.js";

interface QueryCall {
  sql: string;
  params: unknown[];
}

function makeDeps(rowsByCall: unknown[][], featureValues: unknown[] = []): ConversationStoreDeps & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  return {
    calls,
    databaseConfigured: () => true,
    now: () => new Date("2026-05-10T12:00:00.000Z"),
    idFactory: () => "conv_test",
    featureValueProvider: async <T>() => featureValues.shift() as T | undefined,
    dataSourceProvider: async () => ({
      async query<T = unknown>(sql: string, params: unknown[]): Promise<T> {
        calls.push({ sql, params });
        return (rowsByCall.shift() ?? []) as T;
      },
      async transaction<T>(run: (manager: { query<TQuery = unknown>(sql: string, params: unknown[]): Promise<TQuery> }) => Promise<T>): Promise<T> {
        return run({
          async query<TQuery = unknown>(sql: string, params: unknown[]): Promise<TQuery> {
            calls.push({ sql, params });
            return (rowsByCall.shift() ?? []) as TQuery;
          },
        });
      },
    }),
  };
}

const baseRow = {
  id: "conv_a",
  user_id: "user_a",
  channel: "dashboard",
  title: "Daily thesis",
  started_at: new Date("2026-05-10T12:00:00.000Z"),
  updated_at: new Date("2026-05-10T12:00:00.000Z"),
  archived_at: null,
  expires_at: new Date("2026-05-17T12:00:00.000Z"),
  ended_at: null,
  turn_count: 0,
  total_tokens_in: 0,
  total_tokens_out: 0,
  total_cost_usd: "0",
  termination_reason: null,
  tool_call_count: 0,
  model: "test-model",
};

test("createSavedConversation applies the default 7 day TTL when no override is configured", async () => {
  const deps = makeDeps([[baseRow]], [undefined]);

  const created = await createSavedConversation({ userId: "user_a", title: " Daily thesis ", model: "test-model" }, deps);

  assert.equal(created.id, "conv_a");
  assert.equal(created.title, "Daily thesis");
  assert.equal(created.expiresAt, "2026-05-17T12:00:00.000Z");
  assert.match(deps.calls[0]!.sql, /INSERT INTO conversations/);
  assert.deepEqual(deps.calls[0]!.params.slice(0, 6), [
    "conv_test",
    "user_a",
    "dashboard",
    "test-model",
    "Daily thesis",
    new Date("2026-05-17T12:00:00.000Z"),
  ]);
});

test("createSavedConversation honors positive TTL overrides and coerces invalid or low values back to seven days", async () => {
  const valid = makeDeps([[{ ...baseRow, id: "conv_valid", expires_at: new Date("2026-05-13T12:00:00.000Z") }]], [3]);
  const validCreated = await createSavedConversation({ userId: "user_a" }, valid);
  assert.equal(validCreated.expiresAt, "2026-05-13T12:00:00.000Z");
  assert.deepEqual(valid.calls[0]!.params.slice(4, 6), [null, new Date("2026-05-13T12:00:00.000Z")]);

  for (const invalidValue of [0, -1, "abc", Number.NaN]) {
    const deps = makeDeps([[baseRow]], [invalidValue]);
    await createSavedConversation({ userId: "user_a" }, deps);
    assert.deepEqual(deps.calls[0]!.params.slice(4, 6), [null, new Date("2026-05-17T12:00:00.000Z")]);
  }
});

test("listSavedDashboardConversations returns only dashboard conversations scoped to the requested user and excludes archived rows in SQL", async () => {
  const deps = makeDeps([[baseRow]]);

  const list = await listSavedDashboardConversations("user_a", deps);

  assert.equal(list.length, 1);
  assert.equal(list[0]!.userId, "user_a");
  assert.equal(list[0]!.turnCount, 0);
  assert.match(deps.calls[0]!.sql, /WHERE user_id = \$1/);
  assert.match(deps.calls[0]!.sql, /channel = 'dashboard'/);
  assert.match(deps.calls[0]!.sql, /archived_at IS NULL/);
  assert.match(deps.calls[0]!.sql, /ORDER BY updated_at DESC, started_at DESC/);
  assert.match(deps.calls[0]!.sql, /LIMIT \$2 OFFSET \$3/);
  assert.deepEqual(deps.calls[0]!.params, ["user_a", 50, 0]);
});

test("loadConversationForUser reports active archived expired and missing conversation states without leaking other users", async () => {
  const activeDeps = makeDeps([[baseRow]]);
  const active = await loadConversationForUser({ userId: "user_a", conversationId: "conv_a" }, activeDeps);
  assert.equal(active?.accessState, "active");
  assert.equal(active?.isExpired, false);
  assert.deepEqual(activeDeps.calls[0]!.params, ["conv_a", "user_a"]);

  const archivedDeps = makeDeps([[{ ...baseRow, archived_at: new Date("2026-05-11T00:00:00.000Z") }]]);
  const archived = await loadConversationForUser({ userId: "user_a", conversationId: "conv_a" }, archivedDeps);
  assert.equal(archived?.accessState, "archived");

  const expiredDeps = makeDeps([[{ ...baseRow, expires_at: new Date("2026-05-09T00:00:00.000Z") }]]);
  const expired = await loadConversationForUser({ userId: "user_a", conversationId: "conv_a" }, expiredDeps);
  assert.equal(expired?.accessState, "expired");

  const missingDeps = makeDeps([[]]);
  assert.equal(await loadConversationForUser({ userId: "user_b", conversationId: "conv_a" }, missingDeps), null);
});

test("renameSavedConversation validates titles and updates only a matching active conversation owned by the user", async () => {
  const deps = makeDeps([[{ ...baseRow, title: "Renamed" }]]);

  const renamed = await renameSavedConversation({ userId: "user_a", conversationId: "conv_a", title: " Renamed " }, deps);

  assert.equal(renamed.title, "Renamed");
  assert.match(deps.calls[0]!.sql, /UPDATE conversations/);
  assert.match(deps.calls[0]!.sql, /WHERE id = \$2 AND user_id = \$3/);
  assert.match(deps.calls[0]!.sql, /archived_at IS NULL/);
  assert.deepEqual(deps.calls[0]!.params, ["Renamed", "conv_a", "user_a"]);

  for (const title of ["", "   ", "x".repeat(conversationStoreInternals.MAX_SAVED_CHAT_TITLE_LENGTH + 1)]) {
    await assert.rejects(
      () => renameSavedConversation({ userId: "user_a", conversationId: "conv_a", title }, makeDeps([])),
      (error: unknown) => error instanceof ConversationStoreError && error.code === "INVALID_TITLE"
    );
  }
});

test("rename and archive fail closed for missing or wrong-user conversations", async () => {
  await assert.rejects(
    () => renameSavedConversation({ userId: "user_b", conversationId: "conv_a", title: "Nope" }, makeDeps([[]])),
    (error: unknown) => error instanceof ConversationStoreError && error.code === "CONVERSATION_NOT_FOUND"
  );

  await assert.rejects(
    () => archiveSavedConversation({ userId: "user_b", conversationId: "conv_a" }, makeDeps([[]])),
    (error: unknown) => error instanceof ConversationStoreError && error.code === "CONVERSATION_NOT_FOUND"
  );
});

test("archiveSavedConversation performs a soft archive scoped by id and user", async () => {
  const archivedAt = new Date("2026-05-10T12:00:00.000Z");
  const deps = makeDeps([[{ ...baseRow, archived_at: archivedAt }]]);

  const archived = await archiveSavedConversation({ userId: "user_a", conversationId: "conv_a" }, deps);

  assert.equal(archived.archivedAt, "2026-05-10T12:00:00.000Z");
  assert.match(deps.calls[0]!.sql, /SET archived_at =/);
  assert.match(deps.calls[0]!.sql, /WHERE id = \$1 AND user_id = \$2/);
  assert.deepEqual(deps.calls[0]!.params, ["conv_a", "user_a"]);
});

test("saved-chat store exposes database-unavailable and malformed-row failures as typed errors", async () => {
  await assert.rejects(
    () => createSavedConversation({ userId: "user_a" }, { ...makeDeps([]), databaseConfigured: () => false }),
    (error: unknown) => error instanceof ConversationStoreError && error.code === "DATABASE_UNAVAILABLE"
  );

  await assert.rejects(
    () => listSavedDashboardConversations("user_a", makeDeps([[{ ...baseRow, id: "" }]])),
    (error: unknown) => error instanceof ConversationStoreError && error.code === "MALFORMED_ROW"
  );
});
