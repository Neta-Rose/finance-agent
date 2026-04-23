import { promises as fs } from "fs";
import path from "path";
import { buildWorkspace } from "../middleware/userIsolation.js";
import type { Job, JobAction } from "../types/index.js";
import { dispatchJob, getJob } from "./jobService.js";
import { logger } from "./logger.js";
import { resolveConfiguredPath } from "./paths.js";

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
const SCAN_INTERVAL_MS = 15_000;
const AGENT_MANAGED_ACTIONS = new Set<JobAction>(["deep_dive", "full_report"]);
const USER_AGENT_JOB_CONCURRENCY = 1;

function isAgentManagedAction(action: string | null | undefined): action is JobAction {
  return AGENT_MANAGED_ACTIONS.has(action as JobAction);
}

async function readUserJobs(userId: string): Promise<Job[]> {
  const ws = buildWorkspace(userId, USERS_DIR);
  let files: string[];
  try {
    files = await fs.readdir(ws.jobsDir);
  } catch {
    return [];
  }

  const jobs = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        try {
          return await getJob(ws, file.replace(/\.json$/, ""));
        } catch {
          return null;
        }
      })
  );

  return jobs
    .filter((job): job is Job => job !== null)
    .sort(
      (a, b) =>
        new Date(a.triggered_at).getTime() - new Date(b.triggered_at).getTime()
    );
}

async function hasTriggerFile(userId: string, jobId: string): Promise<boolean> {
  const ws = buildWorkspace(userId, USERS_DIR);
  try {
    await fs.access(path.join(ws.triggersDir, `${jobId}.json`));
    return true;
  } catch {
    return false;
  }
}

export async function dispatchPendingAgentJobsForUser(userId: string): Promise<void> {
  const ws = buildWorkspace(userId, USERS_DIR);
  const jobs = await readUserJobs(userId);

  let activeCount = 0;
  const queued: Job[] = [];

  for (const job of jobs) {
    if (!isAgentManagedAction(job.action)) continue;
    if (job.status === "running") {
      activeCount += 1;
      continue;
    }
    if (job.status !== "pending") continue;

    if (await hasTriggerFile(userId, job.id)) {
      activeCount += 1;
      continue;
    }

    queued.push(job);
  }

  if (activeCount >= USER_AGENT_JOB_CONCURRENCY) return;

  const capacity = USER_AGENT_JOB_CONCURRENCY - activeCount;
  for (const job of queued.slice(0, capacity)) {
    await dispatchJob(ws, job);
    logger.info(`Agent dispatcher: released queued ${job.action} job ${job.id} for ${userId}`);
  }
}

async function dispatchAcrossAllUsers(): Promise<void> {
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(USERS_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return;
  }

  for (const userId of entries) {
    try {
      await dispatchPendingAgentJobsForUser(userId);
    } catch (err) {
      logger.warn(`Agent dispatcher error for ${userId}: ${String(err)}`);
    }
  }
}

let interval: NodeJS.Timeout | null = null;

export function startAgentJobDispatcher(): void {
  if (interval) return;

  setTimeout(() => {
    void dispatchAcrossAllUsers().catch((err: Error) =>
      logger.warn(`Agent dispatcher initial scan failed: ${err.message}`)
    );
  }, 5_000);

  interval = setInterval(() => {
    void dispatchAcrossAllUsers().catch((err: Error) =>
      logger.warn(`Agent dispatcher loop failed: ${err.message}`)
    );
  }, SCAN_INTERVAL_MS);

  logger.info(
    `Agent dispatcher started — concurrency=${USER_AGENT_JOB_CONCURRENCY} scan_interval=${SCAN_INTERVAL_MS / 1000}s`
  );
}

