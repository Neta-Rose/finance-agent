import type { IEventStore, LlmRequestEvent, RecentActivityPage, TokenUsageSummary, UserDailySummary } from "./eventStore.js";
import { getObservabilityDataSource, closeObservabilityDataSource } from "../db/observabilityDataSource.js";
import type { ObservabilityRequestEntity } from "../db/entities/ObservabilityRequestEntity.js";

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function rowToEvent(row: Record<string, unknown>): LlmRequestEvent {
  return {
    id: toNumber(row["id"]),
    userId: String(row["user_id"] ?? ""),
    purpose: String(row["purpose"] ?? "empty from earlier version"),
    ticker: (row["ticker"] as string | null) ?? null,
    jobId: (row["job_id"] as string | null) ?? null,
    sourceClass: (row["source_class"] as LlmRequestEvent["sourceClass"]) ?? "unknown_agent_session",
    analyst: String(row["analyst"] ?? "orchestrator"),
    model: String(row["model"] ?? ""),
    tokensIn: toNumber(row["tokens_in"]),
    tokensOut: toNumber(row["tokens_out"]),
    costUsd: toNumber(row["cost_usd"]),
    latencyMs: toNumber(row["latency_ms"]),
    status: (row["status"] as LlmRequestEvent["status"]) ?? "success",
    errorMessage: (row["error_message"] as string | null) ?? null,
    attributionSource: String(row["attribution_source"] ?? "empty from earlier version"),
    rejectionReason: (row["rejection_reason"] as string | null) ?? null,
    timestamp: new Date(String(row["occurred_at"])).toISOString(),
  };
}

function fillMissingDays(userId: string, days: number, rows: UserDailySummary[]): UserDailySummary[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const result: UserDailySummary[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - i);
    const key = date.toISOString().slice(0, 10);
    result.push(
      byDate.get(key) ?? {
        userId,
        date: key,
        requestCount: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCostUsd: 0,
        successCount: 0,
        errorCount: 0,
        timeoutCount: 0,
        rejectedCount: 0,
        unattributedCount: 0,
      }
    );
  }
  return result;
}

export class PostgresEventStore implements IEventStore {
  async initialize(): Promise<void> {
    await getObservabilityDataSource();
  }

  async logRequest(event: LlmRequestEvent): Promise<void> {
    const ds = await getObservabilityDataSource();
    const repo = ds.getRepository<ObservabilityRequestEntity>("ObservabilityRequest");
    await repo.insert({
      userId: event.userId,
      purpose: event.purpose,
      ticker: event.ticker,
      jobId: event.jobId,
      sourceClass: event.sourceClass,
      analyst: event.analyst,
      model: event.model,
      tokensIn: event.tokensIn,
      tokensOut: event.tokensOut,
      costUsd: String(event.costUsd),
      latencyMs: event.latencyMs,
      status: event.status,
      errorMessage: event.errorMessage,
      attributionSource: event.attributionSource,
      rejectionReason: event.rejectionReason,
      occurredAt: new Date(event.timestamp),
    });
  }

  async countRecentRequests(filters: {
    userId: string;
    purpose: string;
    ticker: string | null;
    analyst: string;
    sinceIso: string;
  }): Promise<number> {
    const ds = await getObservabilityDataSource();
    const repo = ds.getRepository<ObservabilityRequestEntity>("ObservabilityRequest");
    const qb = repo
      .createQueryBuilder("r")
      .where("r.userId = :userId", { userId: filters.userId })
      .andWhere("r.purpose = :purpose", { purpose: filters.purpose })
      .andWhere("r.analyst = :analyst", { analyst: filters.analyst })
      .andWhere("r.occurredAt >= :sinceIso", { sinceIso: filters.sinceIso });
    if (filters.ticker) {
      qb.andWhere("r.ticker = :ticker", { ticker: filters.ticker });
    }
    return qb.getCount();
  }

  async getRecentActivityPage(userId: string, limit: number, offset: number): Promise<RecentActivityPage> {
    const ds = await getObservabilityDataSource();
    const rows = await ds.query(
      `SELECT *
       FROM llm_requests
       WHERE user_id = $1
       ORDER BY occurred_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ) as Record<string, unknown>[];
    const totalRow = await ds.query(
      `SELECT COUNT(*)::bigint AS count
       FROM llm_requests
       WHERE user_id = $1`,
      [userId]
    ) as Array<{ count: string }>;

    return {
      events: rows.map(rowToEvent),
      total: toNumber(totalRow[0]?.count),
      limit,
      offset,
    };
  }

  async getDailySummary(date: string): Promise<UserDailySummary[]> {
    const ds = await getObservabilityDataSource();
    const startIso = `${date}T00:00:00.000Z`;
    const end = new Date(startIso);
    end.setUTCDate(end.getUTCDate() + 1);
    const rows = await ds.query(
      `SELECT
         user_id AS "userId",
         to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
         COUNT(*)::int AS "requestCount",
         COALESCE(SUM(tokens_in), 0)::int AS "totalTokensIn",
         COALESCE(SUM(tokens_out), 0)::int AS "totalTokensOut",
         COALESCE(ROUND(SUM(cost_usd), 6), 0) AS "totalCostUsd",
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int AS "successCount",
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS "errorCount",
         SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END)::int AS "timeoutCount",
         SUM(CASE WHEN rejection_reason IS NOT NULL THEN 1 ELSE 0 END)::int AS "rejectedCount",
         SUM(CASE
           WHEN purpose = 'empty from earlier version' OR attribution_source = 'empty from earlier version'
           THEN 1 ELSE 0 END)::int AS "unattributedCount"
       FROM llm_requests
       WHERE occurred_at >= $1::timestamptz
         AND occurred_at < $2::timestamptz
       GROUP BY user_id, date
       ORDER BY user_id`,
      [startIso, end.toISOString()]
    ) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      userId: String(row["userId"]),
      date: String(row["date"]),
      requestCount: toNumber(row["requestCount"]),
      totalTokensIn: toNumber(row["totalTokensIn"]),
      totalTokensOut: toNumber(row["totalTokensOut"]),
      totalCostUsd: toNumber(row["totalCostUsd"]),
      successCount: toNumber(row["successCount"]),
      errorCount: toNumber(row["errorCount"]),
      timeoutCount: toNumber(row["timeoutCount"]),
      rejectedCount: toNumber(row["rejectedCount"]),
      unattributedCount: toNumber(row["unattributedCount"]),
    }));
  }

  async getUserDailyHistory(userId: string, days: number): Promise<UserDailySummary[]> {
    const ds = await getObservabilityDataSource();
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const rows = await ds.query(
      `SELECT
         user_id AS "userId",
         to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
         COUNT(*)::int AS "requestCount",
         COALESCE(SUM(tokens_in), 0)::int AS "totalTokensIn",
         COALESCE(SUM(tokens_out), 0)::int AS "totalTokensOut",
         COALESCE(ROUND(SUM(cost_usd), 6), 0) AS "totalCostUsd",
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int AS "successCount",
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS "errorCount",
         SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END)::int AS "timeoutCount",
         SUM(CASE WHEN rejection_reason IS NOT NULL THEN 1 ELSE 0 END)::int AS "rejectedCount",
         SUM(CASE
           WHEN purpose = 'empty from earlier version' OR attribution_source = 'empty from earlier version'
           THEN 1 ELSE 0 END)::int AS "unattributedCount"
       FROM llm_requests
       WHERE user_id = $1
         AND occurred_at >= $2::timestamptz
       GROUP BY user_id, date
       ORDER BY date DESC`,
      [userId, start.toISOString()]
    ) as UserDailySummary[];

    return fillMissingDays(userId, days, rows.map((row) => ({
      userId: String(row.userId),
      date: String(row.date),
      requestCount: toNumber(row.requestCount),
      totalTokensIn: toNumber(row.totalTokensIn),
      totalTokensOut: toNumber(row.totalTokensOut),
      totalCostUsd: toNumber(row.totalCostUsd),
      successCount: toNumber(row.successCount),
      errorCount: toNumber(row.errorCount),
      timeoutCount: toNumber(row.timeoutCount),
      rejectedCount: toNumber(row.rejectedCount),
      unattributedCount: toNumber(row.unattributedCount),
    })));
  }

  async getTokenUsageSummary(filters: {
    userId: string;
    sinceIso: string;
    sourceClasses?: string[];
    purpose?: string | null;
  }): Promise<TokenUsageSummary> {
    const ds = await getObservabilityDataSource();
    const params: unknown[] = [filters.userId, filters.sinceIso];
    const conditions = [
      `user_id = $1`,
      `occurred_at >= $2::timestamptz`,
    ];

    if (filters.purpose) {
      params.push(filters.purpose);
      conditions.push(`purpose = $${params.length}`);
    }

    if (filters.sourceClasses && filters.sourceClasses.length > 0) {
      params.push(filters.sourceClasses);
      conditions.push(`source_class = ANY($${params.length})`);
    }

    const rows = await ds.query(
      `SELECT
         COUNT(*)::int AS "requestCount",
         COALESCE(SUM(tokens_in), 0)::int AS "totalTokensIn",
         COALESCE(SUM(tokens_out), 0)::int AS "totalTokensOut",
         COALESCE(ROUND(SUM(cost_usd), 6), 0) AS "totalCostUsd"
       FROM llm_requests
       WHERE ${conditions.join(" AND ")}`,
      params
    ) as Array<Record<string, unknown>>;

    const row = rows[0] ?? {};
    return {
      requestCount: toNumber(row["requestCount"]),
      totalTokensIn: toNumber(row["totalTokensIn"]),
      totalTokensOut: toNumber(row["totalTokensOut"]),
      totalCostUsd: toNumber(row["totalCostUsd"]),
    };
  }

  async pruneExpiredRows(retentionDays: number): Promise<number> {
    const ds = await getObservabilityDataSource();
    const rows = await ds.query(
      `DELETE FROM llm_requests
       WHERE occurred_at < (NOW() - ($1::int * INTERVAL '1 day'))
       RETURNING id`,
      [retentionDays]
    ) as Array<{ id: string }>;
    return rows.length;
  }

  async close(): Promise<void> {
    await closeObservabilityDataSource();
  }
}
