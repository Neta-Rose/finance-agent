---
estimated_steps: 1
estimated_files: 5
skills_used: []
---

# T05: Document and verify the inventory boundary contract

Expected executor skills: verify-before-complete, tdd, write-docs. Close the slice by making the boundary contract durable for downstream slices. Steps: (1) add `docs/pilot-features/README.md` explaining catalog format, statuses, `pilotRecommendation`, and how S02 should use WhatsApp/naming-sensitive entries; (2) tighten catalog/API tests to assert every served item has the immutable fields plus mutable review state; (3) add a lightweight completeness assertion that at least one Telegram feature and several Web/admin pilot features are represented without asserting brittle prose; (4) run backend tests and frontend build and fix integration issues. Failure/negative tests: fail if `errorHandling` or `evidencePaths` disappear, if Telegram coverage disappears, or if review state does not survive read-after-write. Done when verification evidence covers catalog, API, persistence contract, and frontend build without relying on `.gsd/` or ignored runtime/user workspace files.

## Inputs

- `backend/src/services/pilotFeatureCatalogService.test.ts`
- `backend/src/services/pilotFeatureReviewService.test.ts`
- `backend/src/routes/adminPilotFeatures.test.ts`
- `docs/pilot-features/pilot-core.json`
- `frontend/src/pages/Admin.tsx`
- `frontend/src/api/admin.ts`

## Expected Output

- `docs/pilot-features/README.md`
- `backend/src/services/pilotFeatureCatalogService.test.ts`
- `backend/src/services/pilotFeatureReviewService.test.ts`
- `backend/src/routes/adminPilotFeatures.test.ts`
- `docs/pilot-features/pilot-core.json`

## Verification

npm --prefix backend test && npm --prefix frontend run build
