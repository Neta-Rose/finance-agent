import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import { logger } from "./logger.js";
import { JobSchema } from "../schemas/job.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { Job, JobAction } from "../types/index.js";

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
  ticker?: string
): Promise<Job> {
  const id = generateJobId();
  const triggered_at = new Date().toISOString();

  const job: Job = {
    id,
    action,
    ticker: ticker ?? "",
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

  const triggerFile = `${workspace.triggersDir}/${id}.json`;
  await fs.mkdir(workspace.triggersDir, { recursive: true });
  await fs.writeFile(triggerFile, JSON.stringify(job, null, 2), "utf-8");

  logger.info(`Job created: ${id} action=${action} ticker=${ticker ?? "none"}`);
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

export async function updateJob(
  workspace: UserWorkspace,
  jobId: string,
  update: Partial<Pick<Job, "status" | "started_at" | "completed_at" | "result" | "error">>
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
