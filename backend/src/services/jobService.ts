import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger.js";
import { JobSchema } from "../schemas/job.js";
import { wakeAgent } from "./agentService.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { Job, JobAction, JobSource } from "../types/index.js";
import { searchTickerContext } from "./explorationService.js";

async function createAgentBriefing(
  workspace: UserWorkspace,
  ticker: string,
  purpose: "quick_check" | "deep_dive"
): Promise<Record<string, unknown> | null> {
  const briefing: Record<string, unknown> = {
    ticker,
    purpose,
    loaded_at: new Date().toISOString(),
  };
  
  try {
    // Try to load sentiment.json
    const sentimentPath = path.join(workspace.reportsDir, ticker, "sentiment.json");
    if (await fileExists(sentimentPath)) {
      const sentimentRaw = await fs.readFile(sentimentPath, "utf-8");
      try {
        briefing.sentiment = JSON.parse(sentimentRaw);
      } catch (e) {
        briefing.sentiment_error = "Failed to parse sentiment.json";
      }
    } else {
      briefing.sentiment_error = "File not found";
    }
    
    // Try to load strategy.json
    const strategyPath = path.join(workspace.tickersDir, ticker, "strategy.json");
    if (await fileExists(strategyPath)) {
      const strategyRaw = await fs.readFile(strategyPath, "utf-8");
      try {
        briefing.strategy = JSON.parse(strategyRaw);
      } catch (e) {
        briefing.strategy_error = "Failed to parse strategy.json";
      }
    } else {
      briefing.strategy_error = "File not found";
    }
    
    // Try to load portfolio to check if ticker is in portfolio
    const portfolioPath = workspace.portfolioFile;
    if (await fileExists(portfolioPath)) {
      const portfolioRaw = await fs.readFile(portfolioPath, "utf-8");
      try {
        const portfolio = JSON.parse(portfolioRaw);
        briefing.is_portfolio_ticker = Object.values(portfolio.accounts || {}).some(
          (positions) =>
            Array.isArray(positions) &&
            positions.some((position: Record<string, unknown>) => position["ticker"] === ticker)
        );
      } catch (e) {
        briefing.portfolio_error = "Failed to parse portfolio.json";
      }
    }

    briefing.exploration = await searchTickerContext(ticker, purpose, purpose === "deep_dive" ? 4 : 2);
    
    return briefing;
  } catch (error) {
    logger.warn(`Failed to create agent briefing for ${ticker}: ${error}`);
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class JobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Job not found: ${jobId}`);
    this.name = "JobNotFoundError";
  }
}

function generateJobId(): string {
  const now = new Date();
  const dateStr = now
    .toISOString()
    .replace(/[-:]/g, "")
    .slice(0, 15)
    .replace("T", "_");
  const hex = randomBytes(3).toString("hex");
  return `job_${dateStr}_${hex}`;
}

export async function createJob(
  workspace: UserWorkspace,
  action: JobAction,
  ticker?: string,
  options?: { dispatch?: boolean; source?: JobSource }
): Promise<Job> {
  const id = generateJobId();
  const triggered_at = new Date().toISOString();
  const dispatch = options?.dispatch ?? true;

  const job: Job = {
    id,
    action,
    ticker: ticker ?? null,
    source: options?.source ?? null,
    budget_admitted_at: null,
    status: "pending",
    triggered_at,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
  };

  const jobFile = workspace.jobFile(id);
  await fs.mkdir(workspace.jobsDir, { recursive: true });
  await fs.writeFile(jobFile, JSON.stringify(job, null, 2), "utf-8");

  if (!dispatch) {
    logger.info(`Job created without dispatch: ${id} action=${action} ticker=${ticker ?? "none"}`);
    return job;
  }

  await dispatchJob(workspace, job);
  return job;
}

export async function dispatchJob(
  workspace: UserWorkspace,
  job: Job
): Promise<Job> {
  const triggerFile = `${workspace.triggersDir}/${job.id}.json`;
  await fs.mkdir(workspace.triggersDir, { recursive: true });

  // For quick_check jobs, create an enhanced trigger with pre-loaded data
  if ((job.action === "quick_check" || job.action === "deep_dive") && job.ticker) {
    const briefing = await createAgentBriefing(workspace, job.ticker, job.action);
    if (briefing) {
      // Create enhanced trigger with briefing
      const enhancedTrigger = {
        ...job,
        briefing
      };
      await fs.writeFile(triggerFile, JSON.stringify(enhancedTrigger, null, 2), "utf-8");
      logger.info(`Job dispatched with briefing: ${job.id} ticker=${job.ticker}`);
      wakeAgent(workspace.userId);
      return job;
    }
  }

  await fs.writeFile(triggerFile, JSON.stringify(job, null, 2), "utf-8");

  logger.info(`Job dispatched: ${job.id} action=${job.action} ticker=${job.ticker ?? "none"}`);

  wakeAgent(workspace.userId);
  return job;
}

export async function getJob(
  workspace: UserWorkspace,
  jobId: string
): Promise<Job> {
  const filePath = workspace.jobFile(jobId);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new JobNotFoundError(jobId);
    }
    throw err;
  }

  const parsed = JSON.parse(raw);
  const result = JobSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid job file: ${jobId}`);
  }
  // Map schema camelCase → interface snake_case
  const data = result.data as Record<string, unknown>;
  const job: Job = {
    id: data["id"] as string,
    action: data["action"] as Job["action"],
    ticker: data["ticker"] as Job["ticker"],
    source: (data["source"] as Job["source"] | undefined) ?? null,
    budget_admitted_at: (data["budget_admitted_at"] as string | null | undefined) ?? null,
    status: data["status"] as Job["status"],
    triggered_at: data["triggered_at"] as string,
    started_at: data["started_at"] as Job["started_at"],
    completed_at: data["completed_at"] as Job["completed_at"],
    result: data["result"] as Job["result"],
    error: data["error"] as Job["error"],
  };
  return job;
}

export async function listJobs(
  workspace: UserWorkspace,
  limit = 50
): Promise<Job[]> {
  let files: string[];
  try {
    files = await fs.readdir(workspace.jobsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const jobs: Job[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = `${workspace.jobsDir}/${file}`;
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      const result = JobSchema.safeParse(parsed);
      if (result.success) {
        const d = result.data as Record<string, unknown>;
        jobs.push({
          id: d["id"] as string,
          action: d["action"] as Job["action"],
          ticker: d["ticker"] as Job["ticker"],
          source: (d["source"] as Job["source"] | undefined) ?? null,
          budget_admitted_at: (d["budget_admitted_at"] as string | null | undefined) ?? null,
          status: d["status"] as Job["status"],
          triggered_at: d["triggered_at"] as string,
          started_at: d["started_at"] as Job["started_at"],
          completed_at: d["completed_at"] as Job["completed_at"],
          result: d["result"] as Job["result"],
          error: d["error"] as Job["error"],
        });
      }
    } catch {
      logger.warn(`Skipping invalid job file: ${file}`);
    }
  }

  jobs.sort(
    (a, b) =>
      new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime()
  );

  return jobs.slice(0, limit);
}

export async function hasPendingAgentManagedWork(
  workspace: UserWorkspace
): Promise<boolean> {
  const jobs = await listJobs(workspace, 200);
  return jobs.some(
    (job) =>
      (job.action === "deep_dive" || job.action === "full_report") &&
      (job.status === "pending" || job.status === "running")
  );
}

export async function updateJob(
  workspace: UserWorkspace,
  jobId: string,
  update: Partial<Pick<Job, "status" | "started_at" | "completed_at" | "result" | "error" | "budget_admitted_at">>
): Promise<Job> {
  const current = await getJob(workspace, jobId);

  const merged: Job = {
    ...current,
    ...update,
  };

  const result = JobSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(
      `Invalid job update: ${result.error.errors.map((e) => e.message).join("; ")}`
    );
  }

  await fs.writeFile(
    workspace.jobFile(jobId),
    JSON.stringify(merged, null, 2),
    "utf-8"
  );

  logger.info(`Job updated: ${jobId} status=${merged.status}`);
  return merged;
}
