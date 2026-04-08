import path from "path";
import { promises as fs } from "fs";
import { logger } from "./logger.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import { PortfolioStateSchema } from "../schemas/portfolio.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { PortfolioStateData } from "../types/index.js";

const USERS_DIR = process.env["USERS_DIR"] ?? "../users";

export class WorkspaceNotFoundError extends Error {
  constructor(userId: string) {
    super(`Workspace not found: ${userId}`);
    this.name = "WorkspaceNotFoundError";
  }
}

async function safeReadJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function workspaceExists(userId: string): Promise<boolean> {
  const wsRoot = path.join(USERS_DIR, userId);
  try {
    await fs.access(wsRoot);
    return true;
  } catch {
    return false;
  }
}

export async function getWorkspace(userId: string): Promise<UserWorkspace> {
  const wsRoot = path.join(USERS_DIR, userId);
  try {
    await fs.access(wsRoot);
  } catch {
    throw new WorkspaceNotFoundError(userId);
  }
  return buildWorkspace(userId, USERS_DIR);
}

export async function createUserWorkspace(
  userId: string
): Promise<UserWorkspace> {
  const wsRoot = path.join(USERS_DIR, userId);
  try {
    await fs.access(wsRoot);
    throw new Error(`Workspace already exists for user: ${userId}`);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  const ws = buildWorkspace(userId, USERS_DIR);

  await fs.mkdir(ws.jobsDir, { recursive: true });
  await fs.mkdir(ws.triggersDir, { recursive: true });
  await fs.mkdir(ws.snapshotsDir, { recursive: true });
  await fs.mkdir(ws.tickersDir, { recursive: true });
  await fs.mkdir(ws.reportsDir, { recursive: true });

  const initialState: PortfolioStateData = {
    userId,
    state: "UNINITIALIZED",
    lastFullReportAt: null,
    lastDailyAt: null,
    pendingDeepDives: [],
    bootstrapProgress: null,
  };
  await fs.writeFile(
    ws.stateFile,
    JSON.stringify(initialState, null, 2),
    "utf-8"
  );

  const config = {
    modelProfile: "testing",
    profiles: {
      testing: {
        orchestrator: "deepseek-v3",
        analysts: "gemini-flash-lite",
        risk: "gemini-flash-lite",
        researchers: "deepseek-v3",
      },
      production: {
        orchestrator: "claude-opus",
        analysts: "claude-sonnet",
        risk: "claude-haiku",
        researchers: "claude-opus",
      },
    },
  };
  await fs.writeFile(
    ws.configFile,
    JSON.stringify(config, null, 2),
    "utf-8"
  );

  // Write USER.md from template (displayName filled in later during onboarding)
  try {
    const templatePath = path.join(process.cwd(), "skills", "user-profile-template.md");
    let userMd = await fs.readFile(templatePath, "utf-8");
    userMd = userMd.replace(/\[DISPLAY_NAME\]/g, userId);
    userMd = userMd.replace(/\[DATE\]/g, new Date().toISOString());
    await fs.writeFile(ws.userMdFile, userMd, "utf-8");
  } catch {
    // Template not found — write minimal stub
    const stub = [
      "# Investor Profile",
      `# Generated: ${new Date().toISOString()}`,
      "# Edit this file to customize agent behavior.",
      "",
      "## Risk profile",
      "riskTolerance: medium",
      "",
      "## Investment focus",
      "notes: |",
      "  Fill in your investment thesis and preferences.",
    ].join("\n");
    await fs.writeFile(ws.userMdFile, stub, "utf-8");
  }

  // Copy shared agent instruction files into user workspace
  const CLAWD_ROOT = "/root/clawd";
  for (const file of ["SOUL.md", "AGENTS.md", "HEARTBEAT.md"]) {
    try {
      await fs.copyFile(
        path.join(CLAWD_ROOT, file),
        path.join(ws.root, file)
      );
    } catch (e) {
      logger.warn(`Could not copy ${file} to user workspace: ${e}`);
    }
  }

  // Create empty OpenClaw-managed files (skip if already exist)
  for (const file of ["IDENTITY.md", "TOOLS.md"]) {
    try {
      await fs.writeFile(path.join(ws.root, file), "", { flag: "wx" });
    } catch { /* already exists */ }
  }

  // Symlink shared skills directory (read-only access for agent)
  try {
    await fs.symlink(
      path.join(CLAWD_ROOT, "skills"),
      path.join(ws.root, "skills")
    );
  } catch { /* already exists */ }

  logger.info(`Created workspace for user: ${userId}`);
  return ws;
}

export async function initUserWorkspace(
  userId: string,
  portfolio: unknown
): Promise<void> {
  const ws = await getWorkspace(userId);

  const parsed = PortfolioFileSchema.safeParse(portfolio);
  if (!parsed.success) {
    throw new Error(
      `Invalid portfolio: ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`
    );
  }

  await fs.writeFile(
    ws.portfolioFile,
    JSON.stringify(parsed.data, null, 2),
    "utf-8"
  );

  // Flatten all positions from named accounts
  const allPositions: Array<{ ticker: string; exchange: string; account: string }> = [];
  for (const [accountName, positions] of Object.entries(parsed.data.accounts)) {
    for (const pos of positions) {
      allPositions.push({ ticker: pos.ticker, exchange: pos.exchange, account: accountName });
    }
  }

  for (const pos of allPositions) {
    const tickerDir = path.join(ws.tickersDir, pos.ticker);
    await fs.mkdir(tickerDir, { recursive: true });

    const strategyStub = {
      ticker: pos.ticker,
      updatedAt: new Date().toISOString(),
      version: 1,
      verdict: "HOLD",
      confidence: "low",
      reasoning: "Pending initial analysis",
      timeframe: "undefined",
      positionSizeILS: 0,
      positionWeightPct: 0,
      entryConditions: [],
      exitConditions: [],
      catalysts: [],
      bullCase: null,
      bearCase: null,
      lastDeepDiveAt: null,
      deepDiveTriggeredBy: null,
    };
    await fs.writeFile(
      ws.strategyFile(pos.ticker),
      JSON.stringify(strategyStub, null, 2),
      "utf-8"
    );

    const eventsPath = ws.eventsFile(pos.ticker);
    try {
      await fs.access(eventsPath);
    } catch {
      await fs.writeFile(eventsPath, "", "utf-8");
    }
  }

  logger.info(`Initialized portfolio for user ${userId}: ${allPositions.length} positions`);

  // Update state to BOOTSTRAPPING — preserve all existing fields, set bootstrapProgress
  const existingState = await fs.readFile(ws.stateFile, "utf-8");
  const currentState = JSON.parse(existingState);
  const newState = {
    ...currentState,
    state: "BOOTSTRAPPING",
    bootstrapProgress: {
      total: allPositions.length,
      completed: 0,
      completedTickers: [],
    },
  };
  await fs.writeFile(ws.stateFile, JSON.stringify(newState, null, 2), "utf-8");
  logger.info(`State transition: UNINITIALIZED → BOOTSTRAPPING | reason=portfolio_submitted`);
}

export interface IntegrityResult {
  userId: string;
  checkedAt: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export async function validateWorkspaceIntegrity(
  userId: string
): Promise<IntegrityResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checkedAt = new Date().toISOString();

  let ws: UserWorkspace;
  try {
    ws = await getWorkspace(userId);
  } catch {
    errors.push("Workspace does not exist");
    return { userId, checkedAt, valid: false, errors, warnings };
  }

  const portfolio = await safeReadJson<object>(ws.portfolioFile);
  if (!portfolio) {
    errors.push("portfolio.json missing or invalid");
  } else {
    const pfResult = PortfolioFileSchema.safeParse(portfolio);
    if (!pfResult.success) {
      errors.push(
        `portfolio.json schema error: ${pfResult.error.errors.map((e) => e.message).join("; ")}`
      );
    }
  }

  const state = await safeReadJson<object>(ws.stateFile);
  if (!state) {
    errors.push("state.json missing");
  } else {
    const stResult = PortfolioStateSchema.safeParse(state);
    if (!stResult.success) {
      errors.push(
        `state.json schema error: ${stResult.error.errors.map((e) => e.message).join("; ")}`
      );
    }
  }

  const portfolioTickers = new Set<string>();
  if (portfolio) {
    const pfResult = PortfolioFileSchema.safeParse(portfolio);
    if (pfResult.success) {
      for (const positions of Object.values(pfResult.data.accounts)) {
        for (const pos of positions) {
          portfolioTickers.add(pos.ticker);
        }
      }
    }
  }

  let tickerDirs: string[] = [];
  try {
    tickerDirs = await fs.readdir(ws.tickersDir);
  } catch {
    warnings.push("tickers/ directory not accessible");
  }

  for (const ticker of tickerDirs) {
    if (!portfolioTickers.has(ticker)) {
      warnings.push(
        `tickers/${ticker}/ exists but ticker not in portfolio.json`
      );
    }
  }

  for (const ticker of portfolioTickers) {
    const tickerDir = path.join(ws.tickersDir, ticker);
    try {
      await fs.access(tickerDir);
    } catch {
      errors.push(`tickers/${ticker}/ directory missing but in portfolio`);
    }
  }

  const valid = errors.length === 0;

  // Warn if USER.md is missing
  try {
    await fs.access(ws.userMdFile);
  } catch {
    warnings.push("USER.md missing — investor profile not configured");
  }

  if (valid) {
    logger.info(`Integrity check passed for user: ${userId}`);
  } else {
    logger.warn(`Integrity check failed for user ${userId}: ${errors.join("; ")}`);
  }

  return { userId, checkedAt, valid, errors, warnings };
}
