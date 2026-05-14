# S07 Research — Pilot Operational Visibility

## Goal of this doc

Document what already exists in the admin/observability surfaces, what's missing, and how a new "view-as-user" read-only impersonation must integrate without breaking the existing JWT + user-isolation + admin-key model.

## Existing admin surfaces (already built)

### Admin authentication
- Single shared admin key in `process.env.ADMIN_KEY`, sent as `X-Admin-Key` header.
- Mounted as `app.use("/api/admin", adminRoutes)` BEFORE the JWT auth middleware (`app.ts`), so admin routes never go through `authMiddleware` or `userIsolationMiddleware`.
- All admin routes pass through `adminAuth` middleware in `routes/admin.ts`.
- No admin user identity beyond "valid key" — an attacker with the key is indistinguishable from the legitimate operator.

### User read endpoints (admin)
- `GET /api/admin/users` — list users with budget, plan, model tier, status.
- `GET /api/admin/users/:userId/jobs` — full job history for a user.
- `GET /api/admin/observability/users/:userId` — 7-day request history + last 20 LLM requests.
- `GET /api/admin/observability/summary` — today's aggregates across all users.
- `GET /api/admin/observability/range` — arbitrary UTC range aggregates.
- `GET /api/admin/observability/all` — 7-day chart data across users.
- `GET /api/admin/step-queue/jobs` — step-queue job list (with userId filter).
- `GET /api/admin/step-queue/jobs/:jobId` — step lifecycle for a single job.
- `GET /api/admin/step-queue/cost` — per-step cost rollup.
- `GET /api/admin/conversations` — chat conversation observability (C2.4).
- `GET /api/admin/support/messages` — pilot support inbox.
- `GET /api/admin/system` — system-wide control state.
- `GET /api/admin/system-agent` — system agent profile.

### Mutation endpoints (admin)
- `POST /api/admin/users` — create user.
- `DELETE /api/admin/users/:userId` — delete user.
- `PATCH /api/admin/users/:userId/limits` — rate limits.
- `PATCH /api/admin/users/:userId/points-budget` — budget config.
- `POST /api/admin/users/:userId/budget/credit` — grant temporary points.
- `PATCH /api/admin/users/:userId/model-tier` — model tier override.
- `POST /api/admin/users/:userId/telegram` — admin-binds a Telegram channel.
- `PATCH /api/admin/support/messages/:messageId` — update support message status.
- `PATCH /api/admin/pilot-features/:featureId/review` — pilot feature review state.
- `PATCH /api/admin/defaults` — admin defaults.

### Audit
- `admin_audit_log` entity exists (`AdminAuditLogEntity.ts`) but is currently underused.

## User-facing surfaces (that admin would want to "view as user")

Mounted under `app.use("/api", authMiddleware, userIsolationMiddleware)`:
- `GET /api/portfolio` — portfolio with live prices.
- `GET /api/verdicts` — verdict feed.
- `GET /api/jobs`, `GET /api/jobs/:jobId` — job list and detail.
- `GET /api/reports/feed`, `GET /api/reports/batch/:batchId`, etc.
- `GET /api/notifications` — notification feed.
- `GET /api/conditions/*` — conditions check report and pending list.
- `GET /api/strategies/*` — strategy detail and list.
- `GET /api/control` — user control state (mounted at `/api/me/control`).
- `GET /api/balance` — points balance.
- `GET /api/chat/conversations`, `GET /api/chat/conversations/:id` — saved chat list and history.
- `GET /api/analyst-config` — per-user analyst config.

All of these read `userId` from `res.locals["userId"]` and `workspace` from `res.locals["workspace"]`, both set by `authMiddleware` and `userIsolationMiddleware` from the JWT subject.

## Identified gaps for R014 (operability)

### Gap 1 — No way to see a user's actual app
Today an admin can read fragmented data about a user (job list, observability, conversations) but cannot open the user's main pages — Portfolio, Strategies, Reports, Today, Notifications, Chat — to see what the user sees. The closest workaround is logging in as the user, which requires their password and pollutes their session.

### Gap 2 — Notification delivery failure surface
`notification_outbox` and Telegram delivery failures are stored, but no admin endpoint or UI surfaces them. An admin cannot see "did this user get yesterday's daily brief on Telegram and did it succeed?".

### Gap 3 — Chat behavior surface
`output_filter_events` (S05) and `tool_calls` are populated, but admin has no UI to inspect them per user or see redirect/block patterns. The existing `GET /api/admin/conversations` returns metadata only.

### Gap 4 — Job failure aggregation
`GET /api/admin/users/:userId/jobs` returns raw jobs; there's no "failures in last 24h" or "stuck jobs" rollup.

### Gap 5 — Budget/cost state per user is fragmented
Balance, budget config, observability cost, and credits are in separate endpoints. No single readiness card per user.

### Gap 6 — Admin audit log is underused
`admin_audit_log` exists but no consistent write path or read endpoint. For a 10-user pilot we need every admin mutation and every impersonation event recorded.

## Constraints and risks

### Security
- The admin key is the only barrier to impersonation. Leaking it currently grants full admin write access; adding impersonation with a leaked key would let an attacker observe any user.
- Mitigation: standard pilot-grade controls — short token TTL (15 min), max 3 active sessions per admin, every issuance and every blocked-write logged, sticky banner on the frontend.

### Read-only enforcement
- Many user-facing routes do mutations. We need a single middleware seam that recognizes "this request is a readonly impersonation" and refuses POST/PATCH/PUT/DELETE.
- Cleanest seam: a new middleware that runs after `authMiddleware` + `userIsolationMiddleware` and inspects the JWT for an `impersonation` claim. If present and the method is not GET, return 403 `readonly_impersonation`.

### State pollution
- Read calls have observable side effects in some cases: `GET /api/portfolio` triggers price fetches that cost money; `GET /api/conditions/check` runs a condition check. These are not mutations but they consume budget.
- Mitigation: an impersonation token's request must be tagged in event-store logs as `impersonator=<adminId>` so we can distinguish admin-initiated reads from user-initiated reads, and any LLM cost during impersonation should be charged to the admin pool, not the user (or skipped if the call is purely cached).

### Scope creep
- "View as user" sounds simple but really means "every read endpoint accepts an impersonator JWT instead of a user JWT". We need to decide the smallest seam that achieves this without rewriting every route.

## Decisions (locked in via user input)

- **Token model**: server-stamped, short-lived (15 min), audit-logged JWT carrying `impersonatorId` + `targetUserId` + `readOnly: true`. Frontend stores it separately (sessionStorage key like `impersonation_token`).
- **Strictness**: hard read-only — every POST/PATCH/PUT/DELETE blocked. No exceptions. Includes `/api/jobs/trigger`, `/api/portfolio/position*`, `/api/chat/messages`, `/api/chat/conversations` (POST/PATCH/DELETE), `/api/notifications/read`, `/api/onboard/*`, `/api/verdict-actions`, `/api/conditions/*` (the trigger/mark variants), `/api/analyst-config` (PATCH).
- **Lifecycle**: per-impersonator-per-target, max 3 concurrent active sessions per admin, every issuance + every blocked write logged to `admin_audit_log`. Frontend: sticky red banner with target user, countdown, exit button.

## Reusable pieces

- The existing `authMiddleware` already reads a JWT and sets `res.locals.userId`. We extend it to also set `res.locals.impersonatorId` and `res.locals.readOnly` when the JWT carries those claims.
- The existing `userIsolationMiddleware` builds the workspace from `res.locals.userId` — no change needed; it already isolates correctly.
- The existing admin frontend `Admin.tsx` already has user detail views — we add a "View as user" button per user that calls a new admin endpoint, gets the impersonation token, and opens the user app routes with that token in place of the normal JWT.

## Open question for design phase

How to bound LLM/tool cost during impersonation. Initial answer: the new middleware sets `res.locals.impersonationActive = true`, and the chat agent + budget service refuse to perform any spending operations when this flag is set. Since hard-read-only blocks the writes that initiate spend (chat send, job trigger), this is largely covered already, but `GET /api/portfolio` calls live prices. We accept that read-time price fetches are cheap and admin-pool funded; we do not rewrite the price service.
