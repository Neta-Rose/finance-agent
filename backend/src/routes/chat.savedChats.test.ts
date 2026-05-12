import test from "node:test";
import assert from "node:assert/strict";

import chatRouter, { setChatRouteDepsForTest } from "./chat.js";
import { AgentChatConversationError } from "../services/chat/agentChat.js";
import { ConversationStoreError, type SavedConversationLoadResult, type TurnRecord } from "../services/chat/conversationStore.js";

const activeConversation: SavedConversationLoadResult = {
  id: "conv_active",
  userId: "user_a",
  channel: "dashboard",
  title: "Daily thesis",
  startedAt: "2026-05-10T12:00:00.000Z",
  updatedAt: "2026-05-10T12:01:00.000Z",
  lastActivityAt: "2026-05-10T12:01:00.000Z",
  archivedAt: null,
  expiresAt: "2026-05-17T12:00:00.000Z",
  endedAt: null,
  turnCount: 2,
  totalTokensIn: 10,
  totalTokensOut: 20,
  totalCostUsd: 0.001,
  terminationReason: "model_final",
  toolCallCount: 0,
  model: "test-model",
  accessState: "active",
  isArchived: false,
  isExpired: false,
};

const archivedConversation: SavedConversationLoadResult = {
  ...activeConversation,
  id: "conv_archived",
  archivedAt: "2026-05-11T00:00:00.000Z",
  accessState: "archived",
  isArchived: true,
};

const expiredConversation: SavedConversationLoadResult = {
  ...activeConversation,
  id: "conv_expired",
  expiresAt: "2026-05-10T11:59:59.000Z",
  accessState: "expired",
  isExpired: true,
};

const turns: TurnRecord[] = [
  {
    conversationId: "conv_active",
    turnIndex: 0,
    role: "user",
    content: "What changed?",
    model: null,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    latencyMs: 0,
    createdAt: "2026-05-10T12:00:30.000Z",
  },
  {
    conversationId: "conv_active",
    turnIndex: 1,
    role: "assistant",
    content: "A concise answer.",
    model: "test-model",
    tokensIn: 10,
    tokensOut: 20,
    costUsd: 0.001,
    latencyMs: 25,
    createdAt: "2026-05-10T12:01:00.000Z",
  },
];

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    databaseConfigured: () => true,
    agentChat: async () => ({
      conversationId: "conv_active",
      replyText: "ok",
      terminationReason: "model_final" as const,
      totalCostUsd: 0.001,
      turnCount: 2,
    }),
    createSavedConversation: async () => ({ ...activeConversation, id: "conv_new", title: null, turnCount: 0 }),
    listSavedDashboardConversations: async () => [activeConversation],
    loadConversationForUser: async (_input: { userId: string; conversationId: string }) => activeConversation,
    loadHistory: async () => turns,
    renameSavedConversation: async (input: { title: string }) => ({ ...activeConversation, title: input.title.trim() }),
    archiveSavedConversation: async () => ({
      ...activeConversation,
      archivedAt: "2026-05-11T00:00:00.000Z",
    }),
    ...overrides,
  };
}

async function invokeChatRouterJson(options: {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  query?: Record<string, unknown>;
  body?: unknown;
  userId?: string;
}): Promise<{ statusCode: number; body: unknown }> {
  return await new Promise((resolve, reject) => {
    const req = {
      method: options.method,
      url: options.url,
      originalUrl: options.url,
      headers: {},
      params: {},
      query: options.query ?? {},
      body: options.body,
    };
    const res = {
      locals: { userId: options.userId ?? "user_a" },
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        resolve({ statusCode: this.statusCode, body });
        return this;
      },
    };

    const chatRouterHandle = chatRouter as unknown as {
      handle: (req: object, res: object, next: (error?: unknown) => void) => void;
    };
    chatRouterHandle.handle(req, res, (error?: unknown) => {
      if (error) reject(error);
      else reject(new Error(`Route fell through without response for ${options.method} ${options.url}`));
    });
  });
}

test("saved-chat API lists conversations with bounded pagination and creates zero-turn saved chats", async () => {
  const calls: Array<{ limit?: number; offset?: number }> = [];
  setChatRouteDepsForTest(makeDeps({
    listSavedDashboardConversations: async (_userId: string, options: { limit?: number; offset?: number }) => {
      calls.push(options);
      return [];
    },
    createSavedConversation: async (input: { userId: string; title?: string | null }) => ({
      ...activeConversation,
      id: "conv_zero",
      title: input.title ?? null,
      turnCount: 0,
      totalCostUsd: 0,
    }),
  }));

  const emptyList = await invokeChatRouterJson({ method: "GET", url: "/chat/conversations", query: { limit: "10", offset: "5" } });
  assert.equal(emptyList.statusCode, 200);
  assert.deepEqual(emptyList.body, { items: [], limit: 10, offset: 5 });
  assert.deepEqual(calls[0], { limit: 10, offset: 5 });

  const created = await invokeChatRouterJson({ method: "POST", url: "/chat/conversations", body: { title: " Watchlist " } });
  assert.equal(created.statusCode, 201);
  assert.equal((created.body as { conversation: { id: string; title: string; turnCount: number } }).conversation.id, "conv_zero");
  assert.equal((created.body as { conversation: { title: string } }).conversation.title, " Watchlist ");
  assert.equal((created.body as { conversation: { turnCount: number } }).conversation.turnCount, 0);
});

test("saved-chat API rejects malformed pagination, IDs, and rename titles", async () => {
  setChatRouteDepsForTest(makeDeps());

  const badPagination = await invokeChatRouterJson({ method: "GET", url: "/chat/conversations", query: { limit: "0" } });
  assert.equal(badPagination.statusCode, 400);
  assert.equal((badPagination.body as { error?: string }).error, "invalid_pagination");

  const badId = await invokeChatRouterJson({ method: "GET", url: "/chat/conversations/bad%20id" });
  assert.equal(badId.statusCode, 400);
  assert.equal((badId.body as { error?: string }).error, "invalid_conversation_id");

  const blankRename = await invokeChatRouterJson({ method: "PATCH", url: "/chat/conversations/conv_active", body: { title: "   " } });
  assert.equal(blankRename.statusCode, 400);
  assert.equal((blankRename.body as { error?: string }).error, "invalid_title");

  const oversizedRename = await invokeChatRouterJson({ method: "PATCH", url: "/chat/conversations/conv_active", body: { title: "x".repeat(161) } });
  assert.equal(oversizedRename.statusCode, 400);
  assert.equal((oversizedRename.body as { error?: string }).error, "invalid_title");
});

test("GET /chat/conversations/:id returns owned active metadata and turn history", async () => {
  let loadedFor: { userId: string; conversationId: string } | null = null;
  setChatRouteDepsForTest(makeDeps({
    loadConversationForUser: async (input: { userId: string; conversationId: string }) => {
      loadedFor = input;
      return activeConversation;
    },
  }));

  const result = await invokeChatRouterJson({ method: "GET", url: "/chat/conversations/conv_active" });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(loadedFor, { userId: "user_a", conversationId: "conv_active" });
  const body = result.body as { conversation: SavedConversationLoadResult; turns: TurnRecord[] };
  assert.equal(body.conversation.title, "Daily thesis");
  assert.equal(body.turns.length, 2);
  assert.equal(body.turns[0]?.content, "What changed?");
});

test("saved-chat API refuses cross-user, archived, and expired conversation history access", async () => {
  setChatRouteDepsForTest(makeDeps({ loadConversationForUser: async () => null }));
  const missing = await invokeChatRouterJson({ method: "GET", url: "/chat/conversations/conv_other" });
  assert.equal(missing.statusCode, 404);
  assert.equal((missing.body as { error?: string }).error, "conversation_not_found");

  setChatRouteDepsForTest(makeDeps({ loadConversationForUser: async () => archivedConversation }));
  const archived = await invokeChatRouterJson({ method: "GET", url: "/chat/conversations/conv_archived" });
  assert.equal(archived.statusCode, 410);
  assert.equal((archived.body as { error?: string }).error, "conversation_archived");

  setChatRouteDepsForTest(makeDeps({ loadConversationForUser: async () => expiredConversation }));
  const expired = await invokeChatRouterJson({ method: "GET", url: "/chat/conversations/conv_expired" });
  assert.equal(expired.statusCode, 410);
  assert.equal((expired.body as { error?: string }).error, "conversation_expired");
});

test("saved-chat API renames and soft archives conversations with stable response shapes", async () => {
  setChatRouteDepsForTest(makeDeps());

  const renamed = await invokeChatRouterJson({ method: "PATCH", url: "/chat/conversations/conv_active", body: { title: "Renamed chat" } });
  assert.equal(renamed.statusCode, 200);
  assert.equal((renamed.body as { conversation: { title: string } }).conversation.title, "Renamed chat");

  const deleted = await invokeChatRouterJson({ method: "DELETE", url: "/chat/conversations/conv_active" });
  assert.equal(deleted.statusCode, 200);
  assert.equal((deleted.body as { conversation: { archivedAt: string | null } }).conversation.archivedAt, "2026-05-11T00:00:00.000Z");
});

test("POST /chat/messages maps cross-user archived and expired continuation refusals before appending", async () => {
  for (const [thrown, expectedStatus, expectedError] of [
    [new AgentChatConversationError("conversation_not_found", "conv_other"), 404, "conversation_not_found"],
    [new AgentChatConversationError("conversation_archived", "conv_archived"), 410, "conversation_archived"],
    [new AgentChatConversationError("conversation_expired", "conv_expired"), 410, "conversation_expired"],
  ] as const) {
    setChatRouteDepsForTest(makeDeps({
      agentChat: async () => {
        throw thrown;
      },
    }));

    const result = await invokeChatRouterJson({
      method: "POST",
      url: "/chat/messages",
      body: { text: "continue without leaking this message", conversationId: thrown.conversationId },
    });

    assert.equal(result.statusCode, expectedStatus);
    assert.equal((result.body as { error?: string }).error, expectedError);
    assert.equal(JSON.stringify(result.body).includes("continue without leaking"), false);
  }
});

test("POST /chat/messages returns a clear budget error without selecting a fake conversation", async () => {
  setChatRouteDepsForTest(makeDeps({
    agentChat: async () => ({
      conversationId: "conv_budget_123",
      replyText: "Your daily budget is exhausted. Try again after the budget window resets.",
      terminationReason: "points_budget_exhausted" as const,
      totalCostUsd: 0,
      turnCount: 0,
    }),
  }));

  const result = await invokeChatRouterJson({
    method: "POST",
    url: "/chat/messages",
    body: { text: "will this spend?" },
  });

  assert.equal(result.statusCode, 402);
  assert.deepEqual(result.body, {
    error: "points_budget_exhausted",
    message: "Your daily budget is exhausted. Try again after the budget window resets.",
    conversationId: null,
  });
});

test("saved-chat API maps database unavailable and store failures without leaking internals", async () => {
  setChatRouteDepsForTest(makeDeps({ databaseConfigured: () => false }));
  const unavailable = await invokeChatRouterJson({ method: "GET", url: "/chat/conversations" });
  assert.equal(unavailable.statusCode, 503);
  assert.equal((unavailable.body as { error?: string }).error, "database_unavailable");

  setChatRouteDepsForTest(makeDeps({
    renameSavedConversation: async () => {
      throw new ConversationStoreError("CONVERSATION_NOT_FOUND", "wrong user or missing");
    },
  }));
  const missingRename = await invokeChatRouterJson({ method: "PATCH", url: "/chat/conversations/conv_other", body: { title: "Nope" } });
  assert.equal(missingRename.statusCode, 404);
  assert.equal((missingRename.body as { error?: string }).error, "conversation_not_found");

  setChatRouteDepsForTest(makeDeps({
    listSavedDashboardConversations: async () => {
      throw new ConversationStoreError("DATABASE_ERROR", "SELECT * FROM secret_table failed");
    },
  }));
  const dbError = await invokeChatRouterJson({ method: "GET", url: "/chat/conversations" });
  assert.equal(dbError.statusCode, 500);
  assert.deepEqual(dbError.body, { error: "chat_store_error", message: "Chat store failed." });
});
