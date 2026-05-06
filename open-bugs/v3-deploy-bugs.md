# Bug Report: Platform Stabilization v2 Deploy — Iteration 3

**Date discovered:** 2026-05-06  
**Status:** Open  
**Context:** Post-v2 bugfix deployment and hotfix commit `1c1ea9c`.

---

## Summary

The deployment is healthier than iteration 2: backend starts cleanly, chat works, chat tool calls are persisted, and model IDs are corrected. The current blockers are now product-flow issues:

1. `example5` failed onboarding `full_report` and remains stuck in `BOOTSTRAPPING`.
2. Deep dives can be triggered by chat, but the soofke TSM deep dive failed after admission.
3. The Controls page route still exists, but there is no visible dashboard navigation to it.
4. Related observability/UX gaps make these failures hard for users to understand.

---

## Current Production State

- Backend health is OK after deploy.
- `chat_agent_enabled = true`.
- Chat smoke test worked and wrote a `tool_calls` row.
- No active `pending` / `running` / `paused` jobs were present after the post-deploy smoke checks.
- Local `main` is ahead of `origin/main` by hotfix commit `1c1ea9c`.
- Untracked cache remains under `data/cache/exa/2026-05-06/`.

---

## Open Bug 1 — `example5` Full Report Fails at Debate

### Symptom

`example5` triggered onboarding `full_report`:

```text
job_20260506_134443_4e9d9d
user: example5
action: full_report
status: failed
model_tier: balanced
failure_reason: Ticker work failed: SPY, AAPL, MSFT
```

`/root/clawd/users/example5/data/state.json` still shows:

```json
{
  "state": "BOOTSTRAPPING",
  "bootstrapProgress": {
    "total": 3,
    "completed": 0,
    "completedTickers": []
  }
}
```

Only analyst artifacts exist for each ticker:

```text
AAPL: fundamentals, macro, risk, sentiment, technical
MSFT: fundamentals, macro, risk, sentiment, technical
SPY: fundamentals, macro, risk, sentiment, technical
```

No `debate.json` or strategy output was produced for those tickers.

### Evidence

All analyst steps completed. Every ticker failed at `debate` after 3 attempts, then `synthesis` was blocked:

```text
SPY  debate failed attempts=3 zod Expected object, received string
AAPL debate failed attempts=3 zod Expected object, received string
MSFT debate failed attempts=3 zod Expected object, received string
synthesis failed handler Blocked by failed prerequisite step
```

The LLM transport layer logged those debate calls as `status=success`, using:

```text
anthropic/claude-4.5-sonnet-20250929
```

but the step product failed schema validation. This means provider success is being conflated with artifact success.

### Likely Root Cause

`debate.ts` has only a shallow normalizer:

- it does not parse JSON if the provider returns a JSON string;
- it does not coerce `dataPoint` values to strings;
- it does not truncate fields with strict max lengths;
- it does not provide a deterministic fallback debate artifact.

Also, `selfCorrectingRetry.ts` exists, but the executor does not use it. `executeClaimedStep()` directly calls `handler.call()` and validates once per attempt, so the configured `self_correcting_retry_enabled=true` flag does not protect this path.

### Fix Direction

- Harden `debate.normalizeRaw`:
  - parse stringified JSON when possible;
  - coerce `dataPoint` null/number/object to bounded strings;
  - truncate bounded fields to schema max lengths;
  - filter/repair invalid URLs;
  - guarantee exactly two bull and two bear rounds;
  - provide a deterministic fallback from the five analyst artifacts.
- Wire `callWithSelfCorrectingRetry` or `callWithStructuredOutput` into the step executor for LLM-backed steps.
- Add regression tests for:
  - raw debate as JSON string;
  - null/number `dataPoint`;
  - overlong `responseToBear` / `responseToBull`;
  - debate failure blocking full report.
- After fix, re-trigger `full_report` for `example5`.

---

## Open Bug 2 — soofke Chat-Triggered TSM Deep Dive Fails at Debate

### Symptom

Chat successfully admitted a deep dive:

```text
conversation: conv_1778074823371_cd17b1dc
tool: triggerDeepDive
args: {"ticker":"TSM"}
result_status: success
job: job_20260506_134048_d7cf53
```

The job then failed:

```text
user: soofke
action: deep_dive
ticker: TSM
status: failed
failure_reason: Ticker work failed: TSM
```

### Evidence

The chat action tool worked and linked the job to the conversation:

```text
tool_calls: triggerDeepDive success cost_points=20
jobs.conversation_id = conv_1778074823371_cd17b1dc
```

The downstream pipeline failed at `debate`:

```text
analyst.fundamentals completed
analyst.technical completed
analyst.sentiment completed
analyst.macro completed
analyst.risk completed
debate failed attempts=3 zod
synthesis failed: Blocked by failed prerequisite step
```

Observed debate validation errors include:

```text
bullRounds[0].evidence[0].dataPoint Expected string, received null
bullRounds[1].evidence[0].dataPoint Expected string, received number
bullRounds[0].responseToBear String must contain at most 300 characters
```

### Likely Root Cause

Same debate schema fragility as Bug 1. This is not a chat admission failure.

### Fix Direction

Same as Bug 1. After fixing debate validation/normalization, re-run a TSM deep dive for soofke and verify `synthesis` completes.

---

## Open Bug 3 — Controls Page Exists but Is Not Discoverable

### Symptom

Users have no easy way to trigger daily briefs, deep dives, full reports, or quick checks from the dashboard.

### Evidence

The route still exists:

```tsx
<Route path="/controls" element={<ProtectedRoute><AppLayout><Controls /></AppLayout></ProtectedRoute>} />
```

But `BottomNav.tsx` only exposes:

```text
Portfolio, Chat, Reports, Strategies, Settings
```

No `/controls` link exists in `Settings.tsx` either.

### Likely Root Cause

The v2 nav change restored Reports/Feed after it was accidentally removed, but Controls remained only as a direct URL. The previous bug report said Controls was accessible from Settings, but current code does not show that.

### Fix Direction

Pick one product path:

- add Controls back to bottom nav, accepting a 6-item nav; or
- add an obvious Operations/Controls entry in Settings; and
- optionally add contextual trigger buttons where users already act:
  - Portfolio position detail: deep dive / quick check;
  - Reports: full report / daily brief;
  - Chat: trigger tools with visible job status.

---

## Open Bug 4 — Chat Action Confirmation Is Clumsy

### Symptom

For soofke, the chat flow required two confirmations:

```text
User: Run a deep dive on tsm
Assistant: Should I proceed?
User: Proceed
Assistant: emits triggerDeepDive tool_call
Assistant/system: Reply 'yes' to confirm
User: yes
Tool fires
```

### Likely Root Cause

The model can ask for natural-language confirmation, but the app-level confirmation store is only populated after a parsed `tool_call` block for an action tool. The first "Proceed" does not satisfy the app-level confirmation because no pending tool confirmation exists yet.

### Fix Direction

- Make the prompt tell the model not to ask its own natural-language confirmation. It should emit the action `tool_call` proposal first and let the app-level confirmation handler ask the user.
- Or support a structured "pending action proposal" state before the model emits the actual tool call.

This is lower priority than the debate failures because chat still admits jobs correctly.

---

## Open Bug 5 — LLM Observability Marks Schema-Invalid Outputs as Success

### Symptom

`llm_requests.status` is `success` for debate calls that later fail Zod validation and fail the product job.

### Impact

Admin/debug views can understate product failure. Cost attribution shows successful LLM calls, but not that the output was unusable.

### Fix Direction

- Record validation outcome in `llm_requests.schema_mode` or a separate field/event.
- When validation fails, either:
  - update the associated request row to `status='schema_invalid'`; or
  - write an explicit step lifecycle event with model, schema mode, and summarized Zod errors.

---

## Priority Order

1. Fix debate normalization / structured retry wiring.
2. Re-run `example5` full report and soofke TSM deep dive.
3. Restore Controls discoverability.
4. Clean up chat confirmation UX.
5. Improve LLM validation observability.

---

## Validation Plan for Iteration 3 Fix

1. Backend unit tests:
   - debate normalizer repairs malformed provider outputs;
   - executor uses self-correcting retry or equivalent structured-output path;
   - full-report/deep-dive expansion still excludes `chat_agent`.
2. Production dry checks:
   - no active running jobs before manual re-trigger.
3. Re-trigger:
   - `example5` `full_report`;
   - `soofke` `deep_dive` on `TSM`.
4. Verify:
   - all analyst + debate + synthesis steps complete;
   - `example5` exits `BOOTSTRAPPING`;
   - strategies/report artifacts are written;
   - tool/job status visible to user;
   - no new Zod lifecycle events.
