import { promises as fs } from "fs";
import path from "path";
import { resolveConfiguredPath } from "./paths.js";
import { WhatsAppConnectionSchema, type WhatsAppConnection } from "../schemas/channels.js";
import { listBindingsForUser, unbindChannel } from "./channelBindingStore.js";

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");

export interface ChannelStatus {
  connected: boolean;
  target: string | null;
}

export interface UserChannelConnectivity {
  telegram: ChannelStatus;
  whatsapp: ChannelStatus;
  web: ChannelStatus;
}

function profilePath(userId: string): string {
  return path.join(USERS_DIR, userId, "profile.json");
}

async function readProfileRecord(userId: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(profilePath(userId), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getProfileTelegramTarget(profile: Record<string, unknown>): string | null {
  const directChatId = profile.telegramChatId;
  if (typeof directChatId === "string" && directChatId.trim().length > 0) return directChatId;

  const connections = profile.channelConnections;
  if (typeof connections !== "object" || connections === null) return null;
  const telegram = (connections as { telegram?: unknown }).telegram;
  if (typeof telegram !== "object" || telegram === null) return null;
  const chatId = (telegram as { chatId?: unknown }).chatId;
  return typeof chatId === "string" && chatId.trim().length > 0 ? chatId : null;
}

async function writeProfileRecord(userId: string, profile: Record<string, unknown>): Promise<void> {
  await fs.writeFile(profilePath(userId), JSON.stringify(profile, null, 2), "utf-8");
}

export async function getStoredWhatsAppConnection(userId: string): Promise<WhatsAppConnection | null> {
  const profile = await readProfileRecord(userId);
  const connection = (profile.channelConnections as { whatsapp?: unknown } | undefined)?.whatsapp;
  if (!connection) return null;

  try {
    return WhatsAppConnectionSchema.parse(connection);
  } catch {
    return null;
  }
}

export async function getUserChannelConnectivity(userId: string): Promise<UserChannelConnectivity> {
  const [bindings, whatsappConnection] = await Promise.all([
    listBindingsForUser(userId),
    getStoredWhatsAppConnection(userId),
  ]);

  const profile = await readProfileRecord(userId);
  const telegramBinding = bindings.find((b) => b.channel === "telegram");
  const profileTelegramTarget = getProfileTelegramTarget(profile);

  return {
    telegram: {
      connected: telegramBinding !== undefined || profileTelegramTarget !== null,
      target: telegramBinding?.channelIdentifier ?? profileTelegramTarget,
    },
    whatsapp: {
      connected: whatsappConnection !== null,
      target: whatsappConnection?.recipientPhone ?? null,
    },
    web: {
      connected: true,
      target: "in-app",
    },
  };
}

export async function connectUserTelegramChannel(
  userId: string,
  _botToken: string,
  telegramChatId: string
): Promise<void> {
  const profile = await readProfileRecord(userId);
  profile.telegramChatId = telegramChatId;
  await writeProfileRecord(userId, profile);
}

export async function disconnectUserTelegramChannel(userId: string): Promise<void> {
  const bindings = await listBindingsForUser(userId);
  const telegramBinding = bindings.find((b) => b.channel === "telegram");
  if (telegramBinding) {
    await unbindChannel("telegram", telegramBinding.channelIdentifier);
  }

  const profile = await readProfileRecord(userId);
  delete profile.telegramChatId;
  await writeProfileRecord(userId, profile);
}

export async function connectUserWhatsAppChannel(
  userId: string,
  connection: WhatsAppConnection
): Promise<void> {
  const profile = await readProfileRecord(userId);
  const currentConnections =
    typeof profile.channelConnections === "object" && profile.channelConnections !== null
      ? (profile.channelConnections as Record<string, unknown>)
      : {};

  profile.channelConnections = {
    ...currentConnections,
    whatsapp: connection,
  };

  await writeProfileRecord(userId, profile);
}

export async function disconnectUserWhatsAppChannel(userId: string): Promise<void> {
  const profile = await readProfileRecord(userId);
  const currentConnections =
    typeof profile.channelConnections === "object" && profile.channelConnections !== null
      ? ({ ...(profile.channelConnections as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  delete currentConnections.whatsapp;
  profile.channelConnections = currentConnections;
  await writeProfileRecord(userId, profile);
}
