import { promises as fs } from "fs";
import path from "path";
import { resolveConfiguredPath } from "./paths.js";
import type { SupportMessageCreate, SupportMessageRecord } from "../schemas/support.js";

const DATA_DIR = resolveConfiguredPath(process.env["DATA_DIR"], "../data");
const SUPPORT_MESSAGES_PATH = path.join(DATA_DIR, "support-messages.json");
const MAX_SUPPORT_MESSAGES = 500;

async function readSupportMessages(): Promise<SupportMessageRecord[]> {
  try {
    const raw = await fs.readFile(SUPPORT_MESSAGES_PATH, "utf-8");
    return JSON.parse(raw) as SupportMessageRecord[];
  } catch {
    return [];
  }
}

async function writeSupportMessages(items: SupportMessageRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(SUPPORT_MESSAGES_PATH), { recursive: true });
  await fs.writeFile(SUPPORT_MESSAGES_PATH, JSON.stringify(items.slice(0, MAX_SUPPORT_MESSAGES), null, 2), "utf-8");
}

export async function submitSupportMessage(
  userId: string,
  input: SupportMessageCreate
): Promise<SupportMessageRecord> {
  const record: SupportMessageRecord = {
    id: `support_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    userId,
    subject: input.subject,
    message: input.message,
    source: input.source,
    page: input.page,
    createdAt: new Date().toISOString(),
    status: "open",
  };

  const current = await readSupportMessages();
  await writeSupportMessages([record, ...current]);
  return record;
}

export async function listSupportMessages(limit = 100): Promise<SupportMessageRecord[]> {
  const current = await readSupportMessages();
  return current.slice(0, limit);
}
