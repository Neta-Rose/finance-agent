import { promises as fs } from "fs";
import path from "path";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import { logger } from "./logger.js";

const TERMINAL_OR_PAUSED = new Set(["paused", "failed", "cancelled", "superseded"]);

interface JobLite {
  id?: string;
  status?: string;
}

interface FullReportStateLite {
  jobId?: string;
  status?: string;
  updatedAt?: string;
}

async function readJsonOrNull<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Scan one user's jobs/ directory. If any job is in a terminal-or-paused
 * status, but the report state file references that same job AND claims
 * status="running", rewrite the state file to match the job. Returns the
 * count of repairs made. Idempotent.
 */
export async function reconcilePausedJobStates(ws: UserWorkspace): Promise<number> {
  const statePath = path.join(ws.reportsDir, "full_report_state.json");
  const state = await readJsonOrNull<FullReportStateLite>(statePath);
  if (!state || state.status !== "running" || !state.jobId) {
    return 0;
  }

  const jobPath = ws.jobFile(state.jobId);
  const job = await readJsonOrNull<JobLite>(jobPath);
  if (!job || !job.status || !TERMINAL_OR_PAUSED.has(job.status)) {
    return 0;
  }

  const updated = {
    ...state,
    status: job.status,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(statePath, JSON.stringify(updated, null, 2), "utf-8");
  logger.info(
    `Reconciled full_report_state.json for ${ws.userId}: running -> ${job.status} (jobId=${state.jobId})`
  );
  return 1;
}
