---
estimated_steps: 20
estimated_files: 3
skills_used: []
---

# T02: Neutralize pilot-facing product copy

Expected installed skills: `write-docs`, `verify-before-complete`.

Apply the nameless-copy invariant to pilot-facing frontend and public/product copy while preserving internal identifiers, package names, API headers, operational docs, and dormant backend code. This task closes the user-visible copy side of R003 and extends the policy script so the invariant is executable.

Steps:
1. Replace pilot-facing frontend translation text in `frontend/src/store/i18n.ts` that says “Clawd” or “finance-agent” with neutral copy such as “your portfolio assistant.”
2. Update public/product-facing `README.md` copy so it no longer presents WhatsApp as a supported pilot delivery channel or spreads “Clawd” as the user-facing product brand.
3. Extend `scripts/verify-pilot-surface.mjs` with copy assertions for `frontend/src/store/i18n.ts` and `README.md`, with allowlists only for internal/non-user-facing identifiers explicitly documented in the script.
4. Do not rewrite internal `CLAUDE.md`, `SOUL.md`, deployment scripts, API headers, database schemas, or package names.
5. Run the task verification commands and fix stale translations/types/lint issues in the changed files.

Must-haves:
- R003 is enforced for pilot-facing frontend copy and public/product README copy.
- Public copy says Web and Telegram are the pilot delivery surfaces; WhatsApp is absent or explicitly deferred, never promoted.
- Internal code identifiers and dormant backend compatibility names remain untouched unless a build failure proves a direct dependency.

Negative Tests:

- **Malformed inputs**: Verification script should fail if forbidden names reappear in checked user-facing files.
- **Error paths**: Frontend build/lint must fail on stale translation keys or type errors introduced by copy cleanup.
- **Boundary conditions**: The static scan must distinguish user-facing copy from internal identifiers such as `x-clawd-*`, package names, and dormant backend code.

Observability Impact:

- Signals added/changed: Extends `scripts/verify-pilot-surface.mjs` with naming-policy diagnostics.
- How a future agent inspects this: Run the policy script and inspect its file-level assertion failures.
- Failure state exposed: Reintroduced pilot-facing “Clawd”/“finance-agent” language is reported before runtime.

## Inputs

- `frontend/src/store/i18n.ts`
- `README.md`
- `scripts/verify-pilot-surface.mjs`

## Expected Output

- `frontend/src/store/i18n.ts`
- `README.md`
- `scripts/verify-pilot-surface.mjs`

## Verification

node scripts/verify-pilot-surface.mjs && npm --prefix frontend run lint && npm --prefix frontend run build

## Observability Impact

Extends `scripts/verify-pilot-surface.mjs` to expose exact naming-policy regressions for R003.
