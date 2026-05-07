import { Router, type Request, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import path from "path";
import { isApplicationDatabaseConfigured, getApplicationDataSource } from "../db/applicationDataSource.js";
import { admitOrReuseStepQueueJob } from "../services/stepQueue/admission.js";
import { ensurePointsBudgetAvailable } from "../services/pointsBudgetService.js";
import { requiresBudgetAdmission } from "../services/jobAdmissionService.js";
import { createUserWorkspace, validateWorkspaceIntegrity, workspaceExists } from "../services/workspaceService.js";
import { hashPassword } from "../middleware/auth.js";
import { logger } from "../services/logger.js";
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  getUserProfileStatus,
  setUserProfile,
  getSystemAgentProfileStatus,
  setSystemAgentProfile,
} from "../services/profileService.js";
import type { PointsBudgetConfig, RateLimits } from "../types/index.js";
import type { ProfileDefinition } from "../schemas/profile.js";
import { eventStore } from "../services/eventStore.js";
import {
  getUserControl,
  setUserControl,
  clearUserControl,
  getSystemControl,
  setSystemControl,
  incrementTokenVersion,
} from "../services/controlService.js";
import { updateJob, listJobs, getJob } from "../services/jobService.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import type { JobAction, Job } from "../types/index.js";
import { connectUserTelegramChannel } from "../services/channelService.js";
import { listSupportMessages, updateSupportMessageStatus } from "../services/supportService.js";
import { getActiveUserEligibility } from "../services/stateService.js";
import { markDeepDiveJobCancelled } from "../services/deepDiveService.js";
import {
  getUserPointsBalanceSnapshot,
  getUserPointsBudget,
  setUserPointsBudget,
} from "../services/pointsBudgetService.js";
const SYSTEM_AGENT_ID = "main";

const OPENCLAW_RETIRED_HEALTH = {
  healthy: true,
  consecutiveErrors: 0,
  lastError: null as null,
  lastErrorReason: null as null,
  lastRunAt: null as null,
  classification: "inactive" as const,
  statusReason: "openclaw_retired",
  operational: false,
};
import {
  ensureDefaultModelTierAssignments,
  isModelTier,
  readUserModelTier,
  writeUserModelTier,
} from "../services/stepQueue/modelTier.js";
import { MODEL_TIERS, STEP_KINDS } from "../services/stepQueue/types.js";
import type { ModelTier, StepKind, JobAction as StepQueueJobAction } from "../services/stepQueue/types.js";
import { getAdminDefaults, updateAdminDefaults, type AdminDefaultsPatch } from "../services/adminDefaultsService.js";

const USERS_DIR = process.env["USERS_DIR"] ?? "../users";
const ADMIN_KEY = process.env["ADMIN_KEY"] ?? "";

const router = Router();

// Check admin key
function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-admin-key"];
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

router.use(adminAuth);

type AdminHandler = (req: Request, res: Response) => Promise<void>;

function handler(fn: AdminHandler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (e) {
      next(e);
    }
  };
}

// GET /api/admin/defaults
router.get(
  "/defaults",
  handler(async (_req, res) => {
    res.json({ defaults: await getAdminDefaults() });
  })
);

// PATCH /api/admin/defaults
router.patch(
  "/defaults",
  handler(async (req, res) => {
    const body = req.body as {
      modelTier?: unknown;
      pointsBudget?: Partial<PointsBudgetConfig>;
      updatedBy?: string;
    };
    try {
      const patch: AdminDefaultsPatch = {};
      if (body.modelTier !== undefined) patch.modelTier = body.modelTier as ModelTier;
      if (body.pointsBudget !== undefined) patch.pointsBudget = body.pointsBudget;
      const defaults = await updateAdminDefaults(
        patch,
        typeof body.updatedBy === "string" ? body.updatedBy : "admin-ui"
      );
      res.json({ defaults });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid_defaults" });
    }
  })
);

function mutationRows<T extends Record<string, unknown>>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    Array.isArray(result[0]) &&
    (typeof result[1] === "number" || result.length === 2)
  ) {
    return result[0] as T[];
  }
  return Array.isArray(result) ? result as T[] : [];
}

function parseIsoRange(req: Request, res: Response): { from: Date; to: Date } | null {
  const fromRaw = typeof req.query["from"] === "string" ? req.query["from"] : "";
  const toRaw = typeof req.query["to"] === "string" ? req.query["to"] : "";
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (!fromRaw || !toRaw || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    res.status(400).json({ error: "valid from and to ISO timestamps required" });
    return null;
  }
  if (from >= to) {
    res.status(400).json({ error: "from must be before to" });
    return null;
  }
  const maxRangeMs = 366 * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxRangeMs) {
    res.status(400).json({ error: "range too large; maximum is 366 days" });
    return null;
  }
  return { from, to };
}

async function patchUserPointsBudget(req: Request, res: Response): Promise<void> {
  const userId = req.params.userId as string;
  if (!userId) {
    res.status(400).json({ error: "userId required" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: Partial<PointsBudgetConfig> = {};
  if (typeof body["dailyBudgetPoints"] !== "undefined") {
    updates.dailyBudgetPoints = Number(body["dailyBudgetPoints"]);
  }

  try {
    const pointsBudget = await setUserPointsBudget(userId, updates);
    res.json({ userId, pointsBudget });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "User not found" });
  }
}

router.get(
  "/support/messages",
  handler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100), 1), 500);
    const messages = await listSupportMessages(limit);
    res.json({ messages });
  })
);

router.patch(
  "/support/messages/:messageId",
  handler(async (req, res) => {
    const messageId = req.params.messageId as string;
    const status = (req.body as { status?: string }).status;
    if (status !== "open" && status !== "closed") {
      res.status(400).json({ error: "status must be open or closed" });
      return;
    }

    const message = await updateSupportMessageStatus(messageId, status);
    if (!message) {
      res.status(404).json({ error: "message_not_found" });
      return;
    }

    res.json({ message });
  })
);

// GET /api/admin/users
router.get(
  "/users",
  handler(async (_req, res) => {
    let entries: string[] = [];
    try {
      const dirents = await fs.readdir(USERS_DIR, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
    } catch {
      entries = [];
    }

    const defaults = await getAdminDefaults();
    const users = await Promise.all(
      entries.map(async (userId) => {
        const userRoot = path.join(USERS_DIR, userId);
        const profilePath = path.join(userRoot, "profile.json");
        const statePath = path.join(userRoot, "data", "state.json");
        const portfolioPath = path.join(userRoot, "data", "portfolio.json");

        let displayName = userId;
        let createdAt = "";
        let modelTier: ModelTier = defaults.modelTier;
        const schedule = { dailyBriefTime: "08:00", weeklyResearchDay: "sunday", weeklyResearchTime: "19:00", timezone: "Asia/Jerusalem" };
        const rateLimits = {
          full_report: { maxPerPeriod: 1, periodHours: 168 },
          daily_brief: { maxPerPeriod: 3, periodHours: 24 },
          deep_dive: { maxPerPeriod: 5, periodHours: 24 },
          new_ideas: { maxPerPeriod: 2, periodHours: 168 },
          quick_check: { maxPerPeriod: 20, periodHours: 24 },
        };

        try {
          const profile = JSON.parse(await fs.readFile(profilePath, "utf-8"));
          displayName = profile.displayName ?? userId;
          createdAt = profile.createdAt ?? "";
          if (profile.schedule) Object.assign(schedule, profile.schedule);
          if (profile.rateLimits) Object.assign(rateLimits, profile.rateLimits);
          modelTier = isModelTier(profile.modelTier) ? profile.modelTier : modelTier;
        } catch { /* no profile */ }

        let pointsBudget: PointsBudgetConfig = { ...defaults.pointsBudget };
        try {
          pointsBudget = await getUserPointsBudget(userId);
        } catch {
          pointsBudget = { ...defaults.pointsBudget };
        }

        let state = "UNKNOWN";
        try {
          const st = JSON.parse(await fs.readFile(statePath, "utf-8"));
          state = st.state ?? "UNKNOWN";
        } catch { /* no state */ }

        let portfolioLoaded = false;
        try {
          await fs.access(portfolioPath);
          portfolioLoaded = true;
        } catch { /* no portfolio */ }

        const [profileStatus, userCtrl, activeEligibility, integrity] = await Promise.all([
          getUserProfileStatus(userId),
          getUserControl(userId),
          state === "ACTIVE"
            ? getActiveUserEligibility(userId)
            : Promise.resolve({ eligible: true, reason: null }),
          validateWorkspaceIntegrity(userId),
        ]);

        return {
          userId,
          displayName,
          state,
          portfolioLoaded,
          agentConfigured: false,
          hasTelegram: false,
          telegramChatId: undefined,
          createdAt,
          rateLimits,
          schedule,
          pointsBudget,
          modelTier,
          modelProfile: profileStatus.name,
          profileBroken: profileStatus.broken,
          profileBrokenReason: profileStatus.broken ? profileStatus.reason : undefined,
          agentHealth: OPENCLAW_RETIRED_HEALTH,
          restriction: userCtrl.restriction,
          eligibilityIssue: activeEligibility.eligible ? null : activeEligibility.reason,
          integrityValid: integrity.valid,
          integrityErrors: integrity.errors,
          integrityWarnings: integrity.warnings,
        };
      })
    );

    res.json({ users });
  })
);

// POST /api/admin/users
router.post(
  "/users",
  handler(async (req, res) => {
    const body = req.body as Record<string, unknown>;

    const userId = String(body.userId ?? "").trim();
    const password = String(body.password ?? "");
    const displayName = String(body.displayName ?? userId).trim();
    const telegramChatId = body.telegramChatId ? String(body.telegramChatId) : undefined;
    const schedule = (body.schedule as Record<string, string>) ?? {
      dailyBriefTime: "08:00",
      weeklyResearchDay: "sunday",
      weeklyResearchTime: "19:00",
      timezone: "Asia/Jerusalem",
    };
    const rateLimits = (body.rateLimits as RateLimits) ?? {
      full_report: { maxPerPeriod: 1, periodHours: 168 },
      daily_brief: { maxPerPeriod: 3, periodHours: 24 },
      deep_dive: { maxPerPeriod: 5, periodHours: 24 },
      new_ideas: { maxPerPeriod: 2, periodHours: 168 },
      quick_check: { maxPerPeriod: 20, periodHours: 24 },
    };
    const defaults = await getAdminDefaults();
    const modelTier = isModelTier(body.modelTier) ? body.modelTier : defaults.modelTier;
    const pointsBudget = {
      dailyBudgetPoints: Number(
        (body.pointsBudget as Partial<PointsBudgetConfig> | undefined)?.dailyBudgetPoints ??
          defaults.pointsBudget.dailyBudgetPoints
      ),
    };

    if (!/^[a-zA-Z0-9-]{4,32}$/.test(userId)) {
      res.status(400).json({ error: "userId must be 4-32 alphanumeric or hyphens" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "password must be at least 8 characters" });
      return;
    }
    if (await workspaceExists(userId)) {
      res.status(409).json({ error: "User already exists" });
      return;
    }

    const ws = await createUserWorkspace(userId);

    const hash = await hashPassword(password);
    await fs.writeFile(path.join(ws.root, "auth.json"), JSON.stringify({ passwordHash: hash }), "utf-8");

    const profile = {
      userId,
      displayName,
      telegramChatId: telegramChatId ?? null,
      schedule,
      rateLimits,
      modelTier,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(ws.root, "profile.json"), JSON.stringify(profile, null, 2), "utf-8");
    await setUserPointsBudget(userId, pointsBudget);

    try {
      await setUserProfile(userId, "testing");
    } catch (err) {
      logger.warn(`Failed to apply default model profile for ${userId}: ${err}`);
    }

    res.status(201).json({ userId, created: true });
  })
);

// DELETE /api/admin/users/:userId
router.delete(
  "/users/:userId",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }

    if (userId === "main" || userId === "admin") {
      res.status(400).json({ error: "Cannot delete system user" });
      return;
    }

    const userRoot = path.join(USERS_DIR, userId);
    const archiveDir = path.join(USERS_DIR, ".archived");

    try {
      await fs.access(userRoot);
      // Workspace exists — archive it
      await fs.mkdir(archiveDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.rename(userRoot, path.join(archiveDir, `${userId}_${ts}`));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error(`Failed to archive ${userId}`, { err });
        res.status(500).json({ error: "Failed to delete workspace" });
        return;
      }
      // Workspace already gone — treat as success
      logger.info(`Workspace already absent for ${userId}, skipping archive`);
    }

    res.json({ deleted: true });
  })
);

// PATCH /api/admin/users/:userId/limits
router.patch(
  "/users/:userId/limits",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const updates = req.body as Partial<RateLimits>;
    const profilePath = path.join(USERS_DIR, userId, "profile.json");

    let profile: Record<string, unknown> = {};
    try {
      profile = JSON.parse(await fs.readFile(profilePath, "utf-8"));
    } catch {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const currentLimits = (profile.rateLimits as RateLimits) ?? {
      full_report: { maxPerPeriod: 1, periodHours: 168 },
      daily_brief: { maxPerPeriod: 3, periodHours: 24 },
      deep_dive: { maxPerPeriod: 5, periodHours: 24 },
      new_ideas: { maxPerPeriod: 2, periodHours: 168 },
      quick_check: { maxPerPeriod: 20, periodHours: 24 },
    };

    const merged = { ...currentLimits, ...updates };
    profile.rateLimits = merged;
    await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), "utf-8");
    res.json({ userId, rateLimits: merged });
  })
);

// PATCH /api/admin/users/:userId/points-budget
router.patch(
  "/users/:userId/points-budget",
  handler(patchUserPointsBudget)
);

// Legacy compatibility during mixed frontend/backend deploy states.
router.patch(
  "/users/:userId/token-budgets",
  handler(patchUserPointsBudget)
);

// PATCH /api/admin/users/:userId/model-tier
router.patch(
  "/users/:userId/model-tier",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    const modelTier = (req.body as { modelTier?: unknown }).modelTier;
    if (!userId) {
      res.status(400).json({ error: "userId required" });
      return;
    }
    if (!isModelTier(modelTier)) {
      res.status(400).json({ error: `modelTier must be one of ${MODEL_TIERS.join(", ")}` });
      return;
    }
    await writeUserModelTier(userId, modelTier);
    res.json({ userId, modelTier: await readUserModelTier(userId) });
  })
);

// POST /api/admin/users/:userId/telegram
router.post(
  "/users/:userId/telegram",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const { botToken, telegramChatId } = req.body as { botToken: string; telegramChatId: string };

    if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(botToken)) {
      res.status(400).json({ error: "Invalid bot token format" });
      return;
    }

    try {
      await connectUserTelegramChannel(userId, botToken, telegramChatId);
    } catch (err) {
      logger.error(`Failed to update Telegram for ${userId}`, { err });
      res.status(500).json({ error: "Failed to update Telegram" });
      return;
    }
    res.json({ updated: true });
  })
);

// GET /api/admin/status
router.get(
  "/status",
  handler(async (_req, res) => {
    let totalUsers = 0;

    try {
      const dirents = await fs.readdir(USERS_DIR, { withFileTypes: true });
      totalUsers = dirents.filter((e) => e.isDirectory() && !e.name.startsWith('.')).length;
    } catch { /* ignore */ }

    res.json({ gatewayRunning: false, totalUsers, activeAgents: 0 });
  })
);

router.get(
  "/system-agent",
  handler(async (_req, res) => {
    const profileStatus = await getSystemAgentProfileStatus();

    res.json({
      agentId: SYSTEM_AGENT_ID,
      workspace: "/root/clawd",
      configured: false,
      hasTelegram: false,
      telegramAccountId: undefined,
      modelProfile: profileStatus.name,
      profileBroken: profileStatus.broken,
      profileBrokenReason: profileStatus.broken ? profileStatus.reason : undefined,
      agentHealth: OPENCLAW_RETIRED_HEALTH,
    });
  })
);

// GET /api/admin/profiles
router.get(
  "/profiles",
  handler(async (_req, res) => {
    const profiles = await listProfiles();
    res.json({ profiles });
  })
);

// POST /api/admin/profiles
router.post(
  "/profiles",
  handler(async (req, res) => {
    const body = req.body as { name?: string; definition?: ProfileDefinition };
    const name = String(body.name ?? "").trim();
    const def = body.definition;
    if (!name || !def) {
      res.status(400).json({ error: "name and definition required" });
      return;
    }
    try {
      await createProfile(name, def);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create profile";
      const status = msg.includes("already exists") ? 409 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    res.status(201).json({ created: true, name });
  })
);

// PATCH /api/admin/profiles/:name
router.patch(
  "/profiles/:name",
  handler(async (req, res) => {
    const name = req.params.name as string;
    const def = req.body as ProfileDefinition;
    try {
      await updateProfile(name, def);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update profile";
      const status = msg.includes("not found") ? 404 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    res.json({ updated: true, name });
  })
);

// DELETE /api/admin/profiles/:name
router.delete(
  "/profiles/:name",
  handler(async (req, res) => {
    const name = req.params.name as string;
    try {
      await deleteProfile(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete profile";
      const status = msg.includes("not found") ? 404 : msg.includes("still on it") || msg.includes("reserved") ? 409 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    res.json({ deleted: true, name });
  })
);

// PATCH /api/admin/users/:userId/profile
router.patch(
  "/users/:userId/profile",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const { profileName } = req.body as { profileName?: string };
    if (!profileName) { res.status(400).json({ error: "profileName required" }); return; }
    try {
      await setUserProfile(userId, profileName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to set profile";
      const status = msg.includes("not found") ? 404 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    res.json({ updated: true, userId, profileName });
  })
);

router.patch(
  "/system-agent/profile",
  handler(async (req, res) => {
    const { profileName } = req.body as { profileName?: string };
    if (!profileName) {
      res.status(400).json({ error: "profileName required" });
      return;
    }
    try {
      await setSystemAgentProfile(profileName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to set profile";
      const status = msg.includes("not found") ? 404 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    res.json({ updated: true, agentId: SYSTEM_AGENT_ID, profileName });
  })
);

// ── Observability routes ──────────────────────────────────────────────────────

// GET /api/admin/observability/summary — all users, today's aggregate totals
router.get(
  "/observability/summary",
  handler(async (_req, res) => {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const users = await eventStore.getDailySummary(today);
    res.json({ date: today, users });
  })
);

// GET /api/admin/observability/range — arbitrary UTC range aggregate from Postgres
router.get(
  "/observability/range",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const range = parseIsoRange(req, res);
    if (!range) return;

    const ds = await getApplicationDataSource();
    const users = await ds.query(
      `SELECT
         user_id AS "userId",
         COUNT(*)::int AS "requestCount",
         COALESCE(SUM(tokens_in), 0)::int AS "totalTokensIn",
         COALESCE(SUM(tokens_out), 0)::int AS "totalTokensOut",
         COALESCE(ROUND(SUM(cost_usd), 6), 0)::float AS "totalCostUsd",
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int AS "successCount",
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS "errorCount",
         SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END)::int AS "timeoutCount",
         SUM(CASE WHEN rejection_reason IS NOT NULL THEN 1 ELSE 0 END)::int AS "rejectedCount",
         SUM(CASE
           WHEN purpose = 'empty from earlier version'
             OR attribution_source = 'empty from earlier version'
           THEN 1 ELSE 0 END)::int AS "unattributedCount"
       FROM llm_requests
       WHERE occurred_at >= $1::timestamptz
         AND occurred_at < $2::timestamptz
       GROUP BY user_id
       ORDER BY "totalCostUsd" DESC`,
      [range.from.toISOString(), range.to.toISOString()]
    ) as Array<Record<string, unknown>>;

    res.json({ from: range.from.toISOString(), to: range.to.toISOString(), users });
  })
);

// GET /api/admin/observability/users/:userId — 7-day history + last 20 requests
router.get(
  "/observability/users/:userId",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const limit = Math.min(Math.max(Number(req.query["limit"] ?? 20), 1), 100);
    const offset = Math.max(Number(req.query["offset"] ?? 0), 0);
    const now = new Date();
    const pointsBudget = await getUserPointsBudget(userId);
    const [history, recentPage] = await Promise.all([
      eventStore.getUserDailyHistory(userId, 7),
      eventStore.getRecentActivityPage(userId, limit, offset),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const todaySummary =
      history.find((entry) => entry.date === today) ?? {
        userId,
        date: today,
        requestCount: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCostUsd: 0,
        successCount: 0,
        errorCount: 0,
        timeoutCount: 0,
        rejectedCount: 0,
        unattributedCount: 0,
      };
    const balance = await getUserPointsBalanceSnapshot(userId, now);
    res.json({
      userId,
      todaySummary,
      history,
      recent: recentPage.events,
      recentTotal: recentPage.total,
      recentLimit: recentPage.limit,
      recentOffset: recentPage.offset,
      pointsBudget,
      pointsBalance: balance,
    });
  })
);

// GET /api/admin/observability/all — all users, last 7 days (for charts)
router.get(
  "/observability/all",
  handler(async (_req, res) => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().slice(0, 10);
    });
    const summaries = await Promise.all(
      days.map((date) => eventStore.getDailySummary(date))
    );
    res.json({ days: days.map((date, i) => ({ date, users: summaries[i] })) });
  })
);

// ── Step queue admin routes ─────────────────────────────────────────────────

function requireStepQueueDatabase(res: Response): boolean {
  if (isApplicationDatabaseConfigured()) return true;
  res.status(503).json({ error: "application_database_unavailable" });
  return false;
}

router.get(
  "/step-queue/jobs",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const limit = Math.min(Math.max(Number(req.query["limit"] ?? 50), 1), 200);
    const userId = typeof req.query["userId"] === "string" ? req.query["userId"] : null;
    const status = typeof req.query["status"] === "string" ? req.query["status"] : null;
    const params: unknown[] = [];
    const where: string[] = [];
    if (userId) {
      params.push(userId);
      where.push(`j.user_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`j.status = $${params.length}`);
    }
    params.push(limit);
    const ds = await getApplicationDataSource();
    const rows = await ds.query(
      `SELECT
         j.*,
         COUNT(DISTINCT t.id)::int AS ticker_count,
         COUNT(DISTINCT s.id)::int AS step_count,
         COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'completed')::int AS completed_steps,
         COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'failed')::int AS failed_steps
       FROM jobs j
       LEFT JOIN ticker_work_items t ON t.job_id = j.id
       LEFT JOIN step_work_items s ON s.job_id = j.id
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       GROUP BY j.id
       ORDER BY j.triggered_at DESC
       LIMIT $${params.length}`,
      params
    ) as Array<Record<string, unknown>>;
    res.json({ jobs: rows });
  })
);

router.get(
  "/step-queue/jobs/:jobId",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const jobId = req.params.jobId as string;
    const ds = await getApplicationDataSource();
    const jobs = await ds.query(`SELECT * FROM jobs WHERE id = $1`, [jobId]) as Array<Record<string, unknown>>;
    const job = jobs[0];
    if (!job) {
      res.status(404).json({ error: "job_not_found" });
      return;
    }
    const [tickers, steps, events] = await Promise.all([
      ds.query(`SELECT * FROM ticker_work_items WHERE job_id = $1 ORDER BY position ASC`, [jobId]),
      ds.query(`SELECT * FROM step_work_items WHERE job_id = $1 ORDER BY created_at ASC`, [jobId]),
      ds.query(
        `SELECT e.*
           FROM step_lifecycle_events e
           JOIN step_work_items s ON s.id = e.step_id
          WHERE s.job_id = $1
          ORDER BY e.occurred_at ASC`,
        [jobId]
      ),
    ]);
    res.json({ job, tickers, steps, events });
  })
);

router.get(
  "/step-queue/models",
  handler(async (_req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const ds = await getApplicationDataSource();
    await ensureDefaultModelTierAssignments(ds);
    const rows = await ds.query(
      `SELECT tier, step_kind, model, fallback, updated_at, updated_by
         FROM model_tier_assignments
        ORDER BY tier, step_kind`
    ) as Array<Record<string, unknown>>;
    res.json({ tiers: MODEL_TIERS, stepKinds: STEP_KINDS, assignments: rows });
  })
);

router.put(
  "/step-queue/models/:tier/:stepKind",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const tier = req.params.tier as ModelTier;
    const stepKind = req.params.stepKind as StepKind;
    if (!(MODEL_TIERS as readonly string[]).includes(tier) || !(STEP_KINDS as readonly string[]).includes(stepKind)) {
      res.status(400).json({ error: "invalid_tier_or_step_kind" });
      return;
    }
    const body = req.body as { model?: string; fallback?: string | null; updatedBy?: string };
    const model = String(body.model ?? "").trim();
    if (!model) {
      res.status(400).json({ error: "model required" });
      return;
    }
    const fallback = typeof body.fallback === "string" && body.fallback.trim() ? body.fallback.trim() : null;
    const updatedBy = String(body.updatedBy ?? "admin").slice(0, 128);
    const ds = await getApplicationDataSource();
    const result = await ds.query(
      `INSERT INTO model_tier_assignments (tier, step_kind, model, fallback, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (tier, step_kind)
       DO UPDATE SET model = EXCLUDED.model,
                     fallback = EXCLUDED.fallback,
                     updated_at = NOW(),
                     updated_by = EXCLUDED.updated_by
       RETURNING *`,
      [tier, stepKind, model, fallback, updatedBy]
    );
    const rows = mutationRows<Record<string, unknown>>(result);
    res.json({ assignment: rows[0] });
  })
);

router.get(
  "/step-queue/cost",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const hasExplicitRange = typeof req.query["from"] === "string" || typeof req.query["to"] === "string";
    const now = new Date();
    const days = Math.min(Math.max(Number(req.query["days"] ?? 7), 1), 90);
    const range = hasExplicitRange
      ? parseIsoRange(req, res)
      : { from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), to: now };
    if (!range) return;
    const ds = await getApplicationDataSource();
    const rows = await ds.query(
      `SELECT
         user_id,
         ticker,
         analyst AS step_kind,
         to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
         COUNT(*)::int AS request_count,
         COALESCE(SUM(tokens_in), 0)::int AS tokens_in,
         COALESCE(SUM(tokens_out), 0)::int AS tokens_out,
         COALESCE(ROUND(SUM(cost_usd), 6), 0) AS cost_usd,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int AS success_count,
         SUM(CASE WHEN status <> 'success' THEN 1 ELSE 0 END)::int AS error_count
       FROM llm_requests
       WHERE purpose = 'step_queue'
         AND occurred_at >= $1::timestamptz
         AND occurred_at < $2::timestamptz
       GROUP BY user_id, ticker, analyst, day
       ORDER BY day DESC, cost_usd DESC`,
      [range.from.toISOString(), range.to.toISOString()]
    ) as Array<Record<string, unknown>>;
    res.json({ days: hasExplicitRange ? null : days, from: range.from.toISOString(), to: range.to.toISOString(), rows });
  })
);

// ── System control ────────────────────────────────────────────────────────────

// GET /api/admin/system — read system-wide control state
router.get(
  "/system",
  handler(async (_req, res) => {
    const ctrl = await getSystemControl();
    res.json(ctrl);
  })
);

// PATCH /api/admin/system — lock/unlock, set broadcast
router.patch(
  "/system",
  handler(async (req, res) => {
    const body = req.body as {
      locked?: boolean;
      lockReason?: string;
      lockedUntil?: string | null;
      broadcast?: { text: string; type: string; dismissible?: boolean; expiresAt?: string | null } | null;
    };
    const patch: Record<string, unknown> = {};
    if (body.locked !== undefined) {
      patch["locked"]   = body.locked;
      patch["lockedAt"] = body.locked ? new Date().toISOString() : null;
    }
    if (body.lockReason !== undefined) patch["lockReason"]  = body.lockReason;
    if ("lockedUntil" in body)          patch["lockedUntil"] = body.lockedUntil ?? null;
    if ("broadcast" in body)            patch["broadcast"]   = body.broadcast ?? null;
    await setSystemControl(patch);
    res.json({ updated: true, system: await getSystemControl() });
  })
);

// ── Per-user control ──────────────────────────────────────────────────────────

// PATCH /api/admin/users/:userId/control — set restriction
router.patch(
  "/users/:userId/control",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const body = req.body as {
      restriction?: "readonly" | "blocked" | "suspended";
      reason?: string;
      restrictedUntil?: string | null;
      banner?: { text: string; type: string; dismissible?: boolean; expiresAt?: string | null } | null;
    };
    if (!body.restriction) { res.status(400).json({ error: "restriction required" }); return; }
    await setUserControl(userId, {
      restriction:     body.restriction,
      reason:          body.reason ?? "",
      restrictedAt:    new Date().toISOString(),
      restrictedUntil: body.restrictedUntil ?? null,
      banner:          body.banner as Parameters<typeof setUserControl>[1]["banner"] ?? null,
    });
    res.json({ updated: true, userId, control: await getUserControl(userId) });
  })
);

// DELETE /api/admin/users/:userId/control — remove all restrictions
router.delete(
  "/users/:userId/control",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    await clearUserControl(userId);
    res.json({ cleared: true, userId });
  })
);

// POST /api/admin/users/:userId/force-logout — invalidate all active sessions
router.post(
  "/users/:userId/force-logout",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    await incrementTokenVersion(userId);
    res.json({ invalidated: true, userId });
  })
);

// POST /api/admin/users/:userId/jobs/:jobId/kill — force-fail a running job
router.post(
  "/users/:userId/jobs/:jobId/kill",
  handler(async (req, res) => {
    const { userId, jobId } = req.params as { userId: string; jobId: string };
    if (!userId || !jobId) { res.status(400).json({ error: "userId and jobId required" }); return; }
    const ws = buildWorkspace(userId, USERS_DIR);
    try {
      await updateJob(ws, jobId, {
        status:       "failed",
        completed_at: new Date().toISOString(),
        error:        "Killed by admin",
      });
      // Also remove trigger file if it exists (pending job killed before pickup)
      try { await fs.unlink(path.join(ws.triggersDir, `${jobId}.json`)); } catch { /* ok */ }
      res.json({ killed: true, userId, jobId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: msg });
    }
  })
);

// ── Admin job control ─────────────────────────────────────────────────────────

const VALID_JOB_ACTIONS: JobAction[] = [
  "daily_brief", "full_report", "deep_dive", "new_ideas", "quick_check", "switch_production", "switch_testing",
];

// GET /api/admin/users/:userId/jobs — list all jobs for a user
router.get(
  "/users/:userId/jobs",
  handler(async (req, res) => {
    const { userId } = req.params as { userId: string };
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const ws = buildWorkspace(userId, USERS_DIR);
    const jobs = await listJobs(ws, 100);
    res.json({ jobs });
  })
);

// POST /api/admin/users/:userId/jobs — admin creates a job (bypasses rate limits)
router.post(
  "/users/:userId/jobs",
  handler(async (req, res) => {
    const { userId } = req.params as { userId: string };
    const { action, ticker } = req.body as { action?: string; ticker?: string };
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    if (!action || !VALID_JOB_ACTIONS.includes(action as JobAction)) {
      res.status(400).json({ error: `Invalid action. Must be one of: ${VALID_JOB_ACTIONS.join(", ")}` });
      return;
    }
    if ((action === "deep_dive" || action === "quick_check") && !ticker) {
      res.status(400).json({ error: `${action} requires ticker` });
      return;
    }
    if (action === "switch_production" || action === "switch_testing") {
      res.status(400).json({ error: `${action} is not a step-queue action — use the profile switch endpoint` });
      return;
    }
    if (!requireStepQueueDatabase(res)) return;
    const ws = buildWorkspace(userId, USERS_DIR);
    const budgetGate = await ensurePointsBudgetAvailable(userId);
    if (!budgetGate.allowed) {
      res.status(202).json({ error: "points_budget_exhausted", reason: budgetGate.reason });
      return;
    }
    const admitted = await admitOrReuseStepQueueJob({
      workspace: ws,
      action: action as StepQueueJobAction,
      ticker,
      source: "admin",
      budgetAdmittedAt: requiresBudgetAdmission({ action: action as JobAction }) ? new Date() : null,
    });
    res.status(admitted.reused ? 200 : 201).json({
      jobId: admitted.jobId,
      stepQueue: true,
      reused: admitted.reused,
      tickerCount: admitted.tickerCount,
      stepCount: admitted.stepCount,
    });
  })
);

// PATCH /api/admin/users/:userId/jobs/:jobId — edit a pending job
router.patch(
  "/users/:userId/jobs/:jobId",
  handler(async (req, res) => {
    const { userId, jobId } = req.params as { userId: string; jobId: string };
    if (!userId || !jobId) { res.status(400).json({ error: "userId and jobId required" }); return; }
    const ws = buildWorkspace(userId, USERS_DIR);
    const job = await getJob(ws, jobId);
    if (job.status !== "pending") {
      res.status(409).json({ error: "Only pending jobs can be edited" });
      return;
    }
    const { action, ticker } = req.body as { action?: string; ticker?: string };
    if (action && !VALID_JOB_ACTIONS.includes(action as JobAction)) {
      res.status(400).json({ error: "Invalid action" });
      return;
    }
    // Update job file
    const updated: Job = {
      ...job,
      action: (action as JobAction | undefined) ?? job.action,
      ticker: ticker !== undefined ? (ticker || null) : job.ticker,
    };
    await fs.writeFile(ws.jobFile(jobId), JSON.stringify(updated, null, 2), "utf-8");
    // Update trigger file if it still exists
    const triggerPath = path.join(ws.triggersDir, `${jobId}.json`);
    try {
      await fs.writeFile(triggerPath, JSON.stringify(updated, null, 2), "utf-8");
    } catch { /* trigger already consumed — that's fine */ }
    res.json({ job: updated });
  })
);

// DELETE /api/admin/users/:userId/jobs/:jobId — cancel a job
router.delete(
  "/users/:userId/jobs/:jobId",
  handler(async (req, res) => {
    const { userId, jobId } = req.params as { userId: string; jobId: string };
    if (!userId || !jobId) { res.status(400).json({ error: "userId and jobId required" }); return; }
    const ws = buildWorkspace(userId, USERS_DIR);
    // Remove trigger file (prevents pickup if still pending)
    try { await fs.unlink(path.join(ws.triggersDir, `${jobId}.json`)); } catch { /* ok */ }
    const existing = await getJob(ws, jobId);
    const job = existing.action === "deep_dive"
      ? await markDeepDiveJobCancelled(ws, existing, "Cancelled by admin")
      : await updateJob(ws, jobId, {
          status: "cancelled",
          completed_at: new Date().toISOString(),
          error: "Cancelled by admin",
        });
    res.json({ cancelled: true, job });
  })
);

// POST /api/admin/users/:userId/jobs/:jobId/continue — retry a job via step queue
router.post(
  "/users/:userId/jobs/:jobId/continue",
  handler(async (req, res) => {
    const { userId, jobId } = req.params as { userId: string; jobId: string };
    if (!userId || !jobId) { res.status(400).json({ error: "userId and jobId required" }); return; }
    if (!requireStepQueueDatabase(res)) return;
    const ws = buildWorkspace(userId, USERS_DIR);
    const job = await getJob(ws, jobId);
    if (job.action === "switch_production" || job.action === "switch_testing") {
      res.status(400).json({ error: `${job.action} is not a step-queue action — cannot continue via step queue` });
      return;
    }
    const admitted = await admitOrReuseStepQueueJob({
      workspace: ws,
      action: job.action as StepQueueJobAction,
      ticker: job.ticker ?? undefined,
      source: "admin",
      budgetAdmittedAt: requiresBudgetAdmission({ action: job.action as JobAction }) ? new Date() : null,
    });
    res.json({ continued: true, userId, previousJobId: jobId, newJobId: admitted.jobId, reused: admitted.reused });
  })
);

// ── GET /api/admin/conversations ─────────────────────────────────────────────
// Admin observability for chat conversations (C2.4).

router.get(
  "/conversations",
  handler(async (req, res) => {
    if (!requireStepQueueDatabase(res)) return;
    const ds = await getApplicationDataSource();

    const userId = typeof req.query["userId"] === "string" ? req.query["userId"] : null;
    const channel = typeof req.query["channel"] === "string" ? req.query["channel"] : null;
    const terminationReason = typeof req.query["terminationReason"] === "string" ? req.query["terminationReason"] : null;
    const since = typeof req.query["since"] === "string" ? req.query["since"] : null;
    const until = typeof req.query["until"] === "string" ? req.query["until"] : null;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);

    const params: unknown[] = [];
    const wheres: string[] = [];
    if (userId) { params.push(userId); wheres.push(`user_id = $${params.length}`); }
    if (channel) { params.push(channel); wheres.push(`channel = $${params.length}`); }
    if (terminationReason) { params.push(terminationReason); wheres.push(`termination_reason = $${params.length}`); }
    if (since) { params.push(since); wheres.push(`started_at >= $${params.length}`); }
    if (until) { params.push(until); wheres.push(`started_at < $${params.length}`); }
    params.push(limit);

    const where = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";
    const rows = await ds.query(
      `SELECT id, user_id, channel, started_at, ended_at, turn_count,
              total_tokens_in, total_tokens_out, total_cost_usd,
              termination_reason, tool_call_count, model
         FROM conversations ${where}
         ORDER BY started_at DESC
         LIMIT $${params.length}`,
      params
    ) as Array<Record<string, unknown>>;

    res.json({ conversations: rows, count: rows.length });
  })
);

export default router;
