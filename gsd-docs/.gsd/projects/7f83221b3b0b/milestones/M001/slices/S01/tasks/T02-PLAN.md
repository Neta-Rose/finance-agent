---
estimated_steps: 1
estimated_files: 5
skills_used: []
---

# T02: Add Postgres review-state storage for pilot features

Expected executor skills: postgresql-table-design, tdd, error-handling-patterns. Add the mutable review persistence layer without touching the admin UI yet. Steps: (1) add idempotent DDL for `pilot_feature_reviews` with `feature_id` primary key, constrained `status` values (`unreviewed`, `needs_fix`, `beta`, `hidden`, `ready`), nullable bounded `admin_comment`, boolean `incorrect_description`, `updated_at`, and `updated_by`; (2) add/register a TypeORM EntitySchema; (3) add `pilotFeatureReviewService` functions to list composed features with default review state, upsert review state, validate status/comment/feature ID, and refuse unknown catalog IDs; (4) add service tests using a minimal in-memory/fake DataSource or narrow mocks where a real Postgres connection is unavailable. Failure/load/negative tests: missing DB should be represented as an explicit service error for routes to map to 503; invalid status/oversized comments write no row; list cost is one catalog load plus one bounded review query. Done when review state can be composed and persisted independently of Express routes.

## Inputs

- `backend/src/schemas/pilotFeature.ts`
- `backend/src/services/pilotFeatureCatalogService.ts`
- `backend/src/db/applicationDataSource.ts`
- `db/application_postgres.sql`
- `backend/src/db/entities/FeatureFlagEntity.ts`

## Expected Output

- `db/application_postgres.sql`
- `backend/src/db/entities/PilotFeatureReviewEntity.ts`
- `backend/src/db/applicationDataSource.ts`
- `backend/src/services/pilotFeatureReviewService.ts`
- `backend/src/services/pilotFeatureReviewService.test.ts`

## Verification

npm --prefix backend test -- --test-name-pattern "pilot feature review service"

## Observability Impact

Signals: typed service errors for unavailable DB, invalid review input, unknown feature ID, and catalog load failure. Inspection: query `pilot_feature_reviews` or call the service through route tests. Failure state exposed: invalid input should be machine-classifiable before route mapping.
