---
estimated_steps: 34
estimated_files: 4
skills_used: []
---

# T01: Define semantic notification composers and renderer contracts

---
estimated_steps: 5
estimated_files: 4
skills_used:
  - api-design
  - tdd
---
Create the central notification composition boundary that turns typed notification events into bounded Web and Telegram render outputs.

Steps:
1. Create `backend/src/services/notificationComposer.ts` with a typed semantic request covering `daily_brief`, `deep_dive`, `full_report`, `market_news`, and report-style variants such as `quick_check`/`new_ideas`, mapping each to the existing persisted categories `daily_brief`, `report`, or `market_news`.
2. Define a common composed envelope with status tone, concise title, bounded body, optional ticker/batch id/action URL, and redaction/length helpers so raw unbounded reasoning is summarized or clipped before rendering.
3. Add Web and Telegram renderer functions in the same module (or a tightly scoped sibling if cleaner) that produce clear titles/body text for Web records and safe Telegram text with restrained markers/action cue; do not include bot tokens, internal paths, prompts, or old/internal product names.
4. Write `backend/src/services/notificationComposer.test.ts` first, covering daily brief, deep dive, full report, market/news, overlong reasoning clipping, markdown-like untrusted input, and action cue behavior.
5. Keep this task contract-only: do not wire existing publishers yet; T02 owns call-site migration.

Must-haves:
- Composer tests prove R005/R006 shape for all owned notification classes.
- Renderer output is bounded and neutral, with no raw full strategy/report reasoning leakage.
- Category mapping remains compatible with existing notification DB/API categories.

Failure Modes:
| Dependency | On error | On timeout | On malformed response |
|------------|----------|------------|-----------------------|
| Job/feed payload data | Render a generic but useful completion/news message and preserve category/ticker when valid | N/A | Normalize missing/invalid strings to safe fallback copy without throwing for ordinary empty fields |

Load Profile:
- **Shared resources**: CPU/string memory only.
- **Per-operation cost**: O(message length) string normalization; no network or DB calls.
- **10x breakpoint**: Large unbounded reasoning text causing memory/noisy notifications; length caps and tests must prevent this.

Negative Tests:
- **Malformed inputs**: Empty title/headline, missing ticker, markdown/control characters, and overlong reasoning/news summary.
- **Error paths**: Renderer must not throw for optional URL/batch fields being absent.
- **Boundary conditions**: Telegram text near max chunk size and body clipping boundary.

Observability Impact:
- Signals added/changed: the composed envelope should expose semantic kind and status tone for later publication logs.
- How a future agent inspects this: run `npm --prefix backend test -- --test-name-pattern "notification composer"` and inspect `backend/src/services/notificationComposer.test.ts` fixtures.
- Failure state exposed: malformed semantic input becomes deterministic fallback output instead of an uncaught formatter error.

## Inputs

- `backend/src/services/notificationService.ts`
- `backend/src/schemas/notifications.ts`
- `backend/src/db/entities/NotificationEntity.ts`
- `backend/src/services/notificationService.test.ts`

## Expected Output

- `backend/src/services/notificationComposer.ts`
- `backend/src/services/notificationComposer.test.ts`

## Verification

npm --prefix backend test -- --test-name-pattern "notification composer"

## Observability Impact

Adds a deterministic semantic kind/status/rendering contract that later runtime logs and delivery records can reference without logging raw sensitive content.
