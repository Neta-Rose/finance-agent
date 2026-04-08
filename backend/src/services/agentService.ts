import fs from "fs/promises";
import { execSync } from "child_process";
import { logger } from "./logger.js";

const OPENCLAW_CONFIG = "/root/.openclaw/openclaw.json";
const USERS_DIR = "/root/clawd/users";

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

interface TelegramBinding {
  agentId: string;
  match: { channel: string; accountId: string };
}

interface OpenClawConfig {
  agents?: {
    list?: AgentEntry[];
    defaults?: Record<string, unknown>;
  };
  channels?: {
    telegram?: {
      // flat admin config fields — never overwrite these
      botToken?: string;
      enabled?: boolean;
      dmPolicy?: string;
      allowFrom?: string[];
      [key: string]: unknown;
      // per-user structures we manage
      accounts?: Record<string, TelegramAccount>;
      bindings?: TelegramBinding[];
    };
  };
  [key: string]: unknown;
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
  _workspace: string,  // kept for signature compat, we always derive absolute path
  botToken?: string,
  telegramChatId?: string
): Promise<void> {
  const config = await readConfig();

  // ── agents.list ──────────────────────────────────────────────────────────
  if (!config.agents) config.agents = {};
  if (!config.agents.list) config.agents.list = [];

  const agentExists = config.agents.list.some((a) => a.id === userId);
  if (!agentExists) {
    config.agents.list.push({
      id: userId,
      workspace: `${USERS_DIR}/${userId}`,
      agentDir: `/root/.openclaw/agents/${userId}/agent`,
    });
    logger.info(`Adding agent to list: ${userId}`);
  } else {
    logger.info(`Agent already in list, skipping agents.list add: ${userId}`);
  }

  // ── Telegram account + binding (only if botToken provided) ────────────────
  if (botToken && telegramChatId) {
    if (!config.channels) config.channels = {};
    if (!config.channels.telegram) config.channels.telegram = {};

    // accounts sub-object — safe to create alongside existing flat config fields
    if (!config.channels.telegram.accounts) {
      config.channels.telegram.accounts = {};
    }
    if (!config.channels.telegram.accounts[userId]) {
      config.channels.telegram.accounts[userId] = {
        botToken,
        dmPolicy: "allowlist",
        allowFrom: [telegramChatId],
      };
      logger.info(`Added Telegram account for: ${userId}`);
    } else {
      logger.info(`Telegram account already exists, skipping: ${userId}`);
    }

    // bindings array
    if (!config.channels.telegram.bindings) {
      config.channels.telegram.bindings = [];
    }
    const alreadyBound = config.channels.telegram.bindings.some(
      (b) => b.agentId === userId
    );
    if (!alreadyBound) {
      config.channels.telegram.bindings.push({
        agentId: userId,
        match: { channel: "telegram", accountId: userId },
      });
      logger.info(`Added Telegram binding for: ${userId}`);
    } else {
      logger.info(`Telegram binding already exists, skipping: ${userId}`);
    }
  }

  await writeConfig(config);

  // Restart gateway and verify
  await restartGateway();

  // Verify agent appears in list
  try {
    const raw = execSync("openclaw agents list --json", {
      timeout: 10_000,
      encoding: "utf-8",
    });
    const agents = JSON.parse(raw) as Array<{ id: string }>;
    if (!agents.some((a) => a.id === userId)) {
      throw new Error(
        `Agent "${userId}" not found after registration. Current agents: ${raw}`
      );
    }
    logger.info(`Verified agent registered: ${userId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Agent verification failed for ${userId}: ${msg}`);
    throw new Error(`Agent verification failed: ${msg}`);
  }
}

export async function removeUserAgent(userId: string): Promise<void> {
  const config = await readConfig();

  // Remove from agents.list
  if (config.agents?.list) {
    config.agents.list = config.agents.list.filter((a) => a.id !== userId);
  }

  // Remove from bindings
  if (config.channels?.telegram?.bindings) {
    config.channels.telegram.bindings = config.channels.telegram.bindings.filter(
      (b) => b.agentId !== userId
    );
  }

  // Remove from accounts
  if (config.channels?.telegram?.accounts?.[userId]) {
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

  if (!config.channels) config.channels = {};
  if (!config.channels.telegram) config.channels.telegram = {};
  if (!config.channels.telegram.accounts) config.channels.telegram.accounts = {};

  // Upsert the account entry (explicit update, so always overwrite)
  config.channels.telegram.accounts[userId] = {
    botToken,
    dmPolicy: "allowlist",
    allowFrom: [telegramChatId],
  };

  // Ensure binding exists
  if (!config.channels.telegram.bindings) config.channels.telegram.bindings = [];
  const alreadyBound = config.channels.telegram.bindings.some(
    (b) => b.agentId === userId
  );
  if (!alreadyBound) {
    config.channels.telegram.bindings.push({
      agentId: userId,
      match: { channel: "telegram", accountId: userId },
    });
  }

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
