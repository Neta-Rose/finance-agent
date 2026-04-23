import { promises as fs } from "fs";
import path from "path";
import { buildWorkspace } from "../middleware/userIsolation.js";
import { createJob, listJobs } from "./jobService.js";
import { runDailyBriefJob } from "./dailyBriefService.js";
import { getActiveUserEligibility, readState } from "./stateService.js";
import { logger } from "./logger.js";

const USERS_DIR = process.env["USERS_DIR"] ?? path.join(process.cwd(), "../users");
const POLL_INTERVAL_MS = 30_000;
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

async function runDueDailyBriefs(): Promise<void> {
  const users = await listScheduledUsers();
  const now = new Date();

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

      const jobs = await listJobs(ws, 100);
      const hasActiveDaily = jobs.some(
        (job) => job.action === "daily_brief" && (job.status === "pending" || job.status === "running")
      );
      if (hasActiveDaily) {
        seenMinuteKeys.set(user.userId, time.minuteKey);
        return;
      }

      seenMinuteKeys.set(user.userId, time.minuteKey);
      logger.info(`Daily scheduler: triggering daily_brief for ${user.userId} at ${time.minuteKey} (${user.timezone})`);
      const job = await createJob(ws, "daily_brief", undefined, { dispatch: false });
      await runDailyBriefJob(ws, job);
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
