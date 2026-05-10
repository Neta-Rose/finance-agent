---
id: T05
parent: S01
milestone: M001
key_files:
  - docs/pilot-features/README.md
  - .gitignore
  - backend/src/services/pilotFeatureCatalogService.test.ts
  - backend/src/services/pilotFeatureReviewService.test.ts
  - backend/src/routes/adminPilotFeatures.test.ts
key_decisions:
  - Kept admin review state documented as Postgres-owned mutable state and catalog JSON as immutable product inventory.
  - Explicitly unignored the pilot feature README because the repository broadly ignores docs files by default.
duration: 
verification_result: mixed
completed_at: 2026-05-09T13:46:20.162Z
blocker_discovered: false
---

# T05: Documented the pilot feature inventory boundary and tightened catalog/API/review contract tests.

**Documented the pilot feature inventory boundary and tightened catalog/API/review contract tests.**

## What Happened

Added `docs/pilot-features/README.md` for future engineers extending the pilot feature inventory. The document explains the immutable catalog versus mutable Postgres review boundary, required catalog fields, review statuses, `pilotRecommendation` semantics, S02 guidance for WhatsApp/deferred channel wording, and report-vs-strategy naming rules. Updated `.gitignore` so the new README is not hidden by the broad `docs/*` ignore rule. Tightened backend tests so default catalog coverage asserts several Web entries plus Telegram/admin coverage, every catalog entry preserves required immutable fields including `errorHandling` and `evidencePaths`, service-composed features include a complete mutable `review` object, and admin API GET/PATCH responses expose the full immutable-plus-review contract while preserving read-after-write behavior from prior tests.

## Verification

Ran focused pilot feature backend tests successfully after the documentation and test changes: `npm --prefix backend test -- --test-name-pattern "pilot feature"` passed with 43/43 tests. Ran the required frontend build successfully: `npm --prefix frontend run build` exited 0. Ran the full backend suite as required; it exited 1 with 132/141 passing because of unrelated existing failures in daily brief coverage expectations and step-queue tests that require OpenAI credentials or have unrelated normalizer assertions. Those failures were visible in prior recorded full-suite output before T05 changes and do not involve the pilot feature catalog/API/review files. Attempted LSP diagnostics on edited TypeScript tests, but no TypeScript language server was available in this worktree.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm --prefix backend test -- --test-name-pattern "pilot feature"` | 0 | ✅ pass | 3958ms |
| 2 | `npm --prefix backend test` | 1 | ❌ fail — 132/141 passed; unrelated pre-existing dailyBriefService/stepQueue failures remain | 8862ms |
| 3 | `npm --prefix frontend run build` | 0 | ✅ pass | 5734ms |
| 4 | `lsp diagnostics backend/src/services/pilotFeatureCatalogService.test.ts backend/src/services/pilotFeatureReviewService.test.ts backend/src/routes/adminPilotFeatures.test.ts` | 1 | ❌ fail — no language server found in worktree | 0ms |

## Deviations

Added `.gitignore` update in addition to the planned docs/tests because root ignores `docs/*`; without the explicit README unignore, the new boundary contract doc would be local-only.

## Known Issues

`npm --prefix backend test` currently fails outside this task's pilot feature boundary: one daily brief coverage assertion expects Infinity but gets 10, and several stepQueue tests fail due missing OpenAI credentials plus one unrelated normalizer assertion. LSP diagnostics could not run because no language server is available in this worktree.

## Files Created/Modified

- `docs/pilot-features/README.md`
- `.gitignore`
- `backend/src/services/pilotFeatureCatalogService.test.ts`
- `backend/src/services/pilotFeatureReviewService.test.ts`
- `backend/src/routes/adminPilotFeatures.test.ts`
