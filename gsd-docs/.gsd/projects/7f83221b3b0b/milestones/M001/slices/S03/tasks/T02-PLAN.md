---
estimated_steps: 38
estimated_files: 8
skills_used: []
---

# T02: Wire backend publishers through the central composer

---
estimated_steps: 6
estimated_files: 8
skills_used:
  - api-design
  - tdd
  - observability
---
Replace scattered backend notification title/body construction with semantic publication calls that render channel-specific Web and Telegram records before persistence/delivery.

Steps:
1. Before code changes, create the production change report for S03 under `/root/codex/production-reports/` documenting change, risks, validation, rollout, rollback trigger, and rollback steps.
2. Update `backend/src/services/notificationService.ts` so the exported publication path accepts semantic notification requests, composes once, renders per candidate channel, preserves existing category preference/idempotency behavior, and logs publication with semantic kind/category/channels but without secrets or raw long body text.
3. Migrate call sites in daily brief, deep dive, full report, quick check, new ideas, and feed/news publication services to pass semantic event fields instead of preformatted `title`/`body` strings.
4. Keep existing Web outbox/API compatibility: `title`, `body`, `category`, `ticker`, `batchId`, `delivered`, `error`, and `readAt` remain available to `frontend/src/App.tsx` and `/notifications` consumers.
5. Update `backend/src/services/notificationService.test.ts` to assert composed Web outbox records for daily brief/report/news paths, idempotent batch behavior, category preference filtering, and that deep-dive bodies are bounded instead of raw unbounded strategy reasoning.
6. Run the S02 policy script so neutral naming and Web+Telegram-only pilot policy remain intact.

Must-haves:
- No production publisher in `backend/src/services/{dailyBriefService,deepDiveService,fullReportService,quickCheckService,newIdeasService,feedService}.ts` constructs pilot-facing notification title/body ad hoc.
- Existing `/notifications` response shape remains additive/backward-compatible for the same-repo frontend.
- Web notification toasts receive clear, actionable composed title/body text.

Failure Modes:
| Dependency | On error | On timeout | On malformed response |
|------------|----------|------------|-----------------------|
| Legacy JSON outbox write | Let the existing error propagate as publication failure because this remains the source of truth | N/A | N/A |
| Postgres dual-write | Preserve current non-blocking warning path and continue JSON outbox write | N/A | Log bounded error and avoid leaking SQL/secrets |
| Composer | Fail fast in tests; runtime should use deterministic fallbacks for ordinary missing optional fields | N/A | Produce safe fallback title/body where feasible |

Load Profile:
- **Shared resources**: legacy per-user notification JSON file and optional `notifications_outbox` database table.
- **Per-operation cost**: one composition plus existing per-channel outbox write and optional DB dual-write.
- **10x breakpoint**: duplicate publication or large bodies increasing file/DB size; preserve batch idempotency and body caps.

Negative Tests:
- **Malformed inputs**: Missing optional ticker/batch fields, empty summaries, overlong strategy reasoning.
- **Error paths**: DB dual-write failure remains non-blocking and logged; disabled categories publish no records.
- **Boundary conditions**: Duplicate report batch id returns the original record; Web-only users still receive Web records.

Observability Impact:
- Signals added/changed: publication logs include semantic kind, category, channels, user id, batch id, and redacted delivery state.
- How a future agent inspects this: query `/notifications`, inspect the JSON outbox in a test fixture, or inspect `notifications_outbox` in configured environments.
- Failure state exposed: category disabled/no-channel cases and DB dual-write failures remain distinguishable in logs without leaking secrets.

## Inputs

- `backend/src/services/notificationComposer.ts`
- `backend/src/services/notificationComposer.test.ts`
- `backend/src/services/notificationService.ts`
- `backend/src/services/dailyBriefService.ts`
- `backend/src/services/deepDiveService.ts`
- `backend/src/services/fullReportService.ts`
- `backend/src/services/quickCheckService.ts`
- `backend/src/services/newIdeasService.ts`
- `backend/src/services/feedService.ts`
- `scripts/verify-pilot-surface.mjs`

## Expected Output

- `/root/codex/production-reports/20260510T000000Z-s03-notification-composition-telegram-delivery.md`
- `backend/src/services/notificationService.ts`
- `backend/src/services/notificationService.test.ts`
- `backend/src/services/dailyBriefService.ts`
- `backend/src/services/deepDiveService.ts`
- `backend/src/services/fullReportService.ts`
- `backend/src/services/quickCheckService.ts`
- `backend/src/services/newIdeasService.ts`
- `backend/src/services/feedService.ts`

## Verification

npm --prefix backend test -- --test-name-pattern "notification service" && node scripts/verify-pilot-surface.mjs

## Observability Impact

Turns notification publication into an inspectable semantic event flow with redacted structured log context and preserved outbox/database failure fields.
