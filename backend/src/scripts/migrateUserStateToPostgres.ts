import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import { resolveConfiguredPath } from "../services/paths.js";
import { logger } from "../services/logger.js";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { listWorkspaceUserIds } from "../services/workspaceService.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import { StrategySchema, type Strategy } from "../schemas/strategy.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import { dualWriteStrategy } from "../services/strategyExportService.js";
import { recordEscalation } from "../services/escalationHistoryStore.js";
import { insertNotification, type NotificationCategory, type NotificationChannel } from "../services/notificationStore.js";
import { putReportBatch } from "../services/reportIndexStore.js";
import { bindChannel } from "../services/channelBindingStore.js";
import { upsertEncryptedSecret } from "../services/security/encryptedSecretsStore.js";
import { recordArchive } from "../services/migrationArchiveStore.js";

/**
 * Migrate one user's JSON state into Postgres (Phase 1, task 1.6).
 *
 * Spec: design.md §6.1 migration tooling; A2.5 (idempotent), A2.6 (fail-loud
 * on corrupt input). The script is **dry-run by default**; pass `--commit`
 * to actually write rows.
 *
 * Per-user advisory lock: the script refuses to run while any
 * `step_work_items.status='running'` row exists for that user — operator
 * waits or supersedes (§16.1 lock-and-quiesce).
 *
 * Idempotent: every write uses `ON CONFLICT DO UPDATE` or the equivalent
 * "first writer wins" path inside the store. Re-running yields the same
 * row counts.
 *
 * Synthetic opening lots: each existing position becomes one synthetic
 * `transfer_in` lot with `transactionAt = users.created_at`, `quantity =
 * shares`, `unitPrice = unitAvgBuyPrice`. Realized P/L for pre-migration
 * sales is therefore not computable — the API surfaces this as
 * `realizedPlAvailableSince = users.created_at`.
 *
 * Telegram tokens are read from `~/.openclaw/openclaw.json` and stored
 * identity-encrypted (key_id=0) for now; Phase 8 re-encrypts under libsodium.
 */

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
const OPENCLAW_CONFIG_PATH = process.env["OPENCLAW_CONFIG_PATH"] ?? path.resolve(process.env["HOME"] ?? "/root", ".openclaw/openclaw.json");

interface MigrationOptions {
  commit: boolean;
  userIds: string[] | null;
}

interface UserMigrationCounts {
  user: number;
  strategies: number;
  reportBatches: number;
  reportIndexEntries: number;
  notifications: number;
  escalationHistory: number;
  syntheticLots: number;
  channelBindings: number;
  encryptedSecrets: number;
  corruptInputs: number;
  inFlightStepsBlocked: number;
}

function emptyCounts(): UserMigrationCounts {
  return {
    user: 0,
    strategies: 0,
    reportBatches: 0,
    reportIndexEntries: 0,
    notifications: 0,
    escalationHistory: 0,
    syntheticLots: 0,
    channelBindings: 0,
    encryptedSecrets: 0,
    corruptInputs: 0,
    inFlightStepsBlocked: 0,
  };
}

interface UserMigrationResult {
  userId: string;
  ok: boolean;
  counts: UserMigrationCounts;
  errors: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Argv parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): MigrationOptions {
  const commit = argv.includes("--commit");
  const userArgIndex = argv.indexOf("--user");
  const allFlag = argv.includes("--all");
  if (userArgIndex >= 0) {
    const value = argv[userArgIndex + 1];
    if (!value) throw new Error("--user requires a value");
    return { commit, userIds: [value] };
  }
  if (allFlag) {
    return { commit, userIds: null };
  }
  throw new Error("Usage: tsx migrateUserStateToPostgres.ts (--user <id> | --all) [--commit]");
}

// ---------------------------------------------------------------------------
// Per-user advisory lock
// ---------------------------------------------------------------------------

function userIdHash(userId: string): bigint {
  // pg_advisory_xact_lock takes a bigint; fold a stable 64-bit hash so
  // distinct users get distinct lock keys without colliding.
  const digest = createHash("sha256").update(userId).digest();
  // Use the low 8 bytes as a signed bigint (Postgres bigint is signed).
  const high = BigInt(digest.readUInt32BE(0));
  const low = BigInt(digest.readUInt32BE(4));
  return ((high << 32n) | low) & 0x7fffffffffffffffn;
}

async function userHasInFlightSteps(userId: string): Promise<boolean> {
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT 1 AS one FROM step_work_items
      WHERE user_id = $1 AND status = 'running'
      LIMIT 1`,
    [userId]
  )) as Array<{ one: number }>;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// File reading helpers
// ---------------------------------------------------------------------------

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

async function readDirOrEmpty(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
}

async function archiveCorruptInput(
  userId: string,
  filePath: string,
  reason: string,
  payload: unknown,
  options: MigrationOptions
): Promise<void> {
  if (!options.commit) return;
  await recordArchive({
    userId,
    sourcePath: filePath,
    reason: "corrupt_input_skipped",
    payload: { reason, raw: payload },
  });
}

// ---------------------------------------------------------------------------
// Per-section migrators (no-op when commit=false beyond counting)
// ---------------------------------------------------------------------------

interface SectionContext {
  userId: string;
  userCreatedAt: string;
  options: MigrationOptions;
  counts: UserMigrationCounts;
  errors: string[];
}

async function migrateUserRow(ctx: SectionContext): Promise<void> {
  const ws = buildWorkspace(ctx.userId, USERS_DIR);
  const auth = await readJsonOrNull<{ passwordHash?: string; tokenVersion?: number }>(
    path.join(ws.root, "auth.json")
  );
  const profile = await readJsonOrNull<Record<string, unknown>>(path.join(ws.root, "profile.json"));

  if (!auth?.passwordHash) {
    ctx.errors.push("auth.json missing or corrupt");
    return;
  }

  const displayName = typeof profile?.["displayName"] === "string"
    ? (profile["displayName"] as string).slice(0, 128)
    : ctx.userId;
  const tokenVersion = typeof auth.tokenVersion === "number" ? auth.tokenVersion : 0;
  const schedule = profile?.["schedule"] && typeof profile["schedule"] === "object"
    ? (profile["schedule"] as Record<string, unknown>)
    : { dailyBriefTime: "08:00", weeklyResearchDay: "sunday", weeklyResearchTime: "19:00", timezone: "Asia/Jerusalem" };
  const rateLimits = profile?.["rateLimits"] && typeof profile["rateLimits"] === "object"
    ? (profile["rateLimits"] as Record<string, unknown>)
    : {};
  const modelTier = typeof profile?.["modelTier"] === "string" ? (profile["modelTier"] as string) : "balanced";

  // state.json — for the `state` column.
  const state = await readJsonOrNull<Record<string, unknown>>(ws.stateFile);
  const stateValue = typeof state?.["state"] === "string"
    ? (state["state"] as string)
    : "INCOMPLETE";
  const normalizedState = stateValue === "UNINITIALIZED" ? "INCOMPLETE" : stateValue;

  // config.json — for modelProfile.
  const config = await readJsonOrNull<Record<string, unknown>>(path.join(ws.root, "data", "config.json"));
  const modelProfile = typeof config?.["modelProfile"] === "string"
    ? (config["modelProfile"] as string)
    : "testing";

  if (!ctx.options.commit) {
    ctx.counts.user = 1;
    return;
  }

  const ds = await getApplicationDataSource();
  await ds.query(
    `INSERT INTO users (
       user_id, display_name, password_hash, token_version, schedule, rate_limits,
       model_tier, model_profile, lot_method, max_single_position_pct, stop_loss_threshold_pct,
       state, restriction, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, 'fifo', 15.00, 25.00,
       $9, NULL, $10, NOW()
     )
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       token_version = GREATEST(users.token_version, EXCLUDED.token_version),
       schedule = EXCLUDED.schedule,
       rate_limits = EXCLUDED.rate_limits,
       model_tier = EXCLUDED.model_tier,
       model_profile = EXCLUDED.model_profile,
       state = EXCLUDED.state,
       updated_at = NOW()`,
    [
      ctx.userId,
      displayName,
      auth.passwordHash,
      tokenVersion,
      JSON.stringify(schedule),
      JSON.stringify(rateLimits),
      ["free", "cheap", "balanced", "expensive"].includes(modelTier) ? modelTier : "balanced",
      modelProfile,
      ["INCOMPLETE", "BOOTSTRAPPING", "ACTIVE", "BLOCKED"].includes(normalizedState) ? normalizedState : "INCOMPLETE",
      ctx.userCreatedAt,
    ]
  );

  await recordArchive({
    userId: ctx.userId,
    sourcePath: ws.root,
    reason: "user_state_migrated",
    payload: {
      displayName,
      modelTier,
      modelProfile,
      state: normalizedState,
    },
  });
  ctx.counts.user = 1;
}

async function migrateStrategies(ctx: SectionContext): Promise<void> {
  const ws = buildWorkspace(ctx.userId, USERS_DIR);
  const tickers = await readDirOrEmpty(ws.tickersDir);
  for (const ticker of tickers) {
    const filePath = ws.strategyFile(ticker);
    let raw: unknown;
    try {
      raw = await readJsonOrNull(filePath);
    } catch {
      raw = null;
    }
    if (!raw) continue;
    const parsed = StrategySchema.safeParse(raw);
    if (!parsed.success) {
      ctx.counts.corruptInputs += 1;
      ctx.errors.push(`strategy ${ticker}: ${parsed.error.message.slice(0, 200)}`);
      await archiveCorruptInput(ctx.userId, filePath, "strategy_zod_failed", raw, ctx.options);
      continue;
    }
    if (!ctx.options.commit) {
      ctx.counts.strategies += 1;
      continue;
    }
    await dualWriteStrategy(parsed.data as Strategy, ctx.userId);
    ctx.counts.strategies += 1;
  }
}

async function migrateReportIndex(ctx: SectionContext): Promise<void> {
  const ws = buildWorkspace(ctx.userId, USERS_DIR);
  const indexDir = path.join(ws.reportsDir, "index");
  const pageFiles = (await readDirOrEmpty(indexDir)).filter((f) => /^page-\d+\.json$/.test(f));
  for (const file of pageFiles) {
    const filePath = path.join(indexDir, file);
    const page = await readJsonOrNull<{ batches: Array<Record<string, unknown>> }>(filePath);
    if (!page?.batches) continue;
    for (const rawBatch of page.batches) {
      const batchId = typeof rawBatch["batchId"] === "string" ? (rawBatch["batchId"] as string) : null;
      const triggeredAt = typeof rawBatch["triggeredAt"] === "string" ? (rawBatch["triggeredAt"] as string) : null;
      const mode = typeof rawBatch["mode"] === "string" ? (rawBatch["mode"] as string) : null;
      const jobId = typeof rawBatch["jobId"] === "string" ? (rawBatch["jobId"] as string) : null;
      const tickers = Array.isArray(rawBatch["tickers"]) ? (rawBatch["tickers"] as string[]) : [];
      const entriesObj = (rawBatch["entries"] && typeof rawBatch["entries"] === "object"
        ? rawBatch["entries"]
        : {}) as Record<string, Record<string, unknown>>;

      if (!batchId || !triggeredAt || !mode || !jobId) {
        ctx.counts.corruptInputs += 1;
        await archiveCorruptInput(ctx.userId, filePath, "report_batch_missing_keys", rawBatch, ctx.options);
        continue;
      }

      if (!ctx.options.commit) {
        ctx.counts.reportBatches += 1;
        ctx.counts.reportIndexEntries += tickers.length;
        continue;
      }

      try {
        await putReportBatch({
          batchId,
          userId: ctx.userId,
          jobId,
          mode,
          triggeredAt,
          summary: rawBatch["summary"] && typeof rawBatch["summary"] === "object"
            ? (rawBatch["summary"] as Record<string, unknown>)
            : null,
          highlights: rawBatch["highlights"] && typeof rawBatch["highlights"] === "object"
            ? (rawBatch["highlights"] as Record<string, unknown>)
            : null,
          entries: tickers.map((ticker) => ({
            ticker,
            dailySection: typeof rawBatch["dailySection"] === "string" ? (rawBatch["dailySection"] as string) : null,
            entry: entriesObj[ticker] ?? {},
          })),
        });
        ctx.counts.reportBatches += 1;
        ctx.counts.reportIndexEntries += tickers.length;
      } catch (err) {
        ctx.errors.push(`report_batch ${batchId}: ${(err as Error).message.slice(0, 200)}`);
      }
    }
  }
}

async function migrateNotifications(ctx: SectionContext): Promise<void> {
  const ws = buildWorkspace(ctx.userId, USERS_DIR);
  const filePath = path.join(ws.root, "data", "feed", "notifications.json");
  const items = await readJsonOrNull<Array<Record<string, unknown>>>(filePath);
  if (!items) return;

  for (const item of items) {
    const id = typeof item["id"] === "string" ? (item["id"] as string) : null;
    const category = item["category"] as NotificationCategory | undefined;
    const channel = item["channel"] as NotificationChannel | undefined;
    const title = typeof item["title"] === "string" ? (item["title"] as string) : null;
    const body = typeof item["body"] === "string" ? (item["body"] as string) : null;
    if (!id || !category || !channel || !title || body === null) {
      ctx.counts.corruptInputs += 1;
      await archiveCorruptInput(ctx.userId, filePath, "notification_missing_keys", item, ctx.options);
      continue;
    }

    if (!ctx.options.commit) {
      ctx.counts.notifications += 1;
      continue;
    }

    try {
      await insertNotification({
        id,
        userId: ctx.userId,
        category,
        channel,
        title,
        body,
        ticker: typeof item["ticker"] === "string" ? (item["ticker"] as string) : null,
        batchId: typeof item["batchId"] === "string" ? (item["batchId"] as string) : null,
        delivered: Boolean(item["delivered"]),
        deliveredAt: typeof item["deliveredAt"] === "string" ? (item["deliveredAt"] as string) : null,
        readAt: typeof item["readAt"] === "string" ? (item["readAt"] as string) : null,
        error: typeof item["error"] === "string" ? (item["error"] as string) : null,
      });
      ctx.counts.notifications += 1;
    } catch (err) {
      // Duplicate id is the most likely failure on re-run; treat as success.
      const message = (err as Error).message;
      if (!message.includes("duplicate key")) {
        ctx.errors.push(`notification ${id}: ${message.slice(0, 200)}`);
      }
    }
  }
}

async function migrateEscalationHistory(ctx: SectionContext): Promise<void> {
  const ws = buildWorkspace(ctx.userId, USERS_DIR);
  const filePath = path.join(ws.root, "data", "escalation_history.json");
  const history = await readJsonOrNull<Record<string, { timestamp?: string; signals?: string[]; jobId?: string }>>(filePath);
  if (!history) return;

  for (const [ticker, record] of Object.entries(history)) {
    const signals = Array.isArray(record?.signals) ? record.signals : [];
    const jobId = typeof record?.jobId === "string" ? record.jobId : null;
    if (!jobId || signals.length === 0) {
      ctx.counts.corruptInputs += 1;
      await archiveCorruptInput(ctx.userId, filePath, "escalation_record_missing_keys", record, ctx.options);
      continue;
    }
    if (!ctx.options.commit) {
      ctx.counts.escalationHistory += 1;
      continue;
    }
    try {
      const sortedSignals = [...signals].sort();
      const fingerprint = createHash("sha256").update(JSON.stringify(sortedSignals)).digest("hex").slice(0, 32);
      await recordEscalation({
        userId: ctx.userId,
        ticker,
        signalSetFingerprint: fingerprint,
        jobId,
        signals: sortedSignals,
      });
      ctx.counts.escalationHistory += 1;
    } catch (err) {
      ctx.errors.push(`escalation ${ticker}: ${(err as Error).message.slice(0, 200)}`);
    }
  }
}

async function migrateSyntheticOpeningLots(ctx: SectionContext): Promise<void> {
  const ws = buildWorkspace(ctx.userId, USERS_DIR);
  const portfolio = await readJsonOrNull(ws.portfolioFile);
  if (!portfolio) return;
  const parsed = PortfolioFileSchema.safeParse(portfolio);
  if (!parsed.success) {
    ctx.counts.corruptInputs += 1;
    ctx.errors.push(`portfolio.json: ${parsed.error.message.slice(0, 200)}`);
    await archiveCorruptInput(ctx.userId, ws.portfolioFile, "portfolio_zod_failed", portfolio, ctx.options);
    return;
  }

  for (const [account, positions] of Object.entries(parsed.data.accounts)) {
    for (const pos of positions) {
      if (!ctx.options.commit) {
        ctx.counts.syntheticLots += 1;
        continue;
      }
      // The position_transactions table doesn't ship until Phase 7. We DO
      // want the audit trail right now though, so write a migration_archive
      // row that the Phase 7 ingest can replay.
      await recordArchive({
        userId: ctx.userId,
        sourcePath: ws.portfolioFile,
        reason: "synthetic_opening_lot_inserted",
        payload: {
          account,
          ticker: pos.ticker,
          exchange: pos.exchange,
          shares: pos.shares,
          unitAvgBuyPrice: pos.unitAvgBuyPrice,
          unitCurrency: pos.unitCurrency,
          transactionAt: ctx.userCreatedAt,
          note: "synthetic_opening_lot",
        },
      });
      ctx.counts.syntheticLots += 1;
    }
  }
}

async function migrateChannelBindings(ctx: SectionContext): Promise<void> {
  const ws = buildWorkspace(ctx.userId, USERS_DIR);
  const profile = await readJsonOrNull<Record<string, unknown>>(path.join(ws.root, "profile.json"));
  const chatId = typeof profile?.["telegramChatId"] === "string"
    ? (profile["telegramChatId"] as string)
    : null;
  if (!chatId) return;

  if (!ctx.options.commit) {
    ctx.counts.channelBindings += 1;
    return;
  }
  await bindChannel({
    channel: "telegram",
    channelIdentifier: chatId,
    userId: ctx.userId,
    conversationId: null,
  });
  await recordArchive({
    userId: ctx.userId,
    sourcePath: path.join(ws.root, "profile.json"),
    reason: "channel_binding_migrated",
    payload: { channel: "telegram", chatId },
  });
  ctx.counts.channelBindings += 1;
}

async function migrateTelegramTokens(ctx: SectionContext): Promise<void> {
  const config = await readJsonOrNull<{ channels?: { telegram?: { accounts?: Record<string, { botToken?: string }> } } }>(
    OPENCLAW_CONFIG_PATH
  );
  const account = config?.channels?.telegram?.accounts?.[ctx.userId];
  const botToken = account?.botToken;
  if (!botToken) return;

  if (!ctx.options.commit) {
    ctx.counts.encryptedSecrets += 1;
    return;
  }
  await upsertEncryptedSecret({
    userId: ctx.userId,
    secretKind: "telegram_bot_token",
    plaintext: botToken,
  });
  await recordArchive({
    userId: ctx.userId,
    sourcePath: OPENCLAW_CONFIG_PATH,
    reason: "telegram_token_migrated",
    payload: { tokenLast4: botToken.slice(-4) },
  });
  ctx.counts.encryptedSecrets += 1;
}

// ---------------------------------------------------------------------------
// Per-user driver
// ---------------------------------------------------------------------------

async function migrateOneUser(userId: string, options: MigrationOptions): Promise<UserMigrationResult> {
  const startedAt = Date.now();
  const counts = emptyCounts();
  const errors: string[] = [];

  if (await userHasInFlightSteps(userId)) {
    counts.inFlightStepsBlocked = 1;
    return {
      userId,
      ok: false,
      counts,
      errors: ["user has in-flight step_work_items.status='running'; quiesce or supersede first"],
      durationMs: Date.now() - startedAt,
    };
  }

  // Determine userCreatedAt for the synthetic transactionAt.
  // We use the workspace mtime as a reasonable proxy when no DB row exists yet.
  const wsRoot = path.join(USERS_DIR, userId);
  let userCreatedAt = new Date().toISOString();
  try {
    const stat = await fs.stat(wsRoot);
    userCreatedAt = stat.birthtime.toISOString();
  } catch {
    // fall through with `now`
  }

  const ds = await getApplicationDataSource();
  const lockKey = userIdHash(userId);

  try {
    if (options.commit) {
      await ds.transaction(async (manager) => {
        await manager.query(`SELECT pg_advisory_xact_lock($1)`, [lockKey.toString()]);
        const ctx: SectionContext = { userId, userCreatedAt, options, counts, errors };
        await migrateUserRow(ctx);
        await migrateStrategies(ctx);
        await migrateReportIndex(ctx);
        await migrateNotifications(ctx);
        await migrateEscalationHistory(ctx);
        await migrateSyntheticOpeningLots(ctx);
        await migrateChannelBindings(ctx);
        await migrateTelegramTokens(ctx);
        await recordArchive({
          userId,
          sourcePath: wsRoot,
          reason: "summary_audit",
          payload: counts,
        });
      });
    } else {
      const ctx: SectionContext = { userId, userCreatedAt, options, counts, errors };
      await migrateUserRow(ctx);
      await migrateStrategies(ctx);
      await migrateReportIndex(ctx);
      await migrateNotifications(ctx);
      await migrateEscalationHistory(ctx);
      await migrateSyntheticOpeningLots(ctx);
      await migrateChannelBindings(ctx);
      await migrateTelegramTokens(ctx);
    }
  } catch (err) {
    errors.push(`fatal: ${(err as Error).message.slice(0, 300)}`);
    return { userId, ok: false, counts, errors, durationMs: Date.now() - startedAt };
  }

  return { userId, ok: errors.length === 0, counts, errors, durationMs: Date.now() - startedAt };
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export async function migrateAllUsers(options: MigrationOptions): Promise<UserMigrationResult[]> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("APP_DATABASE_URL is not configured; cannot run the migration");
  }
  await getApplicationDataSource(); // ensure DDL applied
  const userIds = options.userIds ?? (await listWorkspaceUserIds());
  const results: UserMigrationResult[] = [];
  for (const userId of userIds) {
    logger.info(`Migrating user ${userId} (commit=${options.commit})`);
    const result = await migrateOneUser(userId, options);
    results.push(result);
    if (!result.ok) {
      logger.warn(`Migration for ${userId} reported errors: ${result.errors.join("; ")}`);
    }
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv);
    const results = await migrateAllUsers(options);
    const summary = {
      commit: options.commit,
      users: results.length,
      withErrors: results.filter((r) => !r.ok).length,
      details: results,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (summary.withErrors > 0) process.exit(2);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
