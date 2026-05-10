---
id: S02
parent: M001
milestone: M001
provides:
  - Pilot-visible channel policy: Web + Telegram enabled/presented; WhatsApp hidden/deferred.
  - Naming/copy invariant: pilot-facing frontend and public README copy avoid old/internal product names.
  - Executable static diagnostic for S02 policy regressions.
requires:
  - slice: S01
    provides: S01 pilot feature catalog schema, evidence-path validation, and admin inventory contract.
affects:
  - S03 — consumes Web + Telegram channel policy for notification composition and delivery.
  - S04/S05/S06 — consume nameless copy policy for saved chat, advisory chat, and readability work.
  - S08 — consumes S02 static policy proof before live Web + Telegram rehearsal.
key_files:
  - frontend/src/pages/Settings.tsx
  - frontend/src/store/i18n.ts
  - README.md
  - scripts/verify-pilot-surface.mjs
  - docs/pilot-features/pilot-core.json
  - frontend/src/components/ui/TickerSearch.tsx
  - frontend/src/pages/Admin.tsx
  - frontend/src/pages/Controls.tsx
  - frontend/src/pages/Onboarding.tsx
  - frontend/src/pages/Portfolio.tsx
  - frontend/src/components/portfolio/AddPositionModal.tsx
  - /root/codex/production-reports/20260510T031206Z-s02-pilot-surface-gating.md
key_decisions:
  - Dormant WhatsApp backend/API compatibility remains untouched; S02 controls only visible pilot UI, README/catalog copy, and static policy enforcement.
  - Settings sanitizes notification preferences on both load and save so stale stored WhatsApp values cannot leak back into pilot saves.
  - Pilot catalog entries with `pilotRecommendation: "pilot"` may mention WhatsApp only as hidden, deferred, unavailable, or blocked.
patterns_established:
  - Pilot-facing channel policy is enforced as a static source/catalog invariant before runtime rehearsal.
  - Dormant compatibility code may remain when the pilot surface and catalog make the unsupported path invisible/deferred.
observability_surfaces:
  - `scripts/verify-pilot-surface.mjs` provides file-level diagnostics for Settings WhatsApp regressions, old/internal copy regressions, README delivery-surface regressions, malformed catalog JSON, and pilot catalog entries that promote WhatsApp.
drill_down_paths:
  - .gsd/milestones/M001/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M001/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-05-10T03:17:28.925Z
blocker_discovered: false
---

# S02: Pilot Surface Gating + Nameless Copy

**Pilot-facing surfaces now present Web + Telegram only, hide/defer WhatsApp, and use neutral nameless product copy with executable policy checks.**

## What Happened

S02 turned the pilot surface into an intentional Web + Telegram experience. Settings no longer renders WhatsApp setup or notification choices, and notification preferences are sanitized so stale stored WhatsApp values are converted away before rendering and forced disabled on save. Public/product copy now avoids the old product name and describes pilot delivery as Telegram or web. The pilot feature inventory now says WhatsApp setup/delivery controls are hidden/deferred rather than pilot-ready. The policy script was extended into the authoritative diagnostic for this slice: it checks the Settings source, frontend translations, README copy, and catalog JSON policy, including malformed catalog JSON reporting. The frontend verification contract initially exposed unrelated lint blockers, so those were fixed minimally to make the required lint/build gates executable.

## Verification

Full S02 verification passed with: `node scripts/verify-pilot-surface.mjs && npm --prefix backend test -- --test-name-pattern "pilot feature" && npm --prefix frontend run lint && npm --prefix frontend run build`. Evidence: policy script passed; backend reported 43 tests passed, 0 failed; frontend lint exited 0 with two warnings; TypeScript/Vite build completed successfully.

## Requirements Advanced

- R003 — Removed old/internal names from checked pilot-facing copy and added static policy assertions.
- R004 — Removed visible WhatsApp setup/selection from Settings, forced WhatsApp disabled in notification saves, and marked catalog references hidden/deferred.

## Requirements Validated

- R003 — `scripts/verify-pilot-surface.mjs` checks frontend translations and README for old/internal names; full S02 verification passed.
- R004 — Settings source, README copy, and pilot catalog policy are checked by `scripts/verify-pilot-surface.mjs`; backend pilot feature tests and frontend lint/build passed.

## New Requirements Surfaced

- None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

The required frontend lint gate initially failed on unrelated existing lint errors, so minimal lint cleanup was performed outside the original S02 file list. No S02 scope was expanded beyond making the required verification executable.

## Known Limitations

This slice proves source/catalog/build policy only; it does not run a live browser UAT or prove actual Telegram delivery. S08 owns live Web + Telegram rehearsal. Backend WhatsApp routes/services remain dormant and are not hardened here.

## Follow-ups

Deploy S02 before starting S03 unless the human explicitly defers deployment. Two pre-existing Admin lint warnings and the Vite large chunk warning remain non-blocking but should be cleaned up opportunistically.

## Files Created/Modified

- `frontend/src/pages/Settings.tsx` — Removed visible WhatsApp setup controls and notification selection, and sanitizes notification preferences so WhatsApp is forced disabled before render/save.
- `frontend/src/store/i18n.ts` — Replaced old product-name copy with neutral portfolio-assistant language.
- `README.md` — Rewrote public product copy to use neutral naming and Web + Telegram pilot delivery language.
- `scripts/verify-pilot-surface.mjs` — Added executable policy checks for Settings WhatsApp hiding, nameless copy, README delivery surface, and catalog WhatsApp deferral.
- `docs/pilot-features/pilot-core.json` — Updated settings/catalog wording so WhatsApp is hidden/deferred rather than pilot-ready.
- `frontend/src/components/ui/TickerSearch.tsx` — Minimal lint-gate cleanup required for the frontend verification command.
- `frontend/src/pages/Admin.tsx` — Minimal lint-gate cleanup required for the frontend verification command.
- `frontend/src/pages/Controls.tsx` — Minimal lint-gate cleanup required for the frontend verification command.
- `frontend/src/pages/Onboarding.tsx` — Minimal lint-gate cleanup required for the frontend verification command.
- `frontend/src/pages/Portfolio.tsx` — Minimal lint-gate cleanup required for the frontend verification command.
- `frontend/src/components/portfolio/AddPositionModal.tsx` — Stabilized empty accounts fallback for lint dependency analysis.
- `/root/codex/production-reports/20260510T031206Z-s02-pilot-surface-gating.md` — Production change report for S02 rollout planning and rollback criteria.
