# Observability & LLM Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-user LLM proxy that intercepts OpenClaw→OpenRouter calls, tags every request with user/purpose/analyst context, stores structured events in SQLite, and surfaces live agent activity in the admin panel.

**Architecture:** Each OpenClaw agent gets a `clawd-{userId}` model provider in `openclaw.json` pointing at our backend's `/llm/v1` route with a unique proxy API key. The proxy identifies the user from the key, fingerprints the analyst from the system prompt, correlates with the active job, injects OpenRouter metadata, forwards the request, and logs the event. An `IEventStore` interface decouples the SQLite implementation so the storage backend can be swapped in one line.

**Dependency rule:** `llmProxy.ts` is a pure-functions module — no imports from `agentService.ts`. All config I/O (read/write `openclaw.json`) stays in `agentService.ts`. One-way dependency: `agentService.ts` → `llmProxy.ts`.

**Tech Stack:** Node.js/Express (proxy router), `better-sqlite3` (embedded SQLite, no server needed), React + Tailwind v4 (admin panel additions). OpenClaw config schema supports `models.providers[name].baseUrl + apiKey` per provider.

---

## File Map

**New files:**
- `backend/src/services/eventStore.ts` — `IEventStore` interface, `LlmRequestEvent` type, `createEventStore()` factory, singleton `eventStore` export
- `backend/src/services/eventStoreSqlite.ts` — `SqliteEventStore` implements `IEventStore`
- `backend/src/services/llmProxy.ts` — **pure functions only, no config I/O**: key map (in-memory), `buildKeyMap(agents)`, `generateProxyKey`, `toProxyModel`, analyst fingerprinting, job correlation, cost table
- `backend/src/routes/llmProxy.ts` — Express router at `/llm/v1`, HTTP proxy forwarding + streaming passthrough

**Modified files:**
- `backend/src/services/agentService.ts` — add `ensureProxyProvider`, `removeProxyProvider`, `ensureAllProxyProviders` (all use existing readConfig/writeConfig). Update `addUserAgent` and `applyProfileToAgent` and `removeUserAgent`.
- `backend/src/app.ts` — mount `/llm/v1` router before SPA fallback
- `backend/src/server.ts` — call `ensureAllProxyProviders()` on startup (from agentService)
- `backend/src/routes/admin.ts` — 3 new GET observability routes
- `frontend/src/api/admin.ts` — add observability API functions + types
- `frontend/src/pages/Admin.tsx` — add `UserActivityBadge` component, wire into `UserCard`

---

## Task 1: Investigate per-user agent failures

**Files:** No changes — diagnostic only.

- [ ] **Step 1: Check test-user's state, model profile, and cron**

```bash
# Current state and model profile
cat /root/clawd/users/test-user/data/state.json
cat /root/clawd/users/test-user/data/config.json

# Cron registered? (test-user is likely on "free" llama profile — check)
openclaw cron list --json | python3 -c "
import sys, json
raw = json.load(sys.stdin)
jobs = raw.get('jobs', raw) if isinstance(raw, dict) else raw
for j in (jobs if isinstance(jobs, list) else []):
    if 'test-user' in str(j.get('name','')) or 'test-user' in str(j.get('agentId','')):
        print(json.dumps(j, indent=2))
"
```

- [ ] **Step 2: Check cron error state for test-user**

```bash
python3 -c "
import json
d = json.load(open('/root/.openclaw/cron/jobs.json'))
for j in d.get('jobs', []):
    if 'test-user' in str(j.get('name','')) or 'test-user' in str(j.get('agentId','')):
        print(json.dumps(j, indent=2))
" 2>/dev/null || echo "cron/jobs.json not found"
```

- [ ] **Step 3: Check recent jobs and triggers**

```bash
ls -lt /root/clawd/users/test-user/data/jobs/ 2>/dev/null | head -10 || echo "no jobs dir"
ls -la /root/clawd/users/test-user/data/triggers/ 2>/dev/null || echo "no triggers dir"

# Show most recent job
ls -t /root/clawd/users/test-user/data/jobs/*.json 2>/dev/null | head -1 \
  | xargs -r python3 -c "import sys,json; print(json.dumps(json.load(open(sys.argv[1])), indent=2))" 2>/dev/null \
  || echo "no jobs"
```

- [ ] **Step 4: Apply fix**

Most likely cause: test-user is on `"free"` profile (llama free model — unreliable/rate-limited). Fix:

```bash
ADMIN_KEY=$(cat /etc/environment 2>/dev/null | grep ADMIN_KEY | cut -d= -f2 \
  || systemctl show clawd-backend --property=Environment | grep -oP 'ADMIN_KEY=\K[^ ]+' \
  || echo "YOUR_ADMIN_KEY")

curl -s -X PATCH http://localhost:8081/api/admin/users/test-user/profile \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"profileName":"testing"}' | python3 -m json.tool
```

If cron is missing, restart the backend (deploys auto-register crons):
```bash
systemctl restart clawd-backend && sleep 5
openclaw cron list --json | python3 -c "import sys,json; d=json.load(sys.stdin); print([j['name'] for j in d.get('jobs', [])])"
```

- [ ] **Step 5: Trigger a test job and verify**

```bash
TOKEN=$(curl -s -X POST http://localhost:8081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test-user","password":"YOUR_TEST_USER_PASSWORD"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s -X POST http://localhost:8081/api/jobs/trigger \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"daily_brief"}' | python3 -m json.tool

# Check after 30-60 seconds:
sleep 30
curl -s http://localhost:8081/api/jobs \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -40
```

**Minimax note:** No minimax in current profiles. `testing` = deepseek-v3 (orchestrator) + gemini-2.5-flash-lite (analysts). `production` = Claude. `free` = llama/gemma free tier.

---

## Task 2: Install better-sqlite3

**Files:** `backend/package.json`

- [ ] **Step 1: Install package**

```bash
cd /root/clawd/backend
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

- [ ] **Step 2: Verify**

```bash
node -e "const D=require('better-sqlite3'); const db=new D(':memory:'); db.exec('CREATE TABLE t(x)'); console.log('OK')"
```

Expected: `OK`

---

## Task 3: Event store interface + factory

**Files:**
- Create: `backend/src/services/eventStore.ts`

- [ ] **Step 1: Write the interface file**

```typescript
// backend/src/services/eventStore.ts

export interface LlmRequestEvent {
  id?: number;
  userId: string;
  purpose: string | null;   // daily_brief | deep_dive | full_report | new_ideas | null
  ticker: string | null;
  analyst: string;          // fundamentals|technical|sentiment|macro|risk|bull|bear|orchestrator
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  status: "success" | "error" | "timeout";
  errorMessage: string | null;
  timestamp: string;        // ISO 8601
}

export interface UserDailySummary {
  userId: string;
  date: string;             // YYYY-MM-DD
  requestCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
}

export interface IEventStore {
  logRequest(event: LlmRequestEvent): Promise<void>;
  getRecentActivity(userId: string, limit: number): Promise<LlmRequestEvent[]>;
  getDailySummary(date: string): Promise<UserDailySummary[]>;
  getUserDailyHistory(userId: string, days: number): Promise<UserDailySummary[]>;
  close(): void;
}

// ── Factory ─────────────────────────────────────────────────────────────────
// To swap storage backend: change the import below + return a different class.
// Nothing else in the codebase changes.

import { SqliteEventStore } from "./eventStoreSqlite.js";

function createEventStore(): IEventStore {
  return new SqliteEventStore();
}

// Singleton imported by proxy router and admin routes
export const eventStore: IEventStore = createEventStore();
```

- [ ] **Step 2: Verify (ignore missing eventStoreSqlite error for now)**

```bash
cd /root/clawd/backend && npx tsc --noEmit 2>&1 | grep -v "eventStoreSqlite" | grep "error" | head -10
```

Expected: No errors except the missing eventStoreSqlite import (expected at this step).

---

## Task 4: SQLite event store implementation

**Files:**
- Create: `backend/src/services/eventStoreSqlite.ts`

- [ ] **Step 1: Write the SQLite implementation**

```typescript
// backend/src/services/eventStoreSqlite.ts
import Database from "better-sqlite3";
import path from "path";
import { logger } from "./logger.js";
import type { IEventStore, LlmRequestEvent, UserDailySummary } from "./eventStore.js";

const DATA_DIR = process.env["DATA_DIR"] ?? "../data";

export class SqliteEventStore implements IEventStore {
  private db: Database.Database;

  constructor() {
    const dbPath = path.resolve(DATA_DIR, "observability.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
    logger.info(`Event store initialized: ${dbPath}`);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_requests (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       TEXT    NOT NULL,
        purpose       TEXT,
        ticker        TEXT,
        analyst       TEXT    NOT NULL DEFAULT 'orchestrator',
        model         TEXT    NOT NULL,
        tokens_in     INTEGER NOT NULL DEFAULT 0,
        tokens_out    INTEGER NOT NULL DEFAULT 0,
        cost_usd      REAL    NOT NULL DEFAULT 0,
        latency_ms    INTEGER NOT NULL DEFAULT 0,
        status        TEXT    NOT NULL DEFAULT 'success',
        error_message TEXT,
        timestamp     TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_llm_user    ON llm_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_llm_time    ON llm_requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_llm_user_ts ON llm_requests(user_id, timestamp);
    `);
  }

  async logRequest(event: LlmRequestEvent): Promise<void> {
    this.db.prepare(`
      INSERT INTO llm_requests
        (user_id, purpose, ticker, analyst, model,
         tokens_in, tokens_out, cost_usd, latency_ms,
         status, error_message, timestamp)
      VALUES
        (@userId, @purpose, @ticker, @analyst, @model,
         @tokensIn, @tokensOut, @costUsd, @latencyMs,
         @status, @errorMessage, @timestamp)
    `).run({
      userId:       event.userId,
      purpose:      event.purpose,
      ticker:       event.ticker,
      analyst:      event.analyst,
      model:        event.model,
      tokensIn:     event.tokensIn,
      tokensOut:    event.tokensOut,
      costUsd:      event.costUsd,
      latencyMs:    event.latencyMs,
      status:       event.status,
      errorMessage: event.errorMessage,
      timestamp:    event.timestamp,
    });
  }

  async getRecentActivity(userId: string, limit: number): Promise<LlmRequestEvent[]> {
    const rows = this.db.prepare(`
      SELECT * FROM llm_requests
      WHERE user_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(userId, limit) as Record<string, unknown>[];
    return rows.map(SqliteEventStore.rowToEvent);
  }

  async getDailySummary(date: string): Promise<UserDailySummary[]> {
    return this.db.prepare(`
      SELECT
        user_id                AS userId,
        date(timestamp)        AS date,
        COUNT(*)               AS requestCount,
        SUM(tokens_in)         AS totalTokensIn,
        SUM(tokens_out)        AS totalTokensOut,
        ROUND(SUM(cost_usd),6) AS totalCostUsd
      FROM llm_requests
      WHERE date(timestamp) = ?
      GROUP BY user_id
    `).all(date) as UserDailySummary[];
  }

  async getUserDailyHistory(userId: string, days: number): Promise<UserDailySummary[]> {
    return this.db.prepare(`
      SELECT
        user_id                AS userId,
        date(timestamp)        AS date,
        COUNT(*)               AS requestCount,
        SUM(tokens_in)         AS totalTokensIn,
        SUM(tokens_out)        AS totalTokensOut,
        ROUND(SUM(cost_usd),6) AS totalCostUsd
      FROM llm_requests
      WHERE user_id = ?
        AND timestamp >= datetime('now', ?)
      GROUP BY date(timestamp)
      ORDER BY date DESC
    `).all(userId, `-${days} days`) as UserDailySummary[];
  }

  close(): void {
    this.db.close();
  }

  private static rowToEvent(row: Record<string, unknown>): LlmRequestEvent {
    return {
      id:           row["id"] as number,
      userId:       row["user_id"] as string,
      purpose:      row["purpose"] as string | null,
      ticker:       row["ticker"] as string | null,
      analyst:      row["analyst"] as string,
      model:        row["model"] as string,
      tokensIn:     row["tokens_in"] as number,
      tokensOut:    row["tokens_out"] as number,
      costUsd:      row["cost_usd"] as number,
      latencyMs:    row["latency_ms"] as number,
      status:       row["status"] as "success" | "error" | "timeout",
      errorMessage: row["error_message"] as string | null,
      timestamp:    row["timestamp"] as string,
    };
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd /root/clawd/backend && npx tsc --noEmit 2>&1 | grep "error" | head -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /root/clawd
git add backend/src/services/eventStore.ts backend/src/services/eventStoreSqlite.ts backend/package.json backend/package-lock.json
git commit -m "feat: IEventStore interface + SQLite implementation for LLM request logging"
```

---

## Task 5: LLM proxy service — pure functions, no config I/O

**Files:**
- Create: `backend/src/services/llmProxy.ts`

This file has **no imports from agentService.ts**. All config I/O lives in agentService.ts (Task 7).

- [ ] **Step 1: Write llmProxy.ts**

```typescript
// backend/src/services/llmProxy.ts
// Pure functions: no config reads/writes. agentService.ts imports from here, not the other way.

import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";

// ── Constants ─────────────────────────────────────────────────────────────────

export const PROXY_BASE_URL =
  process.env["LLM_PROXY_URL"] ?? "http://localhost:8081/llm/v1";

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// ── Proxy key generation ──────────────────────────────────────────────────────

export function generateProxyKey(userId: string): string {
  const secret = crypto.randomBytes(16).toString("hex");
  return `clawd-sk-${userId}-${secret}`;
}

// ── In-memory key map: proxyApiKey → userId ───────────────────────────────────
// Rebuilt on startup and after agent registration changes.

const keyMap = new Map<string, string>();

/** Register one key→userId pair. Called by agentService after generating a key. */
export function registerKey(proxyKey: string, userId: string): void {
  keyMap.set(proxyKey, userId);
}

/** Remove a key from the map. Called by agentService when deleting an agent. */
export function unregisterKey(proxyKey: string): void {
  keyMap.delete(proxyKey);
}

/** Resolve a proxy API key to a userId. Returns null if unknown. */
export function resolveUserId(proxyKey: string): string | null {
  return keyMap.get(proxyKey) ?? null;
}

/**
 * Rebuild the entire key map from a pre-parsed agent list.
 * Called by agentService.ensureAllProxyProviders after it reads openclaw.json.
 */
export function buildKeyMap(
  agents: Array<Record<string, unknown>>
): void {
  keyMap.clear();
  for (const agent of agents) {
    const id = agent["id"] as string | undefined;
    const proxyKey = agent["proxyApiKey"] as string | undefined;
    if (id && proxyKey) keyMap.set(proxyKey, id);
  }
}

// ── Model string transformation ───────────────────────────────────────────────
// "openrouter/deepseek/deepseek-v3" → "clawd-{userId}/deepseek/deepseek-v3"
// Non-openrouter models (claude-*, etc.) are left unchanged — they go directly
// to their provider and bypass our proxy.

export function toProxyModel(userId: string, model: string): string {
  if (model.startsWith("openrouter/")) {
    return `clawd-${userId}/${model.slice("openrouter/".length)}`;
  }
  return model;
}

// ── Analyst fingerprinting ────────────────────────────────────────────────────

const ANALYST_PATTERNS: Array<[RegExp, string]> = [
  [/fundamentals analyst/i, "fundamentals"],
  [/technical analyst/i,    "technical"],
  [/sentiment analyst/i,    "sentiment"],
  [/macro analyst/i,        "macro"],
  [/portfolio risk/i,       "risk"],
  [/bull researcher/i,      "bull"],
  [/bear researcher/i,      "bear"],
];

export function fingerprintAnalyst(systemPrompt: string): string {
  for (const [pattern, analyst] of ANALYST_PATTERNS) {
    if (pattern.test(systemPrompt)) return analyst;
  }
  return "orchestrator";
}

// ── Active job correlation ────────────────────────────────────────────────────

const USERS_DIR = process.env["USERS_DIR"] ?? "../users";

export interface ActiveJob {
  action: string;
  ticker: string | null;
}

export async function getActiveJob(userId: string): Promise<ActiveJob | null> {
  const jobsDir = path.resolve(USERS_DIR, userId, "data", "jobs");
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
// Keys are the model IDs as they appear in the request body (no provider prefix).
// Update when adding new profiles to data/model-profiles.json.

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
  const p = MODEL_COSTS[model];
  if (!p) return 0;
  return (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /root/clawd/backend && npx tsc --noEmit 2>&1 | grep "error" | head -10
```

Expected: No errors.

---

## Task 6: LLM proxy Express router

**Files:**
- Create: `backend/src/routes/llmProxy.ts`

- [ ] **Step 1: Write the proxy router**

```typescript
// backend/src/routes/llmProxy.ts
import { Router, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  resolveUserId,
  fingerprintAnalyst,
  getActiveJob,
  estimateCost,
  OPENROUTER_BASE,
} from "../services/llmProxy.js";
import { eventStore } from "../services/eventStore.js";
import { logger } from "../services/logger.js";

const OPENROUTER_KEY = process.env["OPENROUTER_API_KEY"] ?? "";
const UPSTREAM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Headers not safe to forward from upstream to client
const HOP_BY_HOP = new Set([
  "content-encoding", "transfer-encoding", "connection",
  "keep-alive", "upgrade", "proxy-authenticate",
  "proxy-authorization", "te", "trailers",
]);

const router = Router();

// POST /llm/v1/chat/completions
router.post("/chat/completions", (async (req: Request, res: Response) => {
  const startTime = Date.now();

  // 1. Authenticate proxy key → userId
  const authHeader = String(req.headers["authorization"] ?? "");
  const proxyKey = authHeader.replace(/^Bearer\s+/i, "").trim();
  const userId = resolveUserId(proxyKey);
  if (!userId) {
    res.status(401).json({ error: "Invalid proxy API key" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const modelRaw = String(body["model"] ?? "unknown");
  const isStreaming = body["stream"] === true;

  // 2. Fingerprint analyst from system prompt
  const messages =
    (body["messages"] as Array<{ role: string; content: string }>) ?? [];
  const systemMsg = messages.find((m) => m.role === "system");
  const analyst = systemMsg
    ? fingerprintAnalyst(systemMsg.content)
    : "orchestrator";

  // 3. Correlate with active job for purpose tagging
  const activeJob = await getActiveJob(userId);

  // 4. Inject OpenRouter metadata into request body
  const enrichedBody: Record<string, unknown> = {
    ...body,
    metadata: {
      user_id: userId,
      purpose: activeJob?.action ?? null,
      ticker:  activeJob?.ticker ?? null,
      analyst,
    },
  };

  // 5. Forward to OpenRouter with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${OPENROUTER_KEY}`,
        "Content-Type":  "application/json",
        "HTTP-Referer":  "https://clawd.app",
        "X-Title":       `clawd/${userId}/${activeJob?.action ?? "session"}`,
      },
      body: JSON.stringify(enrichedBody),
    });
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = (err as Error).name === "AbortError";
    const latencyMs = Date.now() - startTime;
    logger.warn(`LLM proxy upstream ${isTimeout ? "timeout" : "error"} for ${userId}: ${(err as Error).message}`);
    await eventStore.logRequest({
      userId, purpose: activeJob?.action ?? null, ticker: activeJob?.ticker ?? null,
      analyst, model: modelRaw, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs,
      status: isTimeout ? "timeout" : "error",
      errorMessage: (err as Error).message.slice(0, 500),
      timestamp: new Date().toISOString(),
    }).catch(() => { /* never let logging crash the proxy */ });
    res.status(isTimeout ? 504 : 502).json({ error: "Upstream request failed" });
    return;
  }
  clearTimeout(timeout);

  // 6. Forward upstream headers to client
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value);
  });
  res.status(upstream.status);

  const latencyMs = Date.now() - startTime;

  if (isStreaming && upstream.body) {
    // Streaming: pipe SSE through immediately; log with 0 tokens (can't buffer SSE)
    await eventStore.logRequest({
      userId, purpose: activeJob?.action ?? null, ticker: activeJob?.ticker ?? null,
      analyst, model: modelRaw, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs,
      status: upstream.ok ? "success" : "error", errorMessage: null,
      timestamp: new Date().toISOString(),
    }).catch(() => { /* never let logging crash the proxy */ });

    const nodeStream = Readable.fromWeb(
      upstream.body as Parameters<typeof Readable.fromWeb>[0]
    );
    nodeStream.pipe(res);
  } else {
    // Non-streaming: buffer response, extract token counts for accurate logging
    const responseText = await upstream.text();
    let tokensIn = 0, tokensOut = 0;
    try {
      const json = JSON.parse(responseText) as {
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      tokensIn  = json.usage?.prompt_tokens  ?? 0;
      tokensOut = json.usage?.completion_tokens ?? 0;
    } catch { /* error body or non-JSON — leave tokens at 0 */ }

    const costUsd = estimateCost(modelRaw, tokensIn, tokensOut);

    await eventStore.logRequest({
      userId, purpose: activeJob?.action ?? null, ticker: activeJob?.ticker ?? null,
      analyst, model: modelRaw, tokensIn, tokensOut, costUsd, latencyMs,
      status: upstream.ok ? "success" : "error", errorMessage: null,
      timestamp: new Date().toISOString(),
    }).catch(() => { /* never let logging crash the proxy */ });

    res.send(responseText);
  }
}) as (req: Request, res: Response) => Promise<void>);

// Passthrough /llm/v1/* routes (models list, embeddings, etc.)
router.all("/*", (async (req: Request, res: Response) => {
  const authHeader = String(req.headers["authorization"] ?? "");
  const proxyKey = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!resolveUserId(proxyKey)) {
    res.status(401).json({ error: "Invalid proxy API key" });
    return;
  }

  const upstreamRes = await fetch(`${OPENROUTER_BASE}${req.path}`, {
    method: req.method,
    headers: {
      "Authorization": `Bearer ${OPENROUTER_KEY}`,
      "Content-Type":  "application/json",
    },
    body: ["GET", "HEAD"].includes(req.method)
      ? undefined
      : JSON.stringify(req.body),
  });

  const text = await upstreamRes.text();
  res.status(upstreamRes.status).send(text);
}) as (req: Request, res: Response) => Promise<void>);

export default router;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /root/clawd/backend && npx tsc --noEmit 2>&1 | grep "error" | head -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /root/clawd
git add backend/src/services/llmProxy.ts backend/src/routes/llmProxy.ts
git commit -m "feat: LLM proxy service and router — per-user key auth, analyst fingerprinting, OpenRouter forwarding"
```

---

## Task 7: agentService — proxy provider setup + model string transform

**Files:**
- Modify: `backend/src/services/agentService.ts`

- [ ] **Step 1: Add imports at top of agentService.ts**

Find the existing imports and add after the last import line:

```typescript
import {
  generateProxyKey,
  registerKey,
  unregisterKey,
  toProxyModel,
  buildKeyMap,
  PROXY_BASE_URL,
} from "./llmProxy.js";
```

- [ ] **Step 2: Add ensureProxyProvider + removeProxyProvider + ensureAllProxyProviders**

Add these three functions after the `getUserAgentStatus` function (around line 383, before `AgentHealth` interface):

```typescript
// ── Proxy provider management ─────────────────────────────────────────────────

/**
 * Idempotent: creates models.providers.clawd-{userId} in openclaw.json with
 * a stable proxy API key. Generates a new key only if one doesn't exist yet.
 * Does NOT call writeConfig — caller owns the write.
 * Mutates config in place and returns the proxy key.
 */
function applyProxyProviderToConfig(
  config: OpenClawConfig,
  userId: string
): string {
  // Get or create key on the agent entry
  const agentEntry = config.agents?.list?.find(
    (a) => a.id === userId
  ) as (typeof config.agents.list[0] & Record<string, unknown>) | undefined;

  let proxyKey: string;
  if (agentEntry && (agentEntry as Record<string, unknown>)["proxyApiKey"]) {
    proxyKey = (agentEntry as Record<string, unknown>)["proxyApiKey"] as string;
  } else {
    proxyKey = generateProxyKey(userId);
    if (agentEntry) {
      (agentEntry as Record<string, unknown>)["proxyApiKey"] = proxyKey;
    }
  }

  // Ensure models.providers.clawd-{userId} exists
  if (!config["models"]) config["models"] = {};
  const models = config["models"] as Record<string, unknown>;
  if (!models["providers"]) models["providers"] = {};
  const providers = models["providers"] as Record<string, unknown>;
  providers[`clawd-${userId}`] = { baseUrl: PROXY_BASE_URL, apiKey: proxyKey };

  registerKey(proxyKey, userId);
  return proxyKey;
}

export async function ensureProxyProvider(userId: string): Promise<string> {
  const config = await readConfig();
  const proxyKey = applyProxyProviderToConfig(config, userId);
  await writeConfig(config);
  logger.info(`Proxy provider ensured for ${userId}`);
  return proxyKey;
}

export async function removeProxyProvider(userId: string): Promise<void> {
  const config = await readConfig();

  // Revoke key from in-memory map
  const agentEntry = config.agents?.list?.find((a) => a.id === userId);
  const proxyKey = agentEntry
    ? ((agentEntry as unknown as Record<string, unknown>)["proxyApiKey"] as string | undefined)
    : undefined;
  if (proxyKey) unregisterKey(proxyKey);

  // Remove provider entry
  const providers = (config["models"] as Record<string, unknown> | undefined)
    ?.["providers"] as Record<string, unknown> | undefined;
  if (providers) delete providers[`clawd-${userId}`];

  await writeConfig(config);
  logger.info(`Removed proxy provider for ${userId}`);
}

/**
 * Run once on server startup: ensures every existing agent has a proxy provider
 * and has its model strings updated to route through the proxy.
 * Rebuilds the in-memory key map after processing all agents.
 */
export async function ensureAllProxyProviders(): Promise<void> {
  const config = await readConfig();
  const agents = config.agents?.list ?? [];
  let dirty = false;

  for (const agent of agents) {
    const entry = agent as unknown as Record<string, unknown>;

    // 1. Ensure proxy key + provider entry
    const before = (entry["proxyApiKey"] as string | undefined) ?? "";
    applyProxyProviderToConfig(config, agent.id);
    if ((entry["proxyApiKey"] as string) !== before) dirty = true;

    // 2. Transform openrouter/* model strings to clawd-{userId}/*
    const modelObj = entry["model"] as Record<string, unknown> | undefined;
    if (typeof modelObj?.["primary"] === "string" &&
        (modelObj["primary"] as string).startsWith("openrouter/")) {
      modelObj["primary"] = toProxyModel(
        agent.id, modelObj["primary"] as string
      );
      dirty = true;
    }

    const subagents = entry["subagents"] as Record<string, unknown> | undefined;
    const subModelObj = subagents?.["model"] as Record<string, unknown> | undefined;
    if (typeof subModelObj?.["primary"] === "string" &&
        (subModelObj["primary"] as string).startsWith("openrouter/")) {
      subModelObj["primary"] = toProxyModel(
        agent.id, subModelObj["primary"] as string
      );
      dirty = true;
    }
  }

  if (dirty) await writeConfig(config);

  // Rebuild in-memory key map from final config state
  buildKeyMap(agents as unknown as Array<Record<string, unknown>>);
  logger.info(`ensureAllProxyProviders: processed ${agents.length} agents, dirty=${dirty}`);
}
```

- [ ] **Step 3: Update addUserAgent — call ensureProxyProvider after writeConfig**

In `addUserAgent`, find this section (around line 237):
```typescript
  await writeConfig(config);

  // Restart gateway and verify
  await restartGateway();
```

Replace with:
```typescript
  await writeConfig(config);

  // Create per-user proxy provider (idempotent)
  await ensureProxyProvider(userId);

  // Restart gateway and verify
  await restartGateway();
```

- [ ] **Step 4: Update applyProfileToAgent — transform model strings**

In `applyProfileToAgent`, find these two assignments (around line 343):
```typescript
  agentEntry["model"] = { primary: orchestratorModel };
  agentEntry["subagents"] = {
    ...(typeof agentEntry["subagents"] === "object" && agentEntry["subagents"] !== null
      ? (agentEntry["subagents"] as Record<string, unknown>)
      : {}),
    model: { primary: analystsModel },
  };
```

Replace with:
```typescript
  // Route openrouter/* models through the per-user proxy; other providers go direct.
  agentEntry["model"] = { primary: toProxyModel(userId, orchestratorModel) };
  agentEntry["subagents"] = {
    ...(typeof agentEntry["subagents"] === "object" && agentEntry["subagents"] !== null
      ? (agentEntry["subagents"] as Record<string, unknown>)
      : {}),
    model: { primary: toProxyModel(userId, analystsModel) },
  };
```

- [ ] **Step 5: Update removeUserAgent — call removeProxyProvider**

In `removeUserAgent`, find (around line 279):
```typescript
  await writeConfig(config);

  // Remove the heartbeat cron
  await removeUserCron(userId);
```

Replace with:
```typescript
  await writeConfig(config);

  // Remove proxy provider + key map entry
  await removeProxyProvider(userId);

  // Remove the heartbeat cron
  await removeUserCron(userId);
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /root/clawd/backend && npx tsc --noEmit 2>&1 | grep "error" | head -10
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
cd /root/clawd
git add backend/src/services/agentService.ts
git commit -m "feat: agentService — proxy provider setup per user, model string transform for proxy routing"
```

---

## Task 8: Wire proxy into app.ts and server.ts

**Files:**
- Modify: `backend/src/app.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Mount proxy router in app.ts**

Add import after the existing route imports in `backend/src/app.ts`:
```typescript
import llmProxyRouter from "./routes/llmProxy.js";
```

Add the mount point inside `createApp()`, after `app.use("/api/admin", adminRoutes)` and before the protected routes block (`app.use("/api", authMiddleware, ...)`):
```typescript
  // LLM proxy — OpenClaw agents use their per-user proxy API key
  // No authMiddleware — authenticated via proxy key in Authorization header
  app.use("/llm/v1", llmProxyRouter);
```

- [ ] **Step 2: Add startup call in server.ts**

Add import after existing imports in `backend/src/server.ts`:
```typescript
import { ensureAllProxyProviders, restartGateway } from "./services/agentService.js";
```

Find the listen callback:
```typescript
const server = app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
  startWatchdog();
});
```

Replace with:
```typescript
const server = app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
  startWatchdog();
  // Ensure all agents have proxy providers + rebuild key map
  ensureAllProxyProviders()
    .then(() => restartGateway())
    .catch((err: Error) =>
      logger.warn(`Proxy setup on startup failed: ${err.message}`)
    );
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /root/clawd/backend && npx tsc --noEmit 2>&1 | grep "error" | head -10
```

Expected: No errors.

- [ ] **Step 4: Deploy**

```bash
cd /root/clawd && ./deploy.sh
```

- [ ] **Step 5: Verify proxy provider setup in logs and config**

```bash
# Check startup logs
journalctl -u clawd-backend -n 80 | grep -E "proxy|Proxy|clawd-sk"

# Verify openclaw.json: providers + transformed model strings
python3 -c "
import json
d = json.load(open('/root/.openclaw/openclaw.json'))
providers = d.get('models', {}).get('providers', {})
print('=== Providers ===')
for name, cfg in providers.items():
    print(f'  {name}: baseUrl={cfg[\"baseUrl\"]}')
print()
print('=== Agent models ===')
for a in d.get('agents', {}).get('list', []):
    print(f'  {a[\"id\"]}: {a.get(\"model\",{}).get(\"primary\",\"N/A\")}')
"
```

Expected:
```
=== Providers ===
  clawd-test-user: baseUrl=http://localhost:8081/llm/v1
  clawd-soof: baseUrl=http://localhost:8081/llm/v1
  clawd-noam: baseUrl=http://localhost:8081/llm/v1

=== Agent models ===
  test-user: clawd-test-user/meta-llama/llama-3.3-70b-instruct:free
  soof: clawd-soof/deepseek/deepseek-v3
  noam: clawd-noam/deepseek/deepseek-v3
```

- [ ] **Step 6: Smoke-test the proxy with a real LLM call**

```bash
# Get test-user's proxy key from openclaw.json
PROXY_KEY=$(python3 -c "
import json
d = json.load(open('/root/.openclaw/openclaw.json'))
agents = d.get('agents', {}).get('list', [])
agent = next((a for a in agents if a['id'] == 'test-user'), None)
print((agent or {}).get('proxyApiKey', 'NOT_FOUND'))
")
echo "Key: $PROXY_KEY"

curl -s -X POST http://localhost:8081/llm/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta-llama/llama-3.3-70b-instruct:free",
    "messages": [{"role":"user","content":"Reply with exactly one word: OK"}],
    "max_tokens": 5
  }' | python3 -m json.tool

# Verify event was logged to SQLite
python3 -c "
import sqlite3
db = sqlite3.connect('/root/clawd/data/observability.db')
rows = db.execute('SELECT user_id, analyst, model, tokens_in, tokens_out, status FROM llm_requests ORDER BY id DESC LIMIT 3').fetchall()
for r in rows: print(r)
"
```

Expected: Valid LLM response, and one SQLite row with `user_id='test-user', analyst='orchestrator', status='success'`.

- [ ] **Step 7: Commit**

```bash
cd /root/clawd
git add backend/src/app.ts backend/src/server.ts
git commit -m "feat: mount LLM proxy at /llm/v1, run proxy provider migration on startup"
```

---

## Task 9: Admin observability API routes

**Files:**
- Modify: `backend/src/routes/admin.ts`

- [ ] **Step 1: Add eventStore import to admin.ts**

Find the imports block in `backend/src/routes/admin.ts`. Add after the last import:

```typescript
import { eventStore } from "../services/eventStore.js";
```

- [ ] **Step 2: Add 3 observability routes before `export default router`**

Add at the bottom of `backend/src/routes/admin.ts`, just before `export default router`:

```typescript
// GET /api/admin/observability/summary  — all users, today's totals
router.get(
  "/observability/summary",
  handler(async (_req, res) => {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const users = await eventStore.getDailySummary(today);
    res.json({ date: today, users });
  })
);

// GET /api/admin/observability/users/:userId  — daily history (7d) + last 20 requests
router.get(
  "/observability/users/:userId",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const [history, recent] = await Promise.all([
      eventStore.getUserDailyHistory(userId, 7),
      eventStore.getRecentActivity(userId, 20),
    ]);
    res.json({ userId, history, recent });
  })
);

// GET /api/admin/observability/all  — all users, last 7 days (for charts)
router.get(
  "/observability/all",
  handler(async (_req, res) => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().slice(0, 10);
    });
    const summaries = await Promise.all(
      days.map((date) => eventStore.getDailySummary(date))
    );
    res.json({ days: days.map((date, i) => ({ date, users: summaries[i] })) });
  })
);
```

- [ ] **Step 3: Deploy and test**

```bash
cd /root/clawd && ./deploy.sh

ADMIN_KEY=$(systemctl show clawd-backend --property=Environment 2>/dev/null \
  | grep -oP 'ADMIN_KEY=\K[^ ]+' || echo "YOUR_ADMIN_KEY")

# Today's summary
curl -s "http://localhost:8081/api/admin/observability/summary" \
  -H "X-Admin-Key: $ADMIN_KEY" | python3 -m json.tool

# test-user detail
curl -s "http://localhost:8081/api/admin/observability/users/test-user" \
  -H "X-Admin-Key: $ADMIN_KEY" | python3 -m json.tool | head -40
```

Expected: JSON with `date`, `users` array containing the test-user row from Task 8.

- [ ] **Step 4: Commit**

```bash
cd /root/clawd
git add backend/src/routes/admin.ts
git commit -m "feat: admin observability API — /summary, /users/:userId, /all"
```

---

## Task 10: Admin panel UI — Agent Activity section

**Files:**
- Modify: `frontend/src/api/admin.ts`
- Modify: `frontend/src/pages/Admin.tsx`

- [ ] **Step 1: Read current api/admin.ts to find the right append point**

```bash
tail -30 /root/clawd/frontend/src/api/admin.ts
```

- [ ] **Step 2: Add types and API functions to frontend/src/api/admin.ts**

Append to the end of `frontend/src/api/admin.ts`:

```typescript
// ── Observability ─────────────────────────────────────────────────────────────

export interface LlmRequestEvent {
  id: number;
  userId: string;
  purpose: string | null;
  ticker: string | null;
  analyst: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  status: "success" | "error" | "timeout";
  errorMessage: string | null;
  timestamp: string;
}

export interface UserDailySummary {
  userId: string;
  date: string;
  requestCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
}

export interface UserObservability {
  userId: string;
  history: UserDailySummary[];
  recent: LlmRequestEvent[];
}

export async function adminGetUserObservability(
  userId: string
): Promise<UserObservability> {
  const adminKey = sessionStorage.getItem("admin_key") ?? "";
  const res = await fetch(`/api/admin/observability/users/${encodeURIComponent(userId)}`, {
    headers: { "X-Admin-Key": adminKey },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<UserObservability>;
}
```

- [ ] **Step 3: Add UserActivityBadge component to Admin.tsx**

First, add `adminGetUserObservability` to the import from `"../api/admin"` at the top of `frontend/src/pages/Admin.tsx`. Find the existing import and add it to the named list:

```typescript
import {
  adminFetchUsers,
  adminCreateUser,
  adminDeleteUser,
  adminUpdateLimits,
  adminAddTelegram,
  adminGetStatus,
  adminFetchProfiles,
  adminCreateProfile,
  adminUpdateProfile,
  adminDeleteProfile,
  adminSetUserProfile,
  adminGetUserObservability,
  type UserSummary,
  type RateLimits,
  type AdminStatus,
  type ProfileDefinition,
  type ProfilesRegistry,
  type UserObservability,
  type LlmRequestEvent,
} from "../api/admin";
```

- [ ] **Step 4: Insert UserActivityBadge component**

In `frontend/src/pages/Admin.tsx`, find the `// ---- User Card ----` comment (around line 540). Insert the following component immediately before that comment:

```typescript
// ---- User Activity Badge ----
function UserActivityBadge({ userId }: { userId: string }) {
  const [data, setData] = useState<UserObservability | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    adminGetUserObservability(userId)
      .then(setData)
      .catch(() => { /* no data yet is fine */ });
  }, [userId]);

  if (!data || (data.history.length === 0 && data.recent.length === 0)) {
    return (
      <p className="text-[11px] text-[var(--color-fg-subtle)] italic mt-1">
        No LLM activity yet
      </p>
    );
  }

  const today = data.history[0];
  const last = data.recent[0];

  return (
    <div className="mt-1 text-[11px] text-[var(--color-fg-muted)]">
      <div className="flex items-center gap-3 flex-wrap">
        {today && (
          <>
            <span>
              <span className="text-[var(--color-fg-subtle)]">Today: </span>
              <span className="font-medium text-[var(--color-fg-default)]">
                {today.requestCount} req
              </span>
              {" · "}
              <span className="text-[var(--color-accent-green)]">
                ${today.totalCostUsd.toFixed(4)}
              </span>
            </span>
            <span>
              <span className="text-[var(--color-fg-subtle)]">Tokens: </span>
              {(
                (today.totalTokensIn + today.totalTokensOut) /
                1000
              ).toFixed(1)}
              k
            </span>
          </>
        )}
        {last && (
          <span>
            <span className="text-[var(--color-fg-subtle)]">Last: </span>
            <span className="font-mono text-[10px]">{last.analyst}</span>
            {" · "}
            <span className="text-[10px] text-[var(--color-fg-subtle)]">
              {new Date(last.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {" · "}
            <span
              className={
                last.status === "success"
                  ? "text-[var(--color-accent-green)]"
                  : "text-[var(--color-accent-red)]"
              }
            >
              {last.status}
            </span>
          </span>
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[var(--color-accent-blue)] underline text-[10px]"
        >
          {expanded ? "hide" : `show ${data.recent.length} recent`}
        </button>
      </div>

      {expanded && data.recent.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="text-[var(--color-fg-subtle)] border-b border-[var(--color-border)]">
                <th className="text-left py-1 pr-2 font-normal">Time</th>
                <th className="text-left pr-2 font-normal">Analyst</th>
                <th className="text-left pr-2 font-normal">Purpose</th>
                <th className="text-left pr-2 font-normal">Model</th>
                <th className="text-right pr-2 font-normal">Tokens</th>
                <th className="text-right pr-2 font-normal">Cost</th>
                <th className="text-left font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r: LlmRequestEvent) => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--color-border)] border-opacity-30 hover:bg-[var(--color-bg-muted)]"
                >
                  <td className="py-0.5 pr-2 text-[var(--color-fg-subtle)] font-mono whitespace-nowrap">
                    {new Date(r.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </td>
                  <td className="pr-2 font-medium">{r.analyst}</td>
                  <td className="pr-2 text-[var(--color-fg-subtle)]">
                    {r.purpose ?? "—"}
                    {r.ticker ? ` (${r.ticker})` : ""}
                  </td>
                  <td className="pr-2 font-mono text-[9px] text-[var(--color-fg-subtle)]">
                    {r.model.split("/").slice(-1)[0]}
                  </td>
                  <td className="pr-2 text-right">
                    {(
                      (r.tokensIn + r.tokensOut) /
                      1000
                    ).toFixed(1)}
                    k
                  </td>
                  <td className="pr-2 text-right text-[var(--color-accent-green)]">
                    ${r.costUsd.toFixed(4)}
                  </td>
                  <td
                    className={
                      r.status === "success"
                        ? "text-[var(--color-accent-green)]"
                        : "text-[var(--color-accent-red)]"
                    }
                  >
                    {r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire UserActivityBadge into UserCard**

In the `UserCard` component, find this block:
```typescript
      <div className="text-[11px] text-[var(--color-fg-muted)] space-y-0.5 mb-3">
        {user.hasTelegram ? (
          <p>{t("adminTelegramYes", language)}{user.telegramChatId ? ` (${user.telegramChatId})` : ""}</p>
        ) : (
          <p>{t("adminTelegramNo", language)}</p>
        )}
        <p>{t("adminDeepDives", language)} {user.rateLimits.deep_dive.maxPerPeriod}/{t("perDay", language).replace("/ ", "")} · {t("adminFullReportsLabel", language)} {user.rateLimits.full_report.maxPerPeriod}/{t("perWeek", language).replace("/ ", "")}</p>
      </div>
```

Replace with:
```typescript
      <div className="text-[11px] text-[var(--color-fg-muted)] space-y-0.5 mb-3">
        {user.hasTelegram ? (
          <p>{t("adminTelegramYes", language)}{user.telegramChatId ? ` (${user.telegramChatId})` : ""}</p>
        ) : (
          <p>{t("adminTelegramNo", language)}</p>
        )}
        <p>{t("adminDeepDives", language)} {user.rateLimits.deep_dive.maxPerPeriod}/{t("perDay", language).replace("/ ", "")} · {t("adminFullReportsLabel", language)} {user.rateLimits.full_report.maxPerPeriod}/{t("perWeek", language).replace("/ ", "")}</p>
        <UserActivityBadge userId={user.userId} />
      </div>
```

- [ ] **Step 6: Deploy and verify**

```bash
cd /root/clawd && ./deploy.sh
```

Open the admin panel. Each user card should show either "No LLM activity yet" or real data from the proxy test in Task 8. Trigger a job and refresh to see activity update.

- [ ] **Step 7: Commit**

```bash
cd /root/clawd
git add frontend/src/api/admin.ts frontend/src/pages/Admin.tsx
git commit -m "feat: admin panel agent activity — request counts, cost, analyst breakdown per user"
```

---

## Post-Implementation Verification Checklist

```bash
# 1. All agents proxied and key map live
python3 -c "
import json
d = json.load(open('/root/.openclaw/openclaw.json'))
agents = d.get('agents',{}).get('list',[])
providers = d.get('models',{}).get('providers',{})
for a in agents:
    has_key = 'proxyApiKey' in a
    has_provider = f'clawd-{a[\"id\"]}' in providers
    model = a.get('model',{}).get('primary','N/A')
    print(f'{a[\"id\"]}: key={has_key} provider={has_provider} model={model}')
"

# 2. SQLite DB exists and queryable
python3 -c "
import sqlite3
db = sqlite3.connect('/root/clawd/data/observability.db')
count = db.execute('SELECT COUNT(*) FROM llm_requests').fetchone()[0]
print(f'Total logged requests: {count}')
rows = db.execute('SELECT user_id, analyst, model, status FROM llm_requests ORDER BY id DESC LIMIT 5').fetchall()
for r in rows: print(r)
"

# 3. Admin API endpoints responding
curl -s http://localhost:8081/api/admin/observability/summary \
  -H "X-Admin-Key: $ADMIN_KEY" | python3 -m json.tool | head -20

# 4. Proxy correctly routes a real request
# (run Task 8 Step 6 again if needed)
```
