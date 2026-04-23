import { Router, type Response, type NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import { runConditionCheck, markCatalystTriggered, markDeepDiveComplete } from "../services/conditionEngine.js";
import { createJob } from "../services/jobService.js";
import { initializeDeepDiveJob } from "../services/deepDiveService.js";
import type { EscalationReason } from "../services/conditionEngine.js";
import { dispatchPendingAgentJobsForUser } from "../services/agentJobDispatcher.js";

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

// ── GET /api/conditions/check ────────────────────────────────────────────────

router.get(
  "/conditions/check",
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const report = await runConditionCheck(ws.userId);
    res.json(report);
  })
);

// ── GET /api/conditions/pending ─────────────────────────────────────────────

router.get(
  "/conditions/pending",
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const report = await runConditionCheck(ws.userId);
    const tickers = report.needsEscalation.map((r) => r.ticker);
    res.json({ pendingDeepDives: tickers, count: tickers.length });
  })
);

// ── POST /api/conditions/trigger/:ticker ────────────────────────────────────

router.post(
  "/conditions/trigger/:ticker",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const ticker = String(req.params["ticker"] ?? "").toUpperCase();
    const { reason } = req.body as { reason?: EscalationReason };

    if (!ticker || !/^[A-Z0-9]{1,10}$/.test(ticker)) {
      res.status(400).json({ error: "Invalid ticker" });
      return;
    }

    const validReasons: EscalationReason[] = [
      "catalyst_expired",
      "hold_no_catalyst",
      "stale_low_confidence",
      "pending_deep_dive",
      "manual_trigger",
    ];
    if (reason && !validReasons.includes(reason)) {
      res.status(400).json({ error: "Invalid reason" });
      return;
    }

    // Import writeState inline to avoid circular deps
    const { readState, writeState } = await import("../services/stateService.js");
    const state = await readState(ws.userId);
    const pending = new Set(state.pendingDeepDives ?? []);
    pending.add(ticker);
    await writeState(ws.userId, { pendingDeepDives: Array.from(pending) });

    // Create deep_dive job for this ticker
    const job = await createJob(ws, "deep_dive", ticker, { dispatch: false });
    const initializedJob = await initializeDeepDiveJob(ws, job);
    if (initializedJob.status === "running") {
      await dispatchPendingAgentJobsForUser(ws.userId);
    }

    res.json({ jobId: initializedJob.id, ticker, queued: true });
  })
);

// ── POST /api/conditions/mark-triggered/:ticker ────────────────────────────────

router.post(
  "/conditions/mark-triggered/:ticker",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const ticker = String(req.params["ticker"] ?? "").toUpperCase();
    const { catalystDescription } = req.body as { catalystDescription?: string };

    if (!ticker) {
      res.status(400).json({ error: "Invalid ticker" });
      return;
    }
    if (!catalystDescription) {
      res.status(400).json({ error: "catalystDescription required" });
      return;
    }

    await markCatalystTriggered(ws.userId, ticker, catalystDescription);
    res.json({ ticker, catalystDescription, triggered: true });
  })
);

// ── POST /api/conditions/mark-complete/:ticker ────────────────────────────────

router.post(
  "/conditions/mark-complete/:ticker",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const ticker = String(req.params["ticker"] ?? "").toUpperCase();

    if (!ticker) {
      res.status(400).json({ error: "Invalid ticker" });
      return;
    }

    await markDeepDiveComplete(ws.userId, ticker);
    res.json({ ticker, complete: true });
  })
);

export default router;
