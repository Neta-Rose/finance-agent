import { promises as fs } from "fs";
import path from "path";
import { resolveConfiguredPath } from "../paths.js";

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseExplicitFalse(value: unknown): boolean {
  if (value === false) return true;
  if (typeof value !== "string") return false;
  return ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

export function isStepQueueServiceEnabled(): boolean {
  return !parseExplicitFalse(process.env["USE_STEP_QUEUE"]);
}

async function readUserFlagFile(userId: string, filename: "profile.json" | "data/config.json"): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(USERS_DIR, userId, filename), "utf-8");
    const parsed = JSON.parse(raw) as {
      USE_STEP_QUEUE?: unknown;
      useStepQueue?: unknown;
      features?: { USE_STEP_QUEUE?: unknown; stepQueue?: unknown };
    };
    return (
      parseBoolean(parsed.USE_STEP_QUEUE) ||
      parseBoolean(parsed.useStepQueue) ||
      parseBoolean(parsed.features?.USE_STEP_QUEUE) ||
      parseBoolean(parsed.features?.stepQueue)
    );
  } catch {
    return false;
  }
}

export async function isStepQueueEnabledForUser(userId: string): Promise<boolean> {
  if (isStepQueueServiceEnabled()) return true;

  const [profileEnabled, configEnabled] = await Promise.all([
    readUserFlagFile(userId, "profile.json"),
    readUserFlagFile(userId, "data/config.json"),
  ]);
  return profileEnabled || configEnabled;
}
