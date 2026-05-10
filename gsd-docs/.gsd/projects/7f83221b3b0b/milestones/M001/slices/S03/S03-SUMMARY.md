---
id: S03
parent: M001
milestone: M001
provides:
  - Central notification composition API for daily brief, deep dive, full report, quick-check/new-ideas, and market/news events.
  - Safe Web and Telegram rendering contracts for downstream readability work.
  - Persisted notification delivery/failure state for S07 operator visibility.
  - Verified Web + Telegram notification foundation for S08 end-to-end pilot rehearsal.
requires:
  - slice: S02
    provides: Web + Telegram pilot channel policy and nameless copy invariant; S03 verified no WhatsApp/naming regression.
affects:
  - S06 consumes notification composition outputs as readability patterns for report/strategy/Today/scoring surfaces.
  - S07 should inspect the persisted notification delivery/failure state and redacted diagnostics produced by this slice.
  - S08 must run a real Web + Telegram rehearsal using this notification foundation.
key_files:
  - backend/src/services/notificationComposer.ts
  - backend/src/services/notificationComposer.test.ts
  - backend/src/services/notificationService.ts
  - backend/src/services/notificationService.test.ts
  - backend/src/services/telegramDelivery.ts
  - backend/src/services/telegramDelivery.test.ts
  - backend/src/services/dailyBriefService.ts
  - backend/src/services/deepDiveService.ts
  - backend/src/services/fullReportService.ts
  - backend/src/services/quickCheckService.ts
  - backend/src/services/newIdeasService.ts
  - backend/src/services/feedService.ts
  - backend/src/services/stepQueue/completionEffects.ts
  - backend/src/routes/telegram.ts
  - .gsd/PROJECT.md
  - /root/codex/production-reports/20260510T000000Z-s03-notification-composition-telegram-delivery.md
key_decisions:
  - Use a central semantic notification composer/service boundary instead of publisher-owned notification strings.
  - Render Telegram notifications and webhook replies as plain text with no Markdown/HTML parse mode.
  - Disable Telegram link previews for notification delivery.
  - Bound Telegram fan-out to safe chunks and persist bounded redacted failure details on notification records.
patterns_established:
  - Notification publishers send semantic domain event fields (`kind`, headline/summary/reasoning/action metadata); `notificationService` handles rendering, category mapping, idempotency, channel persistence, and redacted diagnostics.
  - Untrusted notification text from feeds, reports, and LLM outputs is normalized and bounded before Web/outbox persistence or Telegram delivery.
  - Telegram delivery returns structured per-chunk results and persists record-level delivery state instead of relying on logs alone.
observability_surfaces:
  - Notification records expose channel delivery/read/error fields including delivered state, delivered timestamp, and bounded delivery errors.
  - Publication/delivery logs include semantic kind/category/user/batch/channel outcome context while avoiding raw bodies and secrets.
  - Source/build/test contracts verify Telegram formatting safety, chunk failure behavior, and Web notification compatibility.
drill_down_paths:
  - .gsd/milestones/M001/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M001/slices/S03/tasks/T03-SUMMARY.md
  - .gsd/milestones/M001/slices/S03/tasks/T04-SUMMARY.md
  - .gsd/exec/d8e857f6-9849-426c-95de-b822cee69fcf.stdout
  - .gsd/exec/b77dc94f-f252-45d9-b007-132eb19487f9.stdout
duration: ""
verification_result: passed
completed_at: 2026-05-10T12:07:47.106Z
blocker_discovered: false
---

# S03: Notification Composition + Telegram Delivery

**S03 centralized pilot notification composition and hardened Web + Telegram rendering/delivery for daily brief, deep-dive, full-report, quick-check/new-ideas, and market/news notifications.**

## What Happened

S03 delivered the central semantic notification layer promised by the roadmap. `backend/src/services/notificationComposer.ts` now converts typed domain events (`daily_brief`, `deep_dive`, `full_report`, `quick_check`, `new_ideas`, and `market_news`) into bounded Web records and Telegram text, normalizing untrusted strings, mapping semantic kinds to persisted notification categories, retaining valid ticker/batch/action metadata, and clipping unbounded reasoning. `notificationService.publishNotification` was migrated to the semantic boundary so production publishers no longer construct ad hoc category/title/body payloads; the service owns composition, category preferences, batch idempotency, Web/outbox records, Telegram delivery attempts, and bounded redacted diagnostics.

The existing production publishers in daily brief, deep dive, full report, quick check, new ideas, feed/news, and step-queue completion effects now publish semantic notification requests. This preserves the existing Web notification response shape (`title`, `body`, `category`, ticker/batch/action metadata, delivery/read/error fields) while ensuring users see clearer status titles, restrained markers, useful body text, and open/read-more cues. Frontend compatibility was verified without code changes because the composed backend records remain additive/backward-compatible for the current Web consumer.

Telegram delivery was hardened through `backend/src/services/telegramDelivery.ts` and service wiring. Notifications and Telegram webhook replies intentionally use plain text with no Markdown/HTML parse mode, disable link previews, split long messages into bounded chunks, stop sending after the first failed chunk, and persist bounded delivery failure details on notification records. Missing Telegram targets, HTTP non-2xx responses, network failures, and chunk failures are test-covered and recorded instead of becoming log-only failures. The implementation honors S02 policy by not expanding or promoting WhatsApp; the pilot surface verifier still confirms WhatsApp setup/notification selection are hidden and pilot copy remains nameless.

Operationally, the slice leaves downstream S07 with a clearer notification state model to inspect: semantic kind/category, batch idempotency, channel delivery outcomes, `deliveredAt`, `deliveryError`, and redacted publication/delivery logs. S08 still must prove live Telegram delivery with real credentials, but S03 provides the code-level composition, formatting, splitting, and failure-recording contracts required for that rehearsal.

## Verification

Fresh slice-level verification passed in gsd_exec `d8e857f6-9849-426c-95de-b822cee69fcf`:

- `npm --prefix backend test -- --test-name-pattern "notification composer|notification service|telegram delivery"` — exit 0; 30 tests passed, 0 failed, including composer, notification service, and Telegram delivery coverage.
- `npm --prefix backend run build` — exit 0; TypeScript build passed.
- `node scripts/verify-pilot-surface.mjs` — exit 0; WhatsApp setup and notification selection remain hidden, saves force WhatsApp disabled, and pilot copy stays nameless.
- `npm --prefix frontend run lint` — exit 0; two pre-existing hook dependency warnings remain in Admin/Reports-related code and are unrelated to S03 notification compatibility.
- `npm --prefix frontend run build` — exit 0; frontend TypeScript/Vite production build passed.

Additional source contract scan passed in gsd_exec `b77dc94f-f252-45d9-b007-132eb19487f9`: scanned the migrated publisher files plus notification service, Telegram delivery, and Telegram route; found no `parse_mode`/`parseMode` usage and no production `publishNotification` calls without a semantic `kind` marker outside the service boundary.

Task-level evidence also passed for T01-T04, including composer TDD, notification service publication/idempotency/category tests, Telegram splitting/failure tests, backend builds, pilot-surface verification, and frontend compatibility verification.

## Requirements Advanced

- R003 — S03 re-ran `scripts/verify-pilot-surface.mjs`, confirming notification work did not regress nameless copy or hidden WhatsApp policy.
- R014 — S03 created reliable notification delivery/failure fields and logs that S07 can expose for pilot operator visibility.
- R015 — S03 provides the notification composition/delivery foundation that S08 must rehearse with real Web + Telegram credentials.

## Requirements Validated

- R005 — All production notification publishers in scope now route through the semantic composer/service boundary; targeted notification tests and source scan passed.
- R006 — Composer/service tests verify bounded clear Web records and plain-text Telegram messages with status/action cues; full planned slice verification passed.
- R007 — Telegram delivery tests verify plain text, disabled link previews, safe splitting, and persisted bounded failure state; full planned slice verification passed.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

T02 also migrated `backend/src/services/stepQueue/completionEffects.ts` because backend build/test evidence showed it was an active production notification publisher using the old request shape. Frontend compatibility required verification only; no frontend source change was needed.

## Known Limitations

Live Telegram delivery with real credentials is not proven by S03 and remains for S08. S07 still needs to expose richer operator inspection over notification delivery/failure state. Frontend lint still reports unrelated pre-existing hook dependency warnings while exiting 0.

## Follow-ups

S07 should surface notification delivery attempts, `deliveredAt`, `deliveryError`, semantic kind/category, and batch/channel outcomes in admin/operator readiness views. S08 should run live Web + Telegram notification rehearsal with real credentials and seeded/report events.

## Files Created/Modified

- `backend/src/services/notificationComposer.ts` — New semantic composer and Web/Telegram render boundary.
- `backend/src/services/notificationService.ts` — Semantic publication boundary, channel rendering, idempotency, delivery state, and diagnostics.
- `backend/src/services/telegramDelivery.ts` — Shared Telegram plain-text delivery, splitting, disabled link previews, and structured results.
- `backend/src/services/*Service.ts` — Daily/deep-dive/full-report/quick-check/new-ideas/feed publishers migrated to semantic notification requests.
- `backend/src/services/stepQueue/completionEffects.ts` — Active completion notification publisher migrated to the semantic request shape.
- `backend/src/routes/telegram.ts` — Telegram replies aligned with shared plain-text safety decisions where practical.
- `backend/src/services/notificationComposer.test.ts` — Composer contract tests for kinds, categories, clipping, and untrusted input handling.
- `backend/src/services/notificationService.test.ts` — Publication, Web record, preference, idempotency, and delivery-state tests.
- `backend/src/services/telegramDelivery.test.ts` — Telegram delivery splitting, formatting, and failure behavior tests.
- `.gsd/PROJECT.md` — Project state refreshed to note S03 completion patterns and validated notification requirements.
