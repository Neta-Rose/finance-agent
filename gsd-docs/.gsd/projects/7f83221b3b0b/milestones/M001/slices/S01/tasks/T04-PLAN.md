---
estimated_steps: 1
estimated_files: 2
skills_used: []
---

# T04: Add the admin Pilot Features review UI

Expected executor skills: react-best-practices, frontend-design, accessibility, api-design. Build the real admin workflow for R002. Steps: (1) extend `frontend/src/api/admin.ts` with `PilotFeature`, `PilotFeatureReview`, list response types, `adminListPilotFeatures`, and `adminUpdatePilotFeatureReview`; (2) add a `features` section/tab to `frontend/src/pages/Admin.tsx`; (3) add a Pilot Features panel with search/filter controls, feature cards, immutable catalog fields, status select, incorrect-description checkbox, comment textarea, updated metadata, and save affordance; (4) use React Query invalidation after save so read-after-write is visible; (5) preserve existing admin auth/session behavior and use neutral nameless copy. Failure/load/negative tests: API errors show inline/admin error state without silently discarding drafts; empty API response renders a useful empty state; filters can be cleared; current pilot inventory is small but UI should stay usable at dozens of features. Done when a non-technical stakeholder can browse descriptions/error handling and update review state from `/admin`.

## Inputs

- `frontend/src/api/admin.ts`
- `frontend/src/pages/Admin.tsx`
- `backend/src/routes/admin.ts`
- `backend/src/schemas/pilotFeature.ts`

## Expected Output

- `frontend/src/api/admin.ts`
- `frontend/src/pages/Admin.tsx`

## Verification

npm --prefix frontend run build

## Observability Impact

Signals: visible loading, empty, dirty, saving, saved, and API-error states in the admin UI. Inspection: open `/admin`, select Pilot Features, and verify network calls to `/api/admin/pilot-features`. Failure state exposed: list/save errors are visible in the panel or existing admin error banner.
