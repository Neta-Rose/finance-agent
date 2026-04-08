import path from "path";
import fs from "fs/promises";
import { logger } from "./logger.js";

const USERS_DIR = process.env.USERS_DIR ?? path.join(process.cwd(), "../users");

export interface TelegramRoute {
  chatId: string;
  userId: string;
  displayName: string;
}

// Build routing table by scanning all user profile.json files
export async function buildRoutingTable(): Promise<Map<string, TelegramRoute>> {
  const table = new Map<string, TelegramRoute>();
  try {
    const entries = await fs.readdir(USERS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const profilePath = path.join(USERS_DIR, entry.name, "profile.json");
      try {
        const raw = await fs.readFile(profilePath, "utf-8");
        const profile = JSON.parse(raw);
        if (profile.telegramChatId) {
          table.set(profile.telegramChatId, {
            chatId: profile.telegramChatId,
            userId: entry.name,
            displayName: profile.displayName ?? entry.name,
          });
        }
      } catch {
        // Profile missing or invalid — skip silently
      }
    }
  } catch (err) {
    logger.error("Failed to build Telegram routing table", { err });
  }
  logger.info(`Telegram routing table: ${table.size} users`);
  return table;
}

// Route a Telegram message to the correct user's trigger directory
// Returns the userId if found, null if unknown chat ID
export async function routeTelegramMessage(
  chatId: string,
  action: string,
  ticker?: string
): Promise<string | null> {
  const table = await buildRoutingTable();
  const route = table.get(chatId);
  if (!route) {
    logger.warn(`Unknown Telegram chatId: ${chatId}`);
    return null;
  }

  // Write trigger file to user's triggers directory
  const triggersDir = path.join(USERS_DIR, route.userId, "data", "triggers");
  const jobId = `job_${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 15)}_tg${Math.random().toString(16).slice(2, 8)}`;
  const trigger = {
    id: jobId,
    action,
    ticker: ticker ?? null,
    status: "pending",
    triggered_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    source: "telegram",
  };

  await fs.mkdir(triggersDir, { recursive: true });
  await fs.writeFile(
    path.join(triggersDir, `${jobId}.json`),
    JSON.stringify(trigger, null, 2)
  );

  // Also write to jobs dir
  const jobsDir = path.join(USERS_DIR, route.userId, "data", "jobs");
  await fs.mkdir(jobsDir, { recursive: true });
  await fs.writeFile(
    path.join(jobsDir, `${jobId}.json`),
    JSON.stringify(trigger, null, 2)
  );

  logger.info(`Telegram message routed: chatId=${chatId} → userId=${route.userId}, action=${action}`);
  return route.userId;
}
