import { Router, type Response, type NextFunction } from "express";
import { triggerLimiter } from "../middleware/rateLimit.js";
import { createJob, listJobs, getJob } from "../services/jobService.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { JobAction } from "../types/index.js";
import { guardPath } from "../middleware/userIsolation.js";

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

const VALID_ACTIONS: JobAction[] = [
  "daily_brief",
  "full_report",
  "deep_dive",
  "new_ideas",
  "switch_production",
  "switch_testing",
];

const JOB_ID_REGEX = /^job_[0-9]{8}_[0-9]{6}_[a-f0-9]{6}$/;

router.post(
  "/jobs/trigger",
  triggerLimiter,
  handler(
    async (req: AuthenticatedRequest, res: Response) => {
      const ws = res.locals["workspace"] as UserWorkspace;
      const { action, ticker } = req.body as {
        action?: string;
        ticker?: string;
      };

      if (!action || !VALID_ACTIONS.includes(action as JobAction)) {
        res.status(400).json({ error: "Invalid or missing action" });
        return;
      }

      if (action === "deep_dive") {
        if (!ticker || !/^[A-Z0-9]{1,10}$/.test(ticker)) {
          res
            .status(400)
            .json({
              error: "deep_dive requires ticker (uppercase, 1-10 chars)",
            });
          return;
        }
        guardPath(ws, ws.strategyFile(ticker));
      }

      const job = await createJob(ws, action as JobAction, ticker);

      res.status(201).json({ jobId: job.id, job });
    }
  )
);

router.get(
  "/jobs",
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const jobs = await listJobs(ws, 50);
    res.json({ jobs });
  })
);

router.get(
  "/jobs/:jobId",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const jobId = String(req.params["jobId"] ?? "");

    if (!JOB_ID_REGEX.test(jobId)) {
      res.status(400).json({ error: "Invalid jobId format" });
      return;
    }

    const job = await getJob(ws, jobId);
    res.json(job);
  })
);

export default router;
