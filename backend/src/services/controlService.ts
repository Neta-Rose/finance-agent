// backend/src/services/controlService.ts
import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger.js";
import { resolveConfiguredPath } from "./paths.js";
import {
  UserControlSchema,
  SystemControlSchema,
  type UserControl,
  type SystemControl,
} from "../schemas/control.js";

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
const DATA_DIR  = resolveConfiguredPath(process.env["DATA_DIR"], "../data");

function userControlPath(userId: string): string {
  return path.join(USERS_DIR, userId, "control.json");
}

function systemControlPath(): string {
  return path.join(DATA_DIR, "system-control.json");
}

// ── User control ──────────────────────────────────────────────────────────────

/**
 * Read a user's control state. Auto-expires restriction if restrictedUntil is past.
 * Returns a zero-state object (no restriction) if the file doesn't exist yet.
 */
export async function getUserControl(userId: string): Promise<UserControl> {
  try {
    const raw    = await fs.readFile(userControlPath(userId), "utf-8");
    const parsed = UserControlSchema.parse(JSON.parse(raw));

    // Auto-expire: if restrictedUntil is set and in the past, clear restriction
    if (parsed.restriction && parsed.restrictedUntil) {
      if (new Date(parsed.restrictedUntil) < new Date()) {
        const cleared: UserControl = { ...parsed, restriction: null, restrictedAt: null, restrictedUntil: null };
        await setUserControl(userId, cleared);
        return cleared;
      }
    }

    return parsed;
  } catch {
    return UserControlSchema.parse({});
  }
}

export async function setUserControl(userId: string, control: Partial<UserControl>): Promise<void> {
  const current = await getUserControl(userId);
  const merged  = UserControlSchema.parse({ ...current, ...control });
  await fs.writeFile(userControlPath(userId), JSON.stringify(merged, null, 2), "utf-8");
  logger.info(`Set control for ${userId}: restriction=${merged.restriction ?? "none"}`);
}

export async function clearUserControl(userId: string): Promise<void> {
  await setUserControl(userId, {
    restriction: null, reason: "", restrictedAt: null, restrictedUntil: null, banner: null,
  });
}

// ── System control ────────────────────────────────────────────────────────────

/**
 * Read system-wide control state. Auto-expires lock if lockedUntil is past.
 */
export async function getSystemControl(): Promise<SystemControl> {
  try {
    const raw    = await fs.readFile(systemControlPath(), "utf-8");
    const parsed = SystemControlSchema.parse(JSON.parse(raw));

    if (parsed.locked && parsed.lockedUntil) {
      if (new Date(parsed.lockedUntil) < new Date()) {
        const unlocked: SystemControl = { ...parsed, locked: false, lockedAt: null, lockedUntil: null };
        await setSystemControl(unlocked);
        return unlocked;
      }
    }
    return parsed;
  } catch {
    return SystemControlSchema.parse({});
  }
}

export async function setSystemControl(control: Partial<SystemControl>): Promise<void> {
  const current = await getSystemControl();
  const merged  = SystemControlSchema.parse({ ...current, ...control });
  await fs.mkdir(path.dirname(systemControlPath()), { recursive: true });
  await fs.writeFile(systemControlPath(), JSON.stringify(merged, null, 2), "utf-8");
  logger.info(`System control updated: locked=${merged.locked}`);
}

// ── Token version (for force-logout) ─────────────────────────────────────────

function authPath(userId: string): string {
  return path.join(USERS_DIR, userId, "auth.json");
}

export async function getTokenVersion(userId: string): Promise<number> {
  try {
    const raw  = await fs.readFile(authPath(userId), "utf-8");
    const data = JSON.parse(raw) as { tokenVersion?: number };
    return data.tokenVersion ?? 0;
  } catch {
    return 0;
  }
}

export async function incrementTokenVersion(userId: string): Promise<void> {
  try {
    const raw  = await fs.readFile(authPath(userId), "utf-8");
    const data = JSON.parse(raw) as { passwordHash: string; tokenVersion?: number };
    data.tokenVersion = (data.tokenVersion ?? 0) + 1;
    await fs.writeFile(authPath(userId), JSON.stringify(data, null, 2), "utf-8");
    logger.info(`Incremented tokenVersion for ${userId}: now ${data.tokenVersion}`);
  } catch (err) {
    throw new Error(`Could not increment tokenVersion for ${userId}: ${String(err)}`);
  }
}
