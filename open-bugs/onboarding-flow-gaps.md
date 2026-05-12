# Bug: Onboarding Flow — 7 Error Handling & Stability Gaps

**Date discovered:** 2026-05-12
**Affected users:** All new users going through onboarding; authenticated users resuming mid-onboarding
**Reported via:** pilot3 clicking "Review" on portfolio step — button appeared to do nothing
**Status:** Partially fixed (gap #0 deployed); gaps #1–#7 open

---

## Background

During investigation of pilot3's onboarding issue, a full audit of
`frontend/src/pages/Onboarding.tsx` was done. The immediate bug (portfolio Review button
doing nothing) was fixed, and 7 additional gaps were found ranging from misleading error
messages to flows that can leave a user permanently stuck.

---

## Gap #0 — Portfolio field errors not shown (FIXED 2026-05-12)

**Step:** 4 (Portfolio Entry) — "Review" button
**File:** `frontend/src/pages/Onboarding.tsx:579–599` (`Step4.handleNext`),
`frontend/src/pages/Onboarding.tsx:406–412` (`PositionCard` props)

**Symptom:** Clicking "Review" does nothing when shares or avg price fields are empty.
No error messages appear. The button does not advance to the next step.

**Root cause:** `handleNext` at line 579 computes field-level errors keyed as `t_{ai}_{pi}`,
`s_{ai}_{pi}`, `p_{ai}_{pi}` and stores them via `setErrors`. However the `errors` map was
never passed as a prop to `AccountSection` or `PositionCard`, so the messages were computed
and immediately invisible. The only rendered error was `errors.positions` (line 617) which
only fires when there are zero positions total.

**Fix applied:** Added `errors` prop to `AccountSection` and `PositionCard`. Each field
(ticker, shares, avgPrice) now renders its inline error below the input. Deployed 2026-05-12.

---

## Gap #1 — userId conflict and wrong admin key not caught until final Launch

**Step:** 1 (new user account setup) → 5 (Launch)
**File:** `frontend/src/pages/Onboarding.tsx:1007–1067` (`handleSubmit`),
`frontend/src/pages/Onboarding.tsx:185–188` (`Step1.handleNext`),
`backend/src/routes/onboarding.ts:57–130` (`POST /api/onboard/init`)

**Symptom:** A new user fills in admin key, userId, password, display name, then goes through
schedule (step 2), Telegram (step 3), and portfolio (step 4) — 4 full steps. On Launch (step 5)
they get a generic "Setup failed" toast. No field is highlighted. No indication of whether the
admin key was wrong, the userId was already taken, or something else failed.

**Root cause:** `submitOnboardInit` is only called inside `handleSubmit` at step 5 (line 1042).
`Step1.handleNext` (line 185) is purely local validation — it never touches the backend. So
admin key correctness and userId availability are not checked until after the user has invested
time filling in all previous steps. The `catch` block at line 1064 discards the error body
entirely.

**Why the obvious fix won't work:** Calling `POST /api/onboard/init` at step 1 to "pre-validate"
is not safe — the route creates the full workspace, auth.json, and profile.json as side effects
(lines 93–129 of the route). It cannot be used as a read-only check.

**Suggested fix:** Move the actual `submitOnboardInit` call to `Step1.handleNext`, making step 1
an async step (the same pattern `AuthStep1` already uses at line 243). If it succeeds, the account
is created and the user advances. Steps 2–4 then collect schedule/Telegram/portfolio which are all
separate API calls anyway. `handleSubmit` for a non-authenticated user who has already passed step 1
would then only need to do `login` + `submitPortfolio`. This gives the user immediate, step-specific
feedback on the two most likely failure modes (wrong admin key → 401, taken userId → 409) and
eliminates the "wasted 4 steps" problem.

---

## Gap #2 — Telegram "Connect" silently fails for unauthenticated users

**Step:** 3 (Telegram)
**File:** `frontend/src/pages/Onboarding.tsx:339–365` (`Step3.handleConnect`),
`backend/src/routes/onboarding.ts:372` (`POST /api/onboard/telegram`)

**Symptom:** A new user (not yet authenticated) enters their bot token and chat ID and clicks
"Connect". The button shows a loading state, then shows "Telegram connection failed". The user
assumes their credentials are wrong and retries repeatedly. The actual cause has nothing to do
with their input.

**Root cause:** `POST /api/onboard/telegram` is protected by `authMiddleware` — it requires a
valid JWT. New users have no token at step 3; account creation and login happen at step 5. The
`apiClient` call returns 401, which hits the `catch` at line 361 and shows
`t("onboardTelegramFailed")` — the same message used for a genuinely wrong bot token. The two
failure modes are indistinguishable to the user.

**Suggested fix:** When `!isAuthenticated`, do not render the bot token and chat ID inputs or
the Connect button at all. Show a note instead: "You can connect Telegram from Settings after
your account is created." The Skip button remains as the only action. This requires no backend
change and removes a confusing dead end entirely.

---

## Gap #3 — Non-atomic submit leaves new users permanently stuck

**Step:** 5 (Launch) — unauthenticated flow
**File:** `frontend/src/pages/Onboarding.tsx:1007–1067` (`handleSubmit`)

**Symptom:** A new user clicks Launch. The spinner runs briefly, then "Setup failed" appears.
Clicking Launch again produces a different error. Refreshing the page resets everything to step 1
with all fields blank. The user cannot recover without contacting an admin to manually delete the
partially-created account.

**Root cause:** `handleSubmit` for unauthenticated users fires three sequential calls (lines
1042–1049):
1. `submitOnboardInit` — creates workspace, auth.json, profile.json on disk
2. `login` — exchanges credentials for a JWT
3. `submitPortfolio` — writes portfolio.json, queues full_report job

If call #1 succeeds but #2 or #3 fails, the user account now exists on the server. On any retry,
call #1 fails with 409 ("User already exists"). The `loginStore` call at line 1044 is between
calls #2 and #3, so if `submitPortfolio` fails the JWT was already stored — but if `login` fails,
no token is stored and the user cannot even reach the retry path. The `catch` at line 1064 shows
only `t("onboardSetupFailed")` regardless of which call failed.

**Suggested fix (two parts, related to gap #1 fix):**
- If gap #1 is fixed by moving `submitOnboardInit` to step 1, then `handleSubmit` only runs
  `login` + `submitPortfolio` for new users, and the stuck scenario largely disappears.
  `loginStore` should be called immediately after `login` succeeds and before `submitPortfolio`
  runs, so a portfolio failure leaves the user authenticated and able to retry cleanly via the
  `isAuthenticated` branch.
- In the `catch` block, distinguish between failure stages and show a specific message. At
  minimum, extract `err.response?.data?.error` (same pattern used in `completeGuidanceAndLaunch`
  at line 951) rather than discarding it.

---

## Gap #4 — Going back from step 6 re-submits the portfolio

**Step:** 6 (Guidance) → back to 5 (Review) → Continue
**File:** `frontend/src/pages/Onboarding.tsx:1115–1125` (step 6 back button),
`frontend/src/pages/Onboarding.tsx:1103–1113` (step 5 Continue wired to `handleSubmit`)

**Symptom:** User submits portfolio successfully, arrives at the guidance step (step 6), clicks
Back, then clicks Continue again on the review screen. `handleSubmit` runs a second time,
re-submitting the portfolio to the backend and likely queuing a duplicate full_report job.

**Root cause:** The Back button on step 6 at line 1120 calls `() => update("step", 5)`. The
Continue button on step 5 at line 1108 calls `handleSubmit` unconditionally. There is no guard
checking whether portfolio submission already completed in this session.

**Suggested fix:** Add a `portfolioSubmitted` boolean to the `Onboarding` component state,
defaulting to `false`. Set it to `true` after `handleSubmit` completes successfully (before
advancing to step 6). In the step 5 Continue handler, check the flag: if `portfolioSubmitted`
is already `true`, call `() => update("step", 6)` directly without re-running `handleSubmit`.
The user can still navigate back and forward freely; the API is just not hit twice.

---

## Gap #5 — Silent failure when resuming pending guidance

**Step:** Mount — authenticated user with portfolio already submitted
**File:** `frontend/src/pages/Onboarding.tsx:871–897` (`useEffect`)

**Symptom:** An authenticated user who has already submitted their portfolio returns to the
onboarding URL expecting to see the guidance step (step 6). If either `fetchOnboardStatus` or
`fetchPositionGuidance` fails (network error, 5xx, timeout), the user sees nothing — they are
silently dropped into the normal step 1 flow (`AuthStep1` — change password) with no feedback.

**Root cause:** The `catch` block at line 889 is completely empty (`catch {}`). Any error from
either API call is swallowed. The component renders at `step: 1` (line 864) which, for an
authenticated user, shows the change-password screen — a confusing and unrelated UI.

**Suggested fix:** In the `catch` block, show a toast explaining the failure:
`"Could not load your pending setup — please try refreshing."` Optionally, if
`fetchOnboardStatus` succeeded but only `fetchPositionGuidance` failed, still advance to step 6
with empty guidance data so the user can at least skip through rather than being stranded on
the wrong step.

---

## Gap #6 — Step 2 (Schedule) has no validation

**Step:** 2 (Schedule)
**File:** `frontend/src/pages/Onboarding.tsx:299–329` (`Step2`)

**Symptom:** No visible symptom in normal usage. Under unusual conditions (browser autofill
clearing a time field, programmatic state tampering), empty or malformed time strings advance
silently and get sent to the backend.

**Root cause:** `Step2` (line 299) passes `onNext` directly to `BottomBar` at line 327 with
no `handleNext` wrapper and no validation function at all. The fields `dailyBriefTime`,
`weeklyResearchTime`, and `timezone` are never checked before the user advances. This is the
only step in the flow without any validation.

**Suggested fix:** Add a `handleNext` in `Step2` with simple guards:
- `dailyBriefTime` and `weeklyResearchTime` are non-empty and match `HH:MM`
- `timezone` is a non-empty string

These are `type="time"` inputs and `<select>` dropdowns so failures are edge-case only, but
the guard keeps the flow consistent with every other step.

---

## Gap #7 — API error body discarded in `handleSubmit` catch

**Step:** 5 (Launch) — both authenticated and unauthenticated paths
**File:** `frontend/src/pages/Onboarding.tsx:1064–1067` (catch block)

**Symptom:** Any backend error during portfolio submission shows the same generic "Setup failed"
toast regardless of the actual cause. A Zod validation error on a ticker symbol, a rate limit
hit, a malformed field, a server crash — all produce identical feedback. The user has no idea
what to fix.

**Root cause:** The catch block at line 1064–1066 is:
```ts
} catch {
  showToast(t("onboardSetupFailed", language), "error");
  setSubmittingPortfolio(false);
}
```
The caught value is not even bound to a variable. Compare with `completeGuidanceAndLaunch` at
lines 950–967, which already handles this correctly: it extracts `err.response?.data?.error`
and `err.response?.data?.details[0]` and builds a specific message from them, falling back to
the generic string only when nothing else is available.

**Suggested fix:** Apply the identical pattern from `completeGuidanceAndLaunch` to this catch
block. Bind the error, extract the Axios response body, surface the specific message in the
toast. No backend change needed.

---

## Priority order

| # | Gap | Severity | User impact |
|---|-----|----------|-------------|
| 3 | Non-atomic submit leaves users permanently stuck | High | New user can be blocked with no recovery path |
| 2 | Telegram 401 shown as connection error | High | Misleading, causes repeated failed attempts |
| 1 | userId conflict not caught until step 5 | Medium | All onboarding work lost on a fixable input error |
| 7 | API errors discarded in handleSubmit catch | Medium | No actionable feedback on launch failure |
| 4 | Back from step 6 re-submits portfolio | Medium | Silent duplicate full_report job |
| 5 | Silent guidance resume failure | Low | User dropped to wrong step with no explanation |
| 6 | No schedule validation | Low | Theoretical only, browser enforces time inputs |

Note: gaps #1 and #3 share a fix — moving `submitOnboardInit` to step 1 resolves both.
