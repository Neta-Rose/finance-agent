---
estimated_steps: 28
estimated_files: 5
skills_used: []
---

# T01: Hide WhatsApp from pilot Settings and notification controls

Expected installed skills: `react-best-practices`, `verify-before-complete`.

Remove pilot-visible WhatsApp setup and delivery affordances from the real Settings UI while preserving supported Web and Telegram behavior. Keep dormant backend/API types only where needed for existing response compatibility, but the rendered Settings page must not allow a pilot user to connect WhatsApp, disconnect WhatsApp, or choose WhatsApp as a primary/enabled notification channel.

Steps:
1. In `frontend/src/pages/Settings.tsx`, remove WhatsApp connection imports, local form state, connect/disconnect handlers, WhatsApp setup section, WhatsApp primary-channel option, and WhatsApp notification-channel checkbox from the rendered UI.
2. Ensure notification state written from Settings cannot newly enable WhatsApp from this UI; preserve the existing `enabledChannels.whatsapp` shape as `false` or existing backend-compatible data without rendering a control.
3. Clean `frontend/src/store/i18n.ts` only for translation keys that become unused because the WhatsApp setup form is hidden; do not remove backend API schema compatibility types needed elsewhere.
4. Add `scripts/verify-pilot-surface.mjs` as a tracked Node assertion script. It must fail with actionable file/path messages if Settings imports/calls WhatsApp onboarding, renders WhatsApp setup controls, or offers a WhatsApp primary/checkbox delivery option.
5. Run the verification commands listed below and fix any type/lint/build failures introduced by the UI change.

Must-haves:
- Settings still supports Telegram connection, Web delivery, schedule/theme/account/password preferences, and notification categories.
- WhatsApp is not rendered as a connectable or selectable delivery channel in Settings.
- The verification script checks real tracked source files and does not read ignored `.gsd/`, runtime data, or user workspace files.

Failure Modes:

| Dependency | On error | On timeout | On malformed response |
|------------|----------|------------|------------------------|
| `fetchOnboardStatus` / settings APIs | Preserve existing Settings error/toast behavior; this task must not add new API calls. | Preserve existing loading/error behavior; no new retry loop. | Keep existing frontend type guards/optional chaining; do not introduce unchecked WhatsApp assumptions. |

Load Profile:

- **Shared resources**: Existing Settings React Query cache and settings APIs.
- **Per-operation cost**: No added network calls; fewer UI actions can submit unsupported WhatsApp credentials.
- **10x breakpoint**: Unchanged from existing Settings page; this task should not add polling or broad scans at runtime.

Negative Tests:

- **Malformed inputs**: Verification script should fail if a future change reintroduces `connectWhatsApp`, `disconnectWhatsApp`, `setShowWhatsAppForm`, or a rendered `value="whatsapp"` Settings option/control.
- **Error paths**: Frontend build/lint must catch stale imports, removed translation keys, and incompatible notification types.
- **Boundary conditions**: Settings must still render when backend status includes a legacy connected WhatsApp object; the UI simply must not advertise or allow changing it.

Observability Impact:

- Signals added/changed: Adds static policy diagnostics through `scripts/verify-pilot-surface.mjs` with explicit failure messages.
- How a future agent inspects this: Run `node scripts/verify-pilot-surface.mjs` and read the failed assertion path.
- Failure state exposed: Reintroduced unsupported WhatsApp UI is identified before deployment by file and invariant name.

## Inputs

- `frontend/src/pages/Settings.tsx`
- `frontend/src/store/i18n.ts`
- `frontend/src/api/onboarding.ts`
- `frontend/src/types/api.ts`

## Expected Output

- `frontend/src/pages/Settings.tsx`
- `frontend/src/store/i18n.ts`
- `scripts/verify-pilot-surface.mjs`

## Verification

node scripts/verify-pilot-surface.mjs && npm --prefix frontend run lint && npm --prefix frontend run build

## Observability Impact

Adds a deterministic static policy check (`scripts/verify-pilot-surface.mjs`) that fails fast if unsupported WhatsApp Settings controls return.
