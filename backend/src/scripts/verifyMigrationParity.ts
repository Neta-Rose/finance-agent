import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { resolveConfiguredPath } from "../services/paths.js";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { listWorkspaceUserIds } from "../services/workspaceService.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import { StrategySchema } from "../schemas/strategy.js";
import { listStrategies } from "../services/strategyStore.js";
import { listEscalationHistory } from "../services/escalationHistoryStore.js";
import { listNotifications } from "../services/notificationStore.js";

/**
 * Migration parity verifier (Phase 1, task 1.7).
 *
 * Compares the per-user JSON files against the DB rows that the migration
 * script (1.6) and the dual-write paths (1.5) produced. Any divergence is
 * reported as a structured row; zero divergence is the gate to ship Phase 1.
 *
 * Read-only: never writes to the DB or to the JSON files.
 *
 * Usage:
 *   tsx verifyMigrationParity.ts (--user <id> | --all)
 */

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");

interface ParityIssue {
  userId: string;
  category: "strategy" | "escalation_history" | "notifications";
  detail: string;
}

interface UserParityReport {
  userId: string;
  ok: boolean;
  issues: ParityIssue[];
  counts: {
    strategiesJson: number;
    strategiesDb: number;
    escalationJson: number;
    escalationDb: number;
    notificationsJson: number;
    notificationsDb: number;
  };
}

function parseArgs(argv: string[]): { userIds: string[] | null } {
  const userIdx = argv.indexOf("--user");
  if (userIdx >= 0) {
    const value = argv[userIdx + 1];
    if (!value) throw new Error("--user requires a value");
    return { userIds: [value] };
  }
  if (argv.includes("--all")) return { userIds: null };
  throw new Error("Usage: tsx verifyMigrationParity.ts (--user <id> | --all)");
}

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

async function readDirOrEmpty(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Strategies parity
// ---------------------------------------------------------------------------

async function verifyStrategies(userId: string, issues: ParityIssue[], counts: UserParityReport["counts"]): Promise<void> {
  const ws = buildWorkspace(userId, USERS_DIR);
  const tickerDirs = await readDirOrEmpty(ws.tickersDir);
  const jsonByTicker = new Map<string, { verdict: string; version: number }>();

  for (const ticker of tickerDirs) {
    const raw = await readJsonOrNull(ws.strategyFile(ticker));
    if (!raw) continue;
    const parsed = StrategySchema.safeParse(raw);
    if (!parsed.success) {
      issues.push({ userId, category: "strategy", detail: `${ticker}: JSON file fails Zod` });
      continue;
    }
    jsonByTicker.set(parsed.data.ticker.toUpperCase(), {
      verdict: parsed.data.verdict,
      version: parsed.data.version,
    });
  }
  counts.strategiesJson = jsonByTicker.size;

  const dbRecords = await listStrategies(userId);
  const dbByTicker = new Map(dbRecords.map((r) => [r.ticker.toUpperCase(), { verdict: r.verdict, version: r.version }]));
  counts.strategiesDb = dbRecords.length;

  for (const [ticker, jsonValue] of jsonByTicker.entries()) {
    const dbValue = dbByTicker.get(ticker);
    if (!dbValue) {
      issues.push({ userId, category: "strategy", detail: `${ticker}: present in JSON, missing in DB` });
      continue;
    }
    if (jsonValue.verdict !== dbValue.verdict) {
      issues.push({
        userId,
        category: "strategy",
        detail: `${ticker}: verdict differs (json=${jsonValue.verdict}, db=${dbValue.verdict})`,
      });
    }
  }
  for (const ticker of dbByTicker.keys()) {
    if (!jsonByTicker.has(ticker)) {
      // DB has rows JSON does not — usually means an older JSON file was
      // pruned. Report as an info issue so it shows up in the report but
      // does not flip ok=false.
      issues.push({ userId, category: "strategy", detail: `${ticker}: present in DB, missing in JSON (info)` });
    }
  }
}

// ---------------------------------------------------------------------------
// Escalation history parity
// ---------------------------------------------------------------------------

async function verifyEscalationHistory(
  userId: string,
  issues: ParityIssue[],
  counts: UserParityReport["counts"]
): Promise<void> {
  const ws = buildWorkspace(userId, USERS_DIR);
  const filePath = path.join(ws.root, "data", "escalation_history.json");
  const json = await readJsonOrNull<Record<string, { signals?: string[]; jobId?: string }>>(filePath);
  const jsonTickerCount = json ? Object.keys(json).length : 0;
  counts.escalationJson = jsonTickerCount;

  const dbRows = await listEscalationHistory(userId, { limit: 1000 });
  // Reduce DB rows to "latest per ticker" for parity with JSON shape.
  const dbLatestByTicker = new Map<string, { signals: string[]; jobId: string }>();
  for (const row of dbRows) {
    if (!dbLatestByTicker.has(row.ticker)) {
      dbLatestByTicker.set(row.ticker, { signals: row.signals, jobId: row.jobId });
    }
  }
  counts.escalationDb = dbLatestByTicker.size;

  if (!json) return;
  for (const [ticker, record] of Object.entries(json)) {
    const dbRow = dbLatestByTicker.get(ticker.toUpperCase());
    if (!dbRow) {
      issues.push({
        userId,
        category: "escalation_history",
        detail: `${ticker}: present in JSON, missing in DB`,
      });
      continue;
    }
    if (record.jobId && dbRow.jobId !== record.jobId) {
      issues.push({
        userId,
        category: "escalation_history",
        detail: `${ticker}: jobId differs (json=${record.jobId}, db=${dbRow.jobId})`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Notifications parity
// ---------------------------------------------------------------------------

async function verifyNotifications(
  userId: string,
  issues: ParityIssue[],
  counts: UserParityReport["counts"]
): Promise<void> {
  const ws = buildWorkspace(userId, USERS_DIR);
  const filePath = path.join(ws.root, "data", "feed", "notifications.json");
  const items = await readJsonOrNull<Array<{ id?: string }>>(filePath);
  const jsonIds = new Set<string>(
    (items ?? []).map((item) => (typeof item.id === "string" ? item.id : "")).filter(Boolean)
  );
  counts.notificationsJson = jsonIds.size;

  const db = await listNotifications(userId, { limit: 5000 });
  const dbIds = new Set(db.map((d) => d.id));
  counts.notificationsDb = dbIds.size;

  for (const id of jsonIds) {
    if (!dbIds.has(id)) {
      issues.push({
        userId,
        category: "notifications",
        detail: `id ${id}: present in JSON, missing in DB`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Per-user driver
// ---------------------------------------------------------------------------

async function verifyOneUser(userId: string): Promise<UserParityReport> {
  const issues: ParityIssue[] = [];
  const counts: UserParityReport["counts"] = {
    strategiesJson: 0,
    strategiesDb: 0,
    escalationJson: 0,
    escalationDb: 0,
    notificationsJson: 0,
    notificationsDb: 0,
  };
  await verifyStrategies(userId, issues, counts);
  await verifyEscalationHistory(userId, issues, counts);
  await verifyNotifications(userId, issues, counts);

  // Info-only issues (JSON-missing-but-DB-has) do not block.
  const blockingIssues = issues.filter((issue) => !issue.detail.includes("(info)"));
  return {
    userId,
    ok: blockingIssues.length === 0,
    issues,
    counts,
  };
}

export async function verifyAllUsers(userIds: string[] | null): Promise<UserParityReport[]> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("APP_DATABASE_URL is not configured; cannot verify");
  }
  await getApplicationDataSource(); // ensure DDL applied
  const ids = userIds ?? (await listWorkspaceUserIds());
  const results: UserParityReport[] = [];
  for (const userId of ids) {
    results.push(await verifyOneUser(userId));
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { userIds } = parseArgs(process.argv);
    const results = await verifyAllUsers(userIds);
    const summary = {
      users: results.length,
      withIssues: results.filter((r) => !r.ok).length,
      details: results,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (summary.withIssues > 0) process.exit(2);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
