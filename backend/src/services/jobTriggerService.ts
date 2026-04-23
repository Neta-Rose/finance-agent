import { promises as fs } from "fs";
import path from "path";
import { guardPath } from "../middleware/userIsolation.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import { getSystemControl, getUserControl } from "./controlService.js";
import { createJob, getJob, listJobs, updateJob } from "./jobService.js";
import type { Job, JobAction, JobSource, RateLimits } from "../types/index.js";
import { DEFAULT_RATE_LIMITS } from "../types/index.js";
import { setUserProfile, getUserProfileStatus } from "./profileService.js";
import { runQuickCheckJob } from "./quickCheckService.js";
import { runDailyBriefJob } from "./dailyBriefService.js";
import { initializeDeepDiveJob } from "./deepDiveService.js";
import { initializeFullReportJob } from "./fullReportService.js";
import { runNewIdeasJob } from "./newIdeasService.js";
import { dispatchPendingAgentJobsForUser } from "./agentJobDispatcher.js";
import { buildStrategyMetadata } from "./strategyBaselineService.js";

const FUTURE_FEATURE_ACTIONS = new Set<JobAction>(["full_report", "new_ideas"]);

export interface TriggerUserJobParams {
  workspace: UserWorkspace;
  action: JobAction;
  ticker?: string;
  source: JobSource;
}

export interface TriggerUserJobResult {
  statusCode: number;
  body: Record<string, unknown>;
}

function futureFeatureMessage(action: "full_report" | "new_ideas"): string {
  if (action === "full_report") {
    return "Weekly report is still being rebuilt. It stays visible for roadmap clarity, but triggering it is currently blocked.";
  }
  return "New ideas is visible as a future feature, but triggering it is currently blocked.";
}

async function ensureDeepDiveTickerWorkspace(
  ws: UserWorkspace,
  ticker: string
): Promise<void> {
  const tickerDir = path.join(ws.tickersDir, ticker);
  const strategyPath = ws.strategyFile(ticker);
  const eventsPath = ws.eventsFile(ticker);
  const reportsDir = path.join(ws.reportsDir, ticker);

  await fs.mkdir(tickerDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });

  try {
    await fs.access(strategyPath);
  } catch {
    const generatedAt = new Date().toISOString();
    const strategyStub = {
      ticker,
      updatedAt: generatedAt,
      version: 1,
      verdict: "HOLD",
      confidence: "low",
      reasoning: "Pending exploratory deep dive analysis",
      timeframe: "undefined",
      positionSizeILS: 0,
      positionWeightPct: 0,
      entryConditions: [],
      exitConditions: [],
      catalysts: [],
      bullCase: null,
      bearCase: null,
      lastDeepDiveAt: null,
      deepDiveTriggeredBy: "manual_exploration",
      metadata: buildStrategyMetadata("manual_exploration", "provisional", generatedAt, false),
    };
    await fs.writeFile(strategyPath, JSON.stringify(strategyStub, null, 2), "utf-8");
  }

  try {
    await fs.access(eventsPath);
  } catch {
    await fs.writeFile(eventsPath, "", "utf-8");
  }
}

async function checkRateLimit(
  ws: UserWorkspace,
  action: JobAction
): Promise<{ allowed: boolean; reason?: string }> {
  let limits: RateLimits = DEFAULT_RATE_LIMITS;
  try {
    const raw = await fs.readFile(path.join(ws.root, "profile.json"), "utf-8");
    const profile = JSON.parse(raw) as { rateLimits?: Partial<RateLimits> };
    if (profile.rateLimits) {
      limits = { ...DEFAULT_RATE_LIMITS, ...profile.rateLimits };
    }
  } catch {}

  const limit = limits[action as keyof RateLimits];
  if (!limit) return { allowed: true };

  const cutoff = new Date(Date.now() - limit.periodHours * 3600 * 1000).toISOString();
  let jobs: Array<{ action: string; status: string; triggered_at: string }> = [];
  try {
    const files = await fs.readdir(ws.jobsDir);
    await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          try {
            jobs.push(
              JSON.parse(await fs.readFile(path.join(ws.jobsDir, file), "utf-8")) as {
                action: string;
                status: string;
                triggered_at: string;
              }
            );
          } catch {}
        })
    );
  } catch {}

  const recent = jobs.filter(
    (job) =>
      job.action === action &&
      job.status !== "failed" &&
      job.status !== "cancelled" &&
      job.triggered_at >= cutoff
  );
  if (recent.length >= limit.maxPerPeriod) {
    return {
      allowed: false,
      reason: `Rate limit: max ${limit.maxPerPeriod} ${action} per ${limit.periodHours} hours`,
    };
  }

  return { allowed: true };
}

async function findActiveDuplicateJob(
  ws: UserWorkspace,
  action: JobAction,
  ticker?: string
): Promise<Job | null> {
  const jobs = await listJobs(ws, 100);
  return (
    jobs.find((job) => {
      if (job.action !== action) return false;
      if (job.status !== "pending" && job.status !== "running") return false;
      if (action === "deep_dive" || action === "quick_check") {
        return job.ticker === (ticker ?? null);
      }
      return true;
    }) ?? null
  );
}

export async function triggerUserJob(
  params: TriggerUserJobParams
): Promise<TriggerUserJobResult> {
  const ws = params.workspace;
  const { action, ticker, source } = params;

  if ((action === "deep_dive" || action === "quick_check") && ticker) {
    if (action === "deep_dive") {
      await ensureDeepDiveTickerWorkspace(ws, ticker);
      guardPath(ws, ws.strategyFile(ticker));
    }
  }

  if (FUTURE_FEATURE_ACTIONS.has(action)) {
    return {
      statusCode: 409,
      body: {
        error: "feature_blocked",
        reason: futureFeatureMessage(action as "full_report" | "new_ideas"),
      },
    };
  }

  const [sysCtrl, userCtrl] = await Promise.all([
    getSystemControl(),
    getUserControl(ws.userId),
  ]);

  if (sysCtrl.locked) {
    return {
      statusCode: 503,
      body: {
        error: "system_locked",
        message: sysCtrl.lockReason || "System is temporarily locked. Contact admin.",
      },
    };
  }

  if (
    userCtrl.restriction === "suspended" ||
    userCtrl.restriction === "blocked" ||
    userCtrl.restriction === "readonly"
  ) {
    return {
      statusCode: 403,
      body: {
        error: "user_restricted",
        restriction: userCtrl.restriction,
        message: userCtrl.reason || "Your account is restricted. Contact admin.",
      },
    };
  }

  const isSwitchAction = action === "switch_production" || action === "switch_testing";
  if (isSwitchAction) {
    const targetProfile = action === "switch_production" ? "production" : "testing";
    const job = await createJob(ws, action, ticker, { source });
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
      return {
        statusCode: 500,
        body: {
          error: "Failed to switch profile",
          reason: err instanceof Error ? err.message : String(err),
        },
      };
    }
    return {
      statusCode: 201,
      body: { jobId: job.id, job: await getJob(ws, job.id) },
    };
  }

  const profileStatus = await getUserProfileStatus(ws.userId);
  if (profileStatus.broken) {
    return {
      statusCode: 409,
      body: {
        error: "model_profile_broken",
        reason: profileStatus.reason ?? `Profile "${profileStatus.name}" is invalid — contact support`,
      },
    };
  }

  const rateLimitResult = await checkRateLimit(ws, action);
  if (!rateLimitResult.allowed) {
    return {
      statusCode: 429,
      body: {
        error: "rate_limit_exceeded",
        reason: rateLimitResult.reason,
      },
    };
  }

  const duplicate = await findActiveDuplicateJob(ws, action, ticker);
  if (duplicate) {
    return {
      statusCode: 200,
      body: { jobId: duplicate.id, job: duplicate },
    };
  }

  const job = await createJob(ws, action, ticker, { dispatch: false, source });

  if (action === "quick_check" && ticker) {
    const completed = await runQuickCheckJob(ws, ticker, job);
    return { statusCode: 201, body: { jobId: completed.id, job: completed } };
  }
  if (action === "daily_brief") {
    const completed = await runDailyBriefJob(ws, job);
    return { statusCode: 201, body: { jobId: completed.id, job: completed } };
  }
  if (action === "new_ideas") {
    const completed = await runNewIdeasJob(ws, job);
    return { statusCode: 201, body: { jobId: completed.id, job: completed } };
  }
  if (action === "deep_dive") {
    const started = await initializeDeepDiveJob(ws, job);
    await dispatchPendingAgentJobsForUser(ws.userId);
    const refreshed = await getJob(ws, started.id);
    return { statusCode: 201, body: { jobId: refreshed.id, job: refreshed } };
  }
  if (action === "full_report") {
    const started = await initializeFullReportJob(ws, job);
    await dispatchPendingAgentJobsForUser(ws.userId);
    const refreshed = await getJob(ws, started.id);
    return { statusCode: 201, body: { jobId: refreshed.id, job: refreshed } };
  }

  return { statusCode: 201, body: { jobId: job.id, job } };
}
