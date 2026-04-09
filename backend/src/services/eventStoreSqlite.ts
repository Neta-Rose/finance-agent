// backend/src/services/eventStoreSqlite.ts
import Database from "better-sqlite3";
import path from "path";
import { logger } from "./logger.js";
import type { IEventStore, LlmRequestEvent, UserDailySummary } from "./eventStore.js";

const DATA_DIR = process.env["DATA_DIR"] ?? "../data";

export class SqliteEventStore implements IEventStore {
  private db: Database.Database;

  constructor() {
    const dbPath = path.resolve(DATA_DIR, "observability.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
    logger.info(`Event store initialized: ${dbPath}`);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_requests (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       TEXT    NOT NULL,
        purpose       TEXT,
        ticker        TEXT,
        analyst       TEXT    NOT NULL DEFAULT 'orchestrator',
        model         TEXT    NOT NULL,
        tokens_in     INTEGER NOT NULL DEFAULT 0,
        tokens_out    INTEGER NOT NULL DEFAULT 0,
        cost_usd      REAL    NOT NULL DEFAULT 0,
        latency_ms    INTEGER NOT NULL DEFAULT 0,
        status        TEXT    NOT NULL DEFAULT 'success',
        error_message TEXT,
        timestamp     TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_llm_user    ON llm_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_llm_time    ON llm_requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_llm_user_ts ON llm_requests(user_id, timestamp);
    `);
  }

  async logRequest(event: LlmRequestEvent): Promise<void> {
    this.db.prepare(`
      INSERT INTO llm_requests
        (user_id, purpose, ticker, analyst, model,
         tokens_in, tokens_out, cost_usd, latency_ms,
         status, error_message, timestamp)
      VALUES
        (@userId, @purpose, @ticker, @analyst, @model,
         @tokensIn, @tokensOut, @costUsd, @latencyMs,
         @status, @errorMessage, @timestamp)
    `).run({
      userId:       event.userId,
      purpose:      event.purpose,
      ticker:       event.ticker,
      analyst:      event.analyst,
      model:        event.model,
      tokensIn:     event.tokensIn,
      tokensOut:    event.tokensOut,
      costUsd:      event.costUsd,
      latencyMs:    event.latencyMs,
      status:       event.status,
      errorMessage: event.errorMessage,
      timestamp:    event.timestamp,
    });
  }

  async getRecentActivity(userId: string, limit: number): Promise<LlmRequestEvent[]> {
    const rows = this.db.prepare(`
      SELECT * FROM llm_requests
      WHERE user_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(userId, limit) as Record<string, unknown>[];
    return rows.map(SqliteEventStore.rowToEvent);
  }

  async getDailySummary(date: string): Promise<UserDailySummary[]> {
    return this.db.prepare(`
      SELECT
        user_id                AS userId,
        date(timestamp)        AS date,
        COUNT(*)               AS requestCount,
        SUM(tokens_in)         AS totalTokensIn,
        SUM(tokens_out)        AS totalTokensOut,
        ROUND(SUM(cost_usd),6) AS totalCostUsd
      FROM llm_requests
      WHERE date(timestamp) = ?
      GROUP BY user_id
      ORDER BY user_id
    `).all(date) as UserDailySummary[];
  }

  async getUserDailyHistory(userId: string, days: number): Promise<UserDailySummary[]> {
    return this.db.prepare(`
      SELECT
        user_id                AS userId,
        date(timestamp)        AS date,
        COUNT(*)               AS requestCount,
        SUM(tokens_in)         AS totalTokensIn,
        SUM(tokens_out)        AS totalTokensOut,
        ROUND(SUM(cost_usd),6) AS totalCostUsd
      FROM llm_requests
      WHERE user_id = ?
        AND timestamp >= datetime('now', ?)
      GROUP BY date(timestamp)
      ORDER BY date DESC
    `).all(userId, `-${days} days`) as UserDailySummary[];
  }

  close(): void {
    this.db.close();
  }

  private static rowToEvent(row: Record<string, unknown>): LlmRequestEvent {
    return {
      id:           row["id"] as number,
      userId:       row["user_id"] as string,
      purpose:      row["purpose"] as string | null,
      ticker:       row["ticker"] as string | null,
      analyst:      row["analyst"] as string,
      model:        row["model"] as string,
      tokensIn:     row["tokens_in"] as number,
      tokensOut:    row["tokens_out"] as number,
      costUsd:      row["cost_usd"] as number,
      latencyMs:    row["latency_ms"] as number,
      status:       row["status"] as "success" | "error" | "timeout",
      errorMessage: row["error_message"] as string | null,
      timestamp:    row["timestamp"] as string,
    };
  }
}
