---
estimated_steps: 34
estimated_files: 5
skills_used: []
---

# T04: Verify pilot notification contracts and frontend compatibility

---
estimated_steps: 4
estimated_files: 5
skills_used:
  - verify-before-complete
  - test
---
Close the slice by running the full planned verification contract and making any minimal compatibility fixes needed for the existing Web notification consumer.

Steps:
1. Run the targeted backend notification composer/service/Telegram delivery tests and fix any failures in the smallest responsible file.
2. Run `npm --prefix backend run build` to catch TypeScript/API drift from semantic publication and Telegram helper changes.
3. Run `node scripts/verify-pilot-surface.mjs` to ensure S02 Web+Telegram/nameless-copy policy still holds after notification copy changes.
4. Run `npm --prefix frontend run lint` and `npm --prefix frontend run build`; only touch `frontend/src/api/notifications.ts` or `frontend/src/App.tsx` if backend notification shape changes require same-repo frontend compatibility adjustments.

Must-haves:
- All slice-level verification commands pass with fresh output.
- The existing Web notification polling/toast path remains compatible with composed records.
- The S03 production report has validation evidence updated with the commands actually run.

Failure Modes:
| Dependency | On error | On timeout | On malformed response |
|------------|----------|------------|-----------------------|
| Backend test/build command | Fix the smallest failing notification-owned code path; do not mask unrelated regressions | Re-run once only if clearly environmental | Treat TypeScript/type errors as contract drift to fix |
| Frontend lint/build command | Fix only compatibility issues caused by this slice unless an unrelated gate blocks required verification | Re-run once only if clearly environmental | Treat API type mismatches as backend/frontend contract drift |

Load Profile:
- **Shared resources**: local CPU only.
- **Per-operation cost**: normal backend tests/build plus frontend lint/build.
- **10x breakpoint**: N/A for verification commands, but long output should be captured with `gsd_exec` in execution context.

Negative Tests:
- **Malformed inputs**: Covered by composer and Telegram delivery tests from T01/T03.
- **Error paths**: Covered by notification service and Telegram delivery failure tests.
- **Boundary conditions**: Covered by idempotency, clipping, and chunking tests.

Observability Impact:
- Signals added/changed: production report records fresh verification evidence and remaining operational limitations.
- How a future agent inspects this: read `/root/codex/production-reports/20260510T000000Z-s03-notification-composition-telegram-delivery.md` and test files listed in the slice verification section.
- Failure state exposed: any unsupported pilot-surface or frontend/backend contract regression is caught before slice completion.

## Inputs

- `backend/src/services/notificationComposer.test.ts`
- `backend/src/services/notificationService.test.ts`
- `backend/src/services/telegramDelivery.test.ts`
- `frontend/src/api/notifications.ts`
- `frontend/src/App.tsx`
- `scripts/verify-pilot-surface.mjs`

## Expected Output

- `backend/src/services/notificationComposer.test.ts`
- `backend/src/services/notificationService.test.ts`
- `backend/src/services/telegramDelivery.test.ts`
- `frontend/src/api/notifications.ts`
- `frontend/src/App.tsx`
- `/root/codex/production-reports/20260510T000000Z-s03-notification-composition-telegram-delivery.md`

## Verification

npm --prefix backend test -- --test-name-pattern "notification composer|notification service|telegram delivery" && npm --prefix backend run build && node scripts/verify-pilot-surface.mjs && npm --prefix frontend run lint && npm --prefix frontend run build

## Observability Impact

Records final verification and compatibility evidence in the production report so S07/S08 can distinguish implemented contracts from remaining live Telegram UAT.
