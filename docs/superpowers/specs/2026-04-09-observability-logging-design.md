# Observability & Logging System — Design Spec
**Date:** 2026-04-09  
**Status:** Approved for implementation

---

## Problem

1. OpenRouter shows raw requests from OpenClaw with no attribution — impossible to know which user triggered a request, for what purpose, or which analyst sub-agent made it.
2. Per-user agent failures are invisible — no structured event trail to diagnose why a test-user's jobs fail.
3. Admin panel shows static config state only — no live agent activity, request counts, cost breakdown, or sub-agent visibility.

---

## Scope

Four deliverables, in order of dependency:

1. **Agent debugging** — investigate and fix why test-user requests aren't reaching/completing the agent
2. **LLM Proxy** — thin HTTP proxy between OpenClaw and OpenRouter, tags every request with context
3. **Event Store** — SQLite-backed structured log, behind an adapter interface for easy swapping
4. **Admin panel** — new visibility: per-user agent activity, sub-agents, daily request counts, cost

---

## Architecture

```
OpenClaw agent (userId)
  │  uses proxy API key: clawd-sk-{userId}-{secret}
  │  hits: http://localhost:PORT/v1  (our proxy)
  ▼
LLM Proxy (Express router, same backend process)
  │  1. Authenticates proxy key → resolves userId
  │  2. Fingerprints system prompt → resolves analyst
  │  3. Correlates with active job → resolves purpose + ticker
  │  4. Injects OpenRouter metadata field: { user_id, purpose, ticker, analyst }
  │  5. Forwards request to OpenRouter with master API key
  │  6. On response: logs event to Event Store (tokens, cost, latency, status)
  ▼
OpenRouter (real LLM calls)

Event Store (SQLite)
  │  Table: llm_requests
  │  Columns: id, userId, purpose, ticker, analyst, model,
  │           tokens_in, tokens_out, cost_usd, latency_ms,
  │           status, timestamp
  ▼
Admin API  →  Admin Panel UI
```

---

## LLM Proxy

**Route:** `POST /llm/v1/chat/completions` (and passthrough for other `/llm/v1/*`)  
**Auth:** `Authorization: Bearer clawd-sk-{userId}-{secret}` — proxy resolves to userId, forwards with master `OPENROUTER_API_KEY`

**Prompt fingerprinting** — matches system prompt against known patterns:
- `fundamentals` — "Fundamentals Analyst"
- `technical` — "Technical Analyst"  
- `sentiment` — "Sentiment Analyst"
- `macro` — "Macro Analyst"
- `risk` — "Portfolio Risk"
- `bull` — "Bull Researcher"
- `bear` — "Bear Researcher"
- `orchestrator` — anything else (main agent session)

**OpenRouter metadata injection** — merged into request body before forwarding:
```json
{ "metadata": { "user_id": "...", "purpose": "...", "ticker": "...", "analyst": "..." } }
```

**Cost calculation** — proxy maintains a model pricing table (token cost per 1M tokens). Falls back to OpenRouter's `x-openrouter-cost` response header if present.

---

## Event Store

**Interface** (`IEventStore`) — decoupled from implementation:
```typescript
interface IEventStore {
  logRequest(event: LlmRequestEvent): Promise<void>;
  getRequestsForUser(userId: string, since: Date): Promise<LlmRequestEvent[]>;
  getDailySummary(date: string): Promise<UserDailySummary[]>;
  getRecentActivity(userId: string, limit: number): Promise<LlmRequestEvent[]>;
}
```

**Default implementation:** SQLite via `better-sqlite3`  
**DB location:** `data/observability.db` (same DATA_DIR as other data files)  
**Swap path:** implement `IEventStore`, replace in `createEventStore()` factory — one file change

---

## Proxy API Key Management

- Keys stored per-agent in `openclaw.json` (new `proxyApiKey` field on each agent entry)
- Generated on agent creation: `clawd-sk-{userId}-{randomHex(16)}`
- Key → userId mapping cached in-memory at proxy startup (rebuilt on gateway restart)
- `agentService.ts` generates + stores key when calling `addUserAgent()`
- Proxy base URL stored in agent entry too: `proxyBaseUrl: "http://localhost:8081/llm/v1"`

---

## Admin API Endpoints (new)

```
GET /api/admin/observability/summary          — all users, today's counts + costs
GET /api/admin/observability/users/:userId    — per-user: recent requests, daily totals
GET /api/admin/observability/users/:userId/activity — last N llm_requests rows
```

---

## Admin Panel UI (new section)

**In the Admin page**, new "Agent Activity" section per user:
- Currently running job (purpose + ticker + elapsed time)
- Today: N requests, N tokens, $X.XX cost
- Last request: analyst + model + timestamp
- Expandable: last 20 requests table

---

## Agent Debugging (separate from logging)

Investigate in order:
1. Check `openclaw cron list --json` — does test-user's heartbeat cron exist?
2. Check `~/.openclaw/cron/jobs.json` — consecutive errors? lastError message?
3. Check `openclaw agents list --json` — is test-user registered?
4. Check `openclaw.json` — does test-user entry have correct workspace path + model config?
5. Check trigger files — are triggers being created? are they being picked up and deleted?
6. Check job files — stuck in `running` or `pending`?

Fix whatever is broken before building the proxy (clean baseline needed).

---

## Easy-Swap Design Principle

The only place that knows about SQLite is `eventStoreSqlite.ts`.  
`server.ts` calls `createEventStore()` which returns an `IEventStore`.  
To switch to Postgres, Redis, or a SaaS observability platform: implement the interface, change the factory. Nothing else changes.

---

## Implementation Order

1. Debug + fix per-user agent (unblocks real data to test proxy against)
2. Event store: interface + SQLite implementation
3. LLM proxy: Express router, key management, fingerprinting, forwarding
4. `agentService.ts`: generate proxy keys, configure agents to point at proxy
5. Admin API: 3 new endpoints reading from event store
6. Admin panel UI: Agent Activity section
