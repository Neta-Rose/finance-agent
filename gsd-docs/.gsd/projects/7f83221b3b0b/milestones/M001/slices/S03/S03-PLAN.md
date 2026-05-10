# S03: Notification Composition + Telegram Delivery

**Goal:** Daily brief, deep-dive, full-report, and market/news notifications are composed through a central semantic notification layer, rendered as clear Web and Telegram messages, and delivered with safe Telegram formatting/splitting plus recorded failure state.
**Demo:** Daily, deep-dive, full-report, and news/report-style notifications render as clear Web + Telegram messages with safe delivery behavior.

## Must-Haves

- R005: Existing daily brief, deep dive, full report, quick-check/new-ideas report-style, and market/news publication paths use a central semantic composer instead of constructing notification title/body strings ad hoc at call sites.
- R006: Web notification records and Telegram message text have clear status titles, restrained markers, useful body text, and an actionable open/read-more cue without exposing raw unbounded strategy/report reasoning.
- R007: Telegram notification delivery uses safe formatting, message splitting below Telegram limits, disabled link previews, and persisted delivery failure details in the notification outbox/database path.
- S02 policy compatibility: Web and Telegram are pilot channels; WhatsApp compatibility code must not be expanded or promoted by this slice.
- Threat Surface — Abuse: backend jobs/feed events can send external Telegram messages; malformed ticker/title/body values, markdown injection, overlong text, and repeated batch publication must be handled while preserving batch idempotency.
- Threat Surface — Data exposure: notifications may include portfolio tickers, verdict summaries, news summaries, and report metadata, but must not include bot tokens, internal paths, prompt/source names, stack traces, raw full strategy reasoning, or unbounded analyst text.
- Threat Surface — Input trust: tickers and summaries can originate from market/news feeds, job artifacts, and LLM/report outputs; renderers must treat them as untrusted text before writing outbox records or sending Telegram messages.
- Requirement Impact — Requirements touched: R003, R005, R006, R007. R003 is a compatibility constraint for neutral copy; R005-R007 are owned acceptance criteria for this slice.
- Requirement Impact — Re-verify: backend notification composer/renderer tests, backend notification publication tests, Telegram delivery failure/splitting tests, S02 pilot surface policy script, backend build, and frontend lint/build if shared notification API types or toast rendering change.
- Requirement Impact — Decisions revisited: D002 and D003 are honored unchanged; D004 is implemented by this slice; D007 means execution should produce a production report and be deploy-ready before advancing.

## Proof Level

- This slice proves: integration-level backend composition and delivery contracts with mocked Telegram transport plus source/build policy verification. Real runtime is not required for task completion, but S08 still must run live Telegram UAT with real credentials. Human/UAT is not required for this slice.

## Integration Closure

Upstream surfaces consumed: existing job/feed publishers in `backend/src/services/dailyBriefService.ts`, `backend/src/services/deepDiveService.ts`, `backend/src/services/fullReportService.ts`, `backend/src/services/quickCheckService.ts`, `backend/src/services/newIdeasService.ts`, and `backend/src/services/feedService.ts`; existing notification outbox/store/API in `backend/src/services/notificationService.ts`, `backend/src/services/notificationStore.ts`, and `backend/src/routes/notifications.ts`; existing Telegram transport in `backend/src/routes/telegram.ts`.

New wiring introduced in this slice: a central semantic composer/renderer module, publication helpers that render per channel before outbox writes, and a shared Telegram delivery helper used by notification delivery and, where practical, Telegram replies.

What remains before the milestone is truly usable end-to-end: S07 operator visibility may add richer admin inspection of delivery failures; S08 must run a real seeded or live Web + Telegram pilot rehearsal with real credentials.

## Verification

- Slice verification commands:
- `npm --prefix backend test -- --test-name-pattern "notification composer|notification service|telegram delivery"`
- `npm --prefix backend run build`
- `node scripts/verify-pilot-surface.mjs`
- `npm --prefix frontend run lint`
- `npm --prefix frontend run build`
- Planned/updated test files:
- `backend/src/services/notificationComposer.test.ts`
- `backend/src/services/notificationService.test.ts`
- `backend/src/services/telegramDelivery.test.ts`
- Observability / Diagnostics:
- Runtime signals: notification publication logs should include semantic kind, category, user id, batch id, channels attempted, delivery outcome, and redacted error reason; Telegram delivery should return structured per-chunk results rather than log-only failure.
- Inspection surfaces: existing `/notifications` API, legacy user outbox JSON while still active, and `notifications_outbox` dual-write path expose delivered/deliveredAt/error/readAt for Web and Telegram records.
- Failure visibility: Telegram target missing, HTTP non-2xx, network errors, and chunk send failures are persisted on notification records with bounded redacted messages and timestamps where delivery succeeds.
- Redaction constraints: never log or persist Telegram bot tokens, full Telegram API URLs containing tokens, raw stack traces, prompt/source internals, or unbounded strategy/report reasoning.

## Tasks

- [x] **T01: Define semantic notification composers and renderer contracts** `est:1.5h`
  ---
  estimated_steps: 5
  estimated_files: 4
  skills_used:
    - api-design
    - tdd
  ---
  Create the central notification composition boundary that turns typed notification events into bounded Web and Telegram render outputs.
  - Files: `backend/src/services/notificationComposer.ts`, `backend/src/services/notificationComposer.test.ts`, `backend/src/services/notificationService.ts`, `backend/src/schemas/notifications.ts`
  - Verify: npm --prefix backend test -- --test-name-pattern "notification composer"

- [x] **T02: Wire backend publishers through the central composer** `est:2h`
  ---
  estimated_steps: 6
  estimated_files: 8
  skills_used:
    - api-design
    - tdd
    - observability
  ---
  Replace scattered backend notification title/body construction with semantic publication calls that render channel-specific Web and Telegram records before persistence/delivery.
  - Files: `backend/src/services/notificationService.ts`, `backend/src/services/notificationService.test.ts`, `backend/src/services/dailyBriefService.ts`, `backend/src/services/deepDiveService.ts`, `backend/src/services/fullReportService.ts`, `backend/src/services/quickCheckService.ts`, `backend/src/services/newIdeasService.ts`, `backend/src/services/feedService.ts`
  - Verify: npm --prefix backend test -- --test-name-pattern "notification service" && node scripts/verify-pilot-surface.mjs

- [x] **T03: Harden Telegram rendering, splitting, and delivery failure recording** `est:2h`
  ---
  estimated_steps: 6
  estimated_files: 7
  skills_used:
    - tdd
    - observability
    - security-review
  ---
  Make Telegram notification delivery safe and diagnosable by using shared formatting/splitting helpers and persisting bounded failure results on notification records.
  - Files: `backend/src/services/telegramDelivery.ts`, `backend/src/services/telegramDelivery.test.ts`, `backend/src/services/notificationService.ts`, `backend/src/services/notificationService.test.ts`, `backend/src/routes/telegram.ts`
  - Verify: npm --prefix backend test -- --test-name-pattern "telegram delivery|notification service" && npm --prefix backend run build

- [x] **T04: Verify pilot notification contracts and frontend compatibility** `est:1h`
  ---
  estimated_steps: 4
  estimated_files: 5
  skills_used:
    - verify-before-complete
    - test
  ---
  Close the slice by running the full planned verification contract and making any minimal compatibility fixes needed for the existing Web notification consumer.
  - Files: `backend/src/services/notificationComposer.test.ts`, `backend/src/services/notificationService.test.ts`, `backend/src/services/telegramDelivery.test.ts`, `frontend/src/api/notifications.ts`, `frontend/src/App.tsx`
  - Verify: npm --prefix backend test -- --test-name-pattern "notification composer|notification service|telegram delivery" && npm --prefix backend run build && node scripts/verify-pilot-surface.mjs && npm --prefix frontend run lint && npm --prefix frontend run build

## Files Likely Touched

- backend/src/services/notificationComposer.ts
- backend/src/services/notificationComposer.test.ts
- backend/src/services/notificationService.ts
- backend/src/schemas/notifications.ts
- backend/src/services/notificationService.test.ts
- backend/src/services/dailyBriefService.ts
- backend/src/services/deepDiveService.ts
- backend/src/services/fullReportService.ts
- backend/src/services/quickCheckService.ts
- backend/src/services/newIdeasService.ts
- backend/src/services/feedService.ts
- backend/src/services/telegramDelivery.ts
- backend/src/services/telegramDelivery.test.ts
- backend/src/routes/telegram.ts
- frontend/src/api/notifications.ts
- frontend/src/App.tsx
