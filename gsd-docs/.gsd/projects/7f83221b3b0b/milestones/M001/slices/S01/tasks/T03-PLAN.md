---
estimated_steps: 1
estimated_files: 2
skills_used: []
---

# T03: Expose the admin pilot feature inventory API

Expected executor skills: api-design, tdd, observability. Expose the catalog + review state through admin endpoints using existing X-Admin-Key auth. API contract: `GET /api/admin/pilot-features?surface=&status=&limit=&offset=` returns `{ items, total, limit, offset, databaseAvailable }`; `PATCH /api/admin/pilot-features/:featureId/review` accepts `{ status?, adminComment?, incorrectDescription?, updatedBy? }` and returns `{ feature }`. Steps: (1) wire list and patch routes into `backend/src/routes/admin.ts`; (2) clamp pagination (`limit` 1..200) and validate filters/body through the schema/service; (3) map errors honestly: 400/422 invalid input, 404 unknown feature, 503 missing DB, inherited 401 auth; (4) add route tests for list composition, filter/pagination, PATCH read-after-write, unknown feature, invalid status/comment, and missing DB behavior. Failure modes/negative tests: route must not serve partial catalog after validation failure, must not 200-with-error, and must not create review rows for unknown catalog IDs. Done when the frontend task can rely on the exact endpoint shapes.

## Inputs

- `backend/src/schemas/pilotFeature.ts`
- `backend/src/services/pilotFeatureCatalogService.ts`
- `backend/src/services/pilotFeatureReviewService.ts`
- `backend/src/routes/admin.ts`
- `backend/src/routes/fullReportRoutes.test.ts`

## Expected Output

- `backend/src/routes/admin.ts`
- `backend/src/routes/adminPilotFeatures.test.ts`

## Verification

npm --prefix backend test -- --test-name-pattern "admin pilot features"

## Observability Impact

Signals: route logs catalog/review update failures with feature ID and safe reason. Inspection: `GET /api/admin/pilot-features` shows composed state and `databaseAvailable`; route tests document expected failure shapes.
