---
id: T01
parent: S01
milestone: M001
key_files:
  - docs/pilot-features/pilot-core.json
  - backend/src/schemas/pilotFeature.ts
  - backend/src/schemas/index.ts
  - backend/src/services/pilotFeatureCatalogService.ts
  - backend/src/services/pilotFeatureCatalogService.test.ts
  - .gitignore
key_decisions:
  - Used strict Zod object schemas so catalog JSON is an exact immutable boundary contract rather than accepting unknown fields.
  - Kept mutable review status values in the schema now (`unreviewed`, `needs_fix`, `beta`, `hidden`, `ready`) so downstream DB/API tasks share the same enum.
duration: 
verification_result: mixed
completed_at: 2026-05-09T13:26:44.230Z
blocker_discovered: false
---

# T01: Added a strict validated pilot feature catalog with substantive Web, Telegram, and admin coverage.

**Added a strict validated pilot feature catalog with substantive Web, Telegram, and admin coverage.**

## What Happened

Created the pilot feature catalog foundation for S01. Added strict Zod schemas and exported types for immutable catalog entries plus review status values. Implemented a deterministic loader that reads all `docs/pilot-features/*.json`, validates file shape, rejects malformed JSON/schema violations with path-specific reasons, rejects duplicate IDs, rejects unsafe evidence paths pointing at ignored runtime/user/secret locations, and sorts entries by surface, title, and ID. Added `docs/pilot-features/pilot-core.json` with eight non-placeholder entries covering onboarding/portfolio, reports, strategies, alerts/notifications, Telegram delivery/chat webhook, in-app chat, controls/settings, and admin/operator console surfaces. Added a narrow `.gitignore` exception so `docs/pilot-features/*.json` can be tracked despite the broader root `docs/` ignore rule.

## Verification

Direct catalog tests passed: valid loading/sorting, default committed catalog coverage, duplicate ID rejection, invalid shape/missing `errorHandling`, malformed JSON, and unsafe evidence path rejection. Backend TypeScript build passed and the default loader returned 8 committed catalog entries. Frontend build passed after installing frontend dependencies. The exact npm test commands requested by the task/slice ran but returned exit 1 because this worktree's backend test script still enumerates unrelated tests under `--test-name-pattern`; all six pilot feature catalog subtests were reported as ok in that output, while unrelated existing failures remained in daily brief/step queue tests.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `node --test --import ./backend/node_modules/tsx/dist/loader.mjs backend/src/services/pilotFeatureCatalogService.test.ts` | 0 | ✅ pass | 267ms |
| 2 | `npm --prefix backend run build` | 0 | ✅ pass | 4571ms |
| 3 | `node --import ./backend/node_modules/tsx/dist/loader.mjs -e "import('./backend/src/services/pilotFeatureCatalogService.ts').then(async ({ loadPilotFeatureCatalog }) => { const entries = await loadPilotFeatureCatalog(); console.log(JSON.stringify({ count: entries.length, first: entries[0]?.id, last: entries.at(-1)?.id })); })"` | 0 | ✅ pass | 199ms |
| 4 | `npm --prefix backend test -- --test-name-pattern "pilot feature catalog"` | 1 | ❌ fail | 8872ms |
| 5 | `npm --prefix backend test -- --test-name-pattern "pilot feature"` | 1 | ❌ fail | 7606ms |
| 6 | `npm --prefix backend test` | 1 | ❌ fail | 8335ms |
| 7 | `npm --prefix frontend run build` | 0 | ✅ pass | 5504ms |

## Deviations

Added a narrow `.gitignore` unignore exception for `docs/pilot-features/` because the plan requires tracked catalog JSON while the existing root `.gitignore` ignored `docs/` globally. Installed backend and frontend dependencies locally so verification commands could run in this worktree; dependency directories remain ignored.

## Known Issues

The backend npm test runner still executes the full suite with `--test-name-pattern`; exact task/slice backend test commands exit 1 due unrelated existing failures: daily brief default coverage assertion, stepQueue tests needing OpenAI credentials, and existing stepQueue normalizer assertions. These failures are outside the pilot catalog implementation; direct pilot catalog tests pass.

## Files Created/Modified

- `docs/pilot-features/pilot-core.json`
- `backend/src/schemas/pilotFeature.ts`
- `backend/src/schemas/index.ts`
- `backend/src/services/pilotFeatureCatalogService.ts`
- `backend/src/services/pilotFeatureCatalogService.test.ts`
- `.gitignore`
