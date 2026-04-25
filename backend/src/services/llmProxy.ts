// backend/src/services/llmProxy.ts
// Pure functions: no config reads/writes. agentService.ts imports from here, not the other way.

import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { resolveConfiguredPath } from "./paths.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const PROXY_BASE_URL =
  process.env["LLM_PROXY_URL"] ?? "http://localhost:8081/llm/v1";

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// ── Proxy key generation ──────────────────────────────────────────────────────

export function generateProxyKey(userId: string): string {
  const secret = process.env["JWT_SECRET"] ?? "changeme";
  const hmac = crypto.createHmac("sha256", secret).update(userId).digest("hex");
  return `clawd-sk-${userId}-${hmac.slice(0, 32)}`;
}

// ── In-memory key map: proxyApiKey → userId ───────────────────────────────────

const keyMap = new Map<string, string>();

export function registerKey(proxyKey: string, userId: string): void {
  keyMap.set(proxyKey, userId);
}

export function unregisterKey(proxyKey: string): void {
  keyMap.delete(proxyKey);
}

export function resolveUserId(proxyKey: string): string | null {
  const mapped = keyMap.get(proxyKey);
  if (mapped) return mapped;

  const match = /^clawd-sk-([a-zA-Z0-9-]+)-([a-f0-9]{32})$/.exec(proxyKey);
  if (!match) return null;

  const userId = match[1];
  if (!userId) return null;
  return generateProxyKey(userId) === proxyKey ? userId : null;
}

export function buildKeyMap(
  agents: Array<Record<string, unknown>>
): void {
  keyMap.clear();
  for (const agent of agents) {
    const id = agent["id"] as string | undefined;
    if (id) keyMap.set(generateProxyKey(id), id);
  }
}

// ── Model string transformation ───────────────────────────────────────────────

export function toProxyModel(userId: string, model: string): string {
  if (model.startsWith("openrouter/")) {
    return `clawd-${userId}/${model.slice("openrouter/".length)}`;
  }
  return model;
}

export function toUpstreamModel(model: string): string {
  const match = /^clawd-[^/]+\/(.+)$/.exec(model);
  return match?.[1] ?? model;
}

// ── Analyst fingerprinting ────────────────────────────────────────────────────

interface ProxyMessage {
  role?: string;
  content?: unknown;
}

const ANALYST_PATTERNS: Array<[RegExp, string]> = [
  [/fundamentals analyst/i, "fundamentals"],
  [/technical analyst/i,    "technical"],
  [/sentiment analyst/i,    "sentiment"],
  [/macro analyst/i,        "macro"],
  [/portfolio risk/i,       "risk"],
  [/bull researcher/i,      "bull"],
  [/bear researcher/i,      "bear"],
];

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const text = (item as Record<string, unknown>)["text"];
      return typeof text === "string" ? text : "";
    })
    .join("\n");
}

function matchAnalyst(text: string): string | null {
  for (const [pattern, analyst] of ANALYST_PATTERNS) {
    if (pattern.test(text)) return analyst;
  }
  return null;
}

function latestUserText(messages: ProxyMessage[]): string {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  return contentToText(latestUserMessage?.content);
}

function isStructuredConversationDirectChat(messages: ProxyMessage[]): boolean {
  const text = latestUserText(messages);
  if (!text) return false;

  return (
    text.includes("Conversation info (untrusted metadata):") &&
    text.includes("Sender (untrusted metadata):")
  );
}

export function fingerprintAnalyst(messages: ProxyMessage[]): string {
  const latestSystemText = [...messages]
    .reverse()
    .find((message) => message.role === "system");

  const candidates = [
    latestUserText(messages),
    contentToText(latestSystemText?.content),
    messages.map((message) => contentToText(message.content)).join("\n"),
  ];

  for (const text of candidates) {
    const analyst = matchAnalyst(text);
    if (analyst) return analyst;
  }

  return "orchestrator";
}

// ── Active job correlation ────────────────────────────────────────────────────

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");

export interface ActiveJob {
  id: string;
  action: string;
  ticker: string | null;
  source: string | null;
}

export interface ProxyMetadata {
  purpose: string;
  ticker: string | null;
  jobId: string | null;
  sourceClass: "backend_job" | "telegram_command" | "dashboard_action" | "direct_chat" | "unknown_agent_session";
  analyst: string;
  attributionSource: string;
}

export async function getActiveJob(userId: string): Promise<ActiveJob | null> {
  const jobsDir = path.join(USERS_DIR, userId, "data", "jobs");
  try {
    const files = await fs.readdir(jobsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(jobsDir, file), "utf-8");
        const job = JSON.parse(raw) as {
          id?: string;
          status?: string;
          action?: string;
          ticker?: string;
          source?: string | null;
        };
        if (job.status === "running") {
          return {
            id: job.id ?? file.replace(/\.json$/, ""),
            action: job.action ?? "unknown",
            ticker: job.ticker ?? null,
            source: job.source ?? null,
          };
        }
      } catch { /* skip malformed files */ }
    }
  } catch { /* no jobs dir yet */ }
  return null;
}

export async function hasPendingTriggerFiles(userId: string): Promise<boolean> {
  const triggersDir = path.join(USERS_DIR, userId, "data", "triggers");
  try {
    const files = await fs.readdir(triggersDir);
    return files.some((file) => file.endsWith(".json"));
  } catch {
    return false;
  }
}

export function resolveProxyMetadata(
  headers: Record<string, string | string[] | undefined>,
  inferredAnalyst: string,
  activeJob: ActiveJob | null,
  messages: ProxyMessage[] = []
): ProxyMetadata {
  const explicitPurpose = typeof headers["x-clawd-purpose"] === "string"
    ? headers["x-clawd-purpose"]
    : null;
  const explicitTicker = typeof headers["x-clawd-ticker"] === "string"
    ? headers["x-clawd-ticker"]
    : null;
  const explicitAnalyst = typeof headers["x-clawd-analyst"] === "string"
    ? headers["x-clawd-analyst"]
    : null;
  const explicitJobId = typeof headers["x-clawd-job-id"] === "string"
    ? headers["x-clawd-job-id"]
    : null;
  const explicitSource = typeof headers["x-clawd-source"] === "string"
    ? headers["x-clawd-source"]
    : null;

  const explicitDirectChat =
    explicitSource === "direct_chat" || explicitPurpose === "direct_chat";

  if (explicitPurpose) {
    return {
      purpose: explicitPurpose,
      ticker: explicitTicker ?? activeJob?.ticker ?? null,
      jobId: explicitJobId ?? null,
      sourceClass: explicitDirectChat
        ? "direct_chat"
        : explicitSource === "telegram_command"
        ? "telegram_command"
        : explicitSource === "dashboard_action"
        ? "dashboard_action"
        : "backend_job",
      analyst: explicitAnalyst ?? inferredAnalyst,
      attributionSource: "explicit_header",
    };
  }

  if (activeJob) {
    const sourceClass =
      activeJob.source === "telegram_command"
        ? "telegram_command"
        : activeJob.source === "dashboard_action"
        ? "dashboard_action"
        : "backend_job";
    return {
      purpose: activeJob.action,
      ticker: explicitTicker ?? activeJob.ticker ?? null,
      jobId: explicitJobId ?? activeJob.id ?? null,
      sourceClass,
      analyst: explicitAnalyst ?? inferredAnalyst,
      attributionSource: "active_job",
    };
  }

  if (isStructuredConversationDirectChat(messages)) {
    return {
      purpose: "direct_chat",
      ticker: explicitTicker ?? null,
      jobId: explicitJobId ?? null,
      sourceClass: "direct_chat",
      analyst: explicitAnalyst ?? inferredAnalyst,
      attributionSource: "conversation_metadata",
    };
  }

  return {
    purpose: "direct_chat",
    ticker: explicitTicker ?? null,
    jobId: explicitJobId ?? null,
    sourceClass: explicitDirectChat ? "direct_chat" : "unknown_agent_session",
    analyst: explicitAnalyst ?? inferredAnalyst,
    attributionSource: explicitDirectChat ? "explicit_header" : "inferred_direct_chat",
  };
}

export function shouldAllowProxyRequest(
  userId: string,
  metadata: ProxyMetadata,
  hasPendingTriggers = false
): boolean {
  if (userId === "main") return true;
  if (metadata.sourceClass === "unknown_agent_session") {
    return hasPendingTriggers;
  }
  return true;
}
