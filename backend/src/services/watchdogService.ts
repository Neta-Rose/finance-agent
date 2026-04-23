import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import { resolveConfiguredPath } from "./paths.js";
import { dispatchPendingAgentJobsForUser } from "./agentJobDispatcher.js";
import { markDeepDiveJobFailed } from "./deepDiveService.js";
import type { Job } from "../types/index.js";

// Action-specific timeouts for running jobs (in minutes)
const ACTION_TIMEOUTS: Record<string, number> = {
  quick_check: 2,      // 2 minutes max - should feel immediate
  daily_brief: 30,     // 30 minutes max - moderate complexity
  deep_dive: 120,      // 120 minutes max - complex analysis (increased from 60)
  new_ideas: 90,       // 90 minutes max - multiple ideas
  full_report: 120,    // 120 minutes max - very complex, multiple analysts
  switch_production: 2, // 2 minutes max - simple switch
  switch_testing: 2,    // 2 minutes max - simple switch
};

// Default timeout for unknown actions
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;   // 30 minutes

// Pending jobs: agent cron fires every 30 min; allow 2 full cron cycles + buffer.
// This only applies to jobs the agent never picked up at all (no started_at).
const PENDING_STALE_MS = 90 * 60 * 1000;   // 90 minutes
const AGENT_QUEUE_PENDING_MS = 24 * 60 * 60 * 1000; // queued deep dives/full reports may legitimately wait
const DEEP_DIVE_NO_PROGRESS_MS = 30 * 60 * 1000;

const SCAN_INTERVAL_MS = 5 * 60 * 1000;    // every 5 minutes

function resolveUsersDir(): string {
  return resolveConfiguredPath(process.env["USERS_DIR"], "../users");
}

function isAgentManagedAction(action: string | undefined): boolean {
  return action === "deep_dive" || action === "full_report";
}

async function listUserIds(usersDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(usersDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function scanUser(userId: string, usersDir: string): Promise<void> {
  const ws = buildWorkspace(userId, usersDir);

  let files: string[];
  try {
    files = await fs.readdir(ws.jobsDir);
  } catch {
    return; // no jobs dir yet
  }

  const now = Date.now();

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(ws.jobsDir, file);

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      // Parse leniently — agent-written files may have duplicate keys (last value wins)
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      const status = parsed["status"] as string | undefined;
      if (status !== "running" && status !== "pending") continue;

      const startedAt = parsed["started_at"] as string | null | undefined;
      const triggeredAt = parsed["triggered_at"] as string | null | undefined;
      const action = parsed["action"] as string | undefined;
      const isRunning = status === "running" && !!startedAt;

      // Reference time and threshold depend on whether the agent picked it up:
      // - Running (agent set started_at): use started_at + action-specific timeout
      // - Pending (never picked up): use triggered_at + two cron-cycle grace period
      const refTime = isRunning ? startedAt! : triggeredAt;
      if (!refTime) continue;

      const ageMs = now - new Date(refTime).getTime();
      let threshold = PENDING_STALE_MS;
      
      if (isRunning && action) {
        // Get action-specific timeout
        const timeoutMinutes = ACTION_TIMEOUTS[action] || DEFAULT_TIMEOUT_MS / 60000;
        threshold = timeoutMinutes * 60 * 1000;
      } else if (isAgentManagedAction(action)) {
        threshold = AGENT_QUEUE_PENDING_MS;
      }

      if (
        action === "deep_dive" &&
        isRunning &&
        ageMs >= DEEP_DIVE_NO_PROGRESS_MS &&
        typeof parsed["ticker"] === "string"
      ) {
        const jobId = (parsed["id"] as string | undefined) ?? file.replace(".json", "");
        const hasProgress = await hasDeepDiveMadeProgress(ws, jobId, parsed["ticker"] as string);
        if (!hasProgress) {
          const reason =
            `Failed after ${Math.round(ageMs / 60000)} min with no deep-dive progress — no valid artifacts or strategy refresh were produced`;
          await markDeepDiveJobFailed(ws, parsed as unknown as Job, reason, new Date().toISOString());
          logger.warn(
            `Watchdog: failed deep_dive ${jobId} early for no progress (user=${userId} age=${Math.round(ageMs / 60000)}m ticker=${parsed["ticker"] as string})`
          );
          await dispatchPendingAgentJobsForUser(userId);
          continue;
        }
      }
      
      if (ageMs < threshold) continue;

      const ageMin = Math.round(ageMs / 60000);
      const jobId =
        (parsed["id"] as string | undefined) ?? file.replace(".json", "");

      const reason = isRunning
        ? `Timed out after ${ageMin} min — agent started but did not complete (watchdog)`
        : `Abandoned after ${ageMin} min — agent never picked up this job (watchdog)`;

      if (action === "deep_dive") {
        await markDeepDiveJobFailed(ws, parsed as unknown as Job, reason, new Date().toISOString());
      } else {
        const updated: Record<string, unknown> = {
          ...parsed,
          status: "failed",
          completed_at: new Date().toISOString(),
          error: reason,
        };
        await fs.writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
      }
      logger.warn(
        `Watchdog: failed job ${jobId} (user=${userId} action=${String(parsed["action"])} age=${ageMin}m status=${status})`
      );

      if (isRunning && isAgentManagedAction(action)) {
        await dispatchPendingAgentJobsForUser(userId);
      }
    } catch (err) {
      logger.error(
        `Watchdog: error processing ${file} for ${userId}: ${(err as Error).message}`
      );
    }
  }
}

async function hasDeepDiveMadeProgress(
  ws: ReturnType<typeof buildWorkspace>,
  jobId: string,
  ticker: string
): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(ws.reportsDir, ticker, "deep_dive_state.json"), "utf-8");
    const state = JSON.parse(raw) as {
      jobId?: string;
      completedSteps?: number;
      strategyReady?: boolean;
      status?: string;
    };
    if (state.jobId !== jobId) return false;
    return (state.completedSteps ?? 0) > 0 || state.strategyReady === true || state.status === "completed";
  } catch {
    return false;
  }
}

async function scan(): Promise<void> {
  const usersDir = resolveUsersDir();
  const userIds = await listUserIds(usersDir);
  await Promise.all(userIds.map((id) => scanUser(id, usersDir)));
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startWatchdog(): void {
  if (interval) return;

  // Delay initial scan 30s so the server fully starts before touching files
  setTimeout(() => {
    scan().catch((err: Error) =>
      logger.error(`Watchdog initial scan error: ${err.message}`)
    );
  }, 30_000);

  interval = setInterval(() => {
    scan().catch((err: Error) =>
      logger.error(`Watchdog scan error: ${err.message}`)
    );
  }, SCAN_INTERVAL_MS);

  logger.info(
    `Job watchdog started — action_timeouts=${JSON.stringify(ACTION_TIMEOUTS)} pending_threshold=${PENDING_STALE_MS / 60000}min scan_interval=${SCAN_INTERVAL_MS / 60000}min`
  );
}

export function stopWatchdog(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
