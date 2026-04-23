import { promises as fs } from "fs";
import path from "path";
import { NotificationPreferencesSchema, type NotificationPreferences } from "../schemas/notifications.js";
import { resolveConfiguredPath } from "./paths.js";
import { logger } from "./logger.js";
import { getStoredWhatsAppConnection, getUserChannelConnectivity } from "./channelService.js";

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
const MAX_OUTBOX_ITEMS = 250;
const WHATSAPP_GRAPH_VERSION = process.env["WHATSAPP_GRAPH_VERSION"] ?? "v17.0";

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = NotificationPreferencesSchema.parse({
  primaryChannel: "telegram",
  enabledChannels: {
    telegram: true,
    web: true,
    whatsapp: false,
  },
  categories: {
    dailyBriefs: true,
    reportRuns: true,
    marketNews: true,
  },
});

function profilePath(userId: string): string {
  return path.join(USERS_DIR, userId, "profile.json");
}

function outboxPath(userId: string): string {
  return path.join(USERS_DIR, userId, "feed", "notifications.json");
}

export async function getNotificationPreferences(
  userId: string
): Promise<NotificationPreferences> {
  const connectivity = await getUserChannelConnectivity(userId);
  try {
    const raw = await fs.readFile(profilePath(userId), "utf-8");
    const parsed = JSON.parse(raw) as { notifications?: unknown };
    const result = NotificationPreferencesSchema.safeParse(parsed.notifications);
    const base = result.success ? result.data : DEFAULT_NOTIFICATION_PREFERENCES;
    return {
      ...base,
      primaryChannel:
        base.primaryChannel === "telegram" && !connectivity.telegram.connected
          ? "web"
          : base.primaryChannel === "whatsapp" && !connectivity.whatsapp.connected
            ? "web"
            : base.primaryChannel,
      enabledChannels: {
        ...base.enabledChannels,
        telegram: base.enabledChannels.telegram && connectivity.telegram.connected,
        whatsapp: base.enabledChannels.whatsapp && connectivity.whatsapp.connected,
      },
    };
  } catch {
    return {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enabledChannels: {
        ...DEFAULT_NOTIFICATION_PREFERENCES.enabledChannels,
        telegram: connectivity.telegram.connected,
        whatsapp: false,
      },
      primaryChannel: connectivity.telegram.connected ? "telegram" : "web",
    };
  }
}

export async function setNotificationPreferences(
  userId: string,
  preferences: NotificationPreferences
): Promise<NotificationPreferences> {
  const validated = NotificationPreferencesSchema.parse(preferences);
  const connectivity = await getUserChannelConnectivity(userId);
  const nextPrimaryChannel =
    validated.primaryChannel === "telegram" && !connectivity.telegram.connected
      ? "web"
      : validated.primaryChannel === "whatsapp" && !connectivity.whatsapp.connected
        ? "web"
        : validated.primaryChannel;
  const normalized = {
    ...validated,
    primaryChannel: nextPrimaryChannel,
    enabledChannels: {
      ...validated.enabledChannels,
      telegram: validated.enabledChannels.telegram && connectivity.telegram.connected,
      whatsapp: validated.enabledChannels.whatsapp && connectivity.whatsapp.connected,
    },
  } satisfies NotificationPreferences;

  const target = profilePath(userId);
  let profile: Record<string, unknown> = {};
  try {
    profile = JSON.parse(await fs.readFile(target, "utf-8")) as Record<string, unknown>;
  } catch {}

  profile["notifications"] = normalized;
  await fs.writeFile(target, JSON.stringify(profile, null, 2), "utf-8");
  return normalized;
}

export interface NotificationEnvelope {
  id: string;
  userId: string;
  category: "daily_brief" | "report" | "market_news";
  title: string;
  body: string;
  ticker: string | null;
  batchId: string | null;
  channel: "telegram" | "web" | "whatsapp";
  createdAt: string;
  delivered: boolean;
  deliveredAt: string | null;
  readAt: string | null;
  error: string | null;
}

export interface NotificationPublishRequest {
  userId: string;
  category: "daily_brief" | "report" | "market_news";
  title: string;
  body: string;
  ticker: string | null;
  batchId: string | null;
}

function categoryEnabled(preferences: NotificationPreferences, category: NotificationPublishRequest["category"]): boolean {
  if (category === "daily_brief") return preferences.categories.dailyBriefs;
  if (category === "report") return preferences.categories.reportRuns;
  return preferences.categories.marketNews;
}

async function readOutbox(userId: string): Promise<NotificationEnvelope[]> {
  try {
    const raw = await fs.readFile(outboxPath(userId), "utf-8");
    return JSON.parse(raw) as NotificationEnvelope[];
  } catch {
    return [];
  }
}

async function writeOutbox(userId: string, items: NotificationEnvelope[]): Promise<void> {
  const filePath = outboxPath(userId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(items.slice(0, MAX_OUTBOX_ITEMS), null, 2), "utf-8");
}

async function appendOutboxRecord(record: NotificationEnvelope): Promise<void> {
  const current = await readOutbox(record.userId);
  await writeOutbox(record.userId, [record, ...current]);
}

async function updateOutboxRecord(
  userId: string,
  notificationId: string,
  update: Partial<Pick<NotificationEnvelope, "delivered" | "deliveredAt" | "readAt" | "error">>
): Promise<void> {
  const current = await readOutbox(userId);
  const next = current.map((item) => (item.id === notificationId ? { ...item, ...update } : item));
  await writeOutbox(userId, next);
}

async function getTelegramTarget(userId: string): Promise<{ botToken: string; chatId: string } | null> {
  try {
    const { readConfig } = await import("./agentService.js");
    const config = await readConfig();
    const account = config.channels?.telegram?.accounts?.[userId] as
      | { botToken?: string; allowFrom?: string[] }
      | undefined;
    const botToken = account?.botToken;
    const chatId = account?.allowFrom?.[0];
    if (!botToken || !chatId) return null;
    return { botToken, chatId };
  } catch {
    return null;
  }
}

async function deliverTelegram(record: NotificationEnvelope): Promise<{ delivered: boolean; error: string | null }> {
  const target = await getTelegramTarget(record.userId);
  if (!target) {
    return { delivered: false, error: "telegram target not configured" };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${target.botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: target.chatId,
        text: `*${record.title}*\n${record.body}`,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { delivered: false, error: `telegram send failed: ${body.slice(0, 140)}` };
    }

    return { delivered: true, error: null };
  } catch (err) {
    return {
      delivered: false,
      error: err instanceof Error ? err.message.slice(0, 140) : "telegram send failed",
    };
  }
}

async function deliverWhatsApp(record: NotificationEnvelope): Promise<{ delivered: boolean; error: string | null }> {
  const target = await getStoredWhatsAppConnection(record.userId);
  if (!target) {
    return { delivered: false, error: "whatsapp target not configured" };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${target.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${target.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: target.recipientPhone,
          type: "text",
          text: {
            preview_url: false,
            body: `${record.title}\n${record.body}`.slice(0, 4096),
          },
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      return { delivered: false, error: `whatsapp send failed: ${body.slice(0, 140)}` };
    }

    return { delivered: true, error: null };
  } catch (err) {
    return {
      delivered: false,
      error: err instanceof Error ? err.message.slice(0, 140) : "whatsapp send failed",
    };
  }
}

function buildCandidateChannels(
  preferences: NotificationPreferences,
  connectivity: Awaited<ReturnType<typeof getUserChannelConnectivity>>
): Array<NotificationEnvelope["channel"]> {
  const connectedChannels: Array<NotificationEnvelope["channel"]> = [];

  if (preferences.enabledChannels.web && connectivity.web.connected) connectedChannels.push("web");
  if (preferences.enabledChannels.telegram && connectivity.telegram.connected) connectedChannels.push("telegram");
  if (preferences.enabledChannels.whatsapp && connectivity.whatsapp.connected) connectedChannels.push("whatsapp");

  if (preferences.primaryChannel === "none") return connectedChannels;

  if (connectedChannels.includes(preferences.primaryChannel as NotificationEnvelope["channel"])) {
    connectedChannels.sort((left, right) => {
      if (left === preferences.primaryChannel) return -1;
      if (right === preferences.primaryChannel) return 1;
      return 0;
    });
  }

  return connectedChannels;
}

export async function publishNotification(
  request: NotificationPublishRequest
): Promise<NotificationEnvelope[]> {
  const preferences = await getNotificationPreferences(request.userId);
  if (!categoryEnabled(preferences, request.category)) return [];

  const connectivity = await getUserChannelConnectivity(request.userId);
  const candidateChannels = buildCandidateChannels(preferences, connectivity);

  const createdAt = new Date().toISOString();
  const records = candidateChannels.map<NotificationEnvelope>((channel) => ({
    id: `ntf_${Date.now()}_${channel}_${Math.random().toString(16).slice(2, 8)}`,
    createdAt,
    delivered: channel === "web",
    deliveredAt: channel === "web" ? createdAt : null,
    readAt: null,
    error: channel === "web" ? null : "pending delivery",
    channel,
    ...request,
  }));

  for (const record of records) {
    await appendOutboxRecord(record);
    if (record.channel === "telegram") {
      const result = await deliverTelegram(record);
      await updateOutboxRecord(record.userId, record.id, {
        delivered: result.delivered,
        deliveredAt: result.delivered ? new Date().toISOString() : null,
        error: result.error,
      });
    }
    if (record.channel === "whatsapp") {
      const result = await deliverWhatsApp(record);
      await updateOutboxRecord(record.userId, record.id, {
        delivered: result.delivered,
        deliveredAt: result.delivered ? new Date().toISOString() : null,
        error: result.error,
      });
    }
  }

  logger.info(
    `Published notification: user=${request.userId} category=${request.category} channels=${candidateChannels.join(",") || "none"}`
  );
  return records;
}

export async function listNotifications(
  userId: string,
  options?: { limit?: number; channel?: NotificationEnvelope["channel"] | null; unreadOnly?: boolean }
): Promise<NotificationEnvelope[]> {
  const items = await readOutbox(userId);
  const filtered = items.filter((item) => {
    if (options?.channel && item.channel !== options.channel) return false;
    if (options?.unreadOnly && item.readAt !== null) return false;
    return true;
  });
  return filtered.slice(0, options?.limit ?? 50);
}

export async function markNotificationsRead(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const current = await readOutbox(userId);
  const idSet = new Set(ids);
  let updated = 0;
  const now = new Date().toISOString();
  const next = current.map((item) => {
    if (!idSet.has(item.id) || item.readAt !== null) return item;
    updated += 1;
    return { ...item, readAt: now };
  });
  await writeOutbox(userId, next);
  return updated;
}

export { DEFAULT_NOTIFICATION_PREFERENCES };
