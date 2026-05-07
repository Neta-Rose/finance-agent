import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import {
  detectDeepDiveExecutionFailureSignal,
  markDeepDiveJobFailed,
  reconcileDeepDiveJob,
  reconcileFailedDeepDiveJob,
} from "./deepDiveService.js";
import { reconcileFailedFullReportJob, reconcileFullReportJob } from "./fullReportService.js";
import { getUserControl } from "./controlService.js";
import { repairActiveUserState } from "./stateService.js";
import type { Job } from "../types/index.js";

const SCAN_INTERVAL_MS = 30 * 1000;
const USERS_DIR = "/root/clawd/users";

async function readActiveJobs(userId: string): Promise<Array<Job>> {
  const workspace = buildWorkspace(userId, USERS_DIR);
  let jobFiles: string[];
  try {
    jobFiles = await fs.readdir(workspace.jobsDir);
  } catch {
    return [];
  }

  const jobs = await Promise.all(
    jobFiles
      .filter((file) => file.endsWith(".json"))
      .map(async (file): Promise<Job | null> => {
        try {
          const raw = await fs.readFile(path.join(workspace.jobsDir, file), "utf-8");
          const job = JSON.parse(raw) as Job;
          if (
            job.status !== "pending" &&
            job.status !== "running" &&
            job.status !== "failed" &&
            !(job.status === "completed" && (job.action === "deep_dive" || job.action === "full_report"))
          ) {
            return null;
          }
          return job;
        } catch (err) {
          logger.warn(`Skipping unreadable job ${file} for ${userId}: ${String(err)}`);
          return null;
        }
      })
  );

  return jobs.filter((job): job is Job => job !== null);
}

async function scanUser(userId: string): Promise<void> {
  const workspace = buildWorkspace(userId, USERS_DIR);
  await repairActiveUserState(userId);
  await getUserControl(userId); // ensure control record exists
  const jobs = await readActiveJobs(userId);

  for (const job of jobs) {
    try {
      if (job.action === "deep_dive" && job.status === "failed" && job.ticker) {
        await reconcileFailedDeepDiveJob(workspace, job);
        continue;
      }
      if (job.action === "deep_dive" && job.status === "running" && job.ticker) {
        const executionFailure = await detectDeepDiveExecutionFailureSignal(userId, job);
        if (executionFailure) {
          await markDeepDiveJobFailed(workspace, job, executionFailure);
          continue;
        }
      }
      if (job.action === "full_report" && job.status === "failed") {
        await reconcileFailedFullReportJob(workspace, job);
        continue;
      }
      if (job.action === "deep_dive" && job.ticker) {
        await reconcileDeepDiveJob(workspace, job);
      }
      if (job.action === "full_report") {
        await reconcileFullReportJob(workspace, job);
      }
    } catch (err) {
      logger.warn(`Job reconciliation error for ${userId}/${job.id}: ${String(err)}`);
    }
  }
}

async function scanAllUsers(): Promise<void> {
  let userDirs: string[];
  try {
    userDirs = (await fs.readdir(USERS_DIR, { withFileTypes: true }))
      .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith("."))
      .map((dirent) => dirent.name);
  } catch {
    return;
  }

  await Promise.all(userDirs.map((userId) => scanUser(userId)));
}

let interval: NodeJS.Timeout | null = null;

export function startJobCompletionWatcher(): void {
  if (interval) return;

  setTimeout(() => {
    scanAllUsers().catch((err) =>
      logger.error(`Job completion watcher initial scan error: ${String(err)}`)
    );
  }, 10_000);

  interval = setInterval(() => {
    scanAllUsers().catch((err) =>
      logger.error(`Job completion watcher scan error: ${String(err)}`)
    );
  }, SCAN_INTERVAL_MS);

  logger.info(
    `Job completion watcher started — scan_interval=${SCAN_INTERVAL_MS / 1000}s`
  );
}

export function stopJobCompletionWatcher(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
