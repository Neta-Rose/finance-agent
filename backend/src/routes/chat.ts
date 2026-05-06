import { Router } from "express";
import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import { agentChat } from "../services/chat/agentChat.js";
import { loadConversation, loadHistory } from "../services/chat/conversationStore.js";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { logger } from "../services/logger.js";
import { z } from "zod";

/**
 * Dashboard chat route — Phase 5, task 5.11.
 *
 * Spec: design.md §9.1; D3.1, D3.2.
 *
 * POST /api/chat/messages — send a message, get a reply.
 * GET  /api/chat/conversations/:id — read conversation history.
 * GET  /api/admin/conversations — admin observability (task 5.12).
 *
 * Auth: existing JWT header (cookie auth lands Phase 8).
 * No client-side tool-call interpretation (D3.2).
 */

const router = Router();

type AsyncHandler = (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;
function handler(fn: AsyncHandler) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const ChatMessageBodySchema = z.object({
  text: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
});

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
      const result = await agentChat({
        userId,
        text: parsed.data.text,
        channel: "dashboard",
        conversationId: parsed.data.conversationId,
      });
      res.json({
        conversationId: result.conversationId,
        replyText: result.replyText,
        terminationReason: result.terminationReason,
        totalCostUsd: result.totalCostUsd,
        turnCount: result.turnCount,
      });
    } catch (err) {
      logger.error("chat route error", { err, userId });
      res.status(500).json({ error: "chat_error", message: "An error occurred processing your message." });
    }
  })
);

// ── GET /api/chat/conversations/:id ─────────────────────────────────────────

router.get(
  "/chat/conversations/:id",
  handler(async (req, res) => {
    const userId = res.locals["userId"] as string;
    const conversationId = String(req.params["id"] ?? "");

    if (!isApplicationDatabaseConfigured()) {
      res.status(503).json({ error: "database_unavailable" });
      return;
    }

    const conv = await loadConversation(conversationId);
    if (!conv || conv.userId !== userId) {
      res.status(404).json({ error: "conversation_not_found" });
      return;
    }

    const turns = await loadHistory(conversationId, 200);
    res.json({ conversation: conv, turns });
  })
);

export default router;
