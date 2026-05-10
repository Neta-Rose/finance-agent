---
estimated_steps: 30
estimated_files: 5
skills_used: []
---

# T03: Mark WhatsApp deferred in feature inventory and close verification

Expected installed skills: `test`, `write-docs`, `verify-before-complete`.

Update the S01 pilot feature inventory so owner/admin review surfaces accurately describe WhatsApp as hidden/deferred rather than pilot-ready, then close the full S02 verification set. This task completes R004’s catalog contract and proves the changed inventory still satisfies the existing backend catalog loader tests.

Steps:
1. Update `docs/pilot-features/pilot-core.json` so the Settings/catalog entry no longer claims WhatsApp setup is part of the pilot-ready happy path or error-handling path; if WhatsApp must be mentioned, mark it unavailable/deferred and keep `pilotRecommendation` truthful.
2. Update `docs/pilot-features/README.md` only if the S02 guidance needs sharper wording for future maintainers; preserve the S01 boundary that catalog JSON is immutable product inventory and Postgres stores mutable review state.
3. Extend `scripts/verify-pilot-surface.mjs` with catalog assertions: parse `docs/pilot-features/pilot-core.json`, fail on invalid JSON, and fail if any `pilotRecommendation: "pilot"` entry promotes WhatsApp as supported/ready.
4. Run `npm --prefix backend test -- --test-name-pattern "pilot feature"` to verify catalog schema, duplicate IDs, evidence pointers, and admin composition behavior remain valid.
5. Run the complete slice verification set and fix any remaining failures in changed tracked files.

Must-haves:
- R004 is enforced in the feature catalog: WhatsApp is not described as a pilot-ready channel.
- Catalog evidence paths remain tracked, non-sensitive source files.
- All slice verification commands pass in the current worktree.
- Final summary states that dormant WhatsApp backend/schema compatibility may still exist but is no longer pilot-advertised in frontend/catalog/public product copy.

Failure Modes:

| Dependency | On error | On timeout | On malformed response |
|------------|----------|------------|------------------------|
| Backend pilot feature tests | Fix catalog/schema/evidence issues or report a blocker with exact failing assertion. | Re-run once only for transient test-runner startup; otherwise record the timeout. | Treat invalid catalog JSON/schema as a task failure to fix. |
| Frontend build/lint tooling | Fix source/type issues or report a blocker with exact command output. | Re-run once only if dependency install/cache is clearly still warming; otherwise record the timeout. | Treat compiler/linter parser failures as source syntax issues to fix. |

Load Profile:

- **Shared resources**: Local Node toolchain only.
- **Per-operation cost**: One static script, filtered backend tests, frontend lint, frontend build.
- **10x breakpoint**: Not runtime-user-load sensitive; command duration may grow with frontend size but remains acceptable for pilot verification.

Negative Tests:

- **Malformed inputs**: Verification script should fail on JSON parse errors in `docs/pilot-features/pilot-core.json` and report the catalog file path.
- **Error paths**: Backend pilot feature tests must fail if catalog schema/evidence paths become invalid, and frontend build failures must block completion.
- **Boundary conditions**: Catalog guidance may mention WhatsApp only as unavailable/deferred/hidden, never as a pilot-ready channel.

Observability Impact:

- Signals added/changed: Extends the static policy script so catalog channel-policy regressions are diagnosable with concrete file-level assertions.
- How a future agent inspects this: Re-run `node scripts/verify-pilot-surface.mjs` and `npm --prefix backend test -- --test-name-pattern "pilot feature"`.
- Failure state exposed: Invalid catalog policy, invalid catalog schema, lint issues, and build failures are reported before runtime.

## Inputs

- `docs/pilot-features/pilot-core.json`
- `docs/pilot-features/README.md`
- `scripts/verify-pilot-surface.mjs`
- `backend/src/services/pilotFeatureCatalogService.test.ts`
- `backend/src/routes/adminPilotFeatures.test.ts`

## Expected Output

- `docs/pilot-features/pilot-core.json`
- `docs/pilot-features/README.md`
- `scripts/verify-pilot-surface.mjs`

## Verification

node scripts/verify-pilot-surface.mjs && npm --prefix backend test -- --test-name-pattern "pilot feature" && npm --prefix frontend run lint && npm --prefix frontend run build

## Observability Impact

Extends `scripts/verify-pilot-surface.mjs` to expose exact catalog policy regressions for R004 and relies on backend pilot feature tests for schema/evidence diagnostics.
