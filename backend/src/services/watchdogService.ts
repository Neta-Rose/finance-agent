import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger.js";
import { buildWorkspace } from "../middleware/userIsolation.js";

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
const SCAN_INTERVAL_MS = 5 * 60 * 1000;    // every 5 minutes

function resolveUsersDir(): string {
  // Match the same resolution logic as userIsolation middleware
  return path.resolve(process.env["USERS_DIR"] ?? "../users");
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

      // Reference time: prefer started_at, fall back to triggered_at
      const refTime =
        (parsed["started_at"] as string | null | undefined) ??
        (parsed["triggered_at"] as string | null | undefined);
      if (!refTime) continue;

      const ageMs = now - new Date(refTime).getTime();
      if (ageMs < STALE_THRESHOLD_MS) continue;

      const ageMin = Math.round(ageMs / 60000);
      const jobId =
        (parsed["id"] as string | undefined) ?? file.replace(".json", "");

      const updated: Record<string, unknown> = {
        ...parsed,
        status: "failed",
        completed_at: new Date().toISOString(),
        error: `Timed out after ${ageMin} min — no completion signal (watchdog)`,
      };

      await fs.writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
      logger.warn(
        `Watchdog: failed job ${jobId} (user=${userId} action=${String(parsed["action"])} age=${ageMin}m)`
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
    `Job watchdog started — stale_threshold=${STALE_THRESHOLD_MS / 60000}min scan_interval=${SCAN_INTERVAL_MS / 60000}min`
  );
}

export function stopWatchdog(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
