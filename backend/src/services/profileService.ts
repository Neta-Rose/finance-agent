import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger.js";
import {
  ProfileDefinitionSchema,
  ProfilesRegistrySchema,
} from "../schemas/profile.js";
import type { ProfileDefinition, ProfilesRegistry } from "../schemas/profile.js";

const DATA_DIR = process.env["DATA_DIR"] ?? "../data";
const USERS_DIR = process.env["USERS_DIR"] ?? "../users";

function registryPath(): string {
  return path.resolve(path.join(process.cwd(), DATA_DIR, "model-profiles.json"));
}

function userConfigPath(userId: string): string {
  return path.resolve(
    path.join(process.cwd(), USERS_DIR, userId, "data", "config.json")
  );
}

// ── Registry I/O ─────────────────────────────────────────────────────────────

export async function listProfiles(): Promise<ProfilesRegistry> {
  try {
    const raw = await fs.readFile(registryPath(), "utf-8");
    const parsed = ProfilesRegistrySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn("model-profiles.json failed validation — returning raw");
      return JSON.parse(raw) as ProfilesRegistry;
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

export async function deleteProfile(name: string): Promise<void> {
  const registry = await listProfiles();
  if (!registry[name]) throw new Error(`Profile not found: ${name}`);

  // Ensure no user is currently on this profile
  let userIds: string[] = [];
  try {
    const entries = await fs.readdir(
      path.resolve(path.join(process.cwd(), USERS_DIR)),
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

export async function getUserProfile(userId: string): Promise<string> {
  try {
    const raw = await fs.readFile(userConfigPath(userId), "utf-8");
    const parsed = JSON.parse(raw) as { modelProfile?: string };
    return parsed.modelProfile ?? "testing";
  } catch {
    return "testing";
  }
}

export async function setUserProfile(
  userId: string,
  profileName: string
): Promise<void> {
  const profile = await getProfile(profileName);
  if (!profile) throw new Error(`Profile not found: ${profileName}`);

  // Write clean config — strips any legacy embedded profiles block
  const config = { modelProfile: profileName };
  await fs.writeFile(
    userConfigPath(userId),
    JSON.stringify(config, null, 2),
    "utf-8"
  );
  logger.info(`Set profile for ${userId}: ${profileName}`);
}
