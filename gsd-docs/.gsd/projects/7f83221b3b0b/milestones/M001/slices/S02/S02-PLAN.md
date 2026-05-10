# S02: Pilot Surface Gating + Nameless Copy

**Goal:** Pilot-visible product surfaces present Web and Telegram as the supported pilot channels, hide/defer WhatsApp setup and delivery controls, and use neutral nameless product copy instead of old/internal names.
**Demo:** Pilot users no longer see WhatsApp as supported, and user-facing copy uses neutral nameless product language.

## Must-Haves

- ## Must-Haves
- R004: Settings and notification UI do not present WhatsApp as a pilot-ready connection or selectable delivery channel; dormant backend WhatsApp code may remain untouched when not user-visible.
- R003: Pilot-facing frontend copy and public product README text avoid spreading “Clawd” or “finance-agent” as product/brand names, using neutral language such as “your portfolio assistant.”
- S01 feature inventory reflects the S02 policy: WhatsApp-related behavior is removed from pilot-ready descriptions or explicitly marked hidden/deferred, and evidence paths remain tracked files.
- Verification is executable from a fresh checkout and includes static policy assertions, backend catalog tests, frontend build, and lint/build checks for changed frontend code.
- ## Threat Surface
- **Abuse**: A pilot user should not be able to enter WhatsApp access tokens or select WhatsApp delivery through the UI after this slice. Existing backend webhook/channel code is not hardened here and must not be advertised as pilot-ready.
- **Data exposure**: Removing WhatsApp connection controls reduces the chance that a pilot user submits long-lived WhatsApp access tokens or phone numbers into an unsupported path. Telegram credentials and account settings remain in scope but are not redesigned here.
- **Input trust**: User input still reaches existing settings APIs for schedule, password, Telegram, and notification preferences; the task must avoid introducing new client-side paths that submit unsupported WhatsApp values.
- ## Requirement Impact
- **Requirements touched**: R003, R004.
- **Re-verify**: Settings delivery-channel UI, notification preference serialization, pilot feature catalog validation, public/product copy scan, frontend build.
- **Decisions revisited**: D002 and D003 are honored, not changed.
- ## Proof Level
- This slice proves: contract plus static/build-level UI integration.
- Real runtime required: no; browser/UAT is deferred to S08, but changed code must build and static assertions must inspect the real source files.
- Human/UAT required: no for S02 completion; later pilot rehearsal validates the assembled Web + Telegram loop.
- ## Verification
- `node scripts/verify-pilot-surface.mjs`
- `npm --prefix backend test -- --test-name-pattern "pilot feature"`
- `npm --prefix frontend run lint`
- `npm --prefix frontend run build`

## Proof Level

- This slice proves: Contract plus static/build-level integration proof. This slice proves the source-level channel and naming invariants, pilot catalog contract, and frontend compilation/linting; it does not prove a live browser session or real Telegram delivery.

## Integration Closure

Upstream surfaces consumed: S01 pilot feature catalog contract in `docs/pilot-features/README.md`, `docs/pilot-features/pilot-core.json`, and backend pilot feature tests. New wiring introduced: frontend Settings copy/control changes, public copy changes, catalog policy updates, and a tracked verification script that enforces S02 policy against real repository files. Remaining before milestone end-to-end usability: S03 notification composition/delivery, S04-S05 saved/safe chat, S06 readability, S07 operations visibility, and S08 live Web + Telegram rehearsal.

## Verification

- Runtime signals are intentionally unchanged; this slice is a gating/copy policy change. Diagnostics are provided by `scripts/verify-pilot-surface.mjs`, backend pilot feature tests, and the admin pilot feature inventory entries that document WhatsApp as deferred/hidden rather than pilot-ready. Failure localization should point to the exact source file and policy assertion that violated R003/R004; no secrets or user data should be read.

## Tasks

- [x] **T01: Hide WhatsApp from pilot Settings and notification controls** `est:1h`
  Expected installed skills: `react-best-practices`, `verify-before-complete`.
  - Files: `frontend/src/pages/Settings.tsx`, `frontend/src/store/i18n.ts`, `frontend/src/api/onboarding.ts`, `frontend/src/types/api.ts`, `scripts/verify-pilot-surface.mjs`
  - Verify: node scripts/verify-pilot-surface.mjs && npm --prefix frontend run lint && npm --prefix frontend run build

- [x] **T02: Neutralize pilot-facing product copy** `est:45m`
  Expected installed skills: `write-docs`, `verify-before-complete`.
  - Files: `frontend/src/store/i18n.ts`, `README.md`, `scripts/verify-pilot-surface.mjs`
  - Verify: node scripts/verify-pilot-surface.mjs && npm --prefix frontend run lint && npm --prefix frontend run build

- [x] **T03: Mark WhatsApp deferred in feature inventory and close verification** `est:1h`
  Expected installed skills: `test`, `write-docs`, `verify-before-complete`.
  - Files: `docs/pilot-features/pilot-core.json`, `docs/pilot-features/README.md`, `scripts/verify-pilot-surface.mjs`, `backend/src/services/pilotFeatureCatalogService.test.ts`, `backend/src/routes/adminPilotFeatures.test.ts`
  - Verify: node scripts/verify-pilot-surface.mjs && npm --prefix backend test -- --test-name-pattern "pilot feature" && npm --prefix frontend run lint && npm --prefix frontend run build

## Files Likely Touched

- frontend/src/pages/Settings.tsx
- frontend/src/store/i18n.ts
- frontend/src/api/onboarding.ts
- frontend/src/types/api.ts
- scripts/verify-pilot-surface.mjs
- README.md
- docs/pilot-features/pilot-core.json
- docs/pilot-features/README.md
- backend/src/services/pilotFeatureCatalogService.test.ts
- backend/src/routes/adminPilotFeatures.test.ts
