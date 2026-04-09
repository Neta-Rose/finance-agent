import { Router } from "express";
import { promises as fs } from "fs";
import path from "path";
import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { Profile } from "../schemas/onboarding.js";
import {
  OnboardInitSchema,
  ProfileSchema,
  ScheduleSchema,
} from "../schemas/onboarding.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import { hashPassword, verifyPassword } from "../middleware/auth.js";
import {
  createUserWorkspace,
  workspaceExists,
  initUserWorkspace,
} from "../services/workspaceService.js";
import { createJob } from "../services/jobService.js";
import { updateUserTelegram, restartGateway, getUserAgentHealth } from "../services/agentService.js";
import { DEFAULT_RATE_LIMITS } from "../types/index.js";
import type { RateLimits } from "../types/index.js";
import { authMiddleware } from "../middleware/auth.js";
import { userIsolationMiddleware } from "../middleware/userIsolation.js";

const router = Router();

type AsyncHandler = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<void>;

function handler(fn: AsyncHandler) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// ── POST /api/onboard/init ──────────────────────────────────────────────────

router.post(
  "/init",
  handler(async (req, res) => {
    // Admin key check
    const expectedKey = process.env["ADMIN_KEY"];
    const adminKey = req.headers["x-admin-key"];
    if (!expectedKey || adminKey !== expectedKey) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    // Validate input
    const parsed = OnboardInitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.errors,
      });
      return;
    }

    const { userId, password, displayName, telegramChatId, schedule } =
      parsed.data;

    // Check workspace doesn't exist
    if (await workspaceExists(userId)) {
      res.status(409).json({ error: "User already exists" });
      return;
    }

    // Create workspace
    const ws = await createUserWorkspace(userId);

    // Write auth.json
    const hash = await hashPassword(password);
    await fs.writeFile(
      path.join(ws.root, "auth.json"),
      JSON.stringify({ passwordHash: hash }),
      "utf-8"
    );

    // Write profile.json
    const profile: Profile = {
      userId,
      displayName,
      telegramChatId,
      schedule,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(ws.root, "profile.json"),
      JSON.stringify(profile, null, 2),
      "utf-8"
    );

    // Update USER.md with the actual display name
    try {
      const userMdRaw = await fs.readFile(ws.userMdFile, "utf-8");
      const updated = userMdRaw.replace(/\[DISPLAY_NAME\]/g, displayName);
      await fs.writeFile(ws.userMdFile, updated, "utf-8");
    } catch {
      // USER.md will be created fresh if missing
    }

    res.status(201).json({
      userId,
      created: true,
      nextStep: "submit_portfolio",
    });
  })
);

// ── POST /api/onboard/portfolio ─────────────────────────────────────────────

router.post(
  "/portfolio",
  authMiddleware,
  userIsolationMiddleware,
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;

    // Extract optional schedule from body
    const { schedule: incomingSchedule, ...portfolioBody } = req.body as {
      schedule?: unknown;
      [key: string]: unknown;
    };

    // Validate portfolio
    const parsed = PortfolioFileSchema.safeParse(portfolioBody);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.errors,
      });
      return;
    }

    const userId = ws.userId;

    // Idempotent: write portfolio.json and recreate ticker dirs regardless of current state
    await initUserWorkspace(userId, parsed.data);

    // Save schedule to profile.json if provided
    if (incomingSchedule) {
      try {
        const profilePath = path.join(ws.root, "profile.json");
        let profileData: Record<string, unknown> = {};
        try {
          profileData = JSON.parse(await fs.readFile(profilePath, "utf-8"));
        } catch { /* profile may not exist yet */ }
        profileData.schedule = incomingSchedule;
        await fs.writeFile(profilePath, JSON.stringify(profileData, null, 2), "utf-8");
      } catch { /* non-fatal */ }
    }

    // Create initial full-report job (stay BOOTSTRAPPING — agent transitions state)
    const job = await createJob(ws, "full_report");

    res.status(200).json({
      state: "BOOTSTRAPPING",
      jobId: job.id,
      message:
        "Full report queued. Analysis will begin shortly.",
    });
  })
);

// ── GET /api/onboard/status ─────────────────────────────────────────────────

router.get(
  "/status",
  authMiddleware,
  userIsolationMiddleware,
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const userId = ws.userId;

    // Read state.json
    let stateData: {
      state: string;
      bootstrapProgress: {
        total: number;
        completed: number;
        completedTickers: string[];
      } | null;
    };
    try {
      const raw = await fs.readFile(ws.stateFile, "utf-8");
      stateData = JSON.parse(raw);
    } catch {
      res.status(500).json({ error: "Cannot read state file" });
      return;
    }

    // Read profile.json (optional — might not exist for demo users)
    let profile: Profile | null = null;
    try {
      const raw = await fs.readFile(
        path.join(ws.root, "profile.json"),
        "utf-8"
      );
      profile = ProfileSchema.parse(JSON.parse(raw));
    } catch {
      // no profile yet
    }

    // Check portfolio.json exists and is valid
    let portfolioLoaded = false;
    try {
      const raw = await fs.readFile(ws.portfolioFile, "utf-8");
      PortfolioFileSchema.parse(JSON.parse(raw));
      portfolioLoaded = true;
    } catch {
      portfolioLoaded = false;
    }

    const bp = stateData.bootstrapProgress;
    const bootstrapProgress =
      bp !== null
        ? {
            total: bp.total,
            completed: bp.completed,
            completedTickers: bp.completedTickers,
            pct:
              bp.total > 0
                ? Math.round((bp.completed / bp.total) * 100)
                : 0,
          }
        : null;

    const rateLimits: RateLimits = (profile?.rateLimits as RateLimits) ?? DEFAULT_RATE_LIMITS;

    const agentHealth = await getUserAgentHealth(userId);

    res.json({
      userId,
      state: stateData.state,
      displayName: profile?.displayName ?? null,
      telegramChatId: profile?.telegramChatId ?? null,
      bootstrapProgress,
      portfolioLoaded,
      readyForTrading: stateData.state === "ACTIVE",
      rateLimits,
      schedule: profile?.schedule ?? null,
      telegramConnected: !!profile?.telegramChatId,
      agentHealthy: agentHealth.healthy,
    });
  })
);

// POST /api/onboard/telegram
router.post(
  "/telegram",
  authMiddleware,
  userIsolationMiddleware,
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const userId = ws.userId;
    const { botToken, telegramChatId } = req.body as {
      botToken?: string;
      telegramChatId?: string;
    };

    if (!botToken || !/^\d+:[A-Za-z0-9_-]{35,}$/.test(botToken)) {
      res.status(400).json({ error: "Invalid bot token format" });
      return;
    }
    if (!telegramChatId || !/^\d+$/.test(telegramChatId)) {
      res.status(400).json({ error: "Invalid telegram chat ID" });
      return;
    }

    // Update agent config
    await updateUserTelegram(userId, botToken, telegramChatId);

    // Update profile.json
    const profilePath = path.join(ws.root, "profile.json");
    try {
      let profileData: Record<string, unknown> = {};
      try {
        profileData = JSON.parse(await fs.readFile(profilePath, "utf-8"));
      } catch { /* may not exist */ }
      profileData.telegramChatId = telegramChatId;
      await fs.writeFile(profilePath, JSON.stringify(profileData, null, 2), "utf-8");
    } catch { /* non-fatal */ }

    // Restart gateway to pick up new config
    await restartGateway();

    res.json({ connected: true });
  })
);

// POST /api/onboard/change-password
router.post(
  "/change-password",
  authMiddleware,
  userIsolationMiddleware,
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "currentPassword and newPassword required" });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: "newPassword must be at least 8 characters" });
      return;
    }

    // Read current auth.json
    const authPath = path.join(ws.root, "auth.json");
    let authData: { passwordHash: string };
    try {
      authData = JSON.parse(await fs.readFile(authPath, "utf-8"));
    } catch {
      res.status(401).json({ error: "cannot read auth file" });
      return;
    }

    // Verify current password
    const valid = await verifyPassword(currentPassword, authData.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "incorrect_password" });
      return;
    }

    // Hash and save new password
    const hash = await hashPassword(newPassword);
    await fs.writeFile(authPath, JSON.stringify({ passwordHash: hash }), "utf-8");

    res.json({ changed: true });
  })
);

// PATCH /api/onboard/schedule
router.patch(
  "/schedule",
  authMiddleware,
  userIsolationMiddleware,
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const parsed = ScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
      return;
    }

    const profilePath = path.join(ws.root, "profile.json");
    let profileData: Record<string, unknown> = {};
    try {
      profileData = JSON.parse(await fs.readFile(profilePath, "utf-8"));
    } catch { /* may not exist yet */ }

    profileData.schedule = parsed.data;
    await fs.writeFile(profilePath, JSON.stringify(profileData, null, 2), "utf-8");

    res.json({ updated: true, schedule: parsed.data });
  })
);

export default router;
