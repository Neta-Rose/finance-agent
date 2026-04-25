import fs from "fs/promises";
import { readFileSync } from "fs";
import { execSync, exec as execAsync, execFile } from "child_process";
import { promisify } from "util";
import { logger } from "./logger.js";
import {
  generateProxyKey,
  registerKey,
  unregisterKey,
  toProxyModel,
  buildKeyMap,
  PROXY_BASE_URL,
} from "./llmProxy.js";

const OPENCLAW_CONFIG = "/root/.openclaw/openclaw.json";
const USERS_DIR = "/root/clawd/users";
const CLAWD_ROOT = "/root/clawd";
export const SYSTEM_AGENT_ID = "main";
const SYSTEM_AGENT_WORKSPACE = CLAWD_ROOT;
const SYSTEM_AGENT_DIR = `/root/.openclaw/agents/${SYSTEM_AGENT_ID}/agent`;
const SYSTEM_TELEGRAM_ACCOUNT_ID = "default";
const execFileAsync = promisify(execFile);

interface AgentEntry {
  id: string;
  workspace: string;
  agentDir: string;
}

interface TelegramAccount {
  botToken: string;
  dmPolicy: string;
  allowFrom: string[];
  name?: string;
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
  delivery?: { mode?: string; bestEffort?: boolean };
  payload?: { timeoutSeconds?: number };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: string;
    lastStatus?: string;
    consecutiveErrors?: number;
    lastError?: string;
    lastErrorReason?: string;
  };
}

interface OpenClawConfig {
  agents?: {
    list?: AgentEntry[];
    defaults?: Record<string, unknown>;
  };
  bindings?: TelegramBinding[];
  channels?: {
    telegram?: {
      botToken?: string;
      enabled?: boolean;
      dmPolicy?: string;
      allowFrom?: string[];
      defaultAccount?: string;
      [key: string]: unknown;
      accounts?: Record<string, TelegramAccount>;
      bindings?: TelegramBinding[];
    };
  };
  [key: string]: unknown;
}

function normalizeTelegramConfig(config: OpenClawConfig): boolean {
  const telegram = config.channels?.telegram;
  if (!telegram) return false;

  let dirty = false;
  const promotedAllowFrom = Array.isArray(telegram.allowFrom)
    ? telegram.allowFrom.filter((value): value is string => typeof value === "string")
    : [];

  if (telegram.botToken) {
    if (!telegram.accounts) telegram.accounts = {};
    const existingDefault = telegram.accounts["default"];
    telegram.accounts["default"] = {
      botToken: existingDefault?.botToken ?? telegram.botToken,
      dmPolicy: existingDefault?.dmPolicy ?? telegram.dmPolicy ?? "allowlist",
      allowFrom:
        existingDefault?.allowFrom && existingDefault.allowFrom.length > 0
          ? existingDefault.allowFrom
          : promotedAllowFrom,
      name: existingDefault?.name ?? "System bot",
    };
    delete telegram.botToken;
    dirty = true;
  } else if (telegram.accounts?.["default"]) {
    const existingDefault = telegram.accounts["default"];
    if (!existingDefault.dmPolicy) {
      existingDefault.dmPolicy = telegram.dmPolicy ?? "allowlist";
      dirty = true;
    }
    if (!existingDefault.allowFrom) {
      existingDefault.allowFrom = promotedAllowFrom;
      dirty = true;
    }
  }

  if (telegram.allowFrom) {
    delete telegram.allowFrom;
    dirty = true;
  }

  if (!config.bindings) config.bindings = [];
  if (Array.isArray(telegram.bindings) && telegram.bindings.length > 0) {
    for (const binding of telegram.bindings) {
      const normalizedBinding: TelegramBinding =
        binding.agentId === SYSTEM_AGENT_ID &&
        binding.match?.channel === "telegram" &&
        binding.match?.accountId === "main"
          ? {
              agentId: SYSTEM_AGENT_ID,
              match: { channel: "telegram", accountId: SYSTEM_TELEGRAM_ACCOUNT_ID },
            }
          : binding;
      const exists = config.bindings.some(
        (candidate) =>
          candidate.agentId === normalizedBinding.agentId &&
          candidate.match?.channel === normalizedBinding.match?.channel &&
          candidate.match?.accountId === normalizedBinding.match?.accountId
      );
      if (!exists) {
        config.bindings.push(normalizedBinding);
        dirty = true;
      }
    }
    delete telegram.bindings;
    dirty = true;
  }

  if (config.bindings.length > 0) {
    const nextBindings: TelegramBinding[] = [];
    for (const binding of config.bindings) {
      const normalizedBinding: TelegramBinding =
        binding.agentId === SYSTEM_AGENT_ID &&
        binding.match?.channel === "telegram" &&
        binding.match?.accountId === "main"
          ? {
              agentId: SYSTEM_AGENT_ID,
              match: { channel: "telegram", accountId: SYSTEM_TELEGRAM_ACCOUNT_ID },
            }
          : binding;

      const exists = nextBindings.some(
        (candidate) =>
          candidate.agentId === normalizedBinding.agentId &&
          candidate.match?.channel === normalizedBinding.match?.channel &&
          candidate.match?.accountId === normalizedBinding.match?.accountId
      );
      if (!exists) nextBindings.push(normalizedBinding);
    }

    if (nextBindings.length !== config.bindings.length) {
      config.bindings = nextBindings;
      dirty = true;
    }
  }

  if (telegram.accounts?.["default"] && telegram.defaultAccount !== "default") {
    telegram.defaultAccount = "default";
    dirty = true;
  }

  return dirty;
}

function ensureBindings(config: OpenClawConfig): TelegramBinding[] {
  if (!config.bindings) config.bindings = [];
  return config.bindings;
}

function upsertTelegramBinding(
  bindings: TelegramBinding[],
  binding: TelegramBinding
): boolean {
  const existingIndex = bindings.findIndex(
    (candidate) =>
      candidate.match?.channel === binding.match.channel &&
      candidate.match?.accountId === binding.match.accountId
  );

  if (existingIndex === -1) {
    bindings.push(binding);
    return true;
  }

  const existing = bindings[existingIndex];
  if (!existing) return false;
  if (existing.agentId !== binding.agentId) {
    bindings[existingIndex] = binding;
    return true;
  }

  return false;
}

function buildTriggerOnlyCronMessage(userId: string): string {
  const triggersPath = `${USERS_DIR}/${userId}/data/triggers`;
  return (
    `You have pending backend-owned work. Check ${triggersPath}/ for .json trigger files. ` +
    `For each trigger: read it, update jobs/[job_id].json status→running if needed, delete the trigger, ` +
    `and execute only the requested action. ` +
    `If execution hits points_budget_exhausted, budget exhaustion, or repeated provider/rate-limit failure before any report artifact is written, update the matching jobs/[job_id].json status→paused with a short error that includes points_budget_exhausted or rate_limit, then stop processing that trigger. ` +
    `Do not start scheduled portfolio tasks on your own. ` +
    `Do not run daily briefs, weekly reviews, or exploratory analysis unless a trigger explicitly asks for it. ` +
    `If no triggers are pending, reply exactly HEARTBEAT_OK and stop. ` +
    `Do not explain your reasoning in idle heartbeats. ` +
    `Your workspace is ${USERS_DIR}/${userId}.`
  );
}

function isUserWorkspace(workspace: string | undefined): boolean {
  return typeof workspace === "string" && workspace.startsWith(`${USERS_DIR}/`);
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
    const config = JSON.parse(stripJson5Comments(raw)) as OpenClawConfig;
    normalizeTelegramConfig(config);
    return config;
  } catch {
    return {};
  }
}

export async function writeConfig(config: OpenClawConfig): Promise<void> {
  normalizeTelegramConfig(config);
  await fs.writeFile(OPENCLAW_CONFIG, JSON.stringify(config, null, 2), "utf-8");
}

// ── Cron helpers ─────────────────────────────────────────────────────────────

function cronName(userId: string): string {
  return `${userId}-heartbeat`;
}

export async function hasRunnableTriggerFiles(
  userId: string,
  usersDir = USERS_DIR
): Promise<boolean> {
  const triggersDir = `${usersDir}/${userId}/data/triggers`;
  const jobsDir = `${usersDir}/${userId}/data/jobs`;

  let files: string[];
  try {
    files = await fs.readdir(triggersDir);
  } catch {
    return false;
  }

  for (const file of files) {
    if (!file.endsWith(".json")) continue;

    const jobPath = `${jobsDir}/${file}`;
    try {
      const raw = await fs.readFile(jobPath, "utf-8");
      const job = JSON.parse(raw) as { status?: string };
      if (job.status === "pending" || job.status === "running") {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
}

async function runOpenClaw(args: string[], timeout = 10_000): Promise<string> {
  const { stdout } = await execFileAsync("openclaw", args, {
    timeout,
    encoding: "utf-8",
    maxBuffer: 1024 * 1024,
  });
  return String(stdout);
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
  } catch (err) {
    try {
      const raw = readFileSync(CRON_JOBS_PATH, "utf-8");
      const parsed = JSON.parse(raw) as { jobs?: CronEntry[] };
      return parsed.jobs ?? [];
    } catch {
      logger.warn(`Could not list crons via CLI or file: ${String(err)}`);
      return [];
    }
  }
}

async function listCronsAsync(): Promise<CronEntry[]> {
  try {
    const raw = await runOpenClaw(["cron", "list", "--json"]);
    const parsed = JSON.parse(raw) as { jobs?: CronEntry[] } | CronEntry[];
    if (parsed && !Array.isArray(parsed) && "jobs" in parsed) {
      return parsed.jobs ?? [];
    }
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    try {
      const raw = readFileSync(CRON_JOBS_PATH, "utf-8");
      const parsed = JSON.parse(raw) as { jobs?: CronEntry[] };
      return parsed.jobs ?? [];
    } catch {
      logger.warn(`Could not list crons via CLI or file: ${String(err)}`);
      return [];
    }
  }
}

export async function ensureUserCron(
  userId: string,
  existingCrons?: CronEntry[]
): Promise<void> {
  const name = cronName(userId);
  const existing = existingCrons ?? (await listCronsAsync());
  if (existing.some((c) => c.name === name)) {
    logger.info(`Cron already exists for: ${userId}`);
    return;
  }
  const msg = buildTriggerOnlyCronMessage(userId);
  try {
    await runOpenClaw(
      [
        "cron",
        "add",
        "--agent",
        userId,
        "--every",
        "30m",
        "--thinking",
        "low",
        "--name",
        name,
        "--message",
        msg,
        "--session",
        "isolated",
        "--no-deliver",
        "--best-effort-deliver",
        "--timeout-seconds",
        "1800",
      ],
      15_000
    );
    logger.info(`Created heartbeat cron for: ${userId}`);
    if (await hasRunnableTriggerFiles(userId)) {
      logger.info(`Heartbeat cron ready for ${userId} with pending triggers, waking agent immediately`);
      wakeAgent(userId);
    }
  } catch (err) {
    logger.warn(`Failed to create cron for ${userId}: ${err}`);
  }
}

export async function ensureAllUserCrons(): Promise<void> {
  const config = await readConfig();
  const agents = (config.agents?.list ?? []).filter((agent) =>
    isUserWorkspace(agent.workspace)
  );
  const existingCrons = await listCronsAsync();
  for (const agent of agents) {
    await ensureUserCron(agent.id, existingCrons);
  }
  logger.info(`Ensured heartbeat crons for ${agents.length} agent(s)`);
}

export async function rebuildUserCron(userId: string): Promise<void> {
  await removeUserCron(userId);
  await ensureUserCron(userId);
}

export async function rebuildAllUserCrons(): Promise<void> {
  const config = await readConfig();
  const agents = (config.agents?.list ?? []).filter((agent) =>
    isUserWorkspace(agent.workspace)
  );
  for (const agent of agents) {
    await rebuildUserCron(agent.id);
  }
  logger.info(`Rebuilt heartbeat crons for ${agents.length} agent(s) with trigger-only semantics`);
}

export async function wakeAgentsWithPendingTriggers(): Promise<void> {
  const config = await readConfig();
  const agents = (config.agents?.list ?? []).filter((agent) =>
    isUserWorkspace(agent.workspace)
  );

  for (const agent of agents) {
    const triggersDir = `${USERS_DIR}/${agent.id}/data/triggers`;
    const jobsDir = `${USERS_DIR}/${agent.id}/data/jobs`;
    try {
      const files = await fs.readdir(triggersDir);
      let hasPendingTriggers = false;

      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        const triggerPath = `${triggersDir}/${file}`;
        const jobPath = `${jobsDir}/${file}`;

        try {
          const raw = await fs.readFile(jobPath, "utf-8");
          const job = JSON.parse(raw) as { status?: string };
          if (job.status === "pending" || job.status === "running") {
            hasPendingTriggers = true;
            continue;
          }

          await fs.unlink(triggerPath);
          logger.info(`Removed stale trigger for ${agent.id}: ${file}`);
        } catch {
          hasPendingTriggers = true;
        }
      }

      if (hasPendingTriggers) {
        logger.info(`Found pending triggers for ${agent.id}, waking agent`);
        wakeAgent(agent.id);
      }
    } catch {
      // ignore missing or unreadable trigger directories
    }
  }
}

export async function ensureSystemAgent(): Promise<boolean> {
  const config = await readConfig();
  if (!config.agents) config.agents = {};
  if (!config.agents.list) config.agents.list = [];

  let dirty = false;
  const existingIndex = config.agents.list.findIndex(
    (agent) => agent.id === SYSTEM_AGENT_ID
  );
  const existing = existingIndex >= 0 ? config.agents.list[existingIndex] : undefined;
  if (!existing) {
    config.agents.list.unshift({
      id: SYSTEM_AGENT_ID,
      workspace: SYSTEM_AGENT_WORKSPACE,
      agentDir: SYSTEM_AGENT_DIR,
    });
    dirty = true;
    logger.info("Added root system agent to openclaw config");
  } else {
    if (existing.workspace !== SYSTEM_AGENT_WORKSPACE) {
      existing.workspace = SYSTEM_AGENT_WORKSPACE;
      dirty = true;
    }
    if (existing.agentDir !== SYSTEM_AGENT_DIR) {
      existing.agentDir = SYSTEM_AGENT_DIR;
      dirty = true;
    }
    if (existingIndex > 0) {
      config.agents.list.splice(existingIndex, 1);
      config.agents.list.unshift(existing);
      dirty = true;
      logger.info("Moved root system agent to primary position");
    }
  }

  const telegram = config.channels?.telegram;
  const defaultTelegramAccount = telegram?.accounts?.[SYSTEM_TELEGRAM_ACCOUNT_ID];
  if (defaultTelegramAccount?.botToken) {
    const bindings = ensureBindings(config);
    const desiredBinding: TelegramBinding = {
      agentId: SYSTEM_AGENT_ID,
      match: { channel: "telegram", accountId: SYSTEM_TELEGRAM_ACCOUNT_ID },
    };
    if (upsertTelegramBinding(bindings, desiredBinding)) {
      dirty = true;
      logger.info("Bound primary Telegram bot to root system agent");
    }
  }

  if (dirty) {
    await writeConfig(config);
  }

  await ensureProxyProvider(SYSTEM_AGENT_ID);
  return dirty;
}

async function getCronId(userId: string): Promise<string | null> {
  const name = cronName(userId);
  const crons = await listCronsAsync();
  return crons.find((c) => c.name === name)?.id ?? null;
}

export async function removeUserCron(userId: string): Promise<void> {
  const id = await getCronId(userId);
  if (!id) {
    logger.info(`No cron to remove for: ${userId}`);
    return;
  }
  try {
    await runOpenClaw(["cron", "rm", id]);
    logger.info(`Removed heartbeat cron for: ${userId}`);
  } catch (err) {
    logger.warn(`Failed to remove cron for ${userId}: ${err}`);
  }
}

export async function reconcileUserHeartbeatCron(
  userId: string,
  enabled: boolean
): Promise<boolean> {
  const existingId = await getCronId(userId);

  if (enabled) {
    if (existingId) return false;
    await ensureUserCron(userId);
    return true;
  }

  if (!existingId) return false;
  await removeUserCron(userId);
  return true;
}

export function healAllCrons(): void {
  try {
    const crons = listCrons();
    let healed = 0;
    for (const cron of crons) {
      if (!cron.name?.endsWith("-heartbeat")) continue;
      const needsHeal =
        cron.delivery?.mode !== "none" ||
        !cron.delivery?.bestEffort ||
        (cron.payload?.timeoutSeconds ?? 0) < 1800;
      if (!needsHeal) continue;
      try {
        execSync(
          `openclaw cron edit "${cron.id}" --no-deliver --best-effort-deliver --timeout-seconds 1800`,
          { timeout: 10_000, stdio: "pipe" }
        );
        logger.info(`Healed heartbeat cron ${cron.id} (${cron.name})`);
        healed++;
      } catch (err) {
        logger.warn(`Failed to heal cron ${cron.id}: ${err}`);
      }
    }
    if (healed > 0) logger.info(`Healed ${healed} heartbeat cron(s) on startup`);
  } catch (err) {
    logger.warn(`healAllCrons failed: ${err}`);
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
    let crons: CronEntry[] = [];

    if (!listErr) {
      try {
        const parsed = JSON.parse(stdout) as { jobs?: CronEntry[] } | CronEntry[];
        crons =
          !Array.isArray(parsed) && "jobs" in parsed
            ? (parsed.jobs ?? [])
            : Array.isArray(parsed) ? parsed : [];
      } catch (parseErr) {
        logger.warn(`Could not parse cron list for ${userId}: ${String(parseErr)}`);
      }
    }

    if (crons.length === 0) {
      crons = listCrons();
    }

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

    const bindings = ensureBindings(config);
    const changed = upsertTelegramBinding(bindings, {
      agentId: userId,
      match: { channel: "telegram", accountId: userId },
    });
    if (changed) {
      logger.info(`Added Telegram binding for: ${userId}`);
    } else {
      logger.info(`Telegram binding already exists, skipping: ${userId}`);
    }
  }

  await writeConfig(config);

  // Create per-user proxy provider (idempotent — generates key only if missing)
  await ensureProxyProvider(userId);

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
  if (config.bindings) {
    config.bindings = config.bindings.filter((b) => b.agentId !== userId);
  }
  if (config.channels?.telegram?.accounts?.[userId]) {
    delete config.channels.telegram.accounts[userId];
  }

  await writeConfig(config);

  // Revoke proxy provider + in-memory key map entry
  await removeProxyProvider(userId);

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

  upsertTelegramBinding(ensureBindings(config), {
    agentId: userId,
    match: { channel: "telegram", accountId: userId },
  });

  await writeConfig(config);
  logger.info(`Updated Telegram for user: ${userId}`);
}

export async function disconnectUserTelegram(userId: string): Promise<void> {
  const config = await readConfig();
  let dirty = false;

  if (config.channels?.telegram?.accounts?.[userId]) {
    delete config.channels.telegram.accounts[userId];
    dirty = true;
  }

  if (config.bindings) {
    const nextBindings = config.bindings.filter(
      (binding) =>
        !(
          binding.match?.channel === "telegram" &&
          (binding.agentId === userId || binding.match?.accountId === userId)
        )
    );
    if (nextBindings.length !== config.bindings.length) {
      config.bindings = nextBindings;
      dirty = true;
    }
  }

  if (!dirty) return;

  await writeConfig(config);
  logger.info(`Disconnected Telegram for user: ${userId}`);
}

// ── Model enforcement ─────────────────────────────────────────────────────────

/**
 * Write per-agent model config into openclaw.json's agents.list entry.
 * Called every time a profile is assigned or changed for a user.
 * Does NOT restart the gateway — callers that need an immediate live effect
 * should call restartGateway() themselves.
 */
export async function applyProfileToAgent(
  userId: string,
  orchestratorModel: string,
  analystsModel: string
): Promise<boolean> {
  const config = await readConfig();
  if (!config.agents?.list) return false;

  const entry = config.agents.list.find((a) => a.id === userId);
  if (!entry) {
    logger.warn(`applyProfileToAgent: no agent entry found for ${userId}`);
    return false;
  }

  // Type-widen so we can add non-interface fields openclaw accepts per-schema
  const agentEntry = entry as unknown as Record<string, unknown>;
  const desiredPrimary = toProxyModel(userId, orchestratorModel);
  const currentModel =
    typeof agentEntry["model"] === "object" && agentEntry["model"] !== null
      ? (agentEntry["model"] as Record<string, unknown>)
      : {};
  const currentSubagents =
    typeof agentEntry["subagents"] === "object" && agentEntry["subagents"] !== null
      ? (agentEntry["subagents"] as Record<string, unknown>)
      : {};
  const currentSubModel =
    typeof currentSubagents["model"] === "object" && currentSubagents["model"] !== null
      ? (currentSubagents["model"] as Record<string, unknown>)
      : {};
  const desiredAnalystsPrimary = toProxyModel(userId, analystsModel);
  const alreadyApplied =
    currentModel["primary"] === desiredPrimary &&
    Array.isArray(currentModel["fallbacks"]) &&
    currentModel["fallbacks"].length === 0 &&
    currentSubModel["primary"] === desiredAnalystsPrimary &&
    Array.isArray(currentSubModel["fallbacks"]) &&
    currentSubModel["fallbacks"].length === 0;
  if (alreadyApplied) {
    return false;
  }

  // Route openrouter/* models through the per-user proxy; other providers go direct.
  agentEntry["model"] = { primary: desiredPrimary, fallbacks: [] };
  agentEntry["subagents"] = {
    ...currentSubagents,
    model: { primary: desiredAnalystsPrimary, fallbacks: [] },
  };

  await writeConfig(config);
  logger.info(
    `Applied model profile to agent ${userId}: orchestrator=${orchestratorModel} analysts=${analystsModel}`
  );
  return true;
}

// ── Proxy provider management ─────────────────────────────────────────────────

/**
 * Idempotent: creates models.providers.clawd-{userId} in openclaw.json with a
 * stable proxy API key.  Generates a new key only if one doesn't exist yet.
 * Mutates config in place and registers the key in the in-memory map.
 * Does NOT call writeConfig — caller owns the write.
 */
function applyProxyProviderToConfig(
  config: OpenClawConfig,
  userId: string
): string {
  const proxyKey = generateProxyKey(userId);

  // Ensure models.providers.clawd-{userId} exists
  if (!config["models"]) (config as Record<string, unknown>)["models"] = {};
  const models = (config as Record<string, unknown>)["models"] as Record<
    string,
    unknown
  >;
  if (!models["providers"]) models["providers"] = {};
  const providers = models["providers"] as Record<string, unknown>;
  providers[`clawd-${userId}`] = { api: "openai-completions", baseUrl: PROXY_BASE_URL, apiKey: proxyKey, models: [{ id: "*", name: "All models" }] };

  registerKey(proxyKey, userId);
  return proxyKey;
}

/**
 * Idempotent: ensures a proxy provider entry exists for userId in openclaw.json
 * and the in-memory key map. Safe to call on every agent creation or profile switch.
 */
export async function ensureProxyProvider(userId: string): Promise<string> {
  const config = await readConfig();
  const proxyKey = applyProxyProviderToConfig(config, userId);
  await writeConfig(config);
  logger.info(`Proxy provider ensured for ${userId}`);
  return proxyKey;
}

/**
 * Removes the proxy provider entry for userId and invalidates its key in the
 * in-memory map. Called when an agent is deleted.
 */
export async function removeProxyProvider(userId: string): Promise<void> {
  const config = await readConfig();

  // Revoke in-memory key
  unregisterKey(generateProxyKey(userId));

  // Remove provider entry from openclaw config
  const providers = (
    (config as Record<string, unknown>)["models"] as
      | Record<string, unknown>
      | undefined
  )?.["providers"] as Record<string, unknown> | undefined;
  if (providers) delete providers[`clawd-${userId}`];

  await writeConfig(config);
  logger.info(`Removed proxy provider for ${userId}`);
}

/**
 * Run once on server startup: ensures every existing agent has a proxy provider
 * entry and has its openrouter/* model strings transformed to route through the
 * proxy. Rebuilds the in-memory key map from the final config state.
 */
export async function ensureAllProxyProviders(): Promise<boolean> {
  const config = await readConfig();
  const agents = config.agents?.list ?? [];
  let dirty = false;

  for (const agent of agents) {
    const entry = agent as AgentEntry & Record<string, unknown>;

    // 1. Ensure proxy key + provider entry; strip legacy proxyApiKey from agent entry
    if ("proxyApiKey" in entry) {
      delete entry["proxyApiKey"];
      dirty = true;
    }

    // Check if provider entry needs to be (re)written
    const existingProviders = ((config as Record<string, unknown>)["models"] as Record<string, unknown> | undefined)?.["providers"] as Record<string, unknown> | undefined;
    const existingProvider = existingProviders?.[`clawd-${agent.id}`] as Record<string, unknown> | undefined;
    const existingModels = existingProvider?.["models"] as unknown[] | undefined;
    if (!existingProvider || !existingModels || typeof existingModels[0] !== "object" || existingProvider["api"] !== "openai-completions") {
      dirty = true;
    }

    applyProxyProviderToConfig(config, agent.id);

    // 2. Transform openrouter/* model strings to route through per-user proxy
    const modelObj = entry["model"] as Record<string, unknown> | undefined;
    if (
      typeof modelObj?.["primary"] === "string" &&
      (modelObj["primary"] as string).startsWith("openrouter/")
    ) {
      modelObj["primary"] = toProxyModel(agent.id, modelObj["primary"] as string);
      dirty = true;
    }
    // Explicitly forbid fallbacks — no bypass path allowed
    if (modelObj && (modelObj["fallbacks"] as unknown[] | undefined)?.length) {
      modelObj["fallbacks"] = [];
      dirty = true;
    }

    const subagents = entry["subagents"] as Record<string, unknown> | undefined;
    const subModelObj = subagents?.["model"] as
      | Record<string, unknown>
      | undefined;
    if (
      typeof subModelObj?.["primary"] === "string" &&
      (subModelObj["primary"] as string).startsWith("openrouter/")
    ) {
      subModelObj["primary"] = toProxyModel(
        agent.id,
        subModelObj["primary"] as string
      );
      dirty = true;
    }
    if (subModelObj && (subModelObj["fallbacks"] as unknown[] | undefined)?.length) {
      subModelObj["fallbacks"] = [];
      dirty = true;
    }
  }

  // Zero out global defaults fallbacks — agents with explicit models ignore defaults,
  // but removing fallbacks eliminates any possible bypass path entirely.
  const defaults = (config.agents as unknown as Record<string, unknown>)?.["defaults"] as
    | Record<string, unknown>
    | undefined;
  const defaultModel = defaults?.["model"] as Record<string, unknown> | undefined;
  if (defaultModel && (defaultModel["fallbacks"] as unknown[] | undefined)?.length) {
    defaultModel["fallbacks"] = [];
    dirty = true;
  }

  if (dirty) await writeConfig(config);

  // Rebuild in-memory key map from final config state
  buildKeyMap(agents as unknown as Array<Record<string, unknown>>);
  logger.info(
    `ensureAllProxyProviders: processed ${agents.length} agents, dirty=${dirty}`
  );
  return dirty;
}

export async function restartGateway(): Promise<void> {
  try {
    await runOpenClaw(["gateway", "restart"], 15_000);
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

export async function getSystemAgentStatus(): Promise<{
  configured: boolean;
  hasTelegram: boolean;
  telegramAccountId: string | undefined;
}> {
  try {
    const config = await readConfig();
    const agent = config.agents?.list?.find((entry) => entry.id === SYSTEM_AGENT_ID);
    const hasTelegram = !!config.channels?.telegram?.accounts?.[SYSTEM_TELEGRAM_ACCOUNT_ID]?.botToken &&
      !!config.bindings?.some(
        (binding) =>
          binding.agentId === SYSTEM_AGENT_ID &&
          binding.match?.channel === "telegram" &&
          binding.match?.accountId === SYSTEM_TELEGRAM_ACCOUNT_ID
      );
    return {
      configured: !!agent,
      hasTelegram,
      telegramAccountId: hasTelegram ? SYSTEM_TELEGRAM_ACCOUNT_ID : undefined,
    };
  } catch {
    return { configured: false, hasTelegram: false, telegramAccountId: undefined };
  }
}

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

const CRON_JOBS_PATH = "/root/.openclaw/cron/jobs.json";
// Heartbeat runs every 30 min → 10 consecutive errors ≈ 5h of failures before unhealthy
const HEALTH_ERROR_THRESHOLD = 10;

export async function getUserAgentHealth(userId: string): Promise<AgentHealth> {
  try {
    const raw = await fs.readFile(CRON_JOBS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as {
      jobs?: Array<{
        name?: string;
        agentId?: string;
        state?: {
          consecutiveErrors?: number;
          lastError?: string;
          lastErrorReason?: string;
          lastRunAtMs?: number;
        };
      }>;
    };
    const jobs = parsed.jobs ?? [];
    // Match by heartbeat name (preferred) — agentId fallback only for heartbeat jobs
    const cronJob = jobs.find(
      (j) => j.name === `${userId}-heartbeat` ||
        (j.agentId === userId && j.name?.endsWith("-heartbeat"))
    );
    if (!cronJob?.state) {
      return { healthy: true, consecutiveErrors: 0, lastError: null, lastErrorReason: null, lastRunAt: null };
    }
    const { consecutiveErrors = 0, lastError, lastErrorReason, lastRunAtMs } = cronJob.state;
    return {
      healthy: consecutiveErrors < HEALTH_ERROR_THRESHOLD,
      consecutiveErrors,
      lastError: lastError ?? null,
      lastErrorReason: lastErrorReason ?? null,
      lastRunAt: lastRunAtMs ? new Date(lastRunAtMs).toISOString() : null,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      logger.warn(`Failed to read cron jobs file: ${(err as Error).message}`);
    }
    return { healthy: true, consecutiveErrors: 0, lastError: null, lastErrorReason: null, lastRunAt: null };
  }
}
