---
id: T03
parent: S03
milestone: M001
key_files:
  - backend/src/services/telegramDelivery.ts
  - backend/src/services/telegramDelivery.test.ts
  - backend/src/services/notificationService.ts
  - backend/src/services/notificationService.test.ts
  - backend/src/services/channelService.ts
  - backend/src/routes/telegram.ts
  - ../codex/production-reports/M001-S03-T03-telegram-delivery.md
key_decisions:
  - Preserved the S03 plain-text Telegram safety decision by omitting Telegram `parse_mode` for both notifications and webhook replies.
  - Bounded Telegram fan-out to five chunks of at most 3600 characters and stopped sending after the first failed chunk so one failed chunk persists `delivered=false` with a redacted error.
duration: 
verification_result: passed
completed_at: 2026-05-10T12:02:37.602Z
blocker_discovered: false
---

# T03: Hardened Telegram delivery with shared safe chunking, plain-text transport, and persisted redacted failure state.

**Hardened Telegram delivery with shared safe chunking, plain-text transport, and persisted redacted failure state.**

## What Happened

Added `telegramDelivery` as the central Telegram transport helper. It normalizes control characters, preserves content as plain text by omitting `parse_mode`, disables link previews, splits messages below Telegram limits at sensible boundaries, bounds fan-out with `MAX_TELEGRAM_CHUNKS`, and returns structured per-chunk delivery results with redacted bounded errors. Refactored notification Telegram delivery to use this helper and persist `delivered`, `deliveredAt`, and `error` on the legacy JSON outbox plus the DB dual-write update path. Refactored Telegram webhook replies to use the same helper while preserving `200 { ok: true }` webhook acknowledgements. Added service tests for missing Telegram target and non-2xx Telegram failures, confirming bot tokens do not appear in persisted errors. Added a production report before product changes.

## Verification

Verified helper behavior, notification integration, backend build, and full slice verification commands. Targeted Telegram/notification tests passed, backend TypeScript build passed, pilot surface verification passed, frontend lint exited 0 with two pre-existing warnings, and frontend build passed. LSP diagnostics could not run because no language server was available, so `tsc` build served as static verification.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm --prefix backend test -- --test-name-pattern "telegram delivery"` | 0 | ✅ pass | 3735ms |
| 2 | `npm --prefix backend test -- --test-name-pattern "telegram delivery|notification service"` | 0 | ✅ pass | 3758ms |
| 3 | `npm --prefix backend test -- --test-name-pattern "notification composer|notification service|telegram delivery"` | 0 | ✅ pass | 3492ms |
| 4 | `npm --prefix backend run build` | 0 | ✅ pass | 4377ms |
| 5 | `node scripts/verify-pilot-surface.mjs` | 0 | ✅ pass | 41ms |
| 6 | `npm --prefix frontend run lint` | 0 | ✅ pass | 6414ms |
| 7 | `npm --prefix frontend run build` | 0 | ✅ pass | 5441ms |

## Deviations

Added a minimal legacy profile Telegram connectivity/target fallback in `channelService`/`notificationService` so existing file-backed profile state (`telegramChatId` or `channelConnections.telegram`) is recognized when the application DB is not configured; this supports existing local/test paths without changing the DB-backed source of truth when available.

## Known Issues

`npm --prefix frontend run lint` still reports two warnings in `frontend/src/pages/Settings.tsx` about `features` dependencies; the command exits 0 and these warnings are unrelated to this backend Telegram task.

## Files Created/Modified

- `backend/src/services/telegramDelivery.ts`
- `backend/src/services/telegramDelivery.test.ts`
- `backend/src/services/notificationService.ts`
- `backend/src/services/notificationService.test.ts`
- `backend/src/services/channelService.ts`
- `backend/src/routes/telegram.ts`
- `../codex/production-reports/M001-S03-T03-telegram-delivery.md`
