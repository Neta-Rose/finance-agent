import fs from "fs/promises";
import { execSync } from "child_process";
import { logger } from "./logger.js";

const OPENCLAW_CONFIG = "/root/.openclaw/openclaw.json";

interface AgentEntry {
  id: string;
  workspace: string;
  agentDir: string;
}

interface TelegramAccount {
  botToken: string;
  dmPolicy: string;
  allowFrom: string[];
}

interface OpenClawConfig {
  agents?: {
    list?: AgentEntry[];
    defaults?: Record<string, unknown>;
  };
  channels?: {
    telegram?: {
      botToken?: string;
      accounts?: Record<string, TelegramAccount>;
      bindings?: Array<{ agentId: string; match: { channel: string; accountId: string } }>;
    };
  };
}

// Strip // comments so JSON.parse can handle JSON5-style comments
function stripJson5Comments(str: string): string {
  return str
    .replace(/([^:])\/\/.*$/gm, '$1')
    .replace(/^\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

export async function readConfig(): Promise<OpenClawConfig> {
  try {
    const raw = await fs.readFile(OPENCLAW_CONFIG, "utf-8");
    return JSON.parse(stripJson5Comments(raw)) as OpenClawConfig;
  } catch {
    return {};
  }
}

export async function writeConfig(config: OpenClawConfig): Promise<void> {
  await fs.writeFile(OPENCLAW_CONFIG, JSON.stringify(config, null, 2), "utf-8");
}

export async function addUserAgent(
  userId: string,
  workspace: string,
  botToken?: string,
  telegramChatId?: string
): Promise<void> {
  const config = await readConfig();

  // Ensure agents.list exists
  if (!config.agents) config.agents = {};
  if (!config.agents.list) config.agents.list = [];

  // Remove existing entry if present
  config.agents.list = config.agents.list.filter((a) => a.id !== userId);
  config.agents.list.push({
    id: userId,
    workspace,
    agentDir: `/root/.openclaw/agents/${userId}/agent`,
  });

  // Add Telegram account if botToken provided
  if (botToken && telegramChatId) {
    if (!config.channels) config.channels = {};
    if (!config.channels.telegram) config.channels.telegram = {};
    if (!config.channels.telegram.accounts) config.channels.telegram.accounts = {};

    config.channels.telegram.accounts[userId] = {
      botToken,
      dmPolicy: "allow",
      allowFrom: [telegramChatId],
    };

    // Add binding
    if (!config.channels.telegram.bindings) config.channels.telegram.bindings = [];
    config.channels.telegram.bindings = config.channels.telegram.bindings.filter(
      (b) => b.agentId !== userId
    );
    config.channels.telegram.bindings.push({
      agentId: userId,
      match: { channel: "telegram", accountId: userId },
    });
  }

  await writeConfig(config);
  logger.info(`Added user agent: ${userId}`);
}

export async function removeUserAgent(userId: string): Promise<void> {
  const config = await readConfig();

  if (config.agents?.list) {
    config.agents.list = config.agents.list.filter((a) => a.id !== userId);
  }

  if (config.channels?.telegram?.bindings) {
    config.channels.telegram.bindings = config.channels.telegram.bindings.filter(
      (b) => b.agentId !== userId
    );
  }

  if (config.channels?.telegram?.accounts) {
    delete config.channels.telegram.accounts[userId];
  }

  await writeConfig(config);
  logger.info(`Removed user agent: ${userId}`);
}

export async function updateUserTelegram(
  userId: string,
  botToken: string,
  telegramChatId: string
): Promise<void> {
  const config = await readConfig();

  if (!config.channels?.telegram?.accounts?.[userId]) {
    await addUserAgent(userId, "", botToken, telegramChatId);
    return;
  }

  config.channels.telegram.accounts[userId] = {
    ...config.channels.telegram.accounts[userId],
    botToken,
    allowFrom: [telegramChatId],
  };

  await writeConfig(config);
  logger.info(`Updated Telegram for user: ${userId}`);
}

export async function restartGateway(): Promise<void> {
  try {
    execSync("openclaw gateway restart", { timeout: 15_000, stdio: "ignore" });
    logger.info("OpenClaw gateway restarted");
  } catch (err) {
    logger.warn("Gateway restart failed — may restart itself", { err });
  }
}

export async function getUserAgentStatus(userId: string): Promise<{
  configured: boolean;
  hasTelegram: boolean;
  telegramChatId: string | undefined;
}> {
  try {
    const config = await readConfig();
    const agent = config.agents?.list?.find((a) => a.id === userId);
    const telegramAccount = config.channels?.telegram?.accounts?.[userId];
    return {
      configured: !!agent,
      hasTelegram: !!telegramAccount,
      telegramChatId: telegramAccount?.allowFrom?.[0],
    };
  } catch {
    return { configured: false, hasTelegram: false, telegramChatId: undefined };
  }
}
