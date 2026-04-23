// backend/src/services/eventStore.ts

export interface LlmRequestEvent {
  id?: number;
  userId: string;
  purpose: string;
  ticker: string | null;
  jobId: string | null;
  sourceClass: "backend_job" | "telegram_command" | "dashboard_action" | "direct_chat" | "unknown_agent_session";
  analyst: string;          // fundamentals|technical|sentiment|macro|risk|bull|bear|orchestrator
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  status: "success" | "error" | "timeout";
  errorMessage: string | null;
  attributionSource: string;
  rejectionReason: string | null;
  timestamp: string;        // ISO 8601
}

export interface TokenUsageSummary {
  requestCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
}

export interface UserDailySummary {
  userId: string;
  date: string;             // YYYY-MM-DD
  requestCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  rejectedCount: number;
  unattributedCount: number;
}

export interface RecentActivityPage {
  events: LlmRequestEvent[];
  total: number;
  limit: number;
  offset: number;
}

export interface IEventStore {
  initialize(): Promise<void>;
  logRequest(event: LlmRequestEvent): Promise<void>;
  countRecentRequests(filters: {
    userId: string;
    purpose: string;
    ticker: string | null;
    analyst: string;
    sinceIso: string;
  }): Promise<number>;
  getRecentActivityPage(
    userId: string,
    limit: number,
    offset: number
  ): Promise<RecentActivityPage>;
  getDailySummary(date: string): Promise<UserDailySummary[]>;
  getUserDailyHistory(userId: string, days: number): Promise<UserDailySummary[]>;
  getTokenUsageSummary(filters: {
    userId: string;
    sinceIso: string;
    sourceClasses?: string[];
    purpose?: string | null;
  }): Promise<TokenUsageSummary>;
  pruneExpiredRows(retentionDays: number): Promise<number>;
  close(): Promise<void>;
}

// ── Factory ─────────────────────────────────────────────────────────────────
// To swap storage backend: change the import below + return a different class.
// Nothing else in the codebase changes.

import { PostgresEventStore } from "./eventStorePostgres.js";

function createEventStore(): IEventStore {
  return new PostgresEventStore();
}

// Singleton imported by proxy router and admin routes
export const eventStore: IEventStore = createEventStore();
