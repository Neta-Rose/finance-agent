import type { Request, Response, NextFunction } from "express";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { logger } from "../services/logger.js";

/**
 * readOnlyGuard — S07 (Pilot Operational Visibility)
 *
 * Runs after authMiddleware + userIsolationMiddleware.
 * If res.locals.readOnly is true, blocks every non-GET request with 403.
 * Every blocked write attempt is logged to admin_audit_log.
 */
export async function readOnlyGuard(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (res.locals["readOnly"] !== true) {
    next();
    return;
  }

  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }

  // Audit the blocked write attempt
  const impersonatorId = res.locals["impersonatorId"] as string | undefined;
  const sessionId = res.locals["sessionId"] as string | undefined;
  const userId = res.locals["userId"] as string | undefined;

  if (isApplicationDatabaseConfigured()) {
    try {
      const ds = await getApplicationDataSource();
      await ds.query(
        `INSERT INTO admin_audit_log
           (actor_admin_id, action_type, target_user_id, args_json, result_status, request_id, ip_address, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          impersonatorId ?? "unknown",
          "impersonation.blocked_write",
          userId ?? null,
          JSON.stringify({ sessionId: sessionId ?? null, method, path: req.originalUrl.slice(0, 256) }),
          "rejected",
          sessionId ?? "unknown",
          null,
        ]
      );
    } catch (err) {
      logger.warn(`readOnlyGuard: failed to write audit log: ${(err as Error).message}`);
    }
  }

  res.status(403).json({
    error: "readonly_impersonation",
    message: "Write operations are not allowed during read-only impersonation.",
  });
}
