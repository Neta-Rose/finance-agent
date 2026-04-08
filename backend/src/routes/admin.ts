import { Router, type Request, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import path from "path";
import {
  addUserAgent,
  removeUserAgent,
  updateUserTelegram,
  restartGateway,
  getUserAgentStatus,
} from "../services/agentService.js";
import { createUserWorkspace, workspaceExists } from "../services/workspaceService.js";
import { hashPassword } from "../middleware/auth.js";
import { logger } from "../services/logger.js";
import type { RateLimits } from "../types/index.js";

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

    await restartGateway();

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

export default router;
