import { Router, type Response, type NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { SupportMessageCreateSchema } from "../schemas/support.js";
import { submitSupportMessage } from "../services/supportService.js";

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

router.post(
  "/support/messages",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = res.locals["userId"] as string;
    const parsed = SupportMessageCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
      return;
    }

    const record = await submitSupportMessage(userId, parsed.data);
    res.status(201).json({ message: record });
  })
);

export default router;
