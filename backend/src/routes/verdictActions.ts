import { Router } from "express";
import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { recordVerdictAction } from "../services/verdictActionsStore.js";
import { createSnooze } from "../services/snoozeStore.js";
import { createHash } from "crypto";
import { z } from "zod";

/**
 * Verdict actions and snooze routes — Phase 7, task 7.10.
 *
 * POST /api/verdict-actions — record followed/dismissed/partial_acted
 * POST /api/snoozes — snooze a ticker for N days
 */

const router = Router();

type AsyncHandler = (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;
function handler(fn: AsyncHandler) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const VerdictActionBodySchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/),
  decision: z.enum(["followed", "dismissed", "partial_acted"]),
  note: z.string().max(1000).optional(),
});

const SnoozeBodySchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/),
  days: z.number().int().min(1).max(180).optional(),
});

router.post(
  "/verdict-actions",
  handler(async (req, res) => {
    const userId = res.locals["userId"] as string;
    const parsed = VerdictActionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.message });
      return;
    }
    const record = await recordVerdictAction({
      userId,
      ticker: parsed.data.ticker,
      strategyVersion: 1, // will be updated when strategies table is the source of truth
      decision: parsed.data.decision,
      note: parsed.data.note,
    });
    res.json({ verdictActionId: record.id });
  })
);

router.post(
  "/snoozes",
  handler(async (req, res) => {
    const userId = res.locals["userId"] as string;
    const parsed = SnoozeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.message });
      return;
    }
    const days = parsed.data.days ?? 30;
    const snoozeUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    // Use a stable fingerprint for user-initiated snoozes
    const fingerprint = createHash("sha256")
      .update(`user_manual:${parsed.data.ticker}:${new Date().toISOString().slice(0, 10)}`)
      .digest("hex")
      .slice(0, 32);
    const snooze = await createSnooze({
      userId,
      ticker: parsed.data.ticker,
      snoozeUntil,
      signalSetFingerprint: fingerprint,
      reason: "user_manual",
    });
    res.json({ snoozeId: snooze.id, snoozeUntil: snooze.snoozeUntil });
  })
);

export default router;
