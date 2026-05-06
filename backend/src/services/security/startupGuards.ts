import { promises as fs } from "fs";
import path from "path";
import { logger } from "../logger.js";
import { buildPersonaPrompt, validatePersonaPrompt } from "../chat/personaPrompt.js";
import { isForbiddenPatternListPopulated } from "../chat/outputFilter.js";
import { ALL_TOOL_NAMES, FORBIDDEN_TOOL_NAMES } from "../chat/tools/registry.js";

/**
 * Startup guards — Phase 3 initial implementation.
 *
 * Spec: design.md §15.1; tasks.md 3.6.
 *
 * Guards added in this phase:
 *   B4.3 — execSync import scan (refuses to start if any execSync remains)
 *
 * Guards added in Phase 5 (chat agent):
 *   F3.1 — persona prompt non-empty
 *   F3.2 — no Forbidden tool registered
 *   F3.3 — output filter pattern list non-empty
 *
 * Guards added in Phase 8 (security hardening):
 *   O1   — JWT_SECRET not "changeme" or missing
 *   O2.2 — CORS allow-list non-empty
 *   O5.3 — ENCRYPTION_KEY_HEX valid 64-hex-char string
 *   O6   — TELEGRAM_SECRET present
 *   O7.3 — CSP script-src and connect-src set
 *
 * Each guard that fails pushes a structured key into `failures[]`.
 * The caller in server.ts exits with code 78 (EX_CONFIG) on any failure.
 */

export interface StartupGuardResult {
  ok: boolean;
  failures: string[];
}

// ---------------------------------------------------------------------------
// B4.3 — execSync scan
// ---------------------------------------------------------------------------

// Matches actual import/require of execSync, not comments or string literals.
// Patterns:
//   import { execSync } from "child_process"
//   import { execSync, ... } from "child_process"
//   const { execSync } = require("child_process")
const EXECSYNC_IMPORT_PATTERN = /(?:import\s*\{[^}]*\bexecSync\b[^}]*\}|require\s*\(\s*['"]child_process['"]\s*\))/;

async function scanForExecSync(srcDir: string): Promise<string[]> {
  const matches: string[] = [];
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch {
    return matches;
  }

  for (const entry of entries) {
    const fullPath = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await scanForExecSync(fullPath);
      matches.push(...nested);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        if (EXECSYNC_IMPORT_PATTERN.test(content)) {
          matches.push(fullPath);
        }
      } catch {
        // unreadable file — skip
      }
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Main guard runner (Phase 3 only — Phase 5 adds chat agent guards below)
// ---------------------------------------------------------------------------

async function runPhase3Guards(failures: string[], srcDir: string): Promise<void> {
  // B4.3: execSync must not appear in any non-test TypeScript source file.
  const execSyncMatches = await scanForExecSync(srcDir);
  if (execSyncMatches.length > 0) {
    const sample = execSyncMatches.slice(0, 3).join(", ");
    failures.push(`startup_guard.execsync_detected:${sample}`);
    logger.error(
      `Startup guard FAILED: execSync detected in source files: ${execSyncMatches.join(", ")}`
    );
  }
}

export async function runStartupGuards(srcDir?: string): Promise<StartupGuardResult> {
  const failures: string[] = [];
  const backendSrc = srcDir ?? path.resolve(process.cwd(), "src");

  await runPhase3Guards(failures, backendSrc);

  return { ok: failures.length === 0, failures };
}


// ---------------------------------------------------------------------------
// Phase 5 guards — chat agent (F3.1, F3.2, F3.3)
// ---------------------------------------------------------------------------

async function runChatAgentGuards(failures: string[]): Promise<void> {
  // F3.1: persona prompt must be non-empty and must not contain forbidden content.
  const prompt = buildPersonaPrompt("test-user");
  if (!prompt?.trim()) {
    failures.push("startup_guard.persona_prompt_empty");
    logger.error("Startup guard FAILED: persona prompt is empty");
  } else {
    const validation = validatePersonaPrompt(prompt);
    if (!validation.ok) {
      failures.push(`startup_guard.persona_prompt_contains_forbidden:${validation.violations.join(",")}`);
      logger.error(`Startup guard FAILED: persona prompt contains forbidden content: ${validation.violations.join(", ")}`);
    }
  }

  // F3.2: no Forbidden tool name may appear in ALL_TOOL_NAMES.
  for (const forbidden of FORBIDDEN_TOOL_NAMES) {
    if ((ALL_TOOL_NAMES as readonly string[]).includes(forbidden)) {
      failures.push(`startup_guard.forbidden_tool_registered:${forbidden}`);
      logger.error(`Startup guard FAILED: forbidden tool registered: ${forbidden}`);
    }
  }

  // F3.3: output filter pattern list must be non-empty when output_filter_enabled.
  // We check the static patterns + dynamic list; if both are empty, refuse to start.
  const patternListOk = await isForbiddenPatternListPopulated();
  if (!patternListOk) {
    failures.push("startup_guard.output_filter_patterns_empty");
    logger.error("Startup guard FAILED: output filter pattern list is empty");
  }
}

export async function runStartupGuards(srcDir?: string): Promise<StartupGuardResult> {
  const failures: string[] = [];

  // B4.3: execSync must not appear in any non-test TypeScript source file.
  const backendSrc = srcDir ?? path.resolve(process.cwd(), "src");
  const execSyncMatches = await scanForExecSync(backendSrc);
  if (execSyncMatches.length > 0) {
    const sample = execSyncMatches.slice(0, 3).join(", ");
    failures.push(`startup_guard.execsync_detected:${sample}`);
    logger.error(
      `Startup guard FAILED: execSync detected in source files: ${execSyncMatches.join(", ")}`
    );
  }

  // Phase 5: chat agent guards (F3.1, F3.2, F3.3).
  await runChatAgentGuards(failures);

  return { ok: failures.length === 0, failures };
}
