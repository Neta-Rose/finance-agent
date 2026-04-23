import path from "path";
import fs from "fs/promises";
import { logger } from "./logger.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import { readConfig } from "./agentService.js";
import { triggerUserJob } from "./jobTriggerService.js";

const USERS_DIR = process.env.USERS_DIR ?? path.join(process.cwd(), "../users");
const FUTURE_FEATURE_ACTIONS = new Set(["new_ideas", "full_report"]);

export interface TelegramRoute {
  chatId: string;
  userId: string;
  displayName: string;
}

export async function resolveTelegramRoute(chatId: string): Promise<TelegramRoute | null> {
  const table = await buildRoutingTable();
  return table.get(chatId) ?? null;
}

// Build routing table by scanning all user profile.json files
export async function buildRoutingTable(): Promise<Map<string, TelegramRoute>> {
  const table = new Map<string, TelegramRoute>();
  try {
    const config = await readConfig();
    const bindings = config.bindings ?? [];
    const accounts = config.channels?.telegram?.accounts ?? {};
    for (const binding of bindings) {
      if (binding.match?.channel !== "telegram") continue;
      const userId = binding.agentId;
      if (!userId || userId === "main") continue;
      const accountId = binding.match.accountId;
      const account = accounts[accountId];
      const chatId = account?.allowFrom?.[0];
      if (!chatId) continue;
      table.set(chatId, {
        chatId,
        userId,
        displayName: userId,
      });
    }

    const entries = await fs.readdir(USERS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const profilePath = path.join(USERS_DIR, entry.name, "profile.json");
      try {
        const raw = await fs.readFile(profilePath, "utf-8");
        const profile = JSON.parse(raw);
        if (profile.telegramChatId && !table.has(profile.telegramChatId)) {
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

// Route a Telegram message through the same backend job flow used by the dashboard.
// Returns the userId if found, null if unknown chat ID.
export async function routeTelegramMessage(
  chatId: string,
  action: string,
  ticker?: string
): Promise<{ userId: string | null; statusCode: number; body: Record<string, unknown> | null }> {
  const route = await resolveTelegramRoute(chatId);
  if (!route) {
    logger.warn(`Unknown Telegram chatId: ${chatId}`);
    return { userId: null, statusCode: 404, body: null };
  }

  const ws = buildWorkspace(route.userId, USERS_DIR);

  if (FUTURE_FEATURE_ACTIONS.has(action)) {
    logger.info(`Telegram action blocked as future feature: userId=${route.userId} action=${action}`);
    return {
      userId: route.userId,
      statusCode: 409,
      body: {
        error: "feature_blocked",
      },
    };
  }
  const result = await triggerUserJob({
    workspace: ws,
    action: action as Parameters<typeof triggerUserJob>[0]["action"],
    ...(ticker ? { ticker } : {}),
    source: "telegram_command",
  });
  logger.info(
    `Telegram message routed: chatId=${chatId} → userId=${route.userId}, action=${action}, status=${result.statusCode}`
  );
  return { userId: route.userId, statusCode: result.statusCode, body: result.body };
}
