import { promises as fs } from "fs";
import { logger } from "./logger.js";
import { validateAgentOutput } from "../schemas/index.js";
import { StrategySchema } from "../schemas/strategy.js";
import type { AnalystType } from "../types/index.js";

export interface ValidationResult {
  valid: boolean;
  data?: unknown;
  errors?: string[];
  warnings?: string[];
  filePath: string;
  validatedAt: string;
}

export async function validateReportFile(
  filePath: string,
  analyst: AnalystType
): Promise<ValidationResult> {
  const validatedAt = new Date().toISOString();
  let parsed: unknown;

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr: unknown) {
      const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
      logger.warn(`Invalid JSON in ${filePath}: ${message}`);
      return {
        valid: false,
        errors: [`Invalid JSON: ${message}`],
        filePath,
        validatedAt,
      };
    }
  } catch (readErr: unknown) {
    const code = (readErr as { code?: string }).code;
    if (code === "ENOENT") {
      logger.warn(`File not found: ${filePath}`);
      return {
        valid: false,
        errors: [`File not found: ${filePath}`],
        filePath,
        validatedAt,
      };
    }
    throw readErr;
  }

  const result = validateAgentOutput(analyst, parsed);

  if (result.success) {
    logger.info(
      `validateReportFile: VALID | analyst=${analyst} | path=${filePath} | errors=0`
    );
    return {
      valid: true,
      data: result.data,
      filePath,
      validatedAt,
    };
  }

  logger.warn(
    `validateReportFile: INVALID | analyst=${analyst} | path=${filePath} | errors=${result.errors.length}`
  );
  return {
    valid: false,
    errors: result.errors,
    filePath,
    validatedAt,
  };
}

export async function validateStrategyFile(
  filePath: string
): Promise<ValidationResult> {
  const validatedAt = new Date().toISOString();
  let parsed: unknown;

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr: unknown) {
      const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return {
        valid: false,
        errors: [`Invalid JSON: ${message}`],
        filePath,
        validatedAt,
      };
    }
  } catch (readErr: unknown) {
    const code = (readErr as { code?: string }).code;
    if (code === "ENOENT") {
      return {
        valid: false,
        errors: [`File not found: ${filePath}`],
        filePath,
        validatedAt,
      };
    }
    throw readErr;
  }

  const result = StrategySchema.safeParse(parsed);

  if (!result.success) {
    const errors = result.error.errors.map(
      (e) => `${e.path.join(".")}: ${e.message}`
    );
    logger.warn(`validateStrategyFile: INVALID | path=${filePath} | errors=${errors.length}`);
    return { valid: false, errors, filePath, validatedAt };
  }

  const warnings: string[] = [];
  if (
    result.data.verdict === "HOLD" &&
    Array.isArray(result.data.catalysts) &&
    result.data.catalysts.length > 0
  ) {
    const hasExpiring = result.data.catalysts.some((c) => c.expiresAt !== null);
    if (!hasExpiring) {
      warnings.push(
        "HOLD verdict with no expiring catalyst — daily check will flag this"
      );
    }
  }

  logger.info(
    `validateStrategyFile: VALID | path=${filePath} | errors=0 | warnings=${warnings.length}`
  );
  return { valid: true, data: result.data, warnings, filePath, validatedAt };
}

export async function validateJobFile(filePath: string): Promise<ValidationResult> {
  const validatedAt = new Date().toISOString();
  let parsed: unknown;

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr: unknown) {
      const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return {
        valid: false,
        errors: [`Invalid JSON: ${message}`],
        filePath,
        validatedAt,
      };
    }
  } catch (readErr: unknown) {
    const code = (readErr as { code?: string }).code;
    if (code === "ENOENT") {
      return {
        valid: false,
        errors: [`File not found: ${filePath}`],
        filePath,
        validatedAt,
      };
    }
    throw readErr;
  }

  const { JobSchema } = await import("../schemas/job.js");
  const result = JobSchema.safeParse(parsed);

  if (result.success) {
    return { valid: true, data: result.data, filePath, validatedAt };
  }

  const errors = result.error.errors.map(
    (e) => `${e.path.join(".")}: ${e.message}`
  );
  return { valid: false, errors, filePath, validatedAt };
}

export interface SanitizeResult {
  safe: boolean;
  sanitized: string;
  flaggedPatterns: string[];
}

const FILE_PATH = /[~\/](?:home|clawd|etc|usr|var|tmp)\//;
const DOTDOT = /\.\.\//;
const HOME_TILDE = /^~/;
const SHELL_CMD = /\b(?:ls|cat|rm|cd|bash|python3?|exec|sudo|chmod|grep|find|curl|wget)\b/gi;
const INJECTION = /ignore\s+(?:previous|all)\s+instructions|you\s+are\s+now|new\s+system\s+prompt|disregard|act\s+as\s+(?:a\s+)?(?:different|new)|forget\s+(?:all\s+)?(?:previous|your)/gi;
const SYSTEM_QUERY = /show\s+me\s+your\s+(?:instructions|prompt|files|system)|what\s+(?:files|is\s+your\s+prompt|are\s+your\s+instructions)/gi;

export function sanitizeUserInput(input: string): SanitizeResult {
  const flaggedPatterns: string[] = [];
  let sanitized = input;

  if (FILE_PATH.test(sanitized)) {
    flaggedPatterns.push("FILE_PATH");
    sanitized = sanitized.replace(FILE_PATH, "[REDACTED]");
  }
  if (DOTDOT.test(sanitized)) {
    if (!flaggedPatterns.includes("FILE_PATH")) {
      flaggedPatterns.push("FILE_PATH");
    }
    sanitized = sanitized.replace(DOTDOT, "[REDACTED]");
  }
  if (HOME_TILDE.test(sanitized)) {
    if (!flaggedPatterns.includes("FILE_PATH")) {
      flaggedPatterns.push("FILE_PATH");
    }
    sanitized = sanitized.replace(HOME_TILDE, "[REDACTED]");
  }

  const shellMatches = sanitized.match(SHELL_CMD);
  if (shellMatches) {
    flaggedPatterns.push("SHELL_CMD");
    sanitized = sanitized.replace(SHELL_CMD, "[REDACTED]");
  }

  const injMatches = sanitized.match(INJECTION);
  if (injMatches) {
    flaggedPatterns.push("INJECTION");
    sanitized = sanitized.replace(INJECTION, "[REDACTED]");
  }

  const sysMatches = sanitized.match(SYSTEM_QUERY);
  if (sysMatches) {
    flaggedPatterns.push("SYSTEM_QUERY");
    sanitized = sanitized.replace(SYSTEM_QUERY, "[REDACTED]");
  }

  return {
    safe: flaggedPatterns.length === 0,
    sanitized,
    flaggedPatterns,
  };
}

export function watchReportsDir(
  _userId: string,
  reportsPath: string
): import("fs").FSWatcher {
  const { watch } = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");

  const watcher = watch(
    reportsPath,
    { recursive: true },
    async (_eventType: string, filename: string | null) => {
      if (!filename || !filename.endsWith(".json")) return;
      if (filename.endsWith(".invalid")) return;

      const fullPath = path.join(reportsPath, filename);

      let analyst: AnalystType;
      if (filename.includes("fundamentals")) {
        analyst = "fundamentals";
      } else if (filename.includes("technical")) {
        analyst = "technical";
      } else if (filename.includes("sentiment")) {
        analyst = "sentiment";
      } else if (filename.includes("macro")) {
        analyst = "macro";
      } else if (filename.includes("risk")) {
        analyst = "risk";
      } else if (filename.includes("bull_case")) {
        analyst = "bull";
      } else if (filename.includes("bear_case")) {
        analyst = "bear";
      } else {
        return;
      }

      const result = await validateReportFile(fullPath, analyst);
      const invalidMarker = `${fullPath}.invalid`;

      if (!result.valid) {
        await fs.writeFile(
          invalidMarker,
          JSON.stringify({ errors: result.errors }, null, 2)
        );
      } else {
        try {
          await fs.unlink(invalidMarker);
        } catch {
          // ignore if doesn't exist
        }
      }
    }
  );

  return watcher;
}
