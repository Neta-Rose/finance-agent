import { Router, type Request, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import path from "path";
import {
  addUserAgent,
  removeUserAgent,
  restartGateway,
  getUserAgentStatus,
  getUserAgentHealth,
  reconcileUserHeartbeatCron,
  wakeAgent,
  getSystemAgentStatus,
  SYSTEM_AGENT_ID,
  readConfig,
} from "../services/agentService.js";
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
import { DEFAULT_POINTS_BUDGET } from "../types/index.js";
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
import { updateJob, createJob, listJobs, getJob } from "../services/jobService.js";
import { hasPendingAgentManagedWork } from "../services/jobService.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import type { JobAction, Job } from "../types/index.js";
import { connectUserTelegramChannel } from "../services/channelService.js";
import { listSupportMessages } from "../services/supportService.js";
import { getActiveUserEligibility, readState } from "../services/stateService.js";
import { markDeepDiveJobCancelled } from "../services/deepDiveService.js";
import {
  getUserPointsBalanceSnapshot,
  getUserPointsBudget,
  setUserPointsBudget,
} from "../services/pointsBudgetService.js";
import {
  classifySystemAgentHealth,
  classifyUserAgentHealth,
  shouldUserHeartbeatBeEnabled,
} from "../services/startupService.js";

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

    const users = await Promise.all(
      entries.map(async (userId) => {
        const userRoot = path.join(USERS_DIR, userId);
        const profilePath = path.join(userRoot, "profile.json");
        const statePath = path.join(userRoot, "data", "state.json");
        const portfolioPath = path.join(userRoot, "data", "portfolio.json");

        let displayName = userId;
        let createdAt = "";
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
        } catch { /* no profile */ }

        let pointsBudget: PointsBudgetConfig = { ...DEFAULT_POINTS_BUDGET };
        try {
          pointsBudget = await getUserPointsBudget(userId);
        } catch {
          pointsBudget = { ...DEFAULT_POINTS_BUDGET };
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

        const [agentStatus, profileStatus, rawAgentHealth, userCtrl, activeEligibility, integrity, hasAgentManagedWork] = await Promise.all([
          getUserAgentStatus(userId),
          getUserProfileStatus(userId),
          getUserAgentHealth(userId),
          getUserControl(userId),
          state === "ACTIVE"
            ? getActiveUserEligibility(userId)
            : Promise.resolve({ eligible: true, reason: null }),
          validateWorkspaceIntegrity(userId),
          hasPendingAgentManagedWork(buildWorkspace(userId, USERS_DIR)),
        ]);
        const agentHealth = classifyUserAgentHealth(rawAgentHealth, {
          state,
          restriction: userCtrl.restriction,
          eligibilityIssue: activeEligibility.eligible ? null : activeEligibility.reason,
          hasAgentManagedWork,
        });

        return {
          userId,
          displayName,
          state,
          portfolioLoaded,
          agentConfigured: agentStatus.configured,
          hasTelegram: agentStatus.hasTelegram,
          telegramChatId: agentStatus.telegramChatId,
          createdAt,
          rateLimits,
          schedule,
          pointsBudget,
          modelProfile: profileStatus.name,
          profileBroken: profileStatus.broken,
          profileBrokenReason: profileStatus.broken ? profileStatus.reason : undefined,
          agentHealth,
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
    const botToken = body.telegramBotToken ? String(body.telegramBotToken) : undefined;
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
    const pointsBudget = {
      dailyBudgetPoints: Number(
        (body.pointsBudget as Partial<PointsBudgetConfig> | undefined)?.dailyBudgetPoints ??
          DEFAULT_POINTS_BUDGET.dailyBudgetPoints
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
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(ws.root, "profile.json"), JSON.stringify(profile, null, 2), "utf-8");
    await setUserPointsBudget(userId, pointsBudget);

    try {
      if (botToken && telegramChatId) {
        await addUserAgent(userId, ws.root, botToken, telegramChatId);
      } else {
        await addUserAgent(userId, ws.root);
      }
    } catch (err) {
      logger.warn(`Failed to add agent for ${userId}`, { err });
    }

    // Apply the default profile ("testing") to the agent's openclaw entry.
    // addUserAgent() already restarted the gateway — setUserProfile restarts again
    // which is acceptable on creation (rare path).
    try {
      await setUserProfile(userId, "testing");
    } catch (err) {
      logger.warn(`Failed to apply default model profile for ${userId}: ${err}`);
    }

    await reconcileUserHeartbeatCron(userId, false);

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

    try { await removeUserAgent(userId); } catch (err) { logger.warn(`remove agent failed: ${userId}`, { err }); }

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

    await restartGateway();
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
    let gatewayRunning = false;
    let totalUsers = 0;
    let activeAgents = 0;

    try {
      await fs.access("/root/.openclaw/openclaw.json");
      gatewayRunning = true;
    } catch { /* not running */ }

    try {
      const dirents = await fs.readdir(USERS_DIR, { withFileTypes: true });
      totalUsers = dirents.filter((e) => e.isDirectory() && !e.name.startsWith('.')).length;
    } catch { /* ignore */ }

    try {
      const config = await readConfig();
      activeAgents = config.agents?.list?.length ?? totalUsers;
    } catch {
      activeAgents = totalUsers;
    }

    res.json({ gatewayRunning, totalUsers, activeAgents });
  })
);

router.get(
  "/system-agent",
  handler(async (_req, res) => {
    const [agentStatus, profileStatus, rawAgentHealth] = await Promise.all([
      getSystemAgentStatus(),
      getSystemAgentProfileStatus(),
      getUserAgentHealth(SYSTEM_AGENT_ID),
    ]);
    const agentHealth = classifySystemAgentHealth(rawAgentHealth);

    res.json({
      agentId: SYSTEM_AGENT_ID,
      workspace: "/root/clawd",
      configured: agentStatus.configured,
      hasTelegram: agentStatus.hasTelegram,
      telegramAccountId: agentStatus.telegramAccountId,
      modelProfile: profileStatus.name,
      profileBroken: profileStatus.broken,
      profileBrokenReason: profileStatus.broken ? profileStatus.reason : undefined,
      agentHealth,
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
    await reconcileUserHeartbeatCron(userId, false);
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
    let shouldEnableCron = false;
    try {
      const state = await readState(userId);
      const agentStatus = await getUserAgentStatus(userId);
      const hasAgentManagedWork = await hasPendingAgentManagedWork(
        buildWorkspace(userId, USERS_DIR)
      );
      const eligibility = state.state === "ACTIVE"
        ? await getActiveUserEligibility(userId)
        : { eligible: true, reason: null };
      shouldEnableCron = agentStatus.configured && shouldUserHeartbeatBeEnabled({
        state: state.state,
        restriction: null,
        eligibilityIssue: eligibility.eligible ? null : eligibility.reason,
        hasAgentManagedWork,
      });
    } catch {
      shouldEnableCron = false;
    }
    await reconcileUserHeartbeatCron(userId, shouldEnableCron);
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
    const ws = buildWorkspace(userId, USERS_DIR);
    const job = await createJob(ws, action as JobAction, ticker);
    res.status(201).json({ job });
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

// POST /api/admin/users/:userId/jobs/:jobId/continue — retry/nudge a job
router.post(
  "/users/:userId/jobs/:jobId/continue",
  handler(async (req, res) => {
    const { userId, jobId } = req.params as { userId: string; jobId: string };
    if (!userId || !jobId) { res.status(400).json({ error: "userId and jobId required" }); return; }
    const ws = buildWorkspace(userId, USERS_DIR);
    const job = await getJob(ws, jobId);

    if (job.status === "failed" || job.status === "cancelled") {
      // Reset to pending, recreate trigger file
      const reset: Job = {
        ...job,
        status: "pending",
        started_at: null,
        completed_at: null,
        result: null,
        error: null,
        triggered_at: new Date().toISOString(),
      };
      await fs.writeFile(ws.jobFile(jobId), JSON.stringify(reset, null, 2), "utf-8");
      await fs.mkdir(ws.triggersDir, { recursive: true });
      await fs.writeFile(path.join(ws.triggersDir, `${jobId}.json`), JSON.stringify(reset, null, 2), "utf-8");
    }

    // For pending, running, or just-reset-failed: wake the agent
    wakeAgent(userId);
    res.json({ continued: true, userId, jobId, previousStatus: job.status });
  })
);

// POST /api/admin/users/:userId/wake — wake agent to process all pending triggers
router.post(
  "/users/:userId/wake",
  handler(async (req, res) => {
    const { userId } = req.params as { userId: string };
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    wakeAgent(userId);
    res.json({ woken: true, userId });
  })
);

export default router;
