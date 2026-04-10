import { Router, type Response, type NextFunction } from "express";
import { triggerLimiter } from "../middleware/rateLimit.js";
import { createJob, listJobs, getJob, updateJob } from "../services/jobService.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { JobAction, RateLimits, Job } from "../types/index.js";
import { DEFAULT_RATE_LIMITS } from "../types/index.js";
import { guardPath } from "../middleware/userIsolation.js";
import { setUserProfile, getUserProfileStatus } from "../services/profileService.js";
import { getSystemControl, getUserControl } from "../services/controlService.js";
import { promises as fs } from "fs";
import path from "path";

// ── Progress inference ────────────────────────────────────────────────────────

const ANALYST_STEPS = ["fundamentals", "technical", "sentiment", "macro", "risk"];
const DEEP_STEPS = [...ANALYST_STEPS, "bull_case", "bear_case"];
const STEP_LABELS: Record<string, string> = {
  fundamentals: "Fundamentals",
  technical: "Technical Analysis",
  sentiment: "Sentiment",
  macro: "Macro",
  risk: "Portfolio Risk",
  bull_case: "Bull Researcher",
  bear_case: "Bear Researcher",
};

interface JobProgress {
  pct: number;
  currentTicker: string | null;
  currentStep: string | null;
  completedTickers: string[];
  remainingTickers: string[];
  totalTickers: number;
  completedSteps: number;
  totalSteps: number;
}

async function tickerAnalystsDone(_reportsBase: string, _ticker: string, fileList: string[]): Promise<{ done: string[]; nextStep: string | null }> {
  const done = fileList.filter((f) => {
    const name = f.replace(".json", "");
    return DEEP_STEPS.includes(name);
  }).map((f) => f.replace(".json", ""));
  const next = DEEP_STEPS.find((s) => !done.includes(s)) ?? null;
  return { done, nextStep: next };
}

async function computeJobProgress(ws: UserWorkspace, job: Job): Promise<JobProgress | null> {
  if (job.status !== "running") return null;

  const reportsBase = ws.reportsDir;

  if (job.action === "deep_dive" && job.ticker) {
    let files: string[] = [];
    try { files = await fs.readdir(path.join(reportsBase, job.ticker)); } catch { /* not started */ }
    const { done, nextStep } = await tickerAnalystsDone(reportsBase, job.ticker, files);
    const total = DEEP_STEPS.length;
    const pct = Math.round((done.length / total) * 100);
    return {
      pct,
      currentTicker: job.ticker,
      currentStep: nextStep ? (STEP_LABELS[nextStep] ?? nextStep) : null,
      completedTickers: pct >= 100 ? [job.ticker] : [],
      remainingTickers: pct < 100 ? [job.ticker] : [],
      totalTickers: 1,
      completedSteps: done.length,
      totalSteps: total,
    };
  }

  if (job.action === "full_report" || job.action === "daily_brief") {
    // Read agent-maintained progress.json
    let progressData: { completed?: string[]; remaining?: string[]; failed?: string[]; totalTickers?: number } = {};
    try {
      const raw = await fs.readFile(path.join(reportsBase, "progress.json"), "utf-8");
      progressData = JSON.parse(raw) as typeof progressData;
    } catch { /* not started */ }

    const completed = progressData.completed ?? [];
    const remaining = progressData.remaining ?? [];
    const total = progressData.totalTickers ?? (completed.length + remaining.length);

    // Find current ticker by scanning first remaining ticker with partial files
    let currentTicker: string | null = null;
    let currentStep: string | null = null;
    let subDone = 0;

    for (const ticker of remaining.slice(0, 5)) {
      try {
        const files = await fs.readdir(path.join(reportsBase, ticker));
        const { done, nextStep } = await tickerAnalystsDone(reportsBase, ticker, files);
        if (done.length > 0) {
          currentTicker = ticker;
          subDone = done.length;
          currentStep = nextStep ? (STEP_LABELS[nextStep] ?? nextStep) : null;
          break;
        }
      } catch { /* no dir yet */ }
    }

    const stepsPerTicker = ANALYST_STEPS.length;
    const totalSteps = total * stepsPerTicker;
    const completedSteps = completed.length * stepsPerTicker + Math.min(subDone, stepsPerTicker);
    const pct = total > 0 ? Math.min(Math.round((completedSteps / totalSteps) * 100), 99) : 5;

    return {
      pct,
      currentTicker,
      currentStep,
      completedTickers: completed,
      remainingTickers: remaining,
      totalTickers: total,
      completedSteps,
      totalSteps,
    };
  }

  return null;
}

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

      // ── System lock + user restriction check ─────────────────────────────
      const [sysCtrl, userCtrl] = await Promise.all([
        getSystemControl(),
        getUserControl(ws.userId),
      ]);

      if (sysCtrl.locked) {
        res.status(503).json({
          error: "system_locked",
          message: sysCtrl.lockReason || "System is temporarily locked. Contact admin.",
        });
        return;
      }

      if (userCtrl.restriction === "suspended" ||
          userCtrl.restriction === "blocked" ||
          userCtrl.restriction === "readonly") {
        res.status(403).json({
          error: "user_restricted",
          restriction: userCtrl.restriction,
          message: userCtrl.reason || "Your account is restricted. Contact admin.",
        });
        return;
      }

      // ── Switch actions: apply immediately in the backend, never delegate to agent ──
      const isSwitchAction = action === "switch_production" || action === "switch_testing";
      if (isSwitchAction) {
        const targetProfile = action === "switch_production" ? "production" : "testing";
        const job = await createJob(ws, action as JobAction);
        try {
          await setUserProfile(ws.userId, targetProfile);
          await updateJob(ws, job.id, {
            status: "completed",
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            result: `Switched to ${targetProfile} profile`,
          });
        } catch (err) {
          await updateJob(ws, job.id, {
            status: "failed",
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            error: err instanceof Error ? err.message.slice(0, 490) : "Switch failed",
          });
          res.status(500).json({ error: "Failed to switch profile", reason: (err instanceof Error ? err.message : String(err)) });
          return;
        }
        res.status(201).json({ jobId: job.id, job: await getJob(ws, job.id) });
        return;
      }

      // ── For all other actions: validate that the user's profile is not broken ──
      const profileStatus = await getUserProfileStatus(ws.userId);
      if (profileStatus.broken) {
        res.status(409).json({
          error: "model_profile_broken",
          reason: profileStatus.reason ?? `Profile "${profileStatus.name}" is invalid — contact support`,
        });
        return;
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

      res.status(201).json({ jobId: job.id, job });
    }
  )
);

router.get(
  "/jobs",
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const jobs = await listJobs(ws, 50);
    const enriched = await Promise.all(
      jobs.map(async (job) => {
        if (job.status !== "running") return job;
        const progress = await computeJobProgress(ws, job);
        return { ...job, progress };
      })
    );
    res.json({ jobs: enriched });
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
    if (job.status === "running") {
      const progress = await computeJobProgress(ws, job);
      res.json({ ...job, progress });
      return;
    }
    res.json(job);
  })
);

export default router;
