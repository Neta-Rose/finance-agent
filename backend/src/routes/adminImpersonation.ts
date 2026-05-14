import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash } from "crypto";
import { z } from "zod";
import {
  issueSession,
  listActiveSessions,
  revokeSession,
  ImpersonationError,
  type ImpersonationSession,
} from "../services/impersonationService.js";
import { isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { logger } from "../services/logger.js";

/**
 * Admin impersonation routes — S07 (Pilot Operational Visibility)
 *
 * All routes are gated by the existing adminAuth middleware (X-Admin-Key).
 * These routes are mounted inside /api/admin, so they inherit adminAuth.
 *
 * POST   /api/admin/impersonation/sessions        — issue a new session
 * GET    /api/admin/impersonation/sessions        — list active sessions
 * DELETE /api/admin/impersonation/sessions/:id   — revoke a session
 */

const router = Router();

type AdminHandler = (req: Request, res: Response) => Promise<void>;

function handler(fn: AdminHandler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (e) {
      next(e);
    }
  };
}

const IMPERSONATOR_ID = "admin"; // single admin identity for pilot

const IssueSessionBodySchema = z.object({
  targetUserId: z.string().trim().min(1).max(64),
  reason: z.string().trim().max(512).optional(),
}).strict();

const SessionIdParamSchema = z.object({
  id: z.string().trim().min(1).max(64),
});

function hashIp(req: Request): string | undefined {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress;
  if (!ip) return undefined;
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

function truncateUserAgent(req: Request): string | undefined {
  const ua = req.headers["user-agent"];
  if (!ua) return undefined;
  return ua.slice(0, 200);
}

// ── POST /api/admin/impersonation/sessions ───────────────────────────────────

router.post(
  "/impersonation/sessions",
  handler(async (req, res) => {
    if (!isApplicationDatabaseConfigured()) {
      res.status(503).json({ error: "database_unavailable", message: "Application database is not configured." });
      return;
    }

    const parsed = IssueSessionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.message });
      return;
    }

    const { targetUserId, reason } = parsed.data;

    try {
      const result = await issueSession({
        impersonatorId: IMPERSONATOR_ID,
        targetUserId,
        reason,
        userAgent: truncateUserAgent(req),
        ipHash: hashIp(req),
      });

      res.status(201).json({
        sessionId: result.sessionId,
        token: result.token,
        expiresAt: result.expiresAt,
        targetUserId: result.targetUserId,
        impersonatorId: result.impersonatorId,
      });
    } catch (err) {
      if (err instanceof ImpersonationError) {
        switch (err.code) {
          case "target_user_not_found":
            res.status(404).json({ error: "target_user_not_found", message: err.message });
            return;
          case "too_many_active_sessions": {
            // Return the active sessions so the admin can revoke one
            const active = await listActiveSessions(IMPERSONATOR_ID).catch(() => [] as ImpersonationSession[]);
            res.status(429).json({
              error: "too_many_active_sessions",
              message: err.message,
              activeSessions: active,
            });
            return;
          }
          case "database_unavailable":
            res.status(503).json({ error: "database_unavailable", message: err.message });
            return;
        }
      }
      logger.error(`adminImpersonation: unexpected error issuing session: ${(err as Error).message}`);
      throw err;
    }
  })
);

// ── GET /api/admin/impersonation/sessions ────────────────────────────────────

router.get(
  "/impersonation/sessions",
  handler(async (_req, res) => {
    if (!isApplicationDatabaseConfigured()) {
      res.status(503).json({ error: "database_unavailable", message: "Application database is not configured." });
      return;
    }

    const sessions = await listActiveSessions(IMPERSONATOR_ID);
    res.json({ sessions, count: sessions.length });
  })
);

// ── DELETE /api/admin/impersonation/sessions/:id ─────────────────────────────

router.delete(
  "/impersonation/sessions/:id",
  handler(async (req, res) => {
    if (!isApplicationDatabaseConfigured()) {
      res.status(503).json({ error: "database_unavailable", message: "Application database is not configured." });
      return;
    }

    const parsed = SessionIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_session_id", message: "Session ID is invalid." });
      return;
    }

    try {
      await revokeSession(parsed.data.id, "admin_request", IMPERSONATOR_ID);
      res.json({ revoked: true, sessionId: parsed.data.id });
    } catch (err) {
      if (err instanceof ImpersonationError && err.code === "session_not_found") {
        res.status(404).json({ error: "session_not_found", message: err.message });
        return;
      }
      throw err;
    }
  })
);

export default router;
