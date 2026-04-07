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
} from "../schemas/onboarding.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import { hashPassword } from "../middleware/auth.js";
import {
  createUserWorkspace,
  workspaceExists,
  initUserWorkspace,
} from "../services/workspaceService.js";
import { createJob } from "../services/jobService.js";
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

    // Validate portfolio
    const parsed = PortfolioFileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.errors,
      });
      return;
    }

    const userId = ws.userId;

    // Check state
    const stateFile = ws.stateFile;
    let stateData: { state: string };
    try {
      const raw = await fs.readFile(stateFile, "utf-8");
      stateData = JSON.parse(raw);
    } catch {
      res.status(500).json({ error: "Cannot read state file" });
      return;
    }

    if (stateData.state !== "UNINITIALIZED") {
      res.status(409).json({
        error: `Portfolio already submitted. Current state: ${stateData.state}`,
      });
      return;
    }

    // Init workspace with portfolio — creates ticker dirs, strategy stubs, events.jsonl
    await initUserWorkspace(userId, parsed.data);

    // Create initial full-report job
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

    res.json({
      userId,
      state: stateData.state,
      displayName: profile?.displayName ?? null,
      bootstrapProgress,
      portfolioLoaded,
      readyForTrading: stateData.state === "ACTIVE",
    });
  })
);

export default router;
