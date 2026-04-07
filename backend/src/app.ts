import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import cors from "cors";
import { logger } from "./services/logger.js";
import { ZodError } from "zod";
import { WorkspaceViolationError } from "./middleware/userIsolation.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { authMiddleware } from "./middleware/auth.js";
import { userIsolationMiddleware } from "./middleware/userIsolation.js";
import authRoutes from "./routes/auth.js";
import portfolioRoutes from "./routes/portfolio.js";
import verdictsRoutes from "./routes/verdicts.js";
import jobsRoutes from "./routes/jobs.js";
import reportsRoutes from "./routes/reports.js";
import onboardingRoutes from "./routes/onboarding.js";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  // Health — no auth
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Rate limiter on all API routes
  app.use("/api", apiLimiter);

  // Auth routes — login/logout/register (no JWT required)
  // Mounted BEFORE global authMiddleware so /api/auth/* bypasses auth
  app.use("/api/auth", authRoutes);

  // Onboarding routes — init doesn't need JWT, portfolio/status do
  // Mounted here so it can have its own auth handling per-route
  app.use("/api/onboard", onboardingRoutes);

  // Protected routes — JWT + user isolation for everything else
  app.use("/api", authMiddleware, userIsolationMiddleware);

  // Route mounts
  app.use("/api", portfolioRoutes); // GET /api/portfolio
  app.use("/api", verdictsRoutes); // GET /api/verdicts
  app.use("/api", jobsRoutes); // POST /api/jobs/trigger, GET /api/jobs
  app.use("/api", reportsRoutes); // GET /api/reports/*

  // Global error handler
  app.use(
    (
      err: Error,
      _req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      if (err instanceof ZodError) {
        logger.warn(`Validation error: ${err.message}`);
        res
          .status(400)
          .json({ error: "Validation failed", details: err.errors });
        return;
      }

      if (err instanceof WorkspaceViolationError) {
        logger.warn(
          `Workspace violation: user=${err.userId} path=${err.attemptedPath}`
        );
        res.status(403).json({ error: "access denied" });
        return;
      }

      logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
      res.status(500).json({ error: "Internal server error" });
    }
  );

  return app;
}
