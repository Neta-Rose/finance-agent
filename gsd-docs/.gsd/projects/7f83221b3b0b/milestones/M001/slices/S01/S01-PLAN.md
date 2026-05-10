# S01: Pilot Feature Inventory + Admin Review

**Goal:** Deliver the pilot feature inventory foundation: tracked catalog entries for pilot-visible Web + Telegram features, Postgres-backed mutable admin review state, and an admin UI where the owner can browse descriptions, review error-handling expectations, and update status/comment/incorrect-description markers.
**Demo:** Admin can browse pilot-visible features, read short and detailed descriptions, update status/comment, and see per-feature error-handling expectations.

## Must-Haves

- Admin can open the existing `/admin` surface and browse a Pilot Features section without leaving the admin auth model.
- The backend exposes a stable inventory contract combining tracked catalog fields (`id`, `surface`, `title`, `shortSummary`, `detailedExplanation`, `happyPath`, `edgeCases`, `errorHandling`, `evidencePaths`, `pilotRecommendation`) with mutable review state (`status`, `adminComment`, `incorrectDescription`, `updatedAt`, `updatedBy`).
- Catalog entries live in tracked `docs/pilot-features/*.json` files and are validated by automated tests before they can be served.
- Mutable review state is persisted in the application Postgres database table `pilot_feature_reviews`, keyed by feature ID, with safe validation and clear 4xx/503 errors.
- Admin review updates are visible after refetch and preserve catalog fields as read-only, repo-owned content.
- R001 is proven by substantive catalog coverage of current pilot-visible Web + Telegram features with evidence paths and error-handling expectations; R002 is proven by API + UI update flow tests/build checks.
- Threat Surface: admin-only X-Admin-Key API; abuse risks are parameter tampering on feature IDs/status values and oversized comments; data exposure risk is low but catalog evidence paths must not include secrets or per-user workspace paths; untrusted admin comment/status input reaches Postgres and must be validated/bounded.
- Requirement Impact: touches R001 and R002 directly; re-verify admin auth behavior, feature catalog contract, review update API, and admin UI read-after-write. Honors D001, D002, and D003; does not revisit them.

## Proof Level

- This slice proves: integration; automated proof is backend contract tests plus frontend TypeScript/build, with non-blocking human UAT after deployment.

## Integration Closure

Upstream consumed: existing `/api/admin` X-Admin-Key auth, application Postgres DDL/entity registration, and the existing React admin page/API. New wiring: `GET /api/admin/pilot-features`, `PATCH /api/admin/pilot-features/:featureId/review`, `pilot_feature_reviews`, validated `docs/pilot-features/*.json`, frontend admin API client types/functions, and a Pilot Features admin section. Remaining milestone work: S02 uses inventory status to gate WhatsApp/name-sensitive surfaces; S07 rolls inventory state into broader readiness.

## Verification

- Verification commands: `npm --prefix backend test -- --test-name-pattern "pilot feature"`, `npm --prefix backend test`, and `npm --prefix frontend run build`. Diagnostics: catalog files are inspectable under `docs/pilot-features/*.json`; mutable state is inspectable through `pilot_feature_reviews` and `GET /api/admin/pilot-features`; API failures use 4xx/503 responses and safe logs with feature ID/reason only.

## Tasks

- [x] **T01: Create the tracked pilot feature catalog and validator** `est:1h30m`
  Expected executor skills: tdd, write-docs. Create the immutable catalog contract and first substantive catalog entries. Steps: (1) add Zod schema/types for catalog entries and review status values; (2) inventory current visible Web + Telegram pilot surfaces from the listed route/page files; (3) write `docs/pilot-features/pilot-core.json` with entries for onboarding/portfolio, reports, strategies, alerts/notifications, Telegram/daily brief, chat, controls/settings, and admin/operator surfaces; (4) add a deterministic loader that validates all `docs/pilot-features/*.json`, rejects duplicate IDs, sorts by surface/title/id, and rejects evidence paths pointing to `users/`, `.env`, or ignored runtime locations; (5) add node:test coverage for valid load, duplicate ID, invalid shape, sorting, and unsafe evidence paths. Failure modes/negative tests: malformed JSON or schema violations must fail loudly with the path/reason; duplicate IDs and missing `errorHandling` must fail tests. Done when the loader returns typed entries with the exact boundary-map fields and the catalog JSON contains substantive non-placeholder Web + Telegram coverage.
  - Files: `docs/pilot-features/pilot-core.json`, `backend/src/schemas/pilotFeature.ts`, `backend/src/services/pilotFeatureCatalogService.ts`, `backend/src/services/pilotFeatureCatalogService.test.ts`
  - Verify: npm --prefix backend test -- --test-name-pattern "pilot feature catalog"

- [x] **T02: Add Postgres review-state storage for pilot features** `est:1h30m`
  Expected executor skills: postgresql-table-design, tdd, error-handling-patterns. Add the mutable review persistence layer without touching the admin UI yet. Steps: (1) add idempotent DDL for `pilot_feature_reviews` with `feature_id` primary key, constrained `status` values (`unreviewed`, `needs_fix`, `beta`, `hidden`, `ready`), nullable bounded `admin_comment`, boolean `incorrect_description`, `updated_at`, and `updated_by`; (2) add/register a TypeORM EntitySchema; (3) add `pilotFeatureReviewService` functions to list composed features with default review state, upsert review state, validate status/comment/feature ID, and refuse unknown catalog IDs; (4) add service tests using a minimal in-memory/fake DataSource or narrow mocks where a real Postgres connection is unavailable. Failure/load/negative tests: missing DB should be represented as an explicit service error for routes to map to 503; invalid status/oversized comments write no row; list cost is one catalog load plus one bounded review query. Done when review state can be composed and persisted independently of Express routes.
  - Files: `db/application_postgres.sql`, `backend/src/db/applicationDataSource.ts`, `backend/src/db/entities/PilotFeatureReviewEntity.ts`, `backend/src/services/pilotFeatureReviewService.ts`, `backend/src/services/pilotFeatureReviewService.test.ts`
  - Verify: npm --prefix backend test -- --test-name-pattern "pilot feature review service"

- [x] **T03: Expose the admin pilot feature inventory API** `est:1h30m`
  Expected executor skills: api-design, tdd, observability. Expose the catalog + review state through admin endpoints using existing X-Admin-Key auth. API contract: `GET /api/admin/pilot-features?surface=&status=&limit=&offset=` returns `{ items, total, limit, offset, databaseAvailable }`; `PATCH /api/admin/pilot-features/:featureId/review` accepts `{ status?, adminComment?, incorrectDescription?, updatedBy? }` and returns `{ feature }`. Steps: (1) wire list and patch routes into `backend/src/routes/admin.ts`; (2) clamp pagination (`limit` 1..200) and validate filters/body through the schema/service; (3) map errors honestly: 400/422 invalid input, 404 unknown feature, 503 missing DB, inherited 401 auth; (4) add route tests for list composition, filter/pagination, PATCH read-after-write, unknown feature, invalid status/comment, and missing DB behavior. Failure modes/negative tests: route must not serve partial catalog after validation failure, must not 200-with-error, and must not create review rows for unknown catalog IDs. Done when the frontend task can rely on the exact endpoint shapes.
  - Files: `backend/src/routes/admin.ts`, `backend/src/routes/adminPilotFeatures.test.ts`
  - Verify: npm --prefix backend test -- --test-name-pattern "admin pilot features"

- [x] **T04: Add the admin Pilot Features review UI** `est:2h`
  Expected executor skills: react-best-practices, frontend-design, accessibility, api-design. Build the real admin workflow for R002. Steps: (1) extend `frontend/src/api/admin.ts` with `PilotFeature`, `PilotFeatureReview`, list response types, `adminListPilotFeatures`, and `adminUpdatePilotFeatureReview`; (2) add a `features` section/tab to `frontend/src/pages/Admin.tsx`; (3) add a Pilot Features panel with search/filter controls, feature cards, immutable catalog fields, status select, incorrect-description checkbox, comment textarea, updated metadata, and save affordance; (4) use React Query invalidation after save so read-after-write is visible; (5) preserve existing admin auth/session behavior and use neutral nameless copy. Failure/load/negative tests: API errors show inline/admin error state without silently discarding drafts; empty API response renders a useful empty state; filters can be cleared; current pilot inventory is small but UI should stay usable at dozens of features. Done when a non-technical stakeholder can browse descriptions/error handling and update review state from `/admin`.
  - Files: `frontend/src/api/admin.ts`, `frontend/src/pages/Admin.tsx`
  - Verify: npm --prefix frontend run build

- [x] **T05: Document and verify the inventory boundary contract** `est:1h`
  Expected executor skills: verify-before-complete, tdd, write-docs. Close the slice by making the boundary contract durable for downstream slices. Steps: (1) add `docs/pilot-features/README.md` explaining catalog format, statuses, `pilotRecommendation`, and how S02 should use WhatsApp/naming-sensitive entries; (2) tighten catalog/API tests to assert every served item has the immutable fields plus mutable review state; (3) add a lightweight completeness assertion that at least one Telegram feature and several Web/admin pilot features are represented without asserting brittle prose; (4) run backend tests and frontend build and fix integration issues. Failure/negative tests: fail if `errorHandling` or `evidencePaths` disappear, if Telegram coverage disappears, or if review state does not survive read-after-write. Done when verification evidence covers catalog, API, persistence contract, and frontend build without relying on `.gsd/` or ignored runtime/user workspace files.
  - Files: `docs/pilot-features/README.md`, `backend/src/services/pilotFeatureCatalogService.test.ts`, `backend/src/services/pilotFeatureReviewService.test.ts`, `backend/src/routes/adminPilotFeatures.test.ts`, `docs/pilot-features/pilot-core.json`
  - Verify: npm --prefix backend test && npm --prefix frontend run build

## Files Likely Touched

- docs/pilot-features/pilot-core.json
- backend/src/schemas/pilotFeature.ts
- backend/src/services/pilotFeatureCatalogService.ts
- backend/src/services/pilotFeatureCatalogService.test.ts
- db/application_postgres.sql
- backend/src/db/applicationDataSource.ts
- backend/src/db/entities/PilotFeatureReviewEntity.ts
- backend/src/services/pilotFeatureReviewService.ts
- backend/src/services/pilotFeatureReviewService.test.ts
- backend/src/routes/admin.ts
- backend/src/routes/adminPilotFeatures.test.ts
- frontend/src/api/admin.ts
- frontend/src/pages/Admin.tsx
- docs/pilot-features/README.md
