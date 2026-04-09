// backend/src/services/eventStore.ts

export interface LlmRequestEvent {
  id?: number;
  userId: string;
  purpose: string | null;   // daily_brief | deep_dive | full_report | new_ideas | null
  ticker: string | null;
  analyst: string;          // fundamentals|technical|sentiment|macro|risk|bull|bear|orchestrator
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  status: "success" | "error" | "timeout";
  errorMessage: string | null;
  timestamp: string;        // ISO 8601
}

export interface UserDailySummary {
  userId: string;
  date: string;             // YYYY-MM-DD
  requestCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
}

export interface IEventStore {
  logRequest(event: LlmRequestEvent): Promise<void>;
  getRecentActivity(userId: string, limit: number): Promise<LlmRequestEvent[]>;
  getDailySummary(date: string): Promise<UserDailySummary[]>;
  getUserDailyHistory(userId: string, days: number): Promise<UserDailySummary[]>;
  close(): void;
}

// ── Factory ─────────────────────────────────────────────────────────────────
// To swap storage backend: change the import below + return a different class.
// Nothing else in the codebase changes.

import { SqliteEventStore } from "./eventStoreSqlite.js";

function createEventStore(): IEventStore {
  return new SqliteEventStore();
}

// Singleton imported by proxy router and admin routes
export const eventStore: IEventStore = createEventStore();
