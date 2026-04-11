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

export function fingerprintAnalyst(messages: ProxyMessage[]): string {
  const latestUserText = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const latestSystemText = [...messages]
    .reverse()
    .find((message) => message.role === "system");

  const candidates = [
    contentToText(latestUserText?.content),
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
  action: string;
  ticker: string | null;
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
          status?: string;
          action?: string;
          ticker?: string;
        };
        if (job.status === "running") {
          return { action: job.action ?? "unknown", ticker: job.ticker ?? null };
        }
      } catch { /* skip malformed files */ }
    }
  } catch { /* no jobs dir yet */ }
  return null;
}

// ── Model cost table (USD per 1M tokens) ─────────────────────────────────────

const MODEL_COSTS: Record<string, { in: number; out: number }> = {
  "deepseek/deepseek-v3":                    { in: 0.27,  out: 1.10  },
  "deepseek/deepseek-r1":                    { in: 0.55,  out: 2.19  },
  "deepseek/deepseek-chat":                  { in: 0.14,  out: 0.28  },
  "google/gemini-2.5-flash-lite":            { in: 0.10,  out: 0.40  },
  "google/gemini-2.5-flash":                { in: 0.25,  out: 1.00  },
  "google/gemini-flash-1.5":                { in: 0.075, out: 0.30  },
  "meta-llama/llama-3.3-70b-instruct:free": { in: 0,     out: 0     },
  "google/gemma-3-27b-it:free":             { in: 0,     out: 0     },
  "qwen/qwen3.6-plus":                      { in: 0.50,  out: 1.50  },
  "minimax/minimax-01":                      { in: 0.20,  out: 1.10  },
  "anthropic/claude-opus-4":                { in: 15,    out: 75    },
  "anthropic/claude-sonnet-4":             { in: 3,     out: 15    },
};

export function estimateCost(
  model: string,
  tokensIn: number,
  tokensOut: number
): number {
  // MODEL_COSTS keys are bare "vendor/model" without provider prefix.
  // Try direct lookup first (handles correctly-stripped keys from OpenClaw routing).
  // Fall back to stripping a leading "openrouter/" prefix (defensive, in case some
  // path sends the full model string).
  const key = MODEL_COSTS[model]
    ? model
    : model.startsWith("openrouter/")
    ? model.slice("openrouter/".length)
    : model;
  const p = MODEL_COSTS[key];
  if (!p) return 0;
  return (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out;
}
