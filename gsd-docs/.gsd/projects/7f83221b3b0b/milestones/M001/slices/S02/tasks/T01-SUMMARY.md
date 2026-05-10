---
id: T01
parent: S02
milestone: M001
key_files:
  - frontend/src/pages/Settings.tsx
  - scripts/verify-pilot-surface.mjs
  - frontend/src/components/ui/TickerSearch.tsx
  - frontend/src/pages/Admin.tsx
  - frontend/src/pages/Controls.tsx
  - frontend/src/pages/Onboarding.tsx
  - frontend/src/pages/Portfolio.tsx
  - frontend/src/components/portfolio/AddPositionModal.tsx
  - /root/codex/production-reports/20260510T031206Z-s02-pilot-surface-gating.md
key_decisions:
  - Keep dormant frontend WhatsApp API helpers available while removing Settings imports/calls, matching the S02 boundary that backend/dormant code may remain hidden.
  - Sanitize Settings notification preferences on load and save so stale stored WhatsApp preferences cannot be re-submitted by the pilot UI.
duration: 
verification_result: passed
completed_at: 2026-05-10T03:14:10.828Z
blocker_discovered: false
---

# T01: Hidden WhatsApp setup/selection from pilot Settings and verified the frontend gate/build for T01.

**Hidden WhatsApp setup/selection from pilot Settings and verified the frontend gate/build for T01.**

## What Happened

T01 continued from a partially edited Settings surface. The Settings page no longer imports or calls WhatsApp connect/disconnect helpers, no longer renders the WhatsApp connection/setup form, no longer exposes WhatsApp as a primary or enabled notification channel, and sanitizes notification preferences so `whatsapp` is forced false before rendering and saving. The verification script already encoded those Settings policy assertions and was kept as the executable guard. The required frontend lint gate initially failed on unrelated existing React/TypeScript lint errors, so I made minimal behavior-preserving fixes to unblock the S02 verification contract: moved TickerSearch input-driven state changes out of a set-state-in-effect pattern, avoided render-time `Date.now()` in the admin activity badge, added a missing Controls callback dependency, simplified an Onboarding currency type, removed a Portfolio state-sync effect by opening the target position directly, removed a nonessential expanded-account sync effect, and stabilized the AddPositionModal empty accounts fallback.

## Verification

Ran `node scripts/verify-pilot-surface.mjs && npm --prefix frontend run lint && npm --prefix frontend run build` after the final code changes. The pilot surface verifier passed, ESLint exited successfully with two warnings, TypeScript compiled, and Vite built the frontend bundle successfully.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `node scripts/verify-pilot-surface.mjs && npm --prefix frontend run lint && npm --prefix frontend run build` | 0 | ✅ pass | 12600ms |

## Deviations

Verification required `npm --prefix frontend run lint`; fixing the lint gate required minimal cleanup in existing frontend files outside the T01 file list: TickerSearch, Admin, Controls, Onboarding, Portfolio, and AddPositionModal. The S02 policy change itself remains centered on Settings and the verification script.

## Known Issues

`npm --prefix frontend run lint` still reports two warnings in `frontend/src/pages/Admin.tsx` about the `features` fallback array changing hook dependencies; the lint command exits 0 and the build passes. Vite also reports a large chunk warning, pre-existing and not specific to S02.

## Files Created/Modified

- `frontend/src/pages/Settings.tsx`
- `scripts/verify-pilot-surface.mjs`
- `frontend/src/components/ui/TickerSearch.tsx`
- `frontend/src/pages/Admin.tsx`
- `frontend/src/pages/Controls.tsx`
- `frontend/src/pages/Onboarding.tsx`
- `frontend/src/pages/Portfolio.tsx`
- `frontend/src/components/portfolio/AddPositionModal.tsx`
- `/root/codex/production-reports/20260510T031206Z-s02-pilot-surface-gating.md`
