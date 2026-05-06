import { Router } from "express";
import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  getUserAnalystConfig,
  setAnalystStepEnabled,
  TOGGLEABLE_STEP_KINDS,
  STEP_KIND_COST_POINTS,
} from "../services/analystConfigService.js";
import { z } from "zod";

/**
 * Analyst pipeline configuration routes.
 *
 * GET  /api/analyst-config — get the user's analyst pipeline config
 * PATCH /api/analyst-config/:stepKind — enable/disable a step kind
 */

const router = Router();

type AsyncHandler = (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;
function handler(fn: AsyncHandler) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

router.get(
  "/analyst-config",
  handler(async (_req, res) => {
    const userId = res.locals["userId"] as string;
    const config = await getUserAnalystConfig(userId);
    res.json({
      config,
      toggleable: TOGGLEABLE_STEP_KINDS,
      costPoints: STEP_KIND_COST_POINTS,
    });
  })
);

const PatchBodySchema = z.object({
  enabled: z.boolean(),
});

router.patch(
  "/analyst-config/:stepKind",
  handler(async (req, res) => {
    const userId = res.locals["userId"] as string;
    const stepKind = String(req.params["stepKind"] ?? "");
    const parsed = PatchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    await setAnalystStepEnabled(userId, stepKind as Parameters<typeof setAnalystStepEnabled>[1], parsed.data.enabled);
    res.json({ ok: true, stepKind, enabled: parsed.data.enabled });
  })
);

export default router;
