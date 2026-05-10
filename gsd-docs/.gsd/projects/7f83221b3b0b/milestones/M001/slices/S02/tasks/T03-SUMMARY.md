---
id: T03
parent: S02
milestone: M001
key_files:
  - docs/pilot-features/pilot-core.json
  - scripts/verify-pilot-surface.mjs
key_decisions:
  - Catalog policy now permits WhatsApp mentions in pilot entries only when the same text frames WhatsApp as hidden, deferred, unavailable, or blocked.
  - Keep backend WhatsApp/webhook/notification compatibility code untouched; S02 only removes pilot advertising and visible setup/selection paths.
duration: 
verification_result: passed
completed_at: 2026-05-10T03:16:25.083Z
blocker_discovered: false
---

# T03: Marked WhatsApp hidden/deferred in the pilot feature catalog and passed the full S02 verification contract.

**Marked WhatsApp hidden/deferred in the pilot feature catalog and passed the full S02 verification contract.**

## What Happened

T03 updated the S01 pilot feature catalog entry for controls/settings so it no longer claims WhatsApp setup is part of the pilot-ready settings path. The entry now states Settings supports Telegram and Web notification preferences while WhatsApp setup and delivery controls are hidden/deferred. The static policy verifier now parses `docs/pilot-features/pilot-core.json`, reports malformed JSON with the catalog path, and checks every `pilotRecommendation: "pilot"` entry so WhatsApp can only appear when described as hidden/deferred/unavailable/blocked. The complete S02 verification set passed, including the backend pilot feature tests that validate catalog schema, duplicate IDs, evidence paths, admin API composition, and review-state behavior.

## Verification

Ran `node scripts/verify-pilot-surface.mjs && npm --prefix backend test -- --test-name-pattern "pilot feature" && npm --prefix frontend run lint && npm --prefix frontend run build`. The verifier passed, backend reported 43 tests passed and 0 failed, frontend lint exited 0 with warnings, and frontend build completed successfully.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `node scripts/verify-pilot-surface.mjs && npm --prefix backend test -- --test-name-pattern "pilot feature" && npm --prefix frontend run lint && npm --prefix frontend run build` | 0 | ✅ pass | 16700ms |

## Deviations

None.

## Known Issues

Frontend lint exits 0 but reports two warnings in `frontend/src/pages/Admin.tsx`; Vite reports the existing large bundle warning.

## Files Created/Modified

- `docs/pilot-features/pilot-core.json`
- `scripts/verify-pilot-surface.mjs`
