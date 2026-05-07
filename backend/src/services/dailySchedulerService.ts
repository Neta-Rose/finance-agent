import { promises as fs } from "fs";
import path from "path";
import { buildWorkspace } from "../middleware/userIsolation.js";
import { createJob, listJobs } from "./jobService.js";
import { runDailyBriefJob } from "./dailyBriefService.js";
import { getActiveUserEligibility, readState } from "./stateService.js";
import { logger } from "./logger.js";
import { isFeatureEnabled } from "./featureFlagService.js";
import { admitOrReuseStepQueueJob } from "./stepQueue/admission.js";
import { ensurePointsBudgetAvailable } from "./pointsBudgetService.js";
import { isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { getApplicationDataSource } from "../db/applicationDataSource.js";

const USERS_DIR = process.env["USERS_DIR"] ?? path.join(process.cwd(), "../users");
const POLL_INTERVAL_MS = 30_000;

/**
 * In-memory dedup: tracks the last minute-key for which we fired a daily
 * brief per user. Prevents double-firing within the same minute if the
 * scheduler loop runs twice.
 */
const seenMinuteKeys = new Map<string, string>();

interface ScheduledUser {
  userId: string;
  dailyBriefTime: string;
  timezone: string;
}

function getTimeParts(now: Date, timezone: string): { day: string; hourMinute: string; minuteKey: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = `${lookup["year"]}-${lookup["month"]}-${lookup["day"]}`;
  const hourMinute = `${lookup["hour"]}:${lookup["minute"]}`;
  return {
    day,
    hourMinute,
    minuteKey: `${day}T${hourMinute}`,
  };
}

function localDayFromIso(iso: string, timezone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return getTimeParts(date, timezone).day;
}

async function listScheduledUsers(): Promise<ScheduledUser[]> {
  const entries = await fs.readdir(USERS_DIR, { withFileTypes: true });
  const users: ScheduledUser[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = await fs.readFile(path.join(USERS_DIR, entry.name, "profile.json"), "utf-8");
      const profile = JSON.parse(raw) as {
        schedule?: { dailyBriefTime?: string; timezone?: string };
      };
      if (profile.schedule?.dailyBriefTime && profile.schedule?.timezone) {
        users.push({
          userId: entry.name,
          dailyBriefTime: profile.schedule.dailyBriefTime,
          timezone: profile.schedule.timezone,
        });
      }
    } catch {
      // ignore invalid/missing profiles
    }
  }

  return users;
}

/**
 * Acquire a per-minute distributed lease via Postgres advisory lock so that
 * multiple replicas do not double-fire the same user's daily brief.
 *
 * Returns true if this replica acquired the lease (should proceed), false if
 * another replica already holds it.
 *
 * The lock is session-scoped and released automatically when the connection
 * is returned to the pool.
 */
async function tryAcquireMinuteLease(userId: string, minuteKey: string): Promise<boolean> {
  if (!isApplicationDatabaseConfigured()) return true; // no DB → single-replica, always proceed
  try {
    const ds = await getApplicationDataSource();
    // Use a stable numeric key derived from userId + minuteKey
    const { createHash } = await import("crypto");
    const hash = createHash("sha256").update(`${userId}:${minuteKey}`).digest();
    const lockKey = (BigInt(hash.readUInt32BE(0)) << 32n | BigInt(hash.readUInt32BE(4))) & 0x7fffffffffffffffn;
    const rows = await ds.query(
      `SELECT pg_try_advisory_lock($1::bigint) AS acquired`,
      [lockKey.toString()]
    ) as Array<{ acquired: boolean }>;
    return rows[0]?.acquired === true;
  } catch {
    return true; // DB error → fall through and let the scheduler run
  }
}

async function runDueDailyBriefs(): Promise<void> {
  const users = await listScheduledUsers();
  const now = new Date();
  const useLegacyRunners = await isFeatureEnabled("legacy_job_runners_enabled");

  await Promise.all(
    users.map(async (user) => {
      const time = getTimeParts(now, user.timezone);
      if (time.hourMinute !== user.dailyBriefTime) return;
      if (seenMinuteKeys.get(user.userId) === time.minuteKey) return;

      const ws = buildWorkspace(user.userId, USERS_DIR);
      const state = await readState(user.userId);
      if (state.state !== "ACTIVE") return;

      const eligibility = await getActiveUserEligibility(user.userId);
      if (!eligibility.eligible) {
        seenMinuteKeys.set(user.userId, time.minuteKey);
        logger.warn(
          `Daily scheduler: skipping ${user.userId} at ${time.minuteKey} because ${eligibility.reason ?? "user is not eligible"}`
        );
        return;
      }

      const lastDailyDay = state.lastDailyAt ? localDayFromIso(state.lastDailyAt, user.timezone) : null;
      if (lastDailyDay === time.day) {
        seenMinuteKeys.set(user.userId, time.minuteKey);
        return;
      }

      // Distributed lease: only one replica fires per user per minute
      const leaseAcquired = await tryAcquireMinuteLease(user.userId, time.minuteKey);
      if (!leaseAcquired) {
        seenMinuteKeys.set(user.userId, time.minuteKey);
        return;
      }

      seenMinuteKeys.set(user.userId, time.minuteKey);

      if (useLegacyRunners) {
        // Legacy path: create a job file and run the brief inline
        const jobs = await listJobs(ws, 100);
        const hasActiveDaily = jobs.some(
          (job) => job.action === "daily_brief" && (job.status === "pending" || job.status === "running")
        );
        if (hasActiveDaily) return;

        logger.info(`Daily scheduler (legacy): triggering daily_brief for ${user.userId} at ${time.minuteKey}`);
        const job = await createJob(ws, "daily_brief");
        await runDailyBriefJob(ws, job);
      } else {
        // Step-queue path: admit a daily_brief job through the step queue
        if (!isApplicationDatabaseConfigured()) {
          logger.warn(`Daily scheduler: APP_DATABASE_URL not configured, cannot admit step-queue job for ${user.userId}`);
          return;
        }

        const budgetGate = await ensurePointsBudgetAvailable(user.userId);
        if (!budgetGate.allowed) {
          logger.info(`Daily scheduler: budget exhausted for ${user.userId}, skipping daily_brief`);
          return;
        }

        logger.info(`Daily scheduler (step-queue): triggering daily_brief for ${user.userId} at ${time.minuteKey}`);
        const admitted = await admitOrReuseStepQueueJob({
          workspace: ws,
          action: "daily_brief",
          source: "auto_brief",
          budgetAdmittedAt: new Date(),
        });
        logger.info(`Daily scheduler: admitted job ${admitted.jobId} for ${user.userId} (reused=${admitted.reused})`);
      }
    })
  );
}

export function startDailyScheduler(): void {
  void runDueDailyBriefs().catch((err: Error) =>
    logger.warn(`Daily scheduler initial run failed: ${err.message}`)
  );

  setInterval(() => {
    void runDueDailyBriefs().catch((err: Error) =>
      logger.warn(`Daily scheduler loop failed: ${err.message}`)
    );
  }, POLL_INTERVAL_MS);
}
