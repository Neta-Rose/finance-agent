import "dotenv/config";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { listWorkspaceUserIds } from "../services/workspaceService.js";
import { replayOpeningLot } from "../services/transactionStore.js";
import { logger } from "../services/logger.js";

/**
 * Replay synthetic opening lots from migration_archive into position_transactions.
 *
 * Phase 1 migration archived synthetic lot data but could not insert
 * `position_transactions` rows (the table didn't exist yet). This script
 * reads `migration_archive` rows with `reason='synthetic_opening_lot_inserted'`
 * and inserts the corresponding `position_transactions` rows.
 *
 * Idempotent: skips rows where a `position_transactions` row with
 * `note='synthetic_opening_lot'` already exists for the same (user, ticker).
 *
 * Usage:
 *   tsx replayOpeningLots.ts (--user <id> | --all) [--commit]
 */

interface OpeningLotPayload {
  account: string;
  ticker: string;
  exchange: string;
  shares: number;
  unitAvgBuyPrice: number;
  unitCurrency: string;
  transactionAt: string;
  note: string;
}

function parseArgs(argv: string[]): { commit: boolean; userIds: string[] | null } {
  const commit = argv.includes("--commit");
  const userIdx = argv.indexOf("--user");
  if (userIdx >= 0) {
    const value = argv[userIdx + 1];
    if (!value) throw new Error("--user requires a value");
    return { commit, userIds: [value] };
  }
  if (argv.includes("--all")) return { commit, userIds: null };
  throw new Error("Usage: tsx replayOpeningLots.ts (--user <id> | --all) [--commit]");
}

async function replayForUser(userId: string, commit: boolean): Promise<{ inserted: number; skipped: number }> {
  const ds = await getApplicationDataSource();

  // Read archived lots for this user
  const archiveRows = (await ds.query(
    `SELECT payload FROM migration_archive
      WHERE user_id = $1 AND reason = 'synthetic_opening_lot_inserted'
      ORDER BY archived_at ASC`,
    [userId]
  )) as Array<{ payload: OpeningLotPayload }>;

  let inserted = 0;
  let skipped = 0;

  for (const row of archiveRows) {
    const payload = row.payload;
    if (!payload?.ticker || !payload?.shares) continue;

    // Check if already inserted
    const existing = (await ds.query(
      `SELECT id FROM position_transactions
        WHERE user_id = $1 AND ticker = $2 AND note = 'synthetic_opening_lot'
          AND superseded_at IS NULL
        LIMIT 1`,
      [userId, payload.ticker.toUpperCase()]
    )) as Array<{ id: string }>;

    if (existing.length > 0) {
      skipped += 1;
      continue;
    }

    if (!commit) {
      inserted += 1;
      continue;
    }

    await replayOpeningLot({
      userId,
      ticker: payload.ticker,
      exchange: payload.exchange,
      account: payload.account ?? "main",
      shares: payload.shares,
      unitAvgBuyPrice: payload.unitAvgBuyPrice,
      unitCurrency: payload.unitCurrency ?? "USD",
      transactionAt: payload.transactionAt,
    });
    inserted += 1;
  }

  return { inserted, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (!isApplicationDatabaseConfigured()) {
      throw new Error("APP_DATABASE_URL is not configured");
    }
    const { commit, userIds } = parseArgs(process.argv);
    await getApplicationDataSource();
    const ids = userIds ?? (await listWorkspaceUserIds());
    const results: Array<{ userId: string; inserted: number; skipped: number }> = [];
    for (const userId of ids) {
      const result = await replayForUser(userId, commit);
      results.push({ userId, ...result });
      logger.info(`replayOpeningLots: user=${userId} inserted=${result.inserted} skipped=${result.skipped} commit=${commit}`);
    }
    console.log(JSON.stringify({ commit, users: results.length, results }, null, 2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
