import { Router, type Request, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import path from "path";
import {
  addUserAgent,
  removeUserAgent,
  updateUserTelegram,
  restartGateway,
  getUserAgentStatus,
  getUserAgentHealth,
} from "../services/agentService.js";
import { createUserWorkspace, workspaceExists } from "../services/workspaceService.js";
import { hashPassword } from "../middleware/auth.js";
import { logger } from "../services/logger.js";
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  getUserProfileStatus,
  setUserProfile,
} from "../services/profileService.js";
import type { RateLimits } from "../types/index.js";
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
import { updateJob } from "../services/jobService.js";
import { buildWorkspace } from "../middleware/userIsolation.js";

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
        };

        try {
          const profile = JSON.parse(await fs.readFile(profilePath, "utf-8"));
          displayName = profile.displayName ?? userId;
          createdAt = profile.createdAt ?? "";
          if (profile.schedule) Object.assign(schedule, profile.schedule);
          if (profile.rateLimits) Object.assign(rateLimits, profile.rateLimits);
        } catch { /* no profile */ }

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

        const agentStatus = await getUserAgentStatus(userId);
        const profileStatus = await getUserProfileStatus(userId);
        const agentHealth = await getUserAgentHealth(userId);

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
          modelProfile: profileStatus.name,
          profileBroken: profileStatus.broken,
          profileBrokenReason: profileStatus.broken ? profileStatus.reason : undefined,
          agentHealth,
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
    };

    const merged = { ...currentLimits, ...updates };
    profile.rateLimits = merged;
    await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), "utf-8");
    res.json({ userId, rateLimits: merged });
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
      await updateUserTelegram(userId, botToken, telegramChatId);
    } catch (err) {
      logger.error(`Failed to update Telegram for ${userId}`, { err });
      res.status(500).json({ error: "Failed to update Telegram" });
      return;
    }

    const profilePath = path.join(USERS_DIR, userId, "profile.json");
    try {
      const profile = JSON.parse(await fs.readFile(profilePath, "utf-8"));
      profile.telegramChatId = telegramChatId;
      await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), "utf-8");
    } catch { /* skip if no profile */ }

    await restartGateway();
    res.json({ updated: true });
  })
);

// GET /api/admin/status
router.get(
  "/status",
  handler(async (_req, res) => {
    let gatewayRunning = false;
    let totalUsers = 0;

    try {
      await fs.access("/root/.openclaw/openclaw.json");
      gatewayRunning = true;
    } catch { /* not running */ }

    try {
      const dirents = await fs.readdir(USERS_DIR, { withFileTypes: true });
      totalUsers = dirents.filter((e) => e.isDirectory() && !e.name.startsWith('.')).length;
    } catch { /* ignore */ }

    res.json({ gatewayRunning, totalUsers, activeAgents: totalUsers });
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
    const [history, recent] = await Promise.all([
      eventStore.getUserDailyHistory(userId, 7),
      eventStore.getRecentActivity(userId, 20),
    ]);
    res.json({ userId, history, recent });
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
    const USERS_DIR_RESOLVED = process.env["USERS_DIR"] ?? "../users";
    const ws = buildWorkspace(userId, USERS_DIR_RESOLVED);
    try {
      await updateJob(ws, jobId, {
        status:       "failed",
        completed_at: new Date().toISOString(),
        error:        "Killed by admin",
      });
      res.json({ killed: true, userId, jobId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: msg });
    }
  })
);

export default router;
