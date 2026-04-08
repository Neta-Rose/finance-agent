import fs from "fs/promises";
import { execSync, exec as execAsync } from "child_process";
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

interface CronEntry {
  id: string;
  name?: string;
  agentId?: string;
  agent?: string;
}

interface OpenClawConfig {
  agents?: {
    list?: AgentEntry[];
    defaults?: Record<string, unknown>;
  };
  channels?: {
    telegram?: {
      botToken?: string;
      enabled?: boolean;
      dmPolicy?: string;
      allowFrom?: string[];
      [key: string]: unknown;
      accounts?: Record<string, TelegramAccount>;
      bindings?: TelegramBinding[];
    };
  };
  [key: string]: unknown;
}

// Strip // comments so JSON.parse can handle JSON5-style comments
function stripJson5Comments(str: string): string {
  return str
    .replace(/([^:])\/\/.*$/gm, "$1")
    .replace(/^\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
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

// ── Cron helpers ─────────────────────────────────────────────────────────────

function cronName(userId: string): string {
  return `${userId}-heartbeat`;
}

function listCrons(): CronEntry[] {
  try {
    const raw = execSync("openclaw cron list --json", {
      timeout: 10_000,
      encoding: "utf-8",
    });
    const parsed = JSON.parse(raw) as { jobs?: CronEntry[] } | CronEntry[];
    // Gateway returns { jobs: [...] }
    if (parsed && !Array.isArray(parsed) && "jobs" in parsed) {
      return parsed.jobs ?? [];
    }
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function ensureUserCron(userId: string): Promise<void> {
  const name = cronName(userId);
  const existing = listCrons();
  if (existing.some((c) => c.name === name)) {
    logger.info(`Cron already exists for: ${userId}`);
    return;
  }
  const triggersPath = `${USERS_DIR}/${userId}/data/triggers`;
  const msg =
    `You have pending work. Check ${triggersPath}/ for .json trigger files. ` +
    `For each: read it, update jobs/[job_id].json status→running, delete the trigger, ` +
    `execute the action (full_report/daily_brief/deep_dive/new_ideas/switch_production/switch_testing). ` +
    `After all triggers processed (or if none found), proceed with HEARTBEAT.md scheduled tasks. ` +
    `Your workspace is ${USERS_DIR}/${userId}.`;
  try {
    execSync(
      `openclaw cron add --agent "${userId}" --every 30m --thinking low ` +
        `--name "${name}" --message ${JSON.stringify(msg)} --session isolated`,
      { timeout: 15_000, stdio: "pipe" }
    );
    logger.info(`Created heartbeat cron for: ${userId}`);
  } catch (err) {
    logger.warn(`Failed to create cron for ${userId}: ${err}`);
  }
}

function getCronId(userId: string): string | null {
  const name = cronName(userId);
  const crons = listCrons();
  return crons.find((c) => c.name === name)?.id ?? null;
}

export async function removeUserCron(userId: string): Promise<void> {
  const id = getCronId(userId);
  if (!id) {
    logger.info(`No cron to remove for: ${userId}`);
    return;
  }
  try {
    execSync(`openclaw cron rm "${id}"`, { timeout: 10_000, stdio: "ignore" });
    logger.info(`Removed heartbeat cron for: ${userId}`);
  } catch (err) {
    logger.warn(`Failed to remove cron for ${userId}: ${err}`);
  }
}

/**
 * Fire-and-forget: runs the user's heartbeat cron immediately.
 * Does NOT block — the trigger file already persists on disk so
 * the 30-min fallback cron will catch it if this wake is ignored.
 */
export function wakeAgent(userId: string): void {
  // Resolve cron ID asynchronously so we don't block the response
  execAsync("openclaw cron list --json", { timeout: 10_000 }, (listErr, stdout) => {
    if (listErr) {
      logger.warn(`Could not list crons to wake agent ${userId}: ${listErr.message}`);
      return;
    }
    try {
      const parsed = JSON.parse(stdout) as { jobs?: CronEntry[] } | CronEntry[];
      const crons: CronEntry[] =
        !Array.isArray(parsed) && "jobs" in parsed
          ? (parsed.jobs ?? [])
          : Array.isArray(parsed) ? parsed : [];

      const cron = crons.find((c) => c.name === cronName(userId));
      if (!cron) {
        logger.warn(`No cron found to wake agent: ${userId}`);
        return;
      }
      // cron run takes ID as positional argument
      execAsync(`openclaw cron run ${cron.id}`, { timeout: 10_000 }, (runErr) => {
        if (runErr) {
          logger.warn(`Could not wake agent ${userId}: ${runErr.message}`);
        } else {
          logger.info(`Woke agent: ${userId}`);
        }
      });
    } catch (parseErr) {
      logger.warn(`Could not parse cron list for ${userId}: ${parseErr}`);
    }
  });
}

// ── Agent registration ────────────────────────────────────────────────────────

export async function addUserAgent(
  userId: string,
  _workspace: string, // kept for signature compat — always derived as absolute path
  botToken?: string,
  telegramChatId?: string
): Promise<void> {
  const config = await readConfig();

  // ── agents.list ────────────────────────────────────────────────────────────
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

  // ── Telegram account + binding (only if botToken provided) ─────────────────
  if (botToken && telegramChatId) {
    if (!config.channels) config.channels = {};
    if (!config.channels.telegram) config.channels.telegram = {};
    if (!config.channels.telegram.accounts) config.channels.telegram.accounts = {};

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

    if (!config.channels.telegram.bindings) config.channels.telegram.bindings = [];
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

  // Ensure 30-min safety-net cron exists for this user
  await ensureUserCron(userId);
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
  if (config.channels?.telegram?.accounts?.[userId]) {
    delete config.channels.telegram.accounts[userId];
  }

  await writeConfig(config);

  // Remove the heartbeat cron
  await removeUserCron(userId);

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

  config.channels.telegram.accounts[userId] = {
    botToken,
    dmPolicy: "allowlist",
    allowFrom: [telegramChatId],
  };

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
