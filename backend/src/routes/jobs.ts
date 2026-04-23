import { Router, type Response, type NextFunction } from "express";
import { triggerLimiter } from "../middleware/rateLimit.js";
import { listJobs, getJob } from "../services/jobService.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { JobAction, Job } from "../types/index.js";
import { promises as fs } from "fs";
import path from "path";
import {
  getDeepDiveJobProgress,
} from "../services/deepDiveService.js";
import {
  getFullReportJobProgress,
} from "../services/fullReportService.js";
import { triggerUserJob } from "../services/jobTriggerService.js";

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
    const progress = await getDeepDiveJobProgress(ws, job);
    if (progress) return progress;
  }

  if (job.action === "quick_check" && job.ticker) {
    // Quick check only has 1 step (sentiment analyst)
    let files: string[] = [];
    try { files = await fs.readdir(path.join(reportsBase, job.ticker)); } catch { /* not started */ }
    const hasQuickCheckFile = files.includes("quick_check.json");
    const pct = hasQuickCheckFile ? 100 : 5; // 5% if just started
    return {
      pct,
      currentTicker: job.ticker,
      currentStep: hasQuickCheckFile ? null : "Sentiment Analysis",
      completedTickers: hasQuickCheckFile ? [job.ticker] : [],
      remainingTickers: hasQuickCheckFile ? [] : [job.ticker],
      totalTickers: 1,
      completedSteps: hasQuickCheckFile ? 1 : 0,
      totalSteps: 1,
    };
  }

  if (job.action === "full_report" || job.action === "daily_brief") {
    if (job.action === "full_report") {
      const progress = await getFullReportJobProgress(ws, job);
      if (progress) return progress;
    }
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
  "quick_check",
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

      if (action === "deep_dive" || action === "quick_check") {
        if (!ticker || !/^[A-Z0-9]{1,10}$/.test(ticker)) {
          res.status(400).json({
            error: `${action} requires ticker (uppercase, 1-10 chars)`,
          });
          return;
        }
      }

      const result = await triggerUserJob({
        workspace: ws,
        action: action as JobAction,
        ...(ticker ? { ticker } : {}),
        source: "dashboard_action",
      });
      res.status(result.statusCode).json(result.body);
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
