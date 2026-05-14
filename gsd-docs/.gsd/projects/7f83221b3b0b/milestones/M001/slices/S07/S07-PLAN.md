# S07: Pilot Operational Visibility

**Goal:** Give the operator enough visibility, audit trail, and safe debugging tools to confidently run a 10-user pilot — including the ability to view the live app exactly as a target user sees it, in a hard read-only impersonation mode that is short-lived, server-revocable, and fully audited.

**Demo:** From the admin panel, the operator can:
1. Pick a user and click "View as user" to open the user's Portfolio, Strategies, Reports, Today, Notifications, and Chat exactly as that user sees them, with a sticky red banner showing the target and a 15-minute countdown.
2. Confirm that every write button (trigger job, send chat, mark notification read, edit position) returns 403 and is recorded in the admin audit log.
3. Open a per-user readiness card showing baseline coverage, last daily brief, Telegram delivery health, points balance, and 24-hour job failure summary.
4. Open a chat behavior view showing recent output-filter substitutions and tool-call audit rows.
5. Open the admin audit log and see every impersonation issuance, every blocked write, and every admin mutation.

## Must-Haves

- **R014** is advanced by:
  - A read-only impersonation system: server-stamped 15-minute JWT, DB-backed `impersonation_sessions` table, single `readOnlyGuard` middleware that blocks every non-GET request, max 3 concurrent sessions per admin, every issuance and every blocked write logged to `admin_audit_log`.
  - A "View as user" admin UI: button per user, sticky red banner with target name and countdown, exit button, separate sessionStorage slot so it never replaces the admin's normal session.
  - Per-user readiness card aggregating state, baseline coverage, last brief, Telegram delivery health, points balance, model tier, 24-hour job failure rollup.
  - Notification delivery failure list per user.
  - Chat behavior surface: output-filter substitutions and tool-call audit rows per user, joinable to conversations.
  - Admin audit log read endpoint and admin UI tab.

- Verification passes: new impersonation route tests, `readOnlyGuard` middleware unit tests, an integration test that mints → reads → blocks-write → revokes, a new static verifier `scripts/verify-impersonation-policy.mjs`, backend build, frontend lint and build.

## Proof Level

- This slice proves: integration + new security primitive (read-only impersonation).
- Real runtime required: no for automated proof — backend route tests + middleware unit tests + static verifier are sufficient.
- Human/UAT required: yes, light. The operator should manually click through "View as user" once before pilot launch and confirm the banner, countdown, and exit work. Captured by S08 rehearsal.

## Integration Closure

Upstream surfaces consumed:
- S01 admin route + auth pattern (`adminAuth` X-Admin-Key middleware).
- S03 notification outbox and channel delivery records.
- S05 `output_filter_events`, `tool_calls` tables.
- Existing `authMiddleware`, `userIsolationMiddleware`, `admin_audit_log` table.
- Existing user-facing routes — no per-route changes needed; the new `readOnlyGuard` middleware is a single seam.

New wiring:
- New `impersonation_sessions` Postgres table.
- New `backend/src/middleware/impersonation.ts` (`readOnlyGuard`).
- New `backend/src/services/impersonationService.ts` (issue, list, revoke, validate).
- New `backend/src/routes/adminImpersonation.ts` (POST/GET/DELETE).
- Extended `authMiddleware` to recognize and validate impersonation tokens.
- New admin observability endpoints: readiness card, notification failures, output-filter events, audit log.
- Extended `frontend/src/api/client.ts` to send the impersonation token when present.
- New `frontend/src/components/ImpersonationBanner.tsx`.
- New "View as user" button + handlers in `Admin.tsx`.
- New `scripts/verify-impersonation-policy.mjs`.

What remains for the milestone after S07: S08 end-to-end pilot rehearsal.

## Verification

- Runtime signals: every impersonation issuance, expiry, revocation, and blocked write writes a row to `admin_audit_log`. Bounded fields only — no message content, no token value, no PII.
- Inspection surfaces: `GET /api/admin/audit` lists events; `GET /api/admin/impersonation/sessions` lists active sessions per admin.
- Failure visibility: API responses use stable error codes — `readonly_impersonation` (403), `impersonation_session_invalid` (401), `too_many_active_sessions` (429), `database_unavailable` (503).
- Redaction constraints: never log JWTs, never log message text, never log full IPs (hashed only), never log full user agents (truncated).

## Tasks

- [ ] **T01: Add `impersonation_sessions` table and impersonation service** `est:2h`
  Executor skills: `tdd`, `database-design`, `verify-before-complete`.
  - Files: `db/application_postgres.sql`, `backend/src/db/entities/ImpersonationSessionEntity.ts`, `backend/src/services/impersonationService.ts`, `backend/src/services/impersonationService.test.ts`
  - Service contracts: `issueSession({ impersonatorId, targetUserId, reason }) → { sessionId, token, expiresAt }`; `validateSession(sessionId) → { active, row } | { invalid, reason }`; `listActiveSessions(impersonatorId)`; `revokeSession(sessionId, reason)`.
  - Tests: max-3 concurrent enforcement, expired-row rejection, revoked-row rejection, listActiveSessions filtering, audit log write side effects.
  - Verify: `npm --prefix backend test -- src/services/impersonationService.test.ts`

- [ ] **T02: Add `readOnlyGuard` middleware and extend `authMiddleware`** `est:2h`
  Executor skills: `security-review`, `tdd`, `verify-before-complete`.
  - Files: `backend/src/middleware/impersonation.ts`, `backend/src/middleware/auth.ts`, `backend/src/app.ts`, `backend/src/middleware/impersonation.test.ts`
  - Behavior: extend `authMiddleware` to populate `res.locals.impersonatorId`, `res.locals.sessionId`, `res.locals.readOnly` when JWT carries impersonation claims and the session row is active. `readOnlyGuard` returns 403 + audit log on any non-GET when `readOnly` is true. Mount after `userIsolationMiddleware` in `app.ts`.
  - Tests: GET passes through; POST/PATCH/PUT/DELETE return 403 + audit row; expired session returns 401; revoked session returns 401; non-impersonation tokens are unaffected.
  - Verify: `npm --prefix backend test -- src/middleware/impersonation.test.ts`

- [ ] **T03: Add admin impersonation routes** `est:2h`
  Executor skills: `api-design`, `tdd`, `security-review`, `verify-before-complete`.
  - Files: `backend/src/routes/adminImpersonation.ts`, `backend/src/routes/admin.ts` (mount), `backend/src/routes/adminImpersonation.test.ts`
  - Routes: `POST /api/admin/impersonation/sessions`, `GET /api/admin/impersonation/sessions`, `DELETE /api/admin/impersonation/sessions/:sessionId`. All gated by existing `adminAuth`.
  - Tests: issuance success returns token + 201; missing target user → 404; max sessions → 429 with active list; revoke success; revoke unknown id → 404; list returns only active by default.
  - Verify: `npm --prefix backend test -- src/routes/adminImpersonation.test.ts`

- [ ] **T04: Add admin readiness, notification-failure, chat-behavior, and audit-log endpoints** `est:2h`
  Executor skills: `api-design`, `verify-before-complete`.
  - Files: `backend/src/routes/admin.ts`, `backend/src/services/adminReadinessService.ts`, `backend/src/services/adminAuditLogStore.ts`, `backend/src/routes/admin.observability.test.ts`
  - Routes:
    - `GET /api/admin/users/:userId/readiness`
    - `GET /api/admin/notifications/failures?userId=&since=`
    - `GET /api/admin/output-filter-events?userId=&since=&limit=`
    - `GET /api/admin/audit?since=&action=&impersonatorId=&targetUserId=&limit=`
    - Extend `GET /api/admin/conversations` to optionally include filter events.
    - `GET /api/admin/users/:userId/job-failures?windowHours=24`
  - Tests: bounded responses, redaction (no message bodies, hashed IPs only), pagination semantics.
  - Verify: `npm --prefix backend test -- src/routes/admin.observability.test.ts`

- [ ] **T05: Frontend "View as user" + impersonation banner + audit/readiness UI** `est:3h`
  Executor skills: `react-best-practices`, `frontend-design`, `accessibility`, `security-review`, `verify-before-complete`.
  - Files: `frontend/src/api/client.ts`, `frontend/src/api/admin.ts`, `frontend/src/components/ImpersonationBanner.tsx`, `frontend/src/store/impersonationStore.ts`, `frontend/src/pages/Admin.tsx`, `frontend/src/App.tsx`
  - Behavior:
    - API client prefers impersonation token from sessionStorage when present.
    - `<ImpersonationBanner>` mounted globally in `App.tsx`; visible only when an active session exists; shows target user, countdown, exit button.
    - "View as user" button on each row in admin user list calls `POST /api/admin/impersonation/sessions` and opens `/portfolio` (or `/`) in the same tab with the new token active.
    - Read-only failures (403 `readonly_impersonation`) surface as a non-blocking toast "Read-only impersonation: cannot perform this action."
    - New "Audit Log" tab in `Admin.tsx`.
    - New "Readiness" card in user detail.
  - Verify: `node scripts/verify-impersonation-policy.mjs && npm --prefix frontend run lint && npm --prefix frontend run build`

- [ ] **T06: Static verifier and end-to-end integration test** `est:1h`
  Executor skills: `verify-before-complete`.
  - Files: `scripts/verify-impersonation-policy.mjs`, `backend/src/routes/impersonation.integration.test.ts`
  - Static checks:
    1. `readOnlyGuard` is wired in `app.ts` immediately after `userIsolationMiddleware`.
    2. `authMiddleware` reads `impersonatorId`/`sessionId`/`readOnly` claims and validates against the session store.
    3. Frontend API client checks `sessionStorage.impersonation_token` before normal JWT.
    4. `ImpersonationBanner` is mounted globally in `App.tsx`.
    5. No admin route bypasses `adminAuth` for impersonation endpoints.
    6. No production code logs JWT values or full user-agent strings.
  - Integration test: mint token → GET /api/portfolio succeeds → POST /api/jobs/trigger returns 403 with audit row → DELETE session → GET /api/portfolio returns 401.
  - Verify: `node scripts/verify-impersonation-policy.mjs && npm --prefix backend test -- src/routes/impersonation.integration.test.ts`

## Files Likely Touched

Backend:
- db/application_postgres.sql
- backend/src/db/entities/ImpersonationSessionEntity.ts
- backend/src/services/impersonationService.ts
- backend/src/services/impersonationService.test.ts
- backend/src/services/adminReadinessService.ts
- backend/src/services/adminAuditLogStore.ts
- backend/src/middleware/auth.ts
- backend/src/middleware/impersonation.ts
- backend/src/middleware/impersonation.test.ts
- backend/src/routes/admin.ts
- backend/src/routes/adminImpersonation.ts
- backend/src/routes/adminImpersonation.test.ts
- backend/src/routes/admin.observability.test.ts
- backend/src/routes/impersonation.integration.test.ts
- backend/src/app.ts

Frontend:
- frontend/src/api/client.ts
- frontend/src/api/admin.ts
- frontend/src/components/ImpersonationBanner.tsx
- frontend/src/store/impersonationStore.ts
- frontend/src/pages/Admin.tsx
- frontend/src/App.tsx

Scripts:
- scripts/verify-impersonation-policy.mjs
