# S03: Notification Composition + Telegram Delivery — UAT

**Milestone:** M001
**Written:** 2026-05-10T12:07:47.106Z

# S03 UAT — Notification Composition + Telegram Delivery

## UAT Type

Contract/integration UAT for pilot notification behavior using automated tests and source/build verification with mocked Telegram transport. This UAT proves composition, Web record compatibility, Telegram formatting/splitting, delivery failure persistence, and S02 pilot-surface compatibility at code level.

## Preconditions

1. Backend dependencies are installed and backend tests can run with the repository test harness.
2. Frontend dependencies are installed and lint/build can run.
3. No real Telegram bot token or live pilot user is required; Telegram delivery behavior is verified with mocked transport and persisted notification record assertions.
4. Work is run from `/root/clawd`.

## Test Case 1 — Semantic composer renders owned notification kinds

Steps:
1. Run `npm --prefix backend test -- --test-name-pattern "notification composer"`.
2. Inspect/confirm test cases cover daily brief, deep dive, full report, quick check, new ideas, and market/news semantic events.
3. Include malformed or markdown-like ticker/title/body values and overlong reasoning in the covered inputs.

Expected outcomes:
- Each semantic kind maps to the intended persisted notification category.
- Web output contains a clear bounded title/body and useful action cue.
- Telegram output is plain text with restrained status markers and no Markdown/HTML parse mode requirement.
- Untrusted strings are normalized and overlong reasoning is clipped rather than persisted/sent unbounded.

## Test Case 2 — Production publishers use the central semantic boundary

Steps:
1. Run `npm --prefix backend test -- --test-name-pattern "notification service"`.
2. Confirm daily brief, report-style, news, missing optional fields, category-disabled suppression, and duplicate batch/idempotency scenarios pass.
3. Run a source scan over `dailyBriefService`, `deepDiveService`, `fullReportService`, `quickCheckService`, `newIdeasService`, `feedService`, and `stepQueue/completionEffects` to ensure production calls use semantic `publishNotification({ kind: ... })` requests.

Expected outcomes:
- Production notification publishers do not build scattered ad hoc `category`/`title`/`body` payloads.
- `notificationService` composes channel-specific records, preserves category preferences, and keeps batch idempotency.
- Web notification records remain compatible with the existing frontend consumer shape.

## Test Case 3 — Telegram delivery is safe and diagnosable

Steps:
1. Run `npm --prefix backend test -- --test-name-pattern "telegram delivery|notification service"`.
2. Verify tests cover long message splitting, disabled link previews, missing target, non-2xx Telegram response, network failure, and failed chunk behavior.
3. Confirm no `parse_mode`/`parseMode` usage is present in notification/Telegram delivery code.

Expected outcomes:
- Telegram messages are sent as plain text and link previews are disabled.
- Long messages split below Telegram limits.
- Sending stops after the first failed chunk.
- Delivery success records `delivered=true`/`deliveredAt`; failures persist bounded redacted `deliveryError` details instead of exposing bot tokens, stack traces, full API URLs, or raw unbounded report reasoning.

## Test Case 4 — Pilot channel/copy policy remains compatible

Steps:
1. Run `node scripts/verify-pilot-surface.mjs`.
2. Confirm Settings still hides WhatsApp setup and WhatsApp notification selection.
3. Confirm saves force WhatsApp disabled and pilot copy remains nameless.

Expected outcomes:
- S03 does not expand or promote unsupported WhatsApp paths.
- S02 naming policy remains intact for the notification-related pilot surface.

## Test Case 5 — Build and frontend compatibility

Steps:
1. Run `npm --prefix backend run build`.
2. Run `npm --prefix frontend run lint`.
3. Run `npm --prefix frontend run build`.
4. Confirm the Web notification consumer still accepts composed notification records with `title`, `body`, `category`, `ticker`, `batchId`, and delivery/read/error fields.

Expected outcomes:
- Backend TypeScript build passes.
- Frontend lint exits 0; existing hook dependency warnings may be reported but do not block S03.
- Frontend production build passes.
- No frontend code change is needed for notification compatibility because the API record shape remains backward-compatible.

## Edge Cases Covered

- Markdown/HTML-looking titles, tickers, and bodies do not become parsed Telegram markup.
- Overlong reasoning is clipped before Web/Telegram render output.
- Duplicate batch publication remains idempotent.
- Category-disabled preferences suppress notifications as expected.
- Missing Telegram target, HTTP errors, network errors, and chunk-send failures are persisted as bounded delivery failures.
- WhatsApp remains hidden/deferred despite notification system changes.

## Not Proven By This UAT

- Live Telegram delivery with real bot credentials and a real bound pilot chat; S08 must run that end-to-end rehearsal.
- Performance under high-volume notification bursts beyond the current batch/idempotency unit and integration tests.
- Rich S07 admin/operator dashboards for notification delivery failures; S03 only ensures the delivery/failure state exists for S07 to inspect.
- Final advisory readability across all report/strategy/scoring surfaces; S06 consumes the notification patterns but owns broader readability work.
