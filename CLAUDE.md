# Clawd — AI Finance Agent Platform
# CLAUDE.md — read this first, every session

## What this is

A multi-user AI-powered investment advisory platform. One admin (the owner) manages all
users. Each user connects a stock portfolio; an AI agent (OpenClaw) analyzes it, sends
daily briefs via Telegram, and produces BUY/ADD/HOLD/REDUCE/SELL/CLOSE verdicts with
full reasoning. The dashboard is a React SPA served by the backend.

---

## Directory layout

```
~/clawd/
├── SOUL.md            ← Agent identity and four operating modes (read-only)
├── AGENTS.md          ← Security rules, custom commands, analyst dispatch protocol
├── HEARTBEAT.md       ← Schedule: daily 8am, weekly Sunday 7pm, 30-min ambient check
├── TOOLS.md           ← Available agent tools
├── IDENTITY.md / USER.md  ← Per-session files (often empty)
├── deploy.sh          ← git pull → build backend → build frontend → restart service
├── backend/           ← Node.js/Express API (port 8081)
├── frontend/          ← React/Vite SPA
├── users/             ← Per-user runtime data (NEVER commit)
│   └── [userId]/
│       ├── USER.md              ← Investor profile (agent reads to calibrate advice)
│       ├── profile.json         ← displayName, telegramChatId, schedule, rateLimits
│       ├── auth.json            ← bcrypt passwordHash
│       └── data/
│           ├── portfolio.json   ← Holdings (source of truth)
│           ├── state.json       ← UNINITIALIZED | BOOTSTRAPPING | ACTIVE
│           ├── config.json      ← modelProfile: "testing" | "production"
│           ├── tickers/[TICKER]/
│           │   ├── strategy.json   ← AI verdict (Zod-validated, see schema below)
│           │   └── events.jsonl    ← Append-only event log
│           ├── jobs/[job_id].json  ← Job status tracking
│           ├── triggers/           ← Dashboard writes here, agent picks up
│           ├── reports/            ← Analyst JSON outputs
│           └── reports/snapshots/  ← Batch report snapshots
└── data/              ← Legacy single-user data (being migrated)
    └── triggers/      ← Bridge path — jobs.ts ALSO copies triggers here
```

---

## Architecture: three layers

### 1. Agent layer (OpenClaw)

OpenClaw is an external agent framework. The agent reads SOUL.md + AGENTS.md on each
session, injects USER_ID from the gateway, and operates in isolation inside that user's
workspace.

**Four operating modes (SOUL.md):**
- **Mode 1 — Daily brief** (8am auto): top-5 positions by value → sentiment + price check
  only → escalate to Mode 2 if any condition fires → Telegram briefing
- **Mode 2 — Deep dive** (on escalation or user command): all 5 analysts → Bull/Bear debate
  → update strategy.json → Telegram
- **Mode 3 — Weekly research** (Sunday 7pm): 3-5 new ideas, half in-sector, half new →
  full pipeline → write to data/research/ → Telegram
- **Mode 4 — Full report** (`/full-report`): Mode 1 on ALL positions, auto-escalate any
  with no prior deep dive

**Analyst team:** Fundamentals, Technical, Sentiment, Macro, Portfolio Risk, Bull Researcher,
Bear Researcher. All output JSON. The orchestrator validates each file before proceeding.

**HEARTBEAT.md trigger processing:** On every session start, the agent checks
`data/triggers/` for `.json` files, sets jobs to "running", deletes trigger, executes
action, updates job to "completed" or "failed".

**Ambient heartbeat (every 30 min):** Just replies HEARTBEAT_OK unless a Telegram message
mentions a ticker with urgent language — then runs sentiment check only, does NOT update
strategy.json.

### 2. Backend — `backend/src/`

**Entry:** `server.ts` → `createApp()` in `app.ts`. Port from `process.env.PORT ?? 8081`.

**Auth model:**
- JWT Bearer tokens, 7-day expiry, secret from `JWT_SECRET` env
- Passwords: bcrypt (rounds=12), stored in `users/[userId]/auth.json`
- Admin routes: `X-Admin-Key` header (from `ADMIN_KEY` env), no JWT needed
- `authMiddleware` → sets `res.locals.userId`
- `userIsolationMiddleware` → builds `UserWorkspace` object, sets `res.locals.workspace`
- `guardPath()` → throws `WorkspaceViolationError` if a path escapes the user's root → 403

**Route map:**
```
POST /api/auth/login              → issues JWT
GET  /api/health                  → { status: "ok" }
POST /api/onboard/init            → admin-key, creates workspace + auth + profile
POST /api/onboard/portfolio       → JWT, writes portfolio.json, queues full_report job
GET  /api/onboard/status          → JWT, returns state/progress/schedule/rateLimits
POST /api/onboard/telegram        → JWT, wires Telegram in openclaw.json, restarts gateway
POST /api/onboard/change-password → JWT, bcrypt verify + hash new
PATCH /api/onboard/schedule       → JWT, updates profile.json schedule
GET  /api/portfolio               → JWT, live prices + P/L calculations
PATCH /api/position/:ticker       → JWT, update shares/avgPrice in portfolio.json
GET  /api/history/:ticker?timeframe=1M → JWT, candlestick data from Yahoo Finance
GET  /api/verdicts                → JWT, all strategy.json verdicts (reasoning truncated to 150)
GET  /api/strategies              → JWT, sorted SELL→CLOSE→REDUCE→HOLD→ADD→BUY
GET  /api/strategies/:ticker      → JWT, full strategy.json for one ticker
POST /api/jobs/trigger            → JWT, rate-limit check, creates job, bridges to data/triggers/
GET  /api/jobs                    → JWT, lists last 50 jobs
GET  /api/jobs/:jobId             → JWT, single job status
GET  /api/conditions              → JWT, runs conditionEngine.runConditionCheck()
POST /api/conditions/catalyst     → JWT, marks a catalyst triggered
POST /api/conditions/deep-dive-complete → JWT
GET  /api/reports/*               → JWT, serves snapshot files
POST /api/telegram/webhook        → no auth, routes incoming Telegram messages
GET  /api/admin/users             → admin-key, lists all users
POST /api/admin/users             → admin-key, creates user + workspace + agent entry
DELETE /api/admin/users/:userId   → admin-key, archives workspace, removes from openclaw.json
PATCH /api/admin/users/:userId/limits → admin-key, updates rate limits in profile.json
POST /api/admin/users/:userId/telegram → admin-key, updates Telegram config
GET  /api/admin/status            → admin-key, gateway status + user count
```

**Key services:**

`priceService.ts` — yahoo-finance2 v3 (`const yf = new YahooFinance()`).
- 5-minute price cache. USD/ILS rate via `https://api.frankfurter.app/latest?from=USD&to=ILS`,
  1-hour cache, fallback 3.7. Candlestick data via `yf.chart()`.
- CRITICAL: Yahoo Finance returns TASE prices in AGOROT (1/100 shekel).
  `priceService.ts` divides by 100. `portfolio.json` stores `unitAvgBuyPrice` for TASE
  positions in ILA (agorot), USD for US stocks.

`agentService.ts` — manages `~/.openclaw/openclaw.json`. Supports JSON5 `//` comments
(stripped before parse). Structure: `agents.list[]`, `channels.telegram.accounts{}`,
`channels.telegram.bindings[]`. After any write: `openclaw gateway restart`.

`workspaceService.ts` — `USERS_DIR = process.env.USERS_DIR ?? "../users"` (relative
to `backend/`, so resolves to `~/clawd/users/`). Creates all subdirs, writes initial
`state.json` (UNINITIALIZED), `config.json` (default testing profile), and `USER.md`.

`conditionEngine.ts` — scans all tickers in `tickersDir`, validates each `strategy.json`
against Zod schema. Escalation triggers:
1. Any `catalyst.expiresAt` is in the past (not triggered)
2. HOLD verdict with no future-dated catalyst → rules violation
3. `lastDeepDiveAt` null OR >30 days ago AND `confidence === "low"`
4. Ticker already in `pendingDeepDives`
Sorts by urgency: `catalyst_expired → hold_no_catalyst → stale_low_confidence → pending_deep_dive`

`jobService.ts` — `generateJobId()` format: `job_YYYYMMDD_HHMMSS_xxxxxx`.
Creates two files per job: `data/jobs/[id].json` (status tracking) + `data/triggers/[id].json`
(pickup by agent). The `jobs.ts` route ALSO copies the trigger to `~/clawd/data/triggers/`
(legacy bridge for the main agent path).

**Rate limits (defaults, stored per-user in `profile.json`):**
```
full_report:  1 per 168h (weekly)
daily_brief:  3 per 24h
deep_dive:    5 per 24h
new_ideas:    2 per 168h (weekly)
```
`switch_production` / `switch_testing` are exempt from rate limiting.

**Model profiles (`data/config.json`):**
```
testing:    orchestrator=deepseek-v3, analysts=gemini-flash-lite, researchers=deepseek-v3
production: orchestrator=claude-opus, analysts=claude-sonnet, researchers=claude-opus
```

### 3. Frontend — `frontend/src/`

**Stack:** React 18, Vite, Tailwind v4 (`@tailwindcss/vite` plugin — NOT postcss,
`@source` directive required), React Query, React Router v6, Zustand, axios, lucide-react.

**Pages:**
- `Login` — username + password → POST /api/auth/login → JWT stored in zustand+localStorage
- `Onboarding` — 5-step wizard: Step 1 admin-key+credentials, Step 2 display name+schedule,
  Step 3 portfolio entry (accounts with positions), Step 4 Telegram (optional), Step 5 confirm
- `Portfolio` — live prices, P/L per position, SummaryStrip, PositionDetailModal, StrategyModal
- `Alerts` — condition escalation report
- `Strategies` — all verdicts sorted by urgency (SELL first)
- `Reports` — batch report snapshots
- `Controls` — job trigger cards (daily brief, full report, deep dive, new ideas,
  switch testing/production) + active jobs + recent history
- `Settings` — password change, schedule, Telegram connect, rate limits display,
  theme (dark/middle/bright), language (en/he), link to Controls
- `Admin` — user management (create, delete, update limits/Telegram)

**State management:**
- `authStore` (zustand+persist): `token`, `userId`, `isAuthenticated`, `login()`, `logout()`
- `toastStore` (zustand): `show(message, type)` → `ToastContainer` renders in App
- `preferencesStore` (zustand+persist): `theme`, `language`, applies CSS vars to `:root` on change

**API client (`api/client.ts`):** axios, `baseURL: "/api"`, JWT injected from localStorage
`auth-storage` key. 401 → clears storage + redirects to `/login`.

**Route guards:**
- `ProtectedRoute` — checks `isAuthenticated`, fetches onboard status, redirects to
  `/onboarding` if `!portfolioLoaded`
- `OnboardingRoute` — if `portfolioLoaded` is already true, redirects to `/portfolio`

**Key utilities (`utils/format.ts`):**
- `formatILS(n)` — formats with ₪ prefix, K/M abbreviations
- `formatPct(n)` — with leading + for positives
- `plColor(n)` — CSS class: green/red/muted
- `timeAgo(iso)` — "just now / Xm ago / Xh ago / Xd ago"

**CSS custom properties (set by `preferencesStore`):**
`--color-bg-base`, `--color-bg-subtle`, `--color-bg-muted`, `--color-border`,
`--color-fg-default`, `--color-fg-muted`, `--color-fg-subtle`,
`--color-accent-blue`, `--color-accent-green`, `--color-accent-red`

---

## Critical domain rules — never violate these

### TASE pricing
Yahoo Finance returns TASE stock prices in **agorot** (1/100 shekel = 1 ILA).
`priceService.ts` divides raw price by 100 to get ILS.
`portfolio.json` stores `unitAvgBuyPrice` in **ILA** for TASE, **USD** for US stocks.
When computing avgPriceILS for a TASE position: the ILA value IS the ILS value (already
divided by 100 during price fetch — the portfolio route uses `pos.unitAvgBuyPrice` directly
for TASE). For non-TASE: multiply by usdIlsRate.
NEVER use avgPrice as current value — always fetch live price.

### Strategy schema (source of truth: `backend/src/schemas/strategy.ts`)
```typescript
ticker:            /^[A-Z0-9]{1,10}$/
updatedAt:         datetime string
version:           int >= 1
verdict:           "BUY" | "ADD" | "HOLD" | "REDUCE" | "SELL" | "CLOSE"
confidence:        "high" | "medium" | "low"
reasoning:         string (max 800 chars)
timeframe:         "week" | "months" | "long_term" | "undefined"
positionSizeILS:   number
positionWeightPct: number
entryConditions:   string[] (max 5, each max 200 chars)
exitConditions:    string[] (max 5, each max 200 chars)
catalysts:         Array<{ description: string (max 300), expiresAt: datetime|null, triggered: boolean }>
bullCase:          string (max 600) | null
bearCase:          string (max 600) | null
lastDeepDiveAt:    datetime | null
deepDiveTriggeredBy: string | null
```

### Portfolio schema (source of truth: `backend/src/schemas/portfolio.ts`)
```typescript
// portfolio.json
meta: { currency: "ILS", transactionFeeILS: number, note: string }
accounts: Record<accountName, PositionEntry[]>
// PositionEntry
ticker: /^[A-Z0-9]{1,10}$/
exchange: "TASE" | "NYSE" | "NASDAQ" | "LSE" | "XETRA" | "EURONEXT" | "OTHER"
shares: positive int
unitAvgBuyPrice: positive number  ← ILA for TASE, USD for US
unitCurrency: "USD" | "ILA" | "GBP" | "EUR"
```

### Agent hard rules (SOUL.md)
1. Position down >30% with no near-term catalyst → SELL or CLOSE. Never HOLD.
2. Position up >100% → explicit take-profit plan in exitConditions. Never plain HOLD.
3. HOLD only valid with a specific dated catalyst in `catalysts[].expiresAt`,
   OR if position is <1% portfolio weight.
4. Portfolio weight = live price × shares ÷ total live value. Never avgPrice.
5. Workspace isolation: agent may ONLY write to `~/clawd/users/[USER_ID]/`.
   Shared read-only: `~/clawd/skills/*.md` and `~/clawd/SOUL.md`.

---

## OpenClaw config — handle with care

File: `~/.openclaw/openclaw.json`
DO NOT edit manually. Use `agentService.ts` functions:
- `addUserAgent(userId, workspace, botToken?, chatId?)`
- `removeUserAgent(userId)`
- `updateUserTelegram(userId, botToken, chatId)`
- `readConfig()` / `writeConfig(config)`

After ANY change to `openclaw.json`: `openclaw gateway restart`
(backend calls `restartGateway()` which runs this via `execSync`)

The file supports JSON5-style `//` comments — `agentService.ts` strips them before parsing.

---

## Deploy

```bash
./deploy.sh
```

Does: `git pull origin main` → `npm ci` + `npm run build` (backend) →
`npm ci` + `npm run build` (frontend) → `systemctl restart clawd-backend` →
health check at `http://localhost:8081/api/health`

After ANY code change, run `./deploy.sh`. It runs as root on the production server.

---

## Environment variables

```
PORT=8081              ← backend listen port
JWT_SECRET             ← JWT signing secret (default "changeme" — must override in prod)
ADMIN_KEY              ← X-Admin-Key for admin routes
USERS_DIR              ← path to users directory (default "../users" relative to backend/)
DATA_DIR               ← path to legacy data dir (default "../data" relative to backend/)
FRONTEND_DIST          ← path to built frontend (default "../frontend/dist")
```

---

## Running locally

```bash
# Backend dev server (TypeScript, no build step)
cd backend && npx tsx src/server.ts

# Frontend dev server (Vite, hot reload on :3000)
cd frontend && npm run dev
```

Frontend dev server proxies `/api` to the backend — check `frontend/vite.config.ts` for
the proxy target. In dev, the backend still needs to be running separately.

Production runs via systemd:
```bash
systemctl status clawd-backend    # check service status
systemctl restart clawd-backend   # restart (also done by deploy.sh)
journalctl -u clawd-backend -f    # follow logs
```

The systemd service runs the compiled backend from `backend/dist/`. Always run `./deploy.sh`
after changes — do not restart the service manually without building first.

---

## Skills — `~/clawd/skills/`

The `skills/` directory contains two things: **analyst skill files** (read by the agent
during analysis) and an **installed skill** (self-improving-agent).

### Analyst skill files

These are the sub-agent prompt files injected inline when the orchestrator dispatches an
analyst. All output JSON only — no markdown. Each skill validates its output with Python
before confirming.

| File | Role | Output | Confirmation signal |
|------|------|--------|---------------------|
| `fundamentals-analyst.md` | Financial health, valuation, earnings, analyst consensus | `reports/[TICKER]/fundamentals.json` | `FUNDAMENTALS_DONE — [TICKER]` |
| `technical-analyst.md` | Price action, MAs, RSI, MACD, support/resistance | `reports/[TICKER]/technical.json` | `TECHNICAL_DONE — [TICKER]` |
| `sentiment-analyst.md` | Analyst upgrades/downgrades, insider trades, major news, short interest | `reports/[TICKER]/sentiment.json` | `SENTIMENT_DONE — [TICKER]` |
| `macro-analyst.md` | Rates (Fed/BoI/ECB), sector performance, USD/ILS, geopolitical risk | `reports/[TICKER]/macro.json` | `MACRO_DONE — [TICKER]` |
| `portfolio-risk.md` | Position sizing, P/L, portfolio weight, concentration flag | `reports/[TICKER]/risk.json` | `RISK_DONE — [TICKER]` |
| `bull-researcher.md` | Best bull case citing actual analyst data (2 rounds) | `reports/[TICKER]/bull_case.json` | `BULL_DONE — [TICKER] Round [N]` |
| `bear-researcher.md` | Best bear case citing actual analyst data (2 rounds) | `reports/[TICKER]/bear_case.json` | `BEAR_DONE — [TICKER] Round [N]` |
| `user-profile-template.md` | Template for new user `USER.md` files | written to `users/[userId]/USER.md` | — |

**Bull/Bear debate flow (Mode 2 and 4):**
1. Bull Round 1 → Bear Round 1 → Bull Round 2 (rebuts bear's `coreConcern`) →
   Bear Round 2 (rebuts bull's `coreThesis`) → Fund Manager synthesizes verdict

**All analysts:**
- Must cite real URLs in `sources[]` — empty array if none found
- Must include every field — `null` for unknown numbers, `"unknown"` for unknown enums
- After writing: validate with `python3 -c "import sys,json; json.load(sys.stdin); print('VALID JSON')"` — retry once if invalid
- Write path: `~/clawd/users/[USER_ID]/data/reports/[TICKER]/[analyst].json`

**Key JSON schemas per analyst:**

`fundamentals.json` — `earnings{result,epsActual,...}`, `revenueGrowthYoY`,
`marginTrend`, `guidance`, `valuation{pe,sectorAvgPe,assessment}`,
`analystConsensus{buy,hold,sell,avgTargetPrice,currency}`, `balanceSheet`,
`insiderActivity`, `fundamentalView` (max 600 chars), `sources[]`

`technical.json` — `price{current,week52High,week52Low,positionInRange}`,
`movingAverages{ma50,ma200,priceVsMa50,priceVsMa200}`, `rsi{value,signal}`,
`macd`, `volume`, `keyLevels{support,resistance}`, `pattern` (max 200 chars),
`technicalView` (max 600 chars), `sources[]`

`sentiment.json` — `analystActions[]`, `insiderTransactions[]`, `majorNews[]`,
`shortInterest`, `narrativeShift`, `sentimentView` (max 600 chars), `sources[]`

`macro.json` — `rateEnvironment{relevantBank,currentRate,direction,relevance}`,
`sectorPerformance{sectorName,performanceVsMarket30d,trend}`,
`currency{usdIls,trend,impactOnPosition}`,
`geopolitical{relevantFactor,riskLevel}`, `marketRegime`, `macroView` (max 600 chars), `sources[]`

`risk.json` — `livePrice`, `livePriceCurrency`, `shares{main,second,total}`,
`positionValueILS`, `portfolioWeightPct`, `plILS`, `plPct`, `avgPricePaid`,
`concentrationFlag` (true if weight >10%), `riskFacts` (max 400 chars)
TASE note: `avgPricePaid` in ILA (agorot), not ILS.

`bull_case.json` / `bear_case.json` — `round` (1 or 2), `coreThesis`/`coreConcern`
(max 300 chars), `arguments[]` (3-5, each with `source`, `claim`, `dataPoint`),
`responseToBear`/`responseToBull` (null in Round 1, rebuttal in Round 2),
`bullVerdict`/`bearVerdict`, `conditionToBeWrong` (max 200 chars)

`user-profile-template.md` — YAML-style template for `USER.md`. Contains:
`riskTolerance`, `maxSinglePositionPct` (default 15%), `stopLossThresholdPct` (default 25%),
`preferredHoldingPeriod`, `primaryCurrency`, `accounts`, `timezone`, `alertStyle`,
`language`, `telegramActive`, free-text `notes`. Placeholders `[DISPLAY_NAME]` and
`[DATE]` are replaced by `workspaceService.ts` during workspace creation.

### self-improving-agent skill (installed via ClawdHub)

**Location:** `skills/self-improving-agent/`
**Version:** 3.0.10 (from `_meta.json`)
**Purpose:** Continuous improvement loop — captures errors, corrections, and feature
requests into structured markdown logs, then promotes durable learnings to `CLAUDE.md`,
`SOUL.md`, `AGENTS.md`, or `TOOLS.md`.

**Log files** (kept at `.learnings/` in workspace root):
- `LEARNINGS.md` — corrections, knowledge gaps, best practices (`LRN-YYYYMMDD-XXX`)
- `ERRORS.md` — command failures, API errors (`ERR-YYYYMMDD-XXX`)
- `FEATURE_REQUESTS.md` — user-requested capabilities (`FEAT-YYYYMMDD-XXX`)

**When to log:**
- User corrects you ("no, that's wrong") → `LEARNINGS.md` category `correction`
- Command/tool fails unexpectedly → `ERRORS.md`
- User requests a missing capability → `FEATURE_REQUESTS.md`
- You discover a better approach → `LEARNINGS.md` category `best_practice`

**Promotion targets** (when a learning is broadly applicable):

| Target | What goes there |
|--------|----------------|
| `CLAUDE.md` | Project facts, conventions, gotchas for all Claude sessions |
| `SOUL.md` | Agent behavioral patterns and principles |
| `AGENTS.md` | Workflow improvements, agent dispatch patterns |
| `TOOLS.md` | Tool gotchas, integration quirks |

**Promote a learning when:** `Recurrence-Count >= 3`, seen across 2+ tasks,
within a 30-day window.

**Hook integration (opt-in):**
`UserPromptSubmit` hook via `scripts/activator.sh` — injects a learning-evaluation
reminder after each prompt (~50-100 token overhead).
`PostToolUse` hook via `scripts/error-detector.sh` — triggers on Bash command errors.
Enable with `openclaw hooks enable self-improvement`.

---

## What NOT to touch

- `~/.openclaw/openclaw.json` — use `agentService.ts`, never edit directly
- `users/` directories — live user runtime data, never commit
- `data/portfolio.json` — real portfolio, handle carefully
- `SOUL.md`, `AGENTS.md`, `HEARTBEAT.md` — agent instructions, read-only unless authorized
- `deploy.sh` — runs as root, think before modifying

---

## Zod schemas — source of truth

All data shapes are defined in `backend/src/schemas/`:
- `strategy.ts` → `StrategySchema`, `StrategyCatalystSchema`
- `portfolio.ts` → `PortfolioFileSchema`, `PortfolioPositionSchema`, `PortfolioStateSchema`
- `job.ts` → `JobSchema`
- `onboarding.ts` → `OnboardInitSchema`, `ProfileSchema`, `ScheduleSchema`
- `analysts.ts` → analyst output schemas

`backend/src/types/index.ts` — shared TypeScript types (Verdict, Exchange, JobAction, etc.)
`frontend/src/types/api.ts` — frontend mirror of API response shapes

---

## Work in progress / known gaps

The following items are genuinely incomplete as of the last known state:

1. **Onboarding flow for already-authenticated users** — the 5-step wizard in `Onboarding.tsx`
   exists but the flow for a user who is already logged in and returning mid-onboarding
   may not handle all edge cases cleanly.

2. **Portfolio position add/edit UI** — `Portfolio.tsx` has a `+ Add Position` button
   with a `TODO` comment. The PATCH `/api/position/:ticker` backend route exists but
   the frontend modal/flow to add new positions or edit existing ones is not built.

Items that appear incomplete per older notes but are ALREADY implemented:
- yahoo-finance2 v3 instantiation → `priceService.ts:8` has `const yf = new YahooFinance()`
- Rate limit enforcement → fully implemented in `checkRateLimit()` in `routes/jobs.ts`
- Trigger bridge (Fix 5) → implemented in `routes/jobs.ts:129-140`
- Settings page → fully built in `pages/Settings.tsx`
