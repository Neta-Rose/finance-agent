import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import { resolveConfiguredPath } from "./paths.js";

// Running jobs: killed if no completion signal within this window.
// full_report can span many positions — 60 min is generous but safe.
const RUNNING_STALE_MS = 60 * 60 * 1000;   // 60 minutes

// Pending jobs: agent cron fires every 30 min; allow 2 full cron cycles + buffer.
// This only applies to jobs the agent never picked up at all (no started_at).
const PENDING_STALE_MS = 90 * 60 * 1000;   // 90 minutes

const SCAN_INTERVAL_MS = 5 * 60 * 1000;    // every 5 minutes

function resolveUsersDir(): string {
  return resolveConfiguredPath(process.env["USERS_DIR"], "../users");
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
      const isRunning = status === "running" && !!startedAt;

      // Reference time and threshold depend on whether the agent picked it up:
      // - Running (agent set started_at): use started_at + generous running window
      // - Pending (never picked up): use triggered_at + two cron-cycle grace period
      const refTime = isRunning ? startedAt! : triggeredAt;
      if (!refTime) continue;

      const ageMs = now - new Date(refTime).getTime();
      const threshold = isRunning ? RUNNING_STALE_MS : PENDING_STALE_MS;
      if (ageMs < threshold) continue;

      const ageMin = Math.round(ageMs / 60000);
      const jobId =
        (parsed["id"] as string | undefined) ?? file.replace(".json", "");

      const reason = isRunning
        ? `Timed out after ${ageMin} min — agent started but did not complete (watchdog)`
        : `Abandoned after ${ageMin} min — agent never picked up this job (watchdog)`;

      const updated: Record<string, unknown> = {
        ...parsed,
        status: "failed",
        completed_at: new Date().toISOString(),
        error: reason,
      };

      await fs.writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
      logger.warn(
        `Watchdog: failed job ${jobId} (user=${userId} action=${String(parsed["action"])} age=${ageMin}m status=${status})`
      );
    } catch (err) {
      logger.error(
        `Watchdog: error processing ${file} for ${userId}: ${(err as Error).message}`
      );
    }
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
    `Job watchdog started — running_threshold=${RUNNING_STALE_MS / 60000}min pending_threshold=${PENDING_STALE_MS / 60000}min scan_interval=${SCAN_INTERVAL_MS / 60000}min`
  );
}

export function stopWatchdog(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
