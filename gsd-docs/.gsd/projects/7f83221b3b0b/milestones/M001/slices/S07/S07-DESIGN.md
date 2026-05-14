# S07 Design — Pilot Operational Visibility

This design focuses on the highest-risk, highest-novelty piece (read-only user impersonation) and on the integration points that affect existing routes. The non-impersonation observability work (failure rollups, chat behavior surface) is mostly UI assembly over existing data and is sketched at the end.

## 1. Read-only user impersonation

### 1.1 Threat model

Assets to protect:
- User chat content, portfolio holdings, strategy text, USER.md (sensitive personal/financial data).
- User account integrity (no admin-triggered writes that look like the user did them).
- System integrity (impersonation token cannot be re-used or forged).

Threats:
- T1: Stolen `ADMIN_KEY` granting unbounded impersonation.
- T2: Stolen impersonation JWT replayed after admin closes the session.
- T3: Confused-deputy attack where a route reads `res.locals.userId` (target) but a write also reads it and acts on the target's behalf.
- T4: Impersonation token leaked via browser history / referer / shared screenshot.
- T5: Admin uses impersonation routinely instead of as a debug/support tool, making audit log noisy.

Mitigations:
- M1: Tokens are short-lived (15 min hard cap, no refresh), revocable server-side, scoped to one target user, and bound to a specific impersonator ID derived from the request that minted them.
- M2: Server-side allowlist table `impersonation_sessions` with `revoked_at` column. Middleware checks the row exists and is not revoked. Logout/exit endpoint revokes immediately.
- M3: A single new middleware `readOnlyGuard` runs AFTER `authMiddleware` + `userIsolationMiddleware`. If `res.locals.readOnly` is true and the request method is not GET, return 403 `readonly_impersonation`. This is the only enforcement seam — there is no per-route opt-out.
- M4: Token only ever sent via `Authorization: Bearer …` header. Frontend never puts it in URL. Exit button + auto-expiry banner.
- M5: Max 3 concurrent active sessions per admin and a daily soft cap (logged but not blocked) plus banner timer. Audit log entry per issuance and per blocked write attempt.

### 1.2 Token shape

JWT signed with the same `JWT_SECRET` as user tokens, but with extra claims:

```jsonc
{
  "userId": "user_target_abc",       // target user — same field name so userIsolation works unchanged
  "tokenVersion": 0,                 // ignored for impersonation tokens (see auth note)
  "impersonatorId": "admin",         // admin identity — currently single "admin"; future-proof for support staff
  "sessionId": "imp_session_xyz",    // FK to impersonation_sessions row
  "readOnly": true,                  // read-only flag
  "iat": 1234567890,
  "exp": 1234568790                  // 15 minutes from iat
}
```

`userId` is the target user so existing `authMiddleware` and `userIsolationMiddleware` work unchanged — they build the workspace and set `res.locals.userId`. The new middleware adds `impersonatorId`, `sessionId`, `readOnly` to `res.locals` and validates against the DB row.

### 1.3 New table

```sql
CREATE TABLE impersonation_sessions (
  id              VARCHAR(64) PRIMARY KEY,         -- "imp_session_<random>"
  impersonator_id VARCHAR(64) NOT NULL,            -- "admin" today
  target_user_id  VARCHAR(64) NOT NULL,
  reason          VARCHAR(512),                    -- optional free-text, may be null
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,            -- issued_at + 15 min
  revoked_at      TIMESTAMPTZ,                     -- null = active
  revoked_reason  VARCHAR(64),                     -- "exit_clicked", "expired", "admin_override", "max_sessions"
  last_used_at    TIMESTAMPTZ,
  user_agent      VARCHAR(256),                    -- truncated UA from issuance request
  ip_hash         VARCHAR(64)                      -- SHA-256 of issuing IP
);

CREATE INDEX idx_imp_sessions_active ON impersonation_sessions (impersonator_id, revoked_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_imp_sessions_expiry ON impersonation_sessions (expires_at) WHERE revoked_at IS NULL;
```

The session row is the source of truth. The JWT is just a signed pointer to it. If the row is revoked or past `expires_at`, every request fails closed regardless of JWT validity.

### 1.4 New routes

```
POST   /api/admin/impersonation/sessions
  Body: { targetUserId: string, reason?: string }
  Returns: { token: string, sessionId: string, expiresAt: string, targetUserId, impersonatorId }
  Behavior:
    - Verify ADMIN_KEY (existing adminAuth middleware).
    - Verify target user exists in users table.
    - Count active (non-revoked, non-expired) sessions for this impersonator. If >= 3, return 429 too_many_active_sessions.
    - Insert impersonation_sessions row with expires_at = NOW() + 15m.
    - Mint JWT with claims above.
    - Write admin_audit_log entry: action="impersonation.issued", target=targetUserId, sessionId, reason.
    - Return token.

GET    /api/admin/impersonation/sessions
  Returns: { items: ImpersonationSession[] }    // active only by default; ?includeExpired=true for history
  Behavior:
    - List active sessions for the requesting admin.

DELETE /api/admin/impersonation/sessions/:sessionId
  Behavior:
    - Set revoked_at=NOW(), revoked_reason="exit_clicked".
    - Audit log entry "impersonation.revoked".
```

### 1.5 New middleware

```ts
// backend/src/middleware/impersonation.ts

export async function readOnlyGuard(req, res, next) {
  if (res.locals.readOnly !== true) return next();          // not impersonating; no change
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

  // Audit the blocked write attempt
  await writeAdminAuditLog({
    action: "impersonation.blocked_write",
    impersonatorId: res.locals.impersonatorId,
    targetUserId: res.locals.userId,
    sessionId: res.locals.sessionId,
    method,
    path: req.originalUrl,
  });

  res.status(403).json({
    error: "readonly_impersonation",
    message: "Write operations are not allowed during read-only impersonation.",
  });
}
```

Mounted in `app.ts` immediately after `userIsolationMiddleware`:

```ts
app.use("/api", authMiddleware, userIsolationMiddleware, readOnlyGuard);
```

### 1.6 authMiddleware change

Minimal: after JWT verification, if the token has `impersonatorId` and `sessionId`, look up the session row, verify it's active and not expired, and set `res.locals.impersonatorId`, `res.locals.sessionId`, `res.locals.readOnly`. If the row is missing or revoked or expired, return 401 `impersonation_session_invalid`. Skip the per-user `tokenVersion` check (impersonation tokens don't use it — revocation is row-based).

### 1.7 Frontend behavior

- New `/admin/impersonate/:userId` button on each user row in `Admin.tsx`.
- On click: call `POST /api/admin/impersonation/sessions`, store the token in `sessionStorage` under `impersonation_token`, store target user id, expires_at, sessionId.
- A new `useImpersonation` hook exposes the active session and its countdown.
- The API client (`frontend/src/api/client.ts`) checks for an active impersonation token first and uses it as `Authorization: Bearer …` if present, falling back to the normal user JWT.
- A new `<ImpersonationBanner />` component renders globally (sticky top, red background) when an active session exists. Shows: target user display name, countdown timer, "Exit impersonation" button.
- Exit button: call `DELETE /api/admin/impersonation/sessions/:sessionId`, clear sessionStorage, redirect back to admin panel.
- On token expiry: client clears sessionStorage and shows a toast "Impersonation expired."

### 1.8 What the admin sees

After clicking "View as user", the admin's browser opens the regular app routes (`/portfolio`, `/strategies`, `/reports`, `/`, `/chat`, etc.) with the impersonation token as the auth header. Every read works. Every write button still renders (the UI doesn't know it's read-only) but clicking it returns 403 from the backend, surfaced as a toast: "Read-only impersonation: cannot perform this action."

A future polish (deferred from this slice) could disable write buttons when impersonating; for the pilot, the backend 403 + toast is enough.

## 2. Other R014 capabilities (lighter design)

These are smaller, mostly admin-UI assembly work over existing data.

### 2.1 Pilot readiness card per user
- New endpoint: `GET /api/admin/users/:userId/readiness`
- Returns aggregated: state (BOOTSTRAPPING/ACTIVE/SUSPENDED), baseline coverage summary, last daily-brief timestamp, last successful Telegram delivery timestamp, points balance, points exhausted flag, model tier, has-active-jobs, has-failed-jobs-24h.
- UI: render as a dense card in the user detail page in `Admin.tsx`.

### 2.2 Notification delivery failure surface
- New endpoint: `GET /api/admin/notifications/failures?userId=&since=`
- Reads from existing notification outbox / channel records where `delivery_status` is in (`failed`, `partial`).
- Returns: notification ID, kind, target channel, failure code, attempted_at, last_error message (bounded).
- UI: "Failures" tab in user detail.

### 2.3 Chat behavior surface
- Existing `GET /api/admin/conversations` already returns metadata. Extend with optional `?include=output_filter_events` to join the substitution events for the conversation.
- New endpoint: `GET /api/admin/output-filter-events?userId=&since=` — last N substitutions across that user's conversations.
- UI: "Chat behavior" tab showing redirect/strip events with bounded conversation/turn IDs and pattern label.

### 2.4 Job failure rollup
- New endpoint: `GET /api/admin/users/:userId/job-failures?windowHours=24`
- Returns counts by action and by error class plus the most recent 5 failure messages.
- UI: included in the readiness card.

### 2.5 Budget/cost rollup per user
- Existing `GET /api/admin/observability/users/:userId` already covers this.
- UI work only: surface remaining points + budget config in the readiness card.

### 2.6 Admin audit log read endpoint
- New endpoint: `GET /api/admin/audit?since=&action=&impersonatorId=&targetUserId=`
- Reads `admin_audit_log` table.
- UI: a new "Audit" page in admin panel.
- Critical because every impersonation issuance and every blocked write writes here.

## 3. Failure modes and how they surface

| Failure | Behavior |
|---|---|
| Admin issues impersonation token but DB unreachable | 503 `database_unavailable` from issuance endpoint; no token minted |
| Admin opens user app with expired token | 401 `impersonation_session_invalid` from any API call; client clears sessionStorage and toasts "Impersonation expired" |
| Admin tries to write while impersonating | 403 `readonly_impersonation` per request, audited in admin_audit_log |
| Admin exceeds 3 active sessions | 429 `too_many_active_sessions` with the active session list in the body so the admin can revoke one |
| Token forged with wrong signature | 401 `unauthorized` (existing JWT verification fails) |
| Token replay after revoke | 401 `impersonation_session_invalid` (row is revoked) |
| Target user deleted mid-session | 404 `user_workspace_not_found` from userIsolationMiddleware (existing behavior) |

## 4. Verification plan

- Unit: `readOnlyGuard` middleware blocks writes, allows reads, audits blocked attempts.
- Unit: token issuance respects max-active and revoke semantics.
- Route tests: `chat.savedChats.test.ts`-style tests for the impersonation routes covering issuance, listing, revocation, expired/revoked rejection, max-sessions limit.
- Integration: a single end-to-end test that mints a token, calls `GET /api/portfolio` successfully under it, calls `POST /api/jobs/trigger` and asserts 403 + audit row, calls `DELETE` to revoke, calls `GET` again and asserts 401.
- Static verifier (new): `scripts/verify-impersonation-policy.mjs` — confirms `readOnlyGuard` is wired in `app.ts` after `userIsolationMiddleware`, asserts no admin-impersonation route bypass, confirms the audit log writes exist in source.
- Build/lint: backend build + frontend lint + frontend build.

## 5. Out of scope for S07

- Disabling write buttons in the user-facing UI when impersonation is active (visual polish; a 403+toast is enough for pilot).
- Multi-admin support (today there is one admin identity; the design is forward-compatible).
- Auto-revoking sessions on suspicious activity (anomaly detection).
- IP-pinning the token (would need correct trust-proxy plumbing first).
- Replaying user-side WebSocket / streaming events to the impersonator (none exist yet).
