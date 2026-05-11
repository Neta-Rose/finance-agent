import type { DataSource } from "typeorm";
type JSONSchema7 = Record<string, unknown>;
import type { StrategyRecord } from "../../strategyStore.js";
import type { ReportBatchRecord } from "../../reportIndexStore.js";
import type { EscalationHistoryRecord } from "../../escalationHistoryStore.js";
import type { TickerSnoozeRecord } from "../../snoozeStore.js";
import type { NotificationRecord } from "../../notificationStore.js";
import type { PortfolioRiskSnapshotRecord } from "../../portfolioRiskStore.js";
import type { VerdictActionRecord } from "../../verdictActionsStore.js";
import { buildReadTools } from "./readTools.js";
import { buildActionTools } from "./actionTools.js";

/**
 * Tool registry — Phase 5, task 5.7.
 *
 * Spec: design.md §8; E3.1–E3.3, E4.1–E4.2, F3.2.
 *
 * `buildToolRegistry(ctx)` returns the typed Read+Action tool array.
 * Any name not in the allowlist throws at build time (E4.1, F3.2).
 * Forbidden tool names are enumerated and asserted absent at startup (E3.1–E3.3).
 */

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

export const READ_TOOL_NAMES = [
  "getPortfolio",
  "getStrategy",
  "getStrategies",
  "getRecentReports",
  "getReportSummary",
  "getCatalystsDueSoon",
  "getEscalationHistory",
  "getRiskSummary",
  "getNotifications",
  "searchWeb",
] as const;

export const ACTION_TOOL_NAMES = [
  "triggerQuickCheck",
  "triggerDeepDive",
  "triggerDailyBrief",
  "snoozeTicker",
  "markVerdictAddressed",
  "waitForJob",
] as const;

export const ALL_TOOL_NAMES = [...READ_TOOL_NAMES, ...ACTION_TOOL_NAMES] as const;
export type ToolName = (typeof ALL_TOOL_NAMES)[number];

/**
 * Forbidden tool names — must NEVER appear in the registry (E3.1, E3.2).
 * The startup guard asserts none of these are in ALL_TOOL_NAMES.
 */
export const FORBIDDEN_TOOL_NAMES = [
  "readFile", "writeFile", "listFiles", "deleteFile",
  "runShell", "executeCode", "execCommand",
  "readSoul", "readAgents", "readClaude", "readHeartbeat", "readReset", "readOpenClaw",
  "listUsers", "readOtherUserPortfolio", "readOtherUserStrategy",
  "adminTrigger", "restartService", "restartGateway",
  "editConfig", "setUserRestriction", "setSystemLock",
] as const;

// ---------------------------------------------------------------------------
// Context and definition types
// ---------------------------------------------------------------------------

export interface ToolContext {
  userId: string;
  conversationId: string;
  turnIndex: number;
  confirmationToken: string | null;
  db: DataSource | null;
  // Stores injected by buildToolRegistry
  strategyStore: {
    readStrategy(userId: string, ticker: string): Promise<StrategyRecord | null>;
    listStrategies(userId: string, options?: { assetScope?: "portfolio" | "tracking" }): Promise<StrategyRecord[]>;
  };
  reportIndexStore: {
    listReportBatches(userId: string, options?: { limit?: number }): Promise<ReportBatchRecord[]>;
    readReportBatch?(batchId: string): Promise<ReportBatchRecord | null>;
  };
  escalationHistoryStore: {
    listEscalationHistory(userId: string, options?: { ticker?: string; limit?: number }): Promise<EscalationHistoryRecord[]>;
  };
  snoozeStore: {
    createSnooze(input: { userId: string; ticker: string; snoozeUntil: string; signalSetFingerprint: string; reason?: string | null }): Promise<TickerSnoozeRecord>;
  };
  notificationStore: {
    listNotifications(userId: string, options?: { unreadOnly?: boolean; limit?: number }): Promise<NotificationRecord[]>;
  };
  portfolioRiskStore: {
    getLatestPortfolioRiskSnapshot(userId: string): Promise<PortfolioRiskSnapshotRecord | null>;
  };
  verdictActionsStore: {
    recordVerdictAction(input: { userId: string; ticker: string; strategyVersion: number; decision: "followed" | "dismissed" | "partial_acted"; note?: string | null }): Promise<VerdictActionRecord>;
  };
}

export interface ToolResult {
  status: "success" | "error";
  data?: unknown;
  error?: string;
}

export interface ToolDefinition {
  name: ToolName;
  category: "read" | "action";
  description: string;
  inputSchema: JSONSchema7;
  handler: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
  costPoints?: number;
  requiresConfirmation?: boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function buildToolRegistry(ctx: ToolContext): ToolDefinition[] {
  const all = [...buildReadTools(ctx), ...buildActionTools(ctx)];

  // E4.1: verify every tool is in the allowlist
  for (const tool of all) {
    if (!(ALL_TOOL_NAMES as readonly string[]).includes(tool.name)) {
      throw new Error(`tool_not_in_allowlist: ${tool.name}`);
    }
  }

  return all;
}

/**
 * Convert a ToolDefinition to the JSON schema shape the LLM provider expects.
 */
export function toolToProviderDef(tool: ToolDefinition): {
  name: string;
  description: string;
  input_schema: JSONSchema7;
} {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}
