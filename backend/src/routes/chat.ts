import { Router } from "express";
import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { agentChat, AgentChatConversationError } from "../services/chat/agentChat.js";
import {
  ConversationStoreError,
  archiveSavedConversation,
  createSavedConversation,
  listSavedDashboardConversations,
  loadConversationForUser,
  loadHistory,
  renameSavedConversation,
} from "../services/chat/conversationStore.js";
import { isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { logger } from "../services/logger.js";
import { z } from "zod";

/**
 * Dashboard chat routes.
 *
 * POST   /api/chat/messages — send a message, get a reply.
 * GET    /api/chat/conversations — list saved dashboard conversations.
 * POST   /api/chat/conversations — create a zero-turn saved dashboard conversation.
 * GET    /api/chat/conversations/:id — read saved conversation metadata + history.
 * PATCH  /api/chat/conversations/:id — rename a saved conversation.
 * DELETE /api/chat/conversations/:id — soft archive a saved conversation.
 *
 * Auth: existing JWT header. No route logs include message or reply content.
 */

const router = Router();

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const MAX_TITLE_LENGTH = 160;

interface ChatRouteDeps {
  databaseConfigured: () => boolean;
  agentChat: typeof agentChat;
  createSavedConversation: typeof createSavedConversation;
  listSavedDashboardConversations: typeof listSavedDashboardConversations;
  loadConversationForUser: typeof loadConversationForUser;
  loadHistory: typeof loadHistory;
  renameSavedConversation: typeof renameSavedConversation;
  archiveSavedConversation: typeof archiveSavedConversation;
}

const defaultChatRouteDeps: ChatRouteDeps = {
  databaseConfigured: isApplicationDatabaseConfigured,
  agentChat,
  createSavedConversation,
  listSavedDashboardConversations,
  loadConversationForUser,
  loadHistory,
  renameSavedConversation,
  archiveSavedConversation,
};

let chatRouteDeps: ChatRouteDeps = defaultChatRouteDeps;

export function setChatRouteDepsForTest(deps: ChatRouteDeps | null): void {
  chatRouteDeps = deps ?? defaultChatRouteDeps;
}

type AsyncHandler = (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;
function handler(fn: AsyncHandler) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const ConversationIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const ChatMessageBodySchema = z.object({
  text: z.string().min(1).max(4000),
  conversationId: ConversationIdSchema.optional(),
}).strict();
const ConversationParamsSchema = z.object({ id: ConversationIdSchema });
const ConversationCreateBodySchema = z.object({
  title: z.string().max(MAX_TITLE_LENGTH).nullable().optional(),
}).strict();
const ConversationRenameBodySchema = z.object({
  title: z.string()
    .max(MAX_TITLE_LENGTH)
    .refine((value) => value.trim().length > 0, "title cannot be blank"),
}).strict();
const ConversationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

function bounded(value: string | undefined): string {
  return (value ?? "unknown").slice(0, 64);
}

function logLifecycleFailure(event: string, userId: string, code: string, conversationId?: string): void {
  logger.warn(
    `chat conversation lifecycle failure event=${event} user=${bounded(userId)} conv=${bounded(conversationId)} code=${code}`
  );
}

function storeErrorToResponse(error: ConversationStoreError): { status: number; error: string; message: string } {
  switch (error.code) {
    case "DATABASE_UNAVAILABLE":
      return { status: 503, error: "database_unavailable", message: "Chat database is unavailable." };
    case "INVALID_CONVERSATION_ID":
      return { status: 400, error: "invalid_conversation_id", message: "Conversation ID is invalid." };
    case "INVALID_TITLE":
      return { status: 400, error: "invalid_title", message: "Conversation title is invalid." };
    case "CONVERSATION_NOT_FOUND":
      return { status: 404, error: "conversation_not_found", message: "Conversation was not found." };
    case "DATABASE_ERROR":
    case "MALFORMED_ROW":
      return { status: 500, error: "chat_store_error", message: "Chat store failed." };
  }
}

function agentConversationErrorToResponse(error: AgentChatConversationError): { status: number; error: string; message: string } {
  switch (error.code) {
    case "conversation_not_found":
      return { status: 404, error: "conversation_not_found", message: "Conversation was not found." };
    case "conversation_archived":
      return { status: 410, error: "conversation_archived", message: "Conversation is archived." };
    case "conversation_expired":
      return { status: 410, error: "conversation_expired", message: "Conversation has expired." };
  }
}

function sendLifecycleError(res: Response, event: string, userId: string, error: unknown, conversationId?: string): boolean {
  if (error instanceof ConversationStoreError) {
    const mapped = storeErrorToResponse(error);
    logLifecycleFailure(event, userId, mapped.error, conversationId);
    res.status(mapped.status).json({ error: mapped.error, message: mapped.message });
    return true;
  }
  if (error instanceof AgentChatConversationError) {
    const mapped = agentConversationErrorToResponse(error);
    logLifecycleFailure(event, userId, mapped.error, error.conversationId);
    res.status(mapped.status).json({ error: mapped.error, message: mapped.message });
    return true;
  }
  return false;
}

function parseConversationId(req: AuthenticatedRequest, res: Response): string | null {
  const parsed = ConversationParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_conversation_id", message: "Conversation ID is invalid." });
    return null;
  }
  return parsed.data.id;
}

async function loadActiveConversationForRoute(userId: string, conversationId: string) {
  const conversation = await chatRouteDeps.loadConversationForUser({ userId, conversationId });
  if (!conversation) return { status: 404, body: { error: "conversation_not_found", message: "Conversation was not found." } } as const;
  if (conversation.isArchived) return { status: 410, body: { error: "conversation_archived", message: "Conversation is archived." } } as const;
  if (conversation.isExpired) return { status: 410, body: { error: "conversation_expired", message: "Conversation has expired." } } as const;
  return { status: 200, conversation } as const;
}

// ── POST /api/chat/messages ─────────────────────────────────────────────────

router.post(
  "/chat/messages",
  handler(async (req, res) => {
    const userId = res.locals["userId"] as string;
    const parsed = ChatMessageBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.message });
      return;
    }

    try {
      const result = await chatRouteDeps.agentChat({
        userId,
        text: parsed.data.text,
        channel: "dashboard",
        ...(parsed.data.conversationId ? { conversationId: parsed.data.conversationId } : {}),
      });
      if (result.terminationReason === "points_budget_exhausted") {
        res.status(402).json({
          error: "points_budget_exhausted",
          message: result.replyText,
          conversationId: result.conversationId.startsWith("conv_budget_") ? null : result.conversationId,
        });
        return;
      }
      res.json({
        conversationId: result.conversationId,
        replyText: result.replyText,
        terminationReason: result.terminationReason,
        totalCostUsd: result.totalCostUsd,
        turnCount: result.turnCount,
      });
    } catch (err) {
      if (sendLifecycleError(res, "continue", userId, err, parsed.data.conversationId)) return;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`chat route error user=${bounded(userId)}: ${msg}`);
      res.status(500).json({ error: "chat_error", message: "An error occurred processing your message." });
    }
  })
);

// ── Saved-chat lifecycle ────────────────────────────────────────────────────

router.get(
  "/chat/conversations",
  handler(async (req, res) => {
    const userId = res.locals["userId"] as string;
    const parsed = ConversationListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_pagination", details: parsed.error.message });
      return;
    }
    if (!chatRouteDeps.databaseConfigured()) {
      logLifecycleFailure("list", userId, "database_unavailable");
      res.status(503).json({ error: "database_unavailable", message: "Chat database is unavailable." });
      return;
    }

    try {
      const items = await chatRouteDeps.listSavedDashboardConversations(
        userId,
        { limit: parsed.data.limit, offset: parsed.data.offset }
      );
      res.json({ items, limit: parsed.data.limit, offset: parsed.data.offset });
    } catch (err) {
      if (sendLifecycleError(res, "list", userId, err)) return;
      logger.error(`chat conversation lifecycle unexpected event=list user=${bounded(userId)}`);
      res.status(500).json({ error: "chat_store_error", message: "Chat store failed." });
    }
  })
);

router.post(
  "/chat/conversations",
  handler(async (req, res) => {
    const userId = res.locals["userId"] as string;
    const parsed = ConversationCreateBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_conversation", details: parsed.error.message });
      return;
    }

    try {
      const conversation = await chatRouteDeps.createSavedConversation({
        userId,
        title: parsed.data.title ?? null,
      });
      res.status(201).json({ conversation });
    } catch (err) {
      if (sendLifecycleError(res, "create", userId, err)) return;
      logger.error(`chat conversation lifecycle unexpected event=create user=${bounded(userId)}`);
      res.status(500).json({ error: "chat_store_error", message: "Chat store failed." });
    }
  })
);

router.get(
  "/chat/conversations/:id",
  handler(async (req, res) => {
    const userId = res.locals["userId"] as string;
    const conversationId = parseConversationId(req, res);
    if (!conversationId) return;

    try {
      const loaded = await loadActiveConversationForRoute(userId, conversationId);
      if (loaded.status !== 200) {
        logLifecycleFailure("open", userId, String(loaded.body.error), conversationId);
        res.status(loaded.status).json(loaded.body);
        return;
      }

      const turns = await chatRouteDeps.loadHistory(conversationId, 200);
      res.json({ conversation: loaded.conversation, turns });
    } catch (err) {
      if (sendLifecycleError(res, "open", userId, err, conversationId)) return;
      logger.error(`chat conversation lifecycle unexpected event=open user=${bounded(userId)} conv=${bounded(conversationId)}`);
      res.status(500).json({ error: "chat_store_error", message: "Chat store failed." });
    }
  })
);

router.patch(
  "/chat/conversations/:id",
  handler(async (req, res) => {
    const userId = res.locals["userId"] as string;
    const conversationId = parseConversationId(req, res);
    if (!conversationId) return;
    const parsed = ConversationRenameBodySchema.safeParse(req.body);
    if (!parsed.success) {
      logLifecycleFailure("rename", userId, "invalid_title", conversationId);
      res.status(400).json({ error: "invalid_title", details: parsed.error.message });
      return;
    }

    try {
      const conversation = await chatRouteDeps.renameSavedConversation({
        userId,
        conversationId,
        title: parsed.data.title,
      });
      res.json({ conversation });
    } catch (err) {
      if (sendLifecycleError(res, "rename", userId, err, conversationId)) return;
      logger.error(`chat conversation lifecycle unexpected event=rename user=${bounded(userId)} conv=${bounded(conversationId)}`);
      res.status(500).json({ error: "chat_store_error", message: "Chat store failed." });
    }
  })
);

router.delete(
  "/chat/conversations/:id",
  handler(async (req, res) => {
    const userId = res.locals["userId"] as string;
    const conversationId = parseConversationId(req, res);
    if (!conversationId) return;

    try {
      const conversation = await chatRouteDeps.archiveSavedConversation({ userId, conversationId });
      res.json({ conversation });
    } catch (err) {
      if (sendLifecycleError(res, "archive", userId, err, conversationId)) return;
      logger.error(`chat conversation lifecycle unexpected event=archive user=${bounded(userId)} conv=${bounded(conversationId)}`);
      res.status(500).json({ error: "chat_store_error", message: "Chat store failed." });
    }
  })
);

export default router;
