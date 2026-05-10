---
estimated_steps: 1
estimated_files: 4
skills_used: []
---

# T01: Create the tracked pilot feature catalog and validator

Expected executor skills: tdd, write-docs. Create the immutable catalog contract and first substantive catalog entries. Steps: (1) add Zod schema/types for catalog entries and review status values; (2) inventory current visible Web + Telegram pilot surfaces from the listed route/page files; (3) write `docs/pilot-features/pilot-core.json` with entries for onboarding/portfolio, reports, strategies, alerts/notifications, Telegram/daily brief, chat, controls/settings, and admin/operator surfaces; (4) add a deterministic loader that validates all `docs/pilot-features/*.json`, rejects duplicate IDs, sorts by surface/title/id, and rejects evidence paths pointing to `users/`, `.env`, or ignored runtime locations; (5) add node:test coverage for valid load, duplicate ID, invalid shape, sorting, and unsafe evidence paths. Failure modes/negative tests: malformed JSON or schema violations must fail loudly with the path/reason; duplicate IDs and missing `errorHandling` must fail tests. Done when the loader returns typed entries with the exact boundary-map fields and the catalog JSON contains substantive non-placeholder Web + Telegram coverage.

## Inputs

- `frontend/src/App.tsx`
- `frontend/src/pages/Portfolio.tsx`
- `frontend/src/pages/Reports.tsx`
- `frontend/src/pages/Strategies.tsx`
- `frontend/src/pages/Alerts.tsx`
- `frontend/src/pages/Chat.tsx`
- `frontend/src/pages/Controls.tsx`
- `frontend/src/pages/Settings.tsx`
- `backend/src/routes/telegram.ts`
- `backend/src/routes/notifications.ts`

## Expected Output

- `docs/pilot-features/pilot-core.json`
- `backend/src/schemas/pilotFeature.ts`
- `backend/src/services/pilotFeatureCatalogService.ts`
- `backend/src/services/pilotFeatureCatalogService.test.ts`

## Verification

npm --prefix backend test -- --test-name-pattern "pilot feature catalog"
