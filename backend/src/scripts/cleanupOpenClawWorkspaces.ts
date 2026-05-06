import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { resolveConfiguredPath } from "../services/paths.js";
import { listWorkspaceUserIds } from "../services/workspaceService.js";
import { recordArchive } from "../services/migrationArchiveStore.js";
import { isApplicationDatabaseConfigured, getApplicationDataSource } from "../db/applicationDataSource.js";
import { logger } from "../services/logger.js";

/**
 * cleanupOpenClawWorkspaces.ts — Phase 3, task 3.4.
 *
 * Spec: design.md §B2.2; tasks.md 3.4.
 *
 * Idempotent removal of per-user OpenClaw-managed files:
 *   SOUL.md, AGENTS.md, HEARTBEAT.md, RESET.md, data/triggers/, skills symlink
 *
 * Every removed file is archived to `migration_archive` before deletion.
 * Emits one summary `migration_archive` row per user.
 *
 * Usage:
 *   tsx cleanupOpenClawWorkspaces.ts (--user <id> | --all) [--commit]
 *
 * Dry-run by default. Pass --commit to actually delete.
 */

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
const LEGACY_BRIDGE_TRIGGERS = resolveConfiguredPath(undefined, "../data/triggers");

/** Files to remove from each user workspace root. */
const RETIRED_ROOT_FILES = ["SOUL.md", "AGENTS.md", "HEARTBEAT.md", "RESET.md", "IDENTITY.md", "TOOLS.md"];

/** Directories to remove from each user workspace root. */
const RETIRED_ROOT_DIRS = ["data/triggers"];

/** Symlinks to remove from each user workspace root. */
const RETIRED_SYMLINKS = ["skills"];

interface CleanupOptions {
  commit: boolean;
  userIds: string[] | null;
}

interface UserCleanupResult {
  userId: string;
  ok: boolean;
  removed: string[];
  errors: string[];
}

function parseArgs(argv: string[]): CleanupOptions {
  const commit = argv.includes("--commit");
  const userIdx = argv.indexOf("--user");
  if (userIdx >= 0) {
    const value = argv[userIdx + 1];
    if (!value) throw new Error("--user requires a value");
    return { commit, userIds: [value] };
  }
  if (argv.includes("--all")) return { commit, userIds: null };
  throw new Error("Usage: tsx cleanupOpenClawWorkspaces.ts (--user <id> | --all) [--commit]");
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function removeFileWithArchive(
  userId: string,
  filePath: string,
  commit: boolean
): Promise<boolean> {
  let stat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
  try {
    stat = await fs.lstat(filePath);
  } catch {
    return false; // does not exist
  }

  const isSymlink = stat.isSymbolicLink();
  const isDir = stat.isDirectory();

  // Archive content before removal (skip for symlinks and large dirs)
  if (commit && isApplicationDatabaseConfigured()) {
    let payload: unknown = { path: filePath, type: isSymlink ? "symlink" : isDir ? "directory" : "file" };
    if (!isSymlink && !isDir) {
      const content = await readFileOrNull(filePath);
      payload = { path: filePath, type: "file", content };
    }
    try {
      await recordArchive({
        userId,
        sourcePath: filePath,
        reason: "openclaw_workspace_file_removed",
        payload,
      });
    } catch (err) {
      logger.warn(`cleanup: archive write failed for ${filePath}: ${(err as Error).message}`);
    }
  }

  if (!commit) return true; // dry-run: report as would-remove

  try {
    if (isSymlink) {
      await fs.unlink(filePath);
    } else if (isDir) {
      await fs.rm(filePath, { recursive: true, force: true });
    } else {
      await fs.unlink(filePath);
    }
    return true;
  } catch (err) {
    logger.warn(`cleanup: failed to remove ${filePath}: ${(err as Error).message}`);
    return false;
  }
}

async function cleanupOneUser(userId: string, options: CleanupOptions): Promise<UserCleanupResult> {
  const wsRoot = path.join(USERS_DIR, userId);
  const removed: string[] = [];
  const errors: string[] = [];

  // Remove retired root files
  for (const file of RETIRED_ROOT_FILES) {
    const filePath = path.join(wsRoot, file);
    try {
      const didRemove = await removeFileWithArchive(userId, filePath, options.commit);
      if (didRemove) removed.push(filePath);
    } catch (err) {
      errors.push(`${file}: ${(err as Error).message}`);
    }
  }

  // Remove retired directories
  for (const dir of RETIRED_ROOT_DIRS) {
    const dirPath = path.join(wsRoot, dir);
    try {
      const didRemove = await removeFileWithArchive(userId, dirPath, options.commit);
      if (didRemove) removed.push(dirPath);
    } catch (err) {
      errors.push(`${dir}: ${(err as Error).message}`);
    }
  }

  // Remove retired symlinks
  for (const link of RETIRED_SYMLINKS) {
    const linkPath = path.join(wsRoot, link);
    try {
      const didRemove = await removeFileWithArchive(userId, linkPath, options.commit);
      if (didRemove) removed.push(linkPath);
    } catch (err) {
      errors.push(`${link}: ${(err as Error).message}`);
    }
  }

  // Summary archive row
  if (options.commit && isApplicationDatabaseConfigured() && removed.length > 0) {
    try {
      await recordArchive({
        userId,
        sourcePath: wsRoot,
        reason: "summary_audit",
        payload: { phase: 3, removed, errors },
      });
    } catch (err) {
      logger.warn(`cleanup: summary archive write failed for ${userId}: ${(err as Error).message}`);
    }
  }

  return { userId, ok: errors.length === 0, removed, errors };
}

async function cleanupLegacyBridgeDir(commit: boolean): Promise<boolean> {
  try {
    await fs.access(LEGACY_BRIDGE_TRIGGERS);
  } catch {
    return false; // does not exist
  }

  if (!commit) {
    logger.info(`cleanup: would remove legacy bridge directory ${LEGACY_BRIDGE_TRIGGERS}`);
    return true;
  }

  try {
    await fs.rm(LEGACY_BRIDGE_TRIGGERS, { recursive: true, force: true });
    logger.info(`cleanup: removed legacy bridge directory ${LEGACY_BRIDGE_TRIGGERS}`);
    return true;
  } catch (err) {
    logger.warn(`cleanup: failed to remove legacy bridge directory: ${(err as Error).message}`);
    return false;
  }
}

export async function cleanupAllWorkspaces(options: CleanupOptions): Promise<UserCleanupResult[]> {
  if (options.commit && isApplicationDatabaseConfigured()) {
    await getApplicationDataSource(); // ensure DDL applied
  }

  const userIds = options.userIds ?? (await listWorkspaceUserIds());
  const results: UserCleanupResult[] = [];

  for (const userId of userIds) {
    logger.info(`cleanup: processing user ${userId} (commit=${options.commit})`);
    const result = await cleanupOneUser(userId, options);
    results.push(result);
    if (!result.ok) {
      logger.warn(`cleanup: errors for ${userId}: ${result.errors.join("; ")}`);
    }
  }

  await cleanupLegacyBridgeDir(options.commit);
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv);
    const results = await cleanupAllWorkspaces(options);
    const summary = {
      commit: options.commit,
      users: results.length,
      withErrors: results.filter((r) => !r.ok).length,
      totalRemoved: results.reduce((sum, r) => sum + r.removed.length, 0),
      details: results,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (summary.withErrors > 0) process.exit(2);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
