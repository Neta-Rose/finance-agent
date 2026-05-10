---
id: T02
parent: S01
milestone: M001
key_files:
  - db/application_postgres.sql
  - backend/src/db/entities/PilotFeatureReviewEntity.ts
  - backend/src/db/applicationDataSource.ts
  - backend/src/services/pilotFeatureReviewService.ts
  - backend/src/services/pilotFeatureReviewService.test.ts
  - backend/scripts/run-tests.mjs
  - backend/package.json
key_decisions:
  - Used a query-only injected data-source seam for pilotFeatureReviewService so persistence behavior can be tested without a live Postgres connection.
  - Represented review service failure modes with typed `PilotFeatureReviewServiceError` codes instead of plain errors so future Express routes can map invalid input/unknown IDs to 4xx and DB/catalog failures to 503.
  - Fixed the backend npm test runner to forward Node test-runner flags before discovered test files so GSD verification commands using `--test-name-pattern` target the intended tests.
duration: 
verification_result: mixed
completed_at: 2026-05-09T13:32:27.443Z
blocker_discovered: false
---

# T02: Added Postgres-backed pilot feature review storage with typed service errors and targeted tests.

**Added Postgres-backed pilot feature review storage with typed service errors and targeted tests.**

## What Happened

Added the mutable review-state persistence layer for the pilot feature inventory. The new `pilot_feature_reviews` DDL stores one admin review row per catalog feature with constrained status, bounded comments, incorrect-description marker, and audit timestamp/updater fields. Registered a TypeORM EntitySchema with the application data source. Implemented `pilotFeatureReviewService` to compose immutable catalog entries with default or persisted review state, upsert known feature reviews, validate status/comment/updater inputs before writes, reject unknown catalog IDs, and classify catalog/database failures with `PilotFeatureReviewServiceError` codes suitable for route mapping. Added service tests using an injected query-only fake data source so behavior is pinned without requiring a live Postgres connection. Also replaced the backend npm test script with a small runner that discovers test files and places forwarded Node test-runner flags before file paths, which fixed the prior verification-gate issue where `--test-name-pattern` was ignored and unrelated tests ran.

## Verification

Direct pilot feature review service tests passed. Backend TypeScript build passed. The previously failing `npm --prefix backend test -- --test-name-pattern "pilot feature catalog"` command now passes after the test-runner fix. The exact T02 command `npm --prefix backend test -- --test-name-pattern "pilot feature review service"` passes. Slice-level pilot feature filtered tests pass. Frontend build passes. Full backend suite still exits 1 due existing unrelated failures in daily brief default coverage and step queue/deep-dive LLM artifact tests; no pilot feature review tests fail.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `node --test --import ./backend/node_modules/tsx/dist/loader.mjs backend/src/services/pilotFeatureReviewService.test.ts` | 0 | ✅ pass | 639ms |
| 2 | `npm --prefix backend run build` | 0 | ✅ pass | 4357ms |
| 3 | `npm --prefix backend test -- --test-name-pattern "pilot feature catalog"` | 0 | ✅ pass | 6825ms |
| 4 | `npm --prefix backend test -- --test-name-pattern "pilot feature review service"` | 0 | ✅ pass | 6625ms |
| 5 | `npm --prefix backend test -- --test-name-pattern "pilot feature"` | 0 | ✅ pass | 5471ms |
| 6 | `npm --prefix backend test` | 1 | ❌ fail | 16543ms |
| 7 | `npm --prefix frontend run build` | 0 | ✅ pass | 14120ms |

## Deviations

Added `backend/scripts/run-tests.mjs` and updated `backend/package.json` test script because the existing script appended `--test-name-pattern` after file paths, causing the verification gate to ignore filters and run unrelated tests. This keeps full-suite behavior unchanged while making targeted verification reliable.

## Known Issues

Full backend test suite still has unrelated pre-existing failures: `daily brief defaults all users to pro coverage`, several technical/sentiment/macro/risk/debate/synthesis LLM artifact persistence tests, and `fundamentals normalizer recovers missing ticker from step inputs`.

## Files Created/Modified

- `db/application_postgres.sql`
- `backend/src/db/entities/PilotFeatureReviewEntity.ts`
- `backend/src/db/applicationDataSource.ts`
- `backend/src/services/pilotFeatureReviewService.ts`
- `backend/src/services/pilotFeatureReviewService.test.ts`
- `backend/scripts/run-tests.mjs`
- `backend/package.json`
