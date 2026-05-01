import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { StrategySchema } from "../schemas/strategy.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import { listPortfolioTickers } from "../services/baselineCoverageService.js";
import { resolveConfiguredPath } from "../services/paths.js";
import { JobSchema } from "../schemas/job.js";
import { MODEL_TIERS, type ModelTier } from "../services/stepQueue/types.js";

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
const ACTIVE_LEGACY_STATUSES = new Set(["pending", "running", "paused"]);

interface MigrationReport {
  userId: string;
  modelTier: ModelTier;
  supersededLegacyJobs: string[];
  baselineStrategiesCreated: string[];
  profileUpdated: boolean;
}

function parseArgs(argv: string[]): { userId: string; modelTier: ModelTier } {
  const userId = argv[2];
  const tierArgIndex = argv.indexOf("--model-tier");
  const rawTier = tierArgIndex >= 0 ? argv[tierArgIndex + 1] : "cheap";
  if (!userId) {
    throw new Error("Usage: tsx src/scripts/migrateUserToStepQueue.ts <userId> [--model-tier cheap]");
  }
  if (!rawTier || !(MODEL_TIERS as readonly string[]).includes(rawTier)) {
    throw new Error(`Invalid model tier: ${rawTier}`);
  }
  return { userId, modelTier: rawTier as ModelTier };
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filePath, "utf-8")) as Record<string, unknown>;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function supersedeLegacyActiveJobs(userId: string): Promise<string[]> {
  const ws = buildWorkspace(userId, USERS_DIR);
  let files: string[] = [];
  try {
    files = await fs.readdir(ws.jobsDir);
  } catch {
    return [];
  }

  const superseded: string[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(ws.jobsDir, file);
    try {
      const parsed = JobSchema.safeParse(await readJson(filePath));
      if (!parsed.success) continue;
      if (
        (parsed.data.action === "full_report" || parsed.data.action === "deep_dive") &&
        ACTIVE_LEGACY_STATUSES.has(parsed.data.status)
      ) {
        await writeJson(filePath, {
          ...parsed.data,
          status: "superseded",
          completed_at: new Date().toISOString(),
          error: "Superseded by backend step-queue migration",
        });
        superseded.push(parsed.data.id);
        try {
          await fs.unlink(path.join(ws.triggersDir, `${parsed.data.id}.json`));
        } catch {
          // Trigger may have been consumed already.
        }
      }
    } catch {
      // Skip malformed legacy job files; this script should be safe to rerun.
    }
  }
  return superseded;
}

function baselineStrategy(ticker: string): unknown {
  const now = new Date().toISOString();
  return StrategySchema.parse({
    ticker,
    updatedAt: now,
    version: 1,
    verdict: "HOLD",
    confidence: "low",
    reasoning: "Baseline placeholder created during step-queue migration pending full analysis.",
    timeframe: "undefined",
    positionSizeILS: 0,
    positionWeightPct: 0,
    entryConditions: [],
    exitConditions: [],
    catalysts: [],
    bullCase: null,
    bearCase: null,
    lastDeepDiveAt: null,
    deepDiveTriggeredBy: "step_queue_migration",
    metadata: {
      source: "migration",
      status: "provisional",
      generatedAt: now,
      userGuidanceApplied: false,
    },
  });
}

async function ensureStrategies(userId: string): Promise<string[]> {
  const ws = buildWorkspace(userId, USERS_DIR);
  const tickers = await listPortfolioTickers(ws);
  const created: string[] = [];
  for (const ticker of tickers) {
    const strategyPath = ws.strategyFile(ticker);
    try {
      StrategySchema.parse(await readJson(strategyPath));
    } catch {
      await writeJson(strategyPath, baselineStrategy(ticker));
      created.push(ticker);
    }
  }
  return created;
}

async function setProfileModelTier(userId: string, modelTier: ModelTier): Promise<boolean> {
  const profilePath = path.join(USERS_DIR, userId, "profile.json");
  const profile = await readJson(profilePath);
  if (profile["modelTier"] === modelTier) return false;
  await writeJson(profilePath, {
    ...profile,
    modelTier,
  });
  return true;
}

export async function migrateUserToStepQueue(userId: string, modelTier: ModelTier): Promise<MigrationReport> {
  const [supersededLegacyJobs, baselineStrategiesCreated, profileUpdated] = await Promise.all([
    supersedeLegacyActiveJobs(userId),
    ensureStrategies(userId),
    setProfileModelTier(userId, modelTier),
  ]);
  return {
    userId,
    modelTier,
    supersededLegacyJobs,
    baselineStrategiesCreated,
    profileUpdated,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { userId, modelTier } = parseArgs(process.argv);
    const report = await migrateUserToStepQueue(userId, modelTier);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
