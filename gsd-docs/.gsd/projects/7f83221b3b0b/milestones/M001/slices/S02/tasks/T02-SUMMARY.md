---
id: T02
parent: S02
milestone: M001
key_files:
  - frontend/src/store/i18n.ts
  - README.md
  - scripts/verify-pilot-surface.mjs
key_decisions:
  - Enforce nameless pilot-facing copy in `scripts/verify-pilot-surface.mjs` by scanning `frontend/src/store/i18n.ts` and `README.md` for old/internal product identifiers.
  - Keep dormant WhatsApp translation keys untouched because T01 already verifies Settings does not render them; T02 only prevents README from promoting WhatsApp as a supported pilot delivery channel.
duration: 
verification_result: passed
completed_at: 2026-05-10T03:15:24.993Z
blocker_discovered: false
---

# T02: Neutralized pilot-facing product copy and made the naming/channel copy invariant executable.

**Neutralized pilot-facing product copy and made the naming/channel copy invariant executable.**

## What Happened

T02 replaced the public README heading and product references with neutral product language, changed the pilot delivery copy from Telegram/WhatsApp/web to Telegram or web, and updated the remaining pilot-facing translation text that used the old product name. The policy verifier now checks `frontend/src/store/i18n.ts` for old/internal product identifiers and `README.md` for those identifiers plus README-level WhatsApp promotion. The README was cold-read against the intended action: a fresh maintainer can now understand the pilot boundary as Web + Telegram without seeing the old product name presented as the user-facing brand.

## Verification

Ran `node scripts/verify-pilot-surface.mjs && npm --prefix frontend run lint && npm --prefix frontend run build` after the final copy and verifier edits. The pilot surface verifier passed with nameless-copy coverage, ESLint exited successfully with two warnings, TypeScript compiled, and Vite built the frontend bundle successfully.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `node scripts/verify-pilot-surface.mjs && npm --prefix frontend run lint && npm --prefix frontend run build` | 0 | ✅ pass | 11800ms |

## Deviations

None for T02 scope. The frontend lint command still reports two pre-existing Admin warnings but exits 0; the build passes.

## Known Issues

`npm --prefix frontend run lint` reports two warnings in `frontend/src/pages/Admin.tsx` about a `features` fallback array changing hook dependencies; the lint command exits 0. Vite reports a large chunk warning.

## Files Created/Modified

- `frontend/src/store/i18n.ts`
- `README.md`
- `scripts/verify-pilot-surface.mjs`
