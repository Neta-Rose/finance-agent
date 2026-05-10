# S02: Pilot Surface Gating + Nameless Copy — UAT

**Milestone:** M001
**Written:** 2026-05-10T03:17:28.925Z

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: S02 is a source/catalog/copy gating slice. Live browser and real Telegram delivery are intentionally deferred to S08; this slice proves the policy with static source assertions, backend catalog tests, lint, and build.

## Preconditions

- Repository checkout has dependencies installed for backend and frontend.
- No production secrets are required.

## Smoke Test

Run `node scripts/verify-pilot-surface.mjs`. Expected: the script reports that WhatsApp setup and notification selection are hidden, saves force WhatsApp disabled, and pilot copy stays nameless.

## Test Cases

### 1. Settings hides WhatsApp controls

1. Inspect or run the policy script against `frontend/src/pages/Settings.tsx`.
2. Confirm Settings does not import/call WhatsApp connection helpers, render a WhatsApp setup form, or offer `value="whatsapp"` as a notification channel.
3. **Expected:** The policy script passes; any reintroduced Settings WhatsApp setup/selection path fails with a file-level message.

### 2. Pilot copy is nameless and Web + Telegram scoped

1. Run `node scripts/verify-pilot-surface.mjs`.
2. Check that README copy describes delivery as Telegram or web and frontend translations do not contain old/internal product names.
3. **Expected:** The policy script passes; reintroduced old/internal naming or README WhatsApp promotion fails.

### 3. Catalog marks WhatsApp deferred/hidden

1. Run `node scripts/verify-pilot-surface.mjs`.
2. Run `npm --prefix backend test -- --test-name-pattern "pilot feature"`.
3. **Expected:** The policy script accepts only hidden/deferred/unavailable/blocked WhatsApp mentions in `pilot` catalog entries, and backend catalog/admin tests pass.

## Edge Cases

### Stale stored WhatsApp notification preference

1. Inspect Settings notification save behavior through the policy script.
2. **Expected:** Settings keeps `whatsapp: false` in the saved notification payload, preventing stale stored WhatsApp preferences from being re-submitted by the pilot UI.

### Malformed catalog JSON

1. Temporarily break `docs/pilot-features/pilot-core.json` in a local scratch change.
2. Run `node scripts/verify-pilot-surface.mjs`.
3. **Expected:** The script fails and reports the catalog path and parse reason. Revert the scratch change before continuing.

## Failure Signals

- `scripts/verify-pilot-surface.mjs` fails with a Settings, README, i18n, or catalog policy message.
- Backend pilot feature tests fail catalog schema/evidence/admin composition assertions.
- Frontend lint/build exits non-zero.

## Requirements Proved By This UAT

- R003 — Pilot-facing frontend and README copy avoid old/internal product names.
- R004 — WhatsApp is not presented as a pilot-ready channel in user-facing UI or pilot catalog/public copy.

## Not Proven By This UAT

- Live browser rendering of Settings after deployment.
- Real Telegram delivery or notification formatting.
- WhatsApp backend hardening; dormant backend compatibility remains out of scope.

## Notes for Tester

- Existing backend WhatsApp code can still appear in backend routes/services and dormant frontend API helpers; S02 only requires that it is hidden/deferred from pilot-facing surfaces.
- `npm --prefix frontend run lint` may print two Admin warnings while exiting successfully; those warnings are not S02 policy failures.
