import { Router, type Response, type NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import { listNotifications, markNotificationsRead } from "../services/notificationService.js";

const router = Router();

type AsyncHandler = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<void>;

function handler(fn: AsyncHandler) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

router.get(
  "/notifications",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const limit = Math.min(Math.max(Number(req.query["limit"] ?? 20), 1), 100);
    const unreadOnly = String(req.query["unread"] ?? "false") === "true";
    const channelRaw = typeof req.query["channel"] === "string" ? req.query["channel"] : null;
    const channel =
      channelRaw === "web" || channelRaw === "telegram" || channelRaw === "whatsapp"
        ? channelRaw
        : null;

    const items = await listNotifications(ws.userId, {
      limit,
      unreadOnly,
      channel,
    });

    res.json({
      items,
      unreadCount: items.filter((item) => item.readAt === null).length,
    });
  })
);

router.post(
  "/notifications/read",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id: unknown) => typeof id === "string") : [];
    const updated = await markNotificationsRead(ws.userId, ids);
    res.json({ updated });
  })
);

export default router;
