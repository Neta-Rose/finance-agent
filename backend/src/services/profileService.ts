import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger.js";
import {
  ProfileDefinitionSchema,
  ProfilesRegistrySchema,
} from "../schemas/profile.js";
import type { ProfileDefinition, ProfilesRegistry } from "../schemas/profile.js";
import {
  applyProfileToAgent,
  restartGateway,
  SYSTEM_AGENT_ID,
} from "./agentService.js";
import { resolveConfiguredPath } from "./paths.js";

const DATA_DIR = resolveConfiguredPath(process.env["DATA_DIR"], "../data");
const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");

function registryPath(): string {
  return path.join(DATA_DIR, "model-profiles.json");
}

function userConfigPath(userId: string): string {
  return path.join(USERS_DIR, userId, "data", "config.json");
}

function systemAgentConfigPath(): string {
  return path.join(DATA_DIR, "system-agent.json");
}

// ── Registry I/O ─────────────────────────────────────────────────────────────

export async function listProfiles(): Promise<ProfilesRegistry> {
  try {
    const raw = await fs.readFile(registryPath(), "utf-8");
    const data = JSON.parse(raw) as unknown;
    const parsed = ProfilesRegistrySchema.safeParse(data);
    if (!parsed.success) {
      logger.warn("model-profiles.json failed validation — returning raw");
      return data as ProfilesRegistry;
    }
    return parsed.data;
  } catch {
    logger.warn("model-profiles.json not found — returning empty registry");
    return {};
  }
}

export async function getProfile(
  name: string
): Promise<ProfileDefinition | null> {
  const registry = await listProfiles();
  return registry[name] ?? null;
}

export async function createProfile(
  name: string,
  def: ProfileDefinition
): Promise<void> {
  const validName = /^[a-z0-9-]{2,32}$/.test(name);
  if (!validName)
    throw new Error(
      "Profile name must be 2-32 lowercase alphanumeric or hyphens"
    );

  ProfileDefinitionSchema.parse(def); // throws ZodError if invalid

  const registry = await listProfiles();
  if (registry[name]) throw new Error(`Profile already exists: ${name}`);

  registry[name] = def;
  await fs.writeFile(registryPath(), JSON.stringify(registry, null, 2), "utf-8");
  logger.info(`Created profile: ${name}`);
}

export async function updateProfile(
  name: string,
  def: ProfileDefinition
): Promise<void> {
  ProfileDefinitionSchema.parse(def);

  const registry = await listProfiles();
  if (!registry[name]) throw new Error(`Profile not found: ${name}`);

  registry[name] = def;
  await fs.writeFile(registryPath(), JSON.stringify(registry, null, 2), "utf-8");
  logger.info(`Updated profile: ${name}`);
}

// Profiles that cannot be deleted — system fallback depends on "testing" existing
const RESERVED_PROFILES = ["testing", "production"];

export async function deleteProfile(name: string): Promise<void> {
  if (RESERVED_PROFILES.includes(name)) {
    throw new Error(`Cannot delete reserved profile: ${name}`);
  }
  const registry = await listProfiles();
  if (!registry[name]) throw new Error(`Profile not found: ${name}`);

  // Ensure no user is currently on this profile
  let userIds: string[] = [];
  try {
    const entries = await fs.readdir(
      USERS_DIR,
      { withFileTypes: true }
    );
    userIds = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    /* ignore if users dir missing */
  }

  const usersOnProfile: string[] = [];
  for (const userId of userIds) {
    const active = await getUserProfile(userId);
    if (active === name) usersOnProfile.push(userId);
  }
  if ((await getSystemAgentProfile()) === name) {
    usersOnProfile.push(SYSTEM_AGENT_ID);
  }
  if (usersOnProfile.length > 0) {
    throw new Error(
      `Cannot delete profile "${name}" — ${usersOnProfile.length} user(s) still on it: ${usersOnProfile.join(", ")}`
    );
  }

  delete registry[name];
  await fs.writeFile(registryPath(), JSON.stringify(registry, null, 2), "utf-8");
  logger.info(`Deleted profile: ${name}`);
}

// ── Per-user config ───────────────────────────────────────────────────────────

export interface UserProfileStatus {
  name: string;
  broken: boolean;
  reason?: string;
}

/**
 * Returns the raw profile name stored in config.json.
 * Does NOT validate against the registry — callers that need that should use
 * getUserProfileStatus().
 */
export async function getUserProfile(userId: string): Promise<string> {
  try {
    const raw = await fs.readFile(userConfigPath(userId), "utf-8");
    const parsed = JSON.parse(raw) as { modelProfile?: string };
    return parsed.modelProfile ?? "testing";
  } catch {
    return "testing";
  }
}

/**
 * Returns profile name plus a broken flag if the profile name does not exist
 * in the registry (deleted, renamed, or config.json corrupted).
 */
export async function getUserProfileStatus(userId: string): Promise<UserProfileStatus> {
  const name = await getUserProfile(userId);
  const registry = await listProfiles();
  if (!registry[name]) {
    return {
      name,
      broken: true,
      reason: `Profile "${name}" not found in registry — contact support`,
    };
  }
  return { name, broken: false };
}

export async function getSystemAgentProfile(): Promise<string> {
  try {
    const raw = await fs.readFile(systemAgentConfigPath(), "utf-8");
    const parsed = JSON.parse(raw) as { modelProfile?: string };
    return parsed.modelProfile ?? "testing";
  } catch {
    return "testing";
  }
}

export async function getSystemAgentProfileStatus(): Promise<UserProfileStatus> {
  const name = await getSystemAgentProfile();
  const registry = await listProfiles();
  if (!registry[name]) {
    return {
      name,
      broken: true,
      reason: `Profile "${name}" not found in registry — contact support`,
    };
  }
  return { name, broken: false };
}

export async function setUserProfile(
  userId: string,
  profileName: string
): Promise<void> {
  const profile = await getProfile(profileName);
  if (!profile) throw new Error(`Profile not found: ${profileName}`);

  // Write clean config
  const config = { modelProfile: profileName };
  await fs.writeFile(
    userConfigPath(userId),
    JSON.stringify(config, null, 2),
    "utf-8"
  );

  // Enforce: write the model into the agent's openclaw entry, then restart gateway
  await applyProfileToAgent(userId, profile.orchestrator, profile.analysts);
  await restartGateway();

  logger.info(`Set profile for ${userId}: ${profileName}`);
}

export async function setSystemAgentProfile(profileName: string): Promise<void> {
  const profile = await getProfile(profileName);
  if (!profile) throw new Error(`Profile not found: ${profileName}`);

  const config = { modelProfile: profileName };
  await fs.writeFile(
    systemAgentConfigPath(),
    JSON.stringify(config, null, 2),
    "utf-8"
  );

  await applyProfileToAgent(
    SYSTEM_AGENT_ID,
    profile.orchestrator,
    profile.analysts
  );
  await restartGateway();

  logger.info(`Set profile for ${SYSTEM_AGENT_ID}: ${profileName}`);
}

export async function syncAllUserProfiles(): Promise<void> {
  let entries: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    entries = (await fs.readdir(USERS_DIR, {
      withFileTypes: true,
      encoding: "utf8",
    })) as Array<{ name: string; isDirectory(): boolean }>;
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const userId = entry.name;
    const status = await getUserProfileStatus(userId);
    if (status.broken) {
      logger.warn(
        `Skipping profile sync for ${userId}: ${status.reason ?? "profile missing"}`
      );
      continue;
    }

    const profile = await getProfile(status.name);
    if (!profile) continue;

    await applyProfileToAgent(userId, profile.orchestrator, profile.analysts);
  }

  logger.info("Reconciled model profiles for all users");
}

export async function syncSystemAgentProfile(): Promise<void> {
  const status = await getSystemAgentProfileStatus();
  if (status.broken) {
    logger.warn(
      `Skipping profile sync for ${SYSTEM_AGENT_ID}: ${status.reason ?? "profile missing"}`
    );
    return;
  }

  const profile = await getProfile(status.name);
  if (!profile) return;

  await applyProfileToAgent(
    SYSTEM_AGENT_ID,
    profile.orchestrator,
    profile.analysts
  );
  logger.info("Reconciled model profile for root system agent");
}
