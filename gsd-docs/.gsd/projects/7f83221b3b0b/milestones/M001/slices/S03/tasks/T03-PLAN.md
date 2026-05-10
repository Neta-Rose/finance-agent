---
estimated_steps: 38
estimated_files: 5
skills_used: []
---

# T03: Harden Telegram rendering, splitting, and delivery failure recording

---
estimated_steps: 6
estimated_files: 7
skills_used:
  - tdd
  - observability
  - security-review
---
Make Telegram notification delivery safe and diagnosable by using shared formatting/splitting helpers and persisting bounded failure results on notification records.

Steps:
1. Add `backend/src/services/telegramDelivery.ts` with helpers for escaping or otherwise safe plain/Markdown Telegram text, splitting messages below Telegram's 4096 character limit at sensible boundaries, disabling link previews, and returning structured per-send results.
2. Add `backend/src/services/telegramDelivery.test.ts` first, covering markdown/control-character input, multi-chunk messages, non-2xx Telegram responses, network errors, redaction of bot tokens/API URLs, and no chunk exceeding the safe length limit.
3. Refactor `backend/src/services/notificationService.ts` Telegram delivery to render Telegram text via `notificationComposer`, send chunks through the helper, and persist `delivered`, `deliveredAt`, and a bounded `error` when any chunk fails or the target is missing.
4. Where practical with minimal risk, update `backend/src/routes/telegram.ts` to reuse the same delivery helper for bot replies so inbound chat replies and notifications share safe formatting/splitting behavior; keep webhook response semantics unchanged (`200 { ok: true }` to Telegram).
5. Update notification tests to assert Telegram failure recording when the target is missing or mocked Telegram returns a non-2xx response, without logging or persisting the bot token.
6. Run backend build and targeted tests; if the route refactor touches public behavior, add/adjust route-level tests only if an existing route test harness is already present.

Must-haves:
- Telegram notification text is safe, bounded, and split before transport.
- Telegram send failures are recorded on notification outbox/database records with useful but redacted error text.
- Bot tokens never appear in persisted errors, logs, or test snapshots.

Failure Modes:
| Dependency | On error | On timeout | On malformed response |
|------------|----------|------------|-----------------------|
| Telegram Bot API | Mark notification delivery failed with bounded redacted error and continue processing other records/chunks | Treat as network failure and record bounded timeout/error message | Treat non-JSON/error body as opaque bounded text without throwing |
| Telegram binding/secret lookup | Mark notification failed as target not configured | N/A | Treat invalid/missing token/chat id as target not configured or send failure without exposing token |
| Legacy JSON/DB update | Preserve current JSON update first and DB dual-write warning pattern | N/A | Log bounded update failure without blocking unrelated channels |

Load Profile:
- **Shared resources**: Telegram Bot API rate limits, per-user outbox JSON, optional `notifications_outbox` DB writes.
- **Per-operation cost**: one Telegram API call per chunk per Telegram notification; chunk count is bounded by renderer caps.
- **10x breakpoint**: Telegram API rate limits and sequential chunk sends; body caps and chunk limits must avoid fan-out explosions.

Negative Tests:
- **Malformed inputs**: Markdown meta characters, URLs, empty text, very long text, non-string error bodies.
- **Error paths**: HTTP 400/500 from Telegram, thrown fetch/network error, missing target binding/token.
- **Boundary conditions**: Text exactly at and just over chunk limit; one failed chunk means notification delivered=false and error is persisted.

Observability Impact:
- Signals added/changed: structured per-send result with attempted chunk count, success/failure, and bounded redacted error.
- How a future agent inspects this: run `npm --prefix backend test -- --test-name-pattern "telegram delivery"`; inspect `/notifications?channel=telegram` or `notifications_outbox.error` for failed delivery reason.
- Failure state exposed: missing target, Telegram HTTP failure, and network failure become distinguishable persisted notification errors.

## Inputs

- `backend/src/services/notificationComposer.ts`
- `backend/src/services/notificationService.ts`
- `backend/src/services/notificationService.test.ts`
- `backend/src/routes/telegram.ts`
- `backend/src/services/logger.ts`
- `backend/src/services/notificationStore.ts`

## Expected Output

- `backend/src/services/telegramDelivery.ts`
- `backend/src/services/telegramDelivery.test.ts`
- `backend/src/services/notificationService.ts`
- `backend/src/services/notificationService.test.ts`
- `backend/src/routes/telegram.ts`

## Verification

npm --prefix backend test -- --test-name-pattern "telegram delivery|notification service" && npm --prefix backend run build

## Observability Impact

Makes Telegram transport failures externally inspectable through notification delivery state instead of log-only warnings, while redacting token-bearing URLs.
