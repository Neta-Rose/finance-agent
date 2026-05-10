import { promises as fs } from "fs";
import path from "path";
import { NotificationPreferencesSchema, type NotificationPreferences } from "../schemas/notifications.js";
import { resolveConfiguredPath } from "./paths.js";
import { logger } from "./logger.js";
import { getStoredWhatsAppConnection, getUserChannelConnectivity } from "./channelService.js";
import {
  composeNotification,
  renderTelegramNotification,
  renderWebNotification,
  type ComposedNotification,
  type SemanticNotificationRequest,
} from "./notificationComposer.js";
import {
  insertNotification as dbInsertNotification,
  updateDelivery as dbUpdateDelivery,
} from "./notificationStore.js";
import { redactTelegramError, sendTelegramMessage } from "./telegramDelivery.js";

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

export interface NotificationPublishRequest extends SemanticNotificationRequest {
  userId: string;
}

function categoryEnabled(preferences: NotificationPreferences, category: NotificationEnvelope["category"]): boolean {
  if (category === "daily_brief") return preferences.categories.dailyBriefs;
  if (category === "report") return preferences.categories.reportRuns;
  return preferences.categories.marketNews;
}

function redactLogMessage(value: unknown, maxLength = 180): string {
  return redactTelegramError(value, maxLength)
    .replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
    .slice(0, maxLength);
}

function logNotificationEvent(
  level: "info" | "warn",
  fields: Record<string, string | number | boolean | null | string[]>
): void {
  logger[level](JSON.stringify({ event: "notification_publication", ...fields }));
}

function renderRecordContent(
  composed: ComposedNotification,
  channel: NotificationEnvelope["channel"]
): Pick<NotificationEnvelope, "category" | "title" | "body" | "ticker" | "batchId"> {
  if (channel === "telegram") {
    const telegram = renderTelegramNotification(composed);
    return {
      category: composed.category,
      title: composed.title,
      body: telegram.text,
      ticker: composed.ticker,
      batchId: composed.batchId,
    };
  }

  const web = renderWebNotification(composed);
  return {
    category: web.category,
    title: web.title,
    body: web.body,
    ticker: web.ticker,
    batchId: web.batchId,
  };
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

function readProfileTelegramTarget(value: unknown): { botToken: string; chatId: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const connections = (value as { channelConnections?: unknown }).channelConnections;
  if (typeof connections !== "object" || connections === null) return null;
  const telegram = (connections as { telegram?: unknown }).telegram;
  if (typeof telegram !== "object" || telegram === null) return null;
  const botToken = (telegram as { botToken?: unknown }).botToken;
  const chatId = (telegram as { chatId?: unknown }).chatId;
  if (typeof botToken !== "string" || botToken.trim().length === 0) return null;
  if (typeof chatId !== "string" || chatId.trim().length === 0) return null;
  return { botToken, chatId };
}

async function getTelegramTarget(userId: string): Promise<{ botToken: string; chatId: string } | null> {
  try {
    const raw = await fs.readFile(profilePath(userId), "utf-8");
    const profileTarget = readProfileTelegramTarget(JSON.parse(raw) as unknown);
    if (profileTarget) return profileTarget;
  } catch {}

  try {
    const { isApplicationDatabaseConfigured, getApplicationDataSource } = await import("../db/applicationDataSource.js");
    if (!isApplicationDatabaseConfigured()) return null;
    const ds = await getApplicationDataSource();
    const [bindingRows, secretRows] = await Promise.all([
      ds.query(
        `SELECT channel_identifier FROM channel_bindings
          WHERE user_id = $1 AND channel = 'telegram' AND unbound_at IS NULL
          LIMIT 1`,
        [userId]
      ) as Promise<Array<{ channel_identifier: string }>>,
      ds.query(
        `SELECT ciphertext FROM encrypted_secrets
          WHERE user_id = $1 AND secret_kind = 'telegram_bot_token'
          LIMIT 1`,
        [userId]
      ) as Promise<Array<{ ciphertext: Buffer }>>,
    ]);
    const chatId = bindingRows[0]?.channel_identifier;
    const botToken = secretRows[0]?.ciphertext?.toString("utf-8");
    if (!chatId || !botToken) return null;
    return { botToken, chatId };
  } catch {
    return null;
  }
}

async function deliverTelegram(record: NotificationEnvelope): Promise<{ delivered: boolean; error: string | null; attemptedChunks: number }> {
  const target = await getTelegramTarget(record.userId);
  if (!target) {
    return { delivered: false, error: "telegram target not configured", attemptedChunks: 0 };
  }

  const result = await sendTelegramMessage({
    botToken: target.botToken,
    chatId: target.chatId,
    text: record.body,
  });

  return {
    delivered: result.delivered,
    error: result.error,
    attemptedChunks: result.attemptedChunks,
  };
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
  const composed = composeNotification(request);
  const preferences = await getNotificationPreferences(request.userId);
  if (!categoryEnabled(preferences, composed.category)) {
    logNotificationEvent("info", {
      decision: "category_disabled",
      userId: request.userId,
      semanticKind: composed.kind,
      category: composed.category,
      batchId: composed.batchId,
      channels: [],
    });
    return [];
  }

  if (composed.batchId) {
    const existing = (await readOutbox(request.userId)).filter(
      (item) => item.category === composed.category && item.batchId === composed.batchId
    );
    if (existing.length > 0) {
      logNotificationEvent("info", {
        decision: "duplicate_batch",
        userId: request.userId,
        semanticKind: composed.kind,
        category: composed.category,
        batchId: composed.batchId,
        channels: existing.map((item) => item.channel),
      });
      return existing;
    }
  }

  const connectivity = await getUserChannelConnectivity(request.userId);
  const candidateChannels = buildCandidateChannels(preferences, connectivity);

  const createdAt = new Date().toISOString();
  const records = candidateChannels.map<NotificationEnvelope>((channel) => ({
    id: `ntf_${Date.now()}_${channel}_${Math.random().toString(16).slice(2, 8)}`,
    userId: request.userId,
    createdAt,
    delivered: channel === "web",
    deliveredAt: channel === "web" ? createdAt : null,
    readAt: null,
    error: channel === "web" ? null : "pending delivery",
    channel,
    ...renderRecordContent(composed, channel),
  }));

  const deliveryOutcomes: string[] = [];

  for (const record of records) {
    await appendOutboxRecord(record);

    // Phase 1 dual-write to Postgres. Failures are logged but do not block
    // the legacy JSON path which is still source of truth.
    try {
      await dbInsertNotification({
        id: record.id,
        userId: record.userId,
        category: record.category,
        channel: record.channel,
        title: record.title,
        body: record.body,
        ticker: record.ticker,
        batchId: record.batchId,
        delivered: record.delivered,
        deliveredAt: record.deliveredAt,
        readAt: record.readAt,
        error: record.error,
      });
    } catch (err) {
      const message = redactLogMessage(err);
      logNotificationEvent("warn", {
        decision: "dual_write_failed",
        userId: record.userId,
        notificationId: record.id,
        semanticKind: composed.kind,
        category: record.category,
        channel: record.channel,
        batchId: record.batchId,
        error: message,
      });
    }

    if (record.channel === "telegram") {
      const result = await deliverTelegram(record);
      const deliveredAtIso = result.delivered ? new Date().toISOString() : null;
      deliveryOutcomes.push(`telegram:${result.delivered ? "delivered" : "failed"}:${result.attemptedChunks}`);
      await updateOutboxRecord(record.userId, record.id, {
        delivered: result.delivered,
        deliveredAt: deliveredAtIso,
        error: result.error,
      });
      try {
        await dbUpdateDelivery(record.userId, record.id, {
          delivered: result.delivered,
          deliveredAt: deliveredAtIso,
          error: result.error,
        });
      } catch (err) {
        const message = redactLogMessage(err);
        logNotificationEvent("warn", {
          decision: "dual_write_delivery_failed",
          userId: record.userId,
          notificationId: record.id,
          semanticKind: composed.kind,
          category: record.category,
          channel: record.channel,
          batchId: record.batchId,
          error: message,
        });
      }
    }
    if (record.channel === "whatsapp") {
      const result = await deliverWhatsApp(record);
      const deliveredAtIso = result.delivered ? new Date().toISOString() : null;
      deliveryOutcomes.push(`whatsapp:${result.delivered ? "delivered" : "failed"}`);
      await updateOutboxRecord(record.userId, record.id, {
        delivered: result.delivered,
        deliveredAt: deliveredAtIso,
        error: result.error,
      });
      try {
        await dbUpdateDelivery(record.userId, record.id, {
          delivered: result.delivered,
          deliveredAt: deliveredAtIso,
          error: result.error,
        });
      } catch (err) {
        const message = redactLogMessage(err);
        logNotificationEvent("warn", {
          decision: "dual_write_delivery_failed",
          userId: record.userId,
          notificationId: record.id,
          semanticKind: composed.kind,
          category: record.category,
          channel: record.channel,
          batchId: record.batchId,
          error: message,
        });
      }
    }
  }

  logNotificationEvent("info", {
    decision: records.length > 0 ? "published" : "no_channels",
    userId: request.userId,
    semanticKind: composed.kind,
    category: composed.category,
    batchId: composed.batchId,
    channels: candidateChannels,
    deliveryOutcome: deliveryOutcomes.join(",") || (records.length > 0 ? "web:delivered" : "none"),
  });
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
