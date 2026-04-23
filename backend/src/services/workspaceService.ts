import path from "path";
import { promises as fs } from "fs";
import { logger } from "./logger.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import { PortfolioStateSchema } from "../schemas/portfolio.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { PortfolioStateData, PositionGuidance } from "../types/index.js";
import { resolveConfiguredPath } from "./paths.js";
import { readState, writeState } from "./stateService.js";
import { buildStrategyMetadata } from "./strategyBaselineService.js";

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
const CLAWD_ROOT = resolveConfiguredPath(undefined, "..");
const USER_WORKSPACE_TEMPLATE_DIR = resolveConfiguredPath(
  process.env["USER_WORKSPACE_TEMPLATE_DIR"] ?? process.env["USER_AGENT_TEMPLATE_DIR"],
  "../shared/user-workspace"
);
const USER_WORKSPACE_MANIFEST_PATH = path.join(
  USER_WORKSPACE_TEMPLATE_DIR,
  "manifest.json"
);

interface WorkspaceTemplateManifest {
  sharedFiles: string[];
  templatedFiles: Array<{
    source: string;
    target: string;
  }>;
  emptyFiles: string[];
}

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

async function loadWorkspaceTemplateManifest(): Promise<WorkspaceTemplateManifest> {
  const fallback: WorkspaceTemplateManifest = {
    sharedFiles: ["SOUL.md", "AGENTS.md", "HEARTBEAT.md"],
    templatedFiles: [{ source: "USER.md.template", target: "USER.md" }],
    emptyFiles: ["IDENTITY.md", "TOOLS.md"],
  };

  const manifest = await safeReadJson<WorkspaceTemplateManifest>(
    USER_WORKSPACE_MANIFEST_PATH
  );
  if (!manifest) {
    logger.warn(
      `Workspace template manifest missing or invalid at ${USER_WORKSPACE_MANIFEST_PATH}; using fallback defaults`
    );
    return fallback;
  }

  return {
    sharedFiles: Array.isArray(manifest.sharedFiles)
      ? manifest.sharedFiles
      : fallback.sharedFiles,
    templatedFiles: Array.isArray(manifest.templatedFiles)
      ? manifest.templatedFiles
      : fallback.templatedFiles,
    emptyFiles: Array.isArray(manifest.emptyFiles)
      ? manifest.emptyFiles
      : fallback.emptyFiles,
  };
}

function renderWorkspaceTemplate(
  template: string,
  replacements: Record<string, string>
): string {
  let rendered = template;
  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(key, value);
  }
  return rendered;
}

async function ensureExploratoryTickerWorkspace(
  ws: UserWorkspace,
  ticker: string,
  checkedAt: string
): Promise<void> {
  const tickerDir = path.join(ws.tickersDir, ticker);
  const strategyPath = ws.strategyFile(ticker);
  const eventsPath = ws.eventsFile(ticker);

  await fs.mkdir(tickerDir, { recursive: true });

  try {
    await fs.access(strategyPath);
  } catch {
    const strategyStub = {
      ticker,
      updatedAt: checkedAt,
      version: 1,
      verdict: "HOLD",
      confidence: "low",
      reasoning: "Pending exploratory deep dive analysis",
      timeframe: "undefined",
      positionSizeILS: 0,
      positionWeightPct: 0,
      entryConditions: [],
      exitConditions: [],
      catalysts: [],
      bullCase: null,
      bearCase: null,
      lastDeepDiveAt: null,
      deepDiveTriggeredBy: "manual_exploration",
      metadata: buildStrategyMetadata("manual_exploration", "provisional", checkedAt, false),
    };
    await fs.writeFile(strategyPath, JSON.stringify(strategyStub, null, 2), "utf-8");
  }

  try {
    await fs.access(eventsPath);
  } catch {
    await fs.writeFile(eventsPath, "", "utf-8");
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

export async function listWorkspaceUserIds(): Promise<string[]> {
  try {
    const entries = await fs.readdir(USERS_DIR, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
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
  const templateManifest = await loadWorkspaceTemplateManifest();

  await fs.mkdir(ws.jobsDir, { recursive: true });
  await fs.mkdir(ws.triggersDir, { recursive: true });
  await fs.mkdir(ws.snapshotsDir, { recursive: true });
  await fs.mkdir(ws.tickersDir, { recursive: true });
  await fs.mkdir(ws.reportsDir, { recursive: true });

  const initialState: PortfolioStateData = {
    userId,
    state: "INCOMPLETE",
    lastFullReportAt: null,
    lastDailyAt: null,
    pendingDeepDives: [],
    bootstrapProgress: null,
    onboarding: {
      portfolioSubmittedAt: null,
      positionGuidanceStatus: "not_started",
      positionGuidance: {},
    },
  };
  await fs.writeFile(
    ws.stateFile,
    JSON.stringify(initialState, null, 2),
    "utf-8"
  );

  const config = { modelProfile: "testing", plan: "pro" };
  await fs.writeFile(
    ws.configFile,
    JSON.stringify(config, null, 2),
    "utf-8"
  );

  // Render templated files from the canonical shared user workspace template.
  for (const templateFile of templateManifest.templatedFiles) {
    try {
      const templatePath = path.join(
        USER_WORKSPACE_TEMPLATE_DIR,
        templateFile.source
      );
      const template = await fs.readFile(templatePath, "utf-8");
      const rendered = renderWorkspaceTemplate(template, {
        "[DISPLAY_NAME]": userId,
        "[DATE]": new Date().toISOString(),
      });
      await fs.writeFile(
        path.join(ws.root, templateFile.target),
        rendered,
        "utf-8"
      );
    } catch (err) {
      if (templateFile.target !== "USER.md") {
        logger.warn(
          `Could not render ${templateFile.target} from workspace template: ${err}`
        );
        continue;
      }

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
      logger.warn(`Fell back to stub USER.md for ${userId}`);
    }
  }

  // Copy canonical shared workspace files into the user workspace.
  for (const file of templateManifest.sharedFiles) {
    try {
      await fs.copyFile(
        path.join(USER_WORKSPACE_TEMPLATE_DIR, file),
        path.join(ws.root, file)
      );
    } catch (err) {
      logger.warn(`Could not copy ${file} to user workspace: ${err}`);
    }
  }

  // Create empty OpenClaw-managed files declared by the template manifest.
  for (const file of templateManifest.emptyFiles) {
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

export async function saveUserPortfolio(
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

  const currentState = await readState(userId);
  const validTickers = new Set(
    Object.values(parsed.data.accounts).flat().map((position) => position.ticker)
  );
  const preservedGuidance = Object.fromEntries(
    Object.entries(currentState.onboarding.positionGuidance).filter(([ticker]) => validTickers.has(ticker))
  ) as Record<string, PositionGuidance>;

  await writeState(userId, {
    state: "INCOMPLETE",
    bootstrapProgress: null,
    onboarding: {
      portfolioSubmittedAt: new Date().toISOString(),
      positionGuidanceStatus: "pending",
      positionGuidance: preservedGuidance,
    },
  });
}

function createStrategyStub(ticker: string, userGuidanceApplied: boolean) {
  return {
    ticker,
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
    metadata: buildStrategyMetadata(
      "bootstrap",
      "provisional",
      new Date().toISOString(),
      userGuidanceApplied
    ),
  };
}

export async function startUserBootstrap(
  userId: string
): Promise<{ totalPositions: number }> {
  const ws = await getWorkspace(userId);
  const currentState = await readState(userId);
  const rawPortfolio = await fs.readFile(ws.portfolioFile, "utf-8");
  const portfolio = PortfolioFileSchema.parse(JSON.parse(rawPortfolio));

  // Bootstrap strategy/report state is keyed by ticker, so dedupe holdings across accounts.
  const uniquePositions = new Map<string, { ticker: string; exchange: string }>();
  for (const positions of Object.values(portfolio.accounts)) {
    for (const pos of positions) {
      if (!uniquePositions.has(pos.ticker)) {
        uniquePositions.set(pos.ticker, { ticker: pos.ticker, exchange: pos.exchange });
      }
    }
  }

  for (const pos of uniquePositions.values()) {
    const tickerDir = path.join(ws.tickersDir, pos.ticker);
    await fs.mkdir(tickerDir, { recursive: true });

    await fs.writeFile(
      ws.strategyFile(pos.ticker),
      JSON.stringify(
        createStrategyStub(
          pos.ticker,
          Object.prototype.hasOwnProperty.call(currentState.onboarding.positionGuidance, pos.ticker)
        ),
        null,
        2
      ),
      "utf-8"
    );

    const eventsPath = ws.eventsFile(pos.ticker);
    try {
      await fs.access(eventsPath);
    } catch {
      await fs.writeFile(eventsPath, "", "utf-8");
    }
  }

  logger.info(`Initialized portfolio for user ${userId}: ${uniquePositions.size} unique tickers`);

  await writeState(userId, {
    state: "BOOTSTRAPPING",
    bootstrapProgress: {
      total: uniquePositions.size,
      completed: 0,
      completedTickers: [],
    },
    onboarding: {
      ...currentState.onboarding,
      positionGuidanceStatus:
        currentState.onboarding.positionGuidanceStatus === "skipped" ? "skipped" : "completed",
    },
  });
  logger.info(`State transition: INCOMPLETE → BOOTSTRAPPING | reason=bootstrap_started`);
  return { totalPositions: uniquePositions.size };
}

export interface WorkspaceReconciliationResult {
  userId: string;
  checkedAt: string;
  archivedTickers: string[];
  archivedReports: string[];
  removedPendingDeepDives: string[];
  changed: boolean;
}

export async function reconcileWorkspaceIntegrity(
  userId: string
): Promise<WorkspaceReconciliationResult> {
  const checkedAt = new Date().toISOString();
  const ws = await getWorkspace(userId);

  const result: WorkspaceReconciliationResult = {
    userId,
    checkedAt,
    archivedTickers: [],
    archivedReports: [],
    removedPendingDeepDives: [],
    changed: false,
  };

  const portfolio = await safeReadJson<object>(ws.portfolioFile);
  const parsedPortfolio = portfolio ? PortfolioFileSchema.safeParse(portfolio) : null;
  if (!parsedPortfolio?.success) {
    return result;
  }

  const validTickers = new Set<string>();
  for (const positions of Object.values(parsedPortfolio.data.accounts)) {
    for (const position of positions) {
      validTickers.add(position.ticker);
    }
  }

  const currentState = await readState(userId);
  const knownTickerData = new Set(validTickers);

  try {
    const tickerDirs = (await fs.readdir(ws.tickersDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const ticker of tickerDirs) {
      knownTickerData.add(ticker);
    }
  } catch {
    // ignore missing ticker dir
  }

  try {
    const reportDirs = (await fs.readdir(ws.reportsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter(
        (name) =>
          name !== "index" &&
          name !== "archive" &&
          name !== "snapshots"
      );
    for (const ticker of reportDirs) {
      knownTickerData.add(ticker);
      await ensureExploratoryTickerWorkspace(ws, ticker, checkedAt);
    }
  } catch {
    // ignore missing reports dir
  }

  const nextPendingDeepDives = currentState.pendingDeepDives.filter((ticker) =>
    knownTickerData.has(ticker)
  );
  if (nextPendingDeepDives.length !== currentState.pendingDeepDives.length) {
    result.removedPendingDeepDives = currentState.pendingDeepDives.filter(
      (ticker) => !validTickers.has(ticker)
    );
    await writeState(userId, {
      pendingDeepDives: nextPendingDeepDives,
    });
  }

  result.changed =
    result.archivedTickers.length > 0 ||
    result.archivedReports.length > 0 ||
    result.removedPendingDeepDives.length > 0;

  if (result.changed) {
    logger.info(
      `Reconciled workspace integrity for ${userId}: archivedTickers=${result.archivedTickers.join(",") || "none"} archivedReports=${result.archivedReports.join(",") || "none"} removedPendingDeepDives=${result.removedPendingDeepDives.join(",") || "none"}`
    );
  }

  return result;
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
