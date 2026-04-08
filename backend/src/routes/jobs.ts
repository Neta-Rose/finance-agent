import { Router, type Response, type NextFunction } from "express";
import { triggerLimiter } from "../middleware/rateLimit.js";
import { createJob, listJobs, getJob } from "../services/jobService.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { JobAction, RateLimits } from "../types/index.js";
import { DEFAULT_RATE_LIMITS } from "../types/index.js";
import { guardPath } from "../middleware/userIsolation.js";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "../services/logger.js";

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

async function checkRateLimit(
  ws: UserWorkspace,
  action: JobAction
): Promise<{ allowed: boolean; reason?: string }> {
  // Get rate limits from profile
  let limits: RateLimits = DEFAULT_RATE_LIMITS;
  try {
    const raw = await fs.readFile(path.join(ws.root, "profile.json"), "utf-8");
    const profile = JSON.parse(raw);
    if (profile.rateLimits) {
      limits = { ...DEFAULT_RATE_LIMITS, ...profile.rateLimits };
    }
  } catch { /* use defaults */ }

  const limit = limits[action as keyof RateLimits];
  if (!limit) return { allowed: true }; // switch_production/test — no limit

  const now = Date.now();
  const periodMs = limit.periodHours * 3600 * 1000;
  const cutoff = new Date(now - periodMs).toISOString();

  let jobs: Array<{ action: string; status: string; triggered_at: string }> = [];
  try {
    const files = await fs.readdir(ws.jobsDir);
    await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          try {
            const raw = await fs.readFile(path.join(ws.jobsDir, f), "utf-8");
            jobs.push(JSON.parse(raw));
          } catch { /* skip invalid files */ }
        })
    );
  } catch { /* no jobs dir yet */ }

  const recent = jobs.filter(
    (j) =>
      j.action === action &&
      j.status !== "failed" &&
      j.triggered_at >= cutoff
  );

  if (recent.length >= limit.maxPerPeriod) {
    return {
      allowed: false,
      reason: `Rate limit: max ${limit.maxPerPeriod} ${action} per ${limit.periodHours} hours`,
    };
  }

  return { allowed: true };
}

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
          res.status(400).json({
            error: "deep_dive requires ticker (uppercase, 1-10 chars)",
          });
          return;
        }
        guardPath(ws, ws.strategyFile(ticker));
      }

      // Rate limit check
      const rateLimitResult = await checkRateLimit(ws, action as JobAction);
      if (!rateLimitResult.allowed) {
        res.status(429).json({
          error: "rate_limit_exceeded",
          reason: rateLimitResult.reason,
        });
        return;
      }

      const job = await createJob(ws, action as JobAction, ticker);

      // Bridge trigger to main data/triggers directory
      const MAIN_TRIGGERS = path.join(
        process.env.DATA_DIR ?? path.join(process.cwd(), '../data'),
        'triggers'
      );
      await fs.mkdir(MAIN_TRIGGERS, { recursive: true });
      await fs.writeFile(
        path.join(MAIN_TRIGGERS, `${job.id}.json`),
        JSON.stringify({ ...job, userId: ws.userId, workspacePath: ws.root }),
        'utf-8'
      );
      logger.info(`Trigger bridged to main: ${job.id}`);

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
