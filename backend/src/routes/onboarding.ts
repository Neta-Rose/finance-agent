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
  NotificationPreferencesUpdateSchema,
  ScheduleSchema,
  PositionGuidanceCompletionSchema,
  type PositionGuidance,
} from "../schemas/onboarding.js";
import {
  ConnectWhatsAppRequestSchema,
  TelegramConnectRequestSchema,
} from "../schemas/channels.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import { hashPassword, verifyPassword } from "../middleware/auth.js";
import {
  createUserWorkspace,
  workspaceExists,
  saveUserPortfolio,
  startUserBootstrap,
} from "../services/workspaceService.js";
import { createJob } from "../services/jobService.js";
import { hasPendingAgentManagedWork } from "../services/jobService.js";
import { initializeFullReportJob } from "../services/fullReportService.js";
import {
  getUserAgentHealth,
  getUserAgentStatus,
  reconcileUserHeartbeatCron,
} from "../services/agentService.js";
import { DEFAULT_RATE_LIMITS } from "../types/index.js";
import type { RateLimits } from "../types/index.js";
import { authMiddleware } from "../middleware/auth.js";
import { userIsolationMiddleware } from "../middleware/userIsolation.js";
import { getNotificationPreferences, setNotificationPreferences } from "../services/notificationService.js";
import { dispatchPendingAgentJobsForUser } from "../services/agentJobDispatcher.js";
import { readState, writeState } from "../services/stateService.js";
import {
  classifyUserAgentHealth,
  shouldUserHeartbeatBeEnabled,
} from "../services/startupService.js";
import {
  connectUserTelegramChannel,
  connectUserWhatsAppChannel,
  disconnectUserTelegramChannel,
  disconnectUserWhatsAppChannel,
  getUserChannelConnectivity,
} from "../services/channelService.js";

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

    // Idempotent: persist portfolio and open the optional position-guidance window.
    await saveUserPortfolio(userId, parsed.data);

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

    res.status(200).json({
      state: "INCOMPLETE",
      nextStep: "position_guidance",
      guidanceStepPending: true,
      message:
        "Portfolio saved. Add optional position guidance or skip to start analysis.",
    });
  })
);

router.get(
  "/position-guidance",
  authMiddleware,
  userIsolationMiddleware,
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const state = await readState(ws.userId);

    let tickers: string[] = [];
    try {
      const raw = await fs.readFile(ws.portfolioFile, "utf-8");
      const portfolio = PortfolioFileSchema.parse(JSON.parse(raw));
      tickers = Array.from(
        new Set(Object.values(portfolio.accounts).flat().map((position) => position.ticker))
      ).sort();
    } catch {
      tickers = [];
    }

    res.json({
      status: state.onboarding.positionGuidanceStatus,
      tickers,
      guidance: state.onboarding.positionGuidance,
    });
  })
);

router.post(
  "/position-guidance/complete",
  authMiddleware,
  userIsolationMiddleware,
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const parsed = PositionGuidanceCompletionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.errors,
      });
      return;
    }

    let rawPortfolio: string;
    try {
      rawPortfolio = await fs.readFile(ws.portfolioFile, "utf-8");
    } catch {
      res.status(404).json({ error: "portfolio not found" });
      return;
    }

    const portfolio = PortfolioFileSchema.parse(JSON.parse(rawPortfolio));
    const validTickers = new Set(
      Object.values(portfolio.accounts).flat().map((position) => position.ticker)
    );
    const cleanedGuidance = Object.fromEntries(
      Object.entries(parsed.data.guidance).filter(([ticker, guidance]) => {
        if (!validTickers.has(ticker)) return false;
        return (
          guidance.thesis.length > 0 ||
          guidance.horizon !== "unspecified" ||
          guidance.addOn.length > 0 ||
          guidance.reduceOn.length > 0 ||
          guidance.notes.length > 0
        );
      })
    ) as Record<string, PositionGuidance>;

    const currentState = await readState(ws.userId);
    if (currentState.state === "BOOTSTRAPPING" || currentState.state === "ACTIVE") {
      res.json({
        state: currentState.state,
        guidanceStepPending: false,
        message: "Analysis has already started.",
      });
      return;
    }

    await writeState(ws.userId, {
      onboarding: {
        ...currentState.onboarding,
        positionGuidanceStatus: parsed.data.skip ? "skipped" : "completed",
        positionGuidance: cleanedGuidance,
      },
    });

    await startUserBootstrap(ws.userId);
    const job = await createJob(ws, "full_report", undefined, { dispatch: false });
    const initializedJob = await initializeFullReportJob(ws, job);
    const agentStatus = await getUserAgentStatus(ws.userId);
    await reconcileUserHeartbeatCron(
      ws.userId,
      agentStatus.configured && shouldUserHeartbeatBeEnabled({
        state: "BOOTSTRAPPING",
        restriction: null,
        eligibilityIssue: null,
        hasAgentManagedWork: initializedJob.status !== "completed",
      })
    );
    if (initializedJob.status === "running") {
      await dispatchPendingAgentJobsForUser(ws.userId);
    }

    res.status(200).json({
      state: "BOOTSTRAPPING",
      jobId: initializedJob.id,
      guidanceStepPending: false,
      message: "Full report queued. Analysis will begin shortly.",
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

    let stateData: Awaited<ReturnType<typeof readState>>;
    try {
      stateData = await readState(userId);
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

    const [rawAgentHealth, connectivity, notifications] = await Promise.all([
      getUserAgentHealth(userId),
      getUserChannelConnectivity(userId),
      getNotificationPreferences(userId),
    ]);
    const hasAgentManagedWork = await hasPendingAgentManagedWork(ws);
    const agentHealth = classifyUserAgentHealth(rawAgentHealth, {
      state: stateData.state,
      restriction: null,
      eligibilityIssue: stateData.state === "ACTIVE" && !portfolioLoaded ? "portfolio missing" : null,
      hasAgentManagedWork,
    });

    res.json({
      userId,
      state: stateData.state,
      displayName: profile?.displayName ?? null,
      telegramChatId: connectivity.telegram.target ?? profile?.telegramChatId ?? null,
      bootstrapProgress,
      portfolioLoaded,
      guidanceStepPending: stateData.onboarding?.positionGuidanceStatus === "pending",
      positionGuidanceCount: Object.keys(stateData.onboarding?.positionGuidance ?? {}).length,
      readyForTrading: stateData.state === "ACTIVE",
      rateLimits,
      schedule: profile?.schedule ?? null,
      notifications,
      telegramConnected: connectivity.telegram.connected,
      connectivity,
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
    const parsed = TelegramConnectRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
      return;
    }

    await connectUserTelegramChannel(ws.userId, parsed.data.botToken, parsed.data.telegramChatId);

    res.json({
      connected: true,
      channel: "telegram",
      connectivity: await getUserChannelConnectivity(ws.userId),
    });
  })
);

// DELETE /api/onboard/telegram
router.delete(
  "/telegram",
  authMiddleware,
  userIsolationMiddleware,
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    await disconnectUserTelegramChannel(ws.userId);
    res.json({
      connected: false,
      channel: "telegram",
      connectivity: await getUserChannelConnectivity(ws.userId),
    });
  })
);

router.put(
  "/whatsapp",
  authMiddleware,
  userIsolationMiddleware,
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const parsed = ConnectWhatsAppRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
      return;
    }

    await connectUserWhatsAppChannel(ws.userId, parsed.data);
    res.json({
      connected: true,
      channel: "whatsapp",
      connectivity: await getUserChannelConnectivity(ws.userId),
    });
  })
);

router.delete(
  "/whatsapp",
  authMiddleware,
  userIsolationMiddleware,
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    await disconnectUserWhatsAppChannel(ws.userId);
    res.json({
      connected: false,
      channel: "whatsapp",
      connectivity: await getUserChannelConnectivity(ws.userId),
    });
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

router.patch(
  "/notifications",
  authMiddleware,
  userIsolationMiddleware,
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const parsed = NotificationPreferencesUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
      return;
    }

    const notifications = await setNotificationPreferences(ws.userId, parsed.data);
    res.json({ updated: true, notifications });
  })
);

export default router;
