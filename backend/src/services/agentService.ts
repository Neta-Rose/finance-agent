/**
 * agentService.ts — Phase 3 stub (OpenClaw retirement).
 *
 * Spec: design.md §B1; tasks.md 3.2.
 *
 * All OpenClaw-management functions are replaced with no-ops that log a
 * warning so any straggler call is visible in production logs. The exported
 * types and function signatures are preserved so callers compile without
 * changes; callers are updated in subsequent tasks to remove the dependency
 * entirely.
 *
 * execSync / exec / execFile from child_process are intentionally absent.
 * The Phase 3 startup guard (task 3.6) will refuse to start the backend if
 * any execSync import is detected in source.
 */

import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Constants (kept for callers that reference them)
// ---------------------------------------------------------------------------

export const SYSTEM_AGENT_ID = "main";

// ---------------------------------------------------------------------------
// AgentHealth type (kept for startupService.ts and admin.ts)
// ---------------------------------------------------------------------------

export interface AgentHealth {
  healthy: boolean;
  consecutiveErrors: number;
  lastError: string | null;
  lastErrorReason: string | null;
  lastRunAt: string | null;
  classification?: "healthy" | "degraded" | "restricted" | "inactive";
  statusReason?: string | null;
  operational?: boolean;
}

const RETIRED_HEALTH: AgentHealth = {
  healthy: true,
  consecutiveErrors: 0,
  lastError: null,
  lastErrorReason: null,
  lastRunAt: null,
  classification: "inactive",
  statusReason: "openclaw_retired",
  operational: false,
};

// ---------------------------------------------------------------------------
// Config read/write (kept for channelService, telegramRouter, profileService)
// Returns an empty config object; callers that need real data should migrate
// to the channel_bindings and encrypted_secrets tables.
// ---------------------------------------------------------------------------

export interface OpenClawConfig {
  agents?: { list?: Array<{ id: string; workspace: string; agentDir: string }> };
  channels?: {
    telegram?: {
      accounts?: Record<string, { botToken: string; dmPolicy: string; allowFrom: string[] }>;
    };
  };
  bindings?: Array<{ agentId: string; match: { channel: string; accountId: string } }>;
  [key: string]: unknown;
}

export async function readConfig(): Promise<OpenClawConfig> {
  return {};
}

export async function writeConfig(_config: OpenClawConfig): Promise<void> {
  logger.warn("agentService.writeConfig called after OpenClaw retirement — no-op");
}

// ---------------------------------------------------------------------------
// Gateway (no-op)
// ---------------------------------------------------------------------------

export async function restartGateway(): Promise<void> {
  logger.warn("agentService.restartGateway called after OpenClaw retirement — no-op");
}

// ---------------------------------------------------------------------------
// Agent registration (no-op)
// ---------------------------------------------------------------------------

export async function addUserAgent(
  userId: string,
  _workspace: string,
  _botToken?: string,
  _telegramChatId?: string
): Promise<void> {
  logger.warn(`agentService.addUserAgent called after OpenClaw retirement — no-op (userId=${userId})`);
}

export async function removeUserAgent(userId: string): Promise<void> {
  logger.warn(`agentService.removeUserAgent called after OpenClaw retirement — no-op (userId=${userId})`);
}

export async function updateUserTelegram(
  userId: string,
  _botToken: string,
  _telegramChatId: string
): Promise<void> {
  logger.warn(`agentService.updateUserTelegram called after OpenClaw retirement — no-op (userId=${userId})`);
}

export async function disconnectUserTelegram(userId: string): Promise<void> {
  logger.warn(`agentService.disconnectUserTelegram called after OpenClaw retirement — no-op (userId=${userId})`);
}

// ---------------------------------------------------------------------------
// Cron management (no-op)
// ---------------------------------------------------------------------------

export async function ensureUserCron(userId: string): Promise<void> {
  logger.warn(`agentService.ensureUserCron called after OpenClaw retirement — no-op (userId=${userId})`);
}

export async function removeUserCron(userId: string): Promise<void> {
  logger.warn(`agentService.removeUserCron called after OpenClaw retirement — no-op (userId=${userId})`);
}

export async function rebuildUserCron(userId: string): Promise<void> {
  logger.warn(`agentService.rebuildUserCron called after OpenClaw retirement — no-op (userId=${userId})`);
}

export async function reconcileUserHeartbeatCron(
  _userId: string,
  _enabled: boolean
): Promise<boolean> {
  return false;
}

export function healAllCrons(): void {
  // no-op
}

export function wakeAgent(_userId: string): void {
  // no-op
}

export async function wakeAgentsWithPendingTriggers(): Promise<void> {
  // no-op
}

export async function ensureAllUserCrons(): Promise<void> {
  // no-op
}

// ---------------------------------------------------------------------------
// Startup reconciliation (no-op — called from server.ts)
// ---------------------------------------------------------------------------

export async function ensureSystemAgent(): Promise<boolean> {
  return false;
}

export async function ensureAllProxyProviders(): Promise<boolean> {
  return false;
}

export async function applyProfileToAgent(
  _userId: string,
  _orchestratorModel: string,
  _analystsModel: string
): Promise<boolean> {
  return false;
}

export async function ensureProxyProvider(_userId: string): Promise<string> {
  return "";
}

export async function removeProxyProvider(_userId: string): Promise<void> {
  // no-op
}

// ---------------------------------------------------------------------------
// Health / status (returns safe defaults)
// ---------------------------------------------------------------------------

export async function getUserAgentStatus(_userId: string): Promise<{
  configured: boolean;
  hasTelegram: boolean;
  telegramChatId: string | undefined;
}> {
  return { configured: false, hasTelegram: false, telegramChatId: undefined };
}

export async function getSystemAgentStatus(): Promise<{
  configured: boolean;
  hasTelegram: boolean;
  telegramAccountId: string | undefined;
}> {
  return { configured: false, hasTelegram: false, telegramAccountId: undefined };
}

export async function getUserAgentHealth(_userId: string): Promise<AgentHealth> {
  return { ...RETIRED_HEALTH };
}

export async function hasRunnableTriggerFiles(
  _userId: string,
  _usersDir?: string
): Promise<boolean> {
  return false;
}
