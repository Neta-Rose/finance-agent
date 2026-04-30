# Handoff — Clawd Step-Queue Redesign, PR 1 Complete

**Date:** 2026-04-30
**Author:** Claude (with the user, in a brainstorm + plan + execute session)
**For:** Whoever picks this up next — human or AI.

If you are an AI agent who just opened this repo cold: **read this file end-to-end before doing anything else.** It tells you exactly what state the project is in, what was just done, what is safe to assume, and what to NOT redo.

---

## 1. TL;DR (read this if nothing else)

- The Clawd platform's `full_report` / `deep_dive` execution path is being redesigned because the LLM-orchestrated trigger-file pipeline failed for user `soofke` on 2026-04-27 (DeepSeek-v3.2 hallucinated a Python script, was sandbox-blocked, self-paused, stuck 3+ days).
- A full design (4-PR rollout) was brainstormed and committed as a spec on 2026-04-30. **Read it: `docs/superpowers/specs/2026-04-30-step-queue-execution-redesign-design.md`.**
- **PR 1 (Phase 0 defensive fixes) is SHIPPED.** Deployed to production this same day. Soofke is unblocked. The work is in commits `c6ce869` through `85c3b3b` on `main`.
- **PRs 2, 3, 4 are NOT yet planned or executed.** The next forward action is writing PR 2's implementation plan via the `superpowers:writing-plans` skill — but only when the user signals they are ready to start it.
- **DO NOT re-run the PR 1 plan.** It was for a one-time defensive cleanup. Re-running its supersede script against soofke would be a no-op (script is idempotent), but re-executing the plan as a workflow would be confusing and waste cycles.

## 2. Project context (in 90 seconds)

Clawd is an AI-powered portfolio operations platform. One admin owns it; 10-20 pilot users connect their stock portfolios; an AI agent (OpenClaw) analyzes positions, sends Telegram briefings, and produces BUY/HOLD/SELL verdicts with reasoning.

The core artifact is `users/<userId>/data/tickers/<TICKER>/strategy.json` — Zod-validated, the source of truth for what the system thinks about each position. Analysts (fundamentals, technical, sentiment, macro, risk, bull, bear) write supporting JSON files under `users/<userId>/data/reports/<TICKER>/`. The "deep dive" workflow runs all analysts plus a Bull/Bear debate plus a Fund Manager synthesis to produce one strategy.json. The "full report" workflow runs deep dives across the whole portfolio.

Today (pre-redesign) all of that is orchestrated by an LLM agent reading `HEARTBEAT.md` and a trigger-file directory — which is exactly the architecture that broke for soofke. The redesign moves orchestration into the backend (Postgres-backed step queue) and reduces the LLM's role to "produce one JSON per step, validated by Zod." Workspace artifact files and chat behavior are unchanged.

## 3. What just happened in PR 1

PR 1 was strictly defensive — it does NOT introduce the new step queue, does NOT touch the agent path, does NOT change how full_report runs. It only:

1. Adds a new `superseded` status to `JobSchema` (backend + frontend types).
2. Adds a backend startup reconciler that auto-fixes `full_report_state.json` whenever it disagrees with a terminal-or-paused job (a divergence class soofke was stuck on for 3 days).
3. Adds an idempotent CLI script `supersedeStuckJob.ts` that an admin runs manually to mark a specific job superseded + delete named hallucinated artifacts.
4. Adds a frontend `SupersededJobBanner` shown on `/controls` for users with any superseded job.
5. Was deployed via `./deploy.sh` and verified healthy at 16:04:21 UTC. The reconciler completed its first per-user pass at 16:05:16. The supersede script was then run against soofke. Final state of soofke: job=`superseded`, three hallucinated artifacts (`full_report_analysis.py`, `full_report_simple.py`, `full_report_basic_20260427_1147.json`) deleted, `full_report_state.json`=`superseded` (manually aligned, see §6), banner renders.

PR 1 commits (newest → oldest):
```
85c3b3b feat: render SupersededJobBanner on /controls
a1814c3 feat: add SupersededJobBanner component
3270ab8 feat: add superseded to frontend JobStatus union
71e2408 feat: add supersedeStuckJob CLI script
3774433 feat: run jobStateReconciler on backend startup
7493f15 feat: add jobStateReconciler for paused/state divergence
96467c7 feat: add superseded status to JobSchema enum
c6ce869 chore: snapshot in-flight stabilization work before Phase 0 PR
a802a44 docs: add Phase 0 defensive-fixes implementation plan
9410036 docs: add step-queue execution redesign spec
```

`c6ce869` is a chore snapshot of the user's pre-existing in-flight stabilization work; treat its content as their context, not part of PR 1's design.

## 4. What to read, in order

A fresh agent or engineer should read these in this exact order to come up to speed:

1. **This file** (the handoff) — orientation.
2. **`docs/superpowers/specs/2026-04-30-step-queue-execution-redesign-design.md`** — the full design. ~3,500 words. Sections cover the problem evidence, goals, architecture (PG entities + workspace files split), step taxonomy, executor + γ→δ seam, model tiers, pause/resume semantics, soofke recovery, observability, failure modes, explicit non-behaviors, 4-PR rollout, deferred questions.
3. **`CLAUDE.md`** at the repo root — domain rules (TASE pricing, strategy schema, agent hard rules, OpenClaw config caveats). These are non-negotiable invariants the redesign respects.
4. **`docs/core-stabilization-plan.md`** (from 2026-04-12) — the umbrella plan whose items #3, #5, #6, #9 the redesign implements. Useful for "why these specific concerns and not others."
5. **`docs/superpowers/plans/2026-04-30-phase-0-soofke-defensive-fixes.md`** — historical record only. The plan PR 1 was executed against. Do NOT re-execute. Useful as a template for how PR 2-4 plans should look.
6. **Auto-memory** at `/root/.claude/projects/-root/memory/`:
   - `MEMORY.md` (the index)
   - `project_clawd_100_plan_progress.md` (project status)
   - `project_clawd_overview.md`, `project_clawd_architecture.md`, `project_clawd_techstack.md` (background)
   - `feedback_admin_configurability.md` (the user's stable preference for admin-editable config over hardcoded defaults — applies to all future Clawd design)
   - `feedback_instrument_then_bound.md` (the user's stable preference for shipping instrumentation first and setting cost/limit thresholds based on observed real distributions, not guessed defaults)

## 5. What is safe to assume vs. what to verify

**Safe to assume (recorded in spec or memory):**
- The 4-tier model config (`free`/`cheap`/`balanced`/`expensive`), per-(tier, step_kind) admin-editable matrix is the chosen approach. Don't propose alternatives.
- The step taxonomy (5 analysts + `debate` + `synthesis`, 7 total) is decided. Don't propose 9 steps or a different debate structure.
- The γ pattern (backend gathers data, LLM produces one JSON, no tool use) is the default for PR 2-3. δ (per-step tool use) is a deferred upgrade hook, not initial scope.
- OpenClaw becomes chat-only post-redesign. Don't write designs that route analyst work through OpenClaw.
- No daily cost cap in initial pilot — record cost, set caps after observed distributions.

**Verify before acting (live state):**
- Soofke's job status: `cat /root/clawd/users/soofke/data/jobs/job_20260426_144855_1abcd8.json | python3 -c "import sys,json;print(json.load(sys.stdin).get('status'))"` — should print `superseded`.
- Backend health: `curl -s http://localhost:8081/api/health` — should return `{"status":"ok",...}`.
- Latest commits: `git -C /root/clawd log --oneline -10` — should match the list in §3.
- Tests still passing: `cd /root/clawd/backend && npm test` — should be 97/97.
- TypeScript: `cd /root/clawd/backend && npx tsc --noEmit` and `cd /root/clawd/frontend && npx tsc --noEmit` — both should be silent.

If any of these fail, **stop and investigate before writing more code.** Something has drifted since 2026-04-30.

## 6. Known follow-ups / residual issues

These are intentionally deferred. Don't fix them as part of the next session unless the user asks.

1. **Reconciler one-direction-only.** `backend/src/services/jobStateReconciler.ts` only fires when `state.status === "running"` and the corresponding job is in a terminal-or-paused state. It does NOT fire when state is `paused` and the job becomes `superseded` (which arose from the supersede script run). I patched soofke's state.json directly. If we see this pattern recur in PR 2-4, widen the reconciler condition to "any divergence between `state.status` and the referenced job's `status`."

2. **PR 2 plan not yet written.** The next forward action is invoking `superpowers:writing-plans` against the spec, scoped to PR 2 only. Don't widen scope. Don't combine with PR 3.

3. **Bundle-size warning.** `vite build` warns about chunks > 500 kB. Pre-existing. Not introduced by PR 1. Tracked separately if at all.

4. **The user's WIP committed as `chore` in `c6ce869`.** That commit is a snapshot of in-flight work the user had on disk before PR 1 started. It typechecks and passes the test suite, but the *intent* of those changes wasn't reviewed by me — they may or may not be coherent on their own. Not PR 1's problem; flag if you find conflicts later.

## 7. The user

The repo's primary user/admin is `netarose1596@gmail.com` (per auto-memory). Their working style observed across this session:

- **Direct.** "a", "do it", "looks good", "continue" are normal answers. Doesn't repeat themselves; expects you to proceed once approved.
- **Decision-oriented.** Picks options out of multiple-choice questions cleanly. Doesn't want long preambles before clarifying questions.
- **Strategic, not micromanaging.** Wants the right architecture, not perfectly polished prose. Trust their architectural intuition; push back only with strong reasons.
- **Casual git workflow.** Commits to `main` directly with brief messages. PRs aren't usually opened on GitHub; deploy is via `./deploy.sh` from the production box.
- Two stable preferences (see `feedback_*` memories): **admin-editable config over hardcoded defaults**, and **instrument first, set bounds later** for cost/limit thresholds.

## 8. If the user signals readiness for PR 2

Their next move is likely "let's plan PR 2" or similar. When that happens:

1. Invoke `superpowers:writing-plans`.
2. Scope: **PR 2 only** (PG schema + executor + handler interface + 2 stub handlers, per the spec's §14). Not PR 3. Not PR 4. Not all four.
3. Read the spec sections relevant to PR 2: §4 (architecture), §5 (PG schema in detail), §6 (step taxonomy and expansion rules), §7 (executor + handler interface).
4. Note that the existing TypeORM data source at `backend/src/db/applicationDataSource.ts` already has the wiring; just add three new entity files alongside `ObservabilityRequestEntity` and `UserPointsBudgetEntity`.
5. The two stub handlers should be `analyst.fundamentals` (the analyst-style bookend) and `synthesis` (the strategy-writing bookend) — together they exercise the full pipeline at one ticker.
6. Plan should be feature-flag-protected (`USE_STEP_QUEUE` per user, default off). No production users opted in until PR 4.
7. Use the existing PR 1 plan (`docs/superpowers/plans/2026-04-30-phase-0-soofke-defensive-fixes.md`) as the formatting template — TDD steps with full code listings, no placeholders.

If the user signals something different ("let's pause" / "let's do something else") — fine, redirect cleanly.

## 9. Quick recovery if something is broken

If PR 1's deploy somehow regresses (unlikely; tests + typecheck were green):

```bash
# Roll back to before Phase 0 (keeps the chore commit and spec/plan):
cd /root/clawd && git reset --hard a802a44 && ./deploy.sh

# Roll back further including the chore snapshot (loses the user's WIP commit too):
cd /root/clawd && git reset --hard 9410036 && ./deploy.sh
```

The supersede effect on soofke is reversible by manually editing her job file back to `paused` — but the recommended posture is to leave her in `superseded` state regardless of code rollback, because PR 2-4 are designed around that.

---

**End of handoff.** The system is in a known-good state. Soofke is unblocked. The next session's job is to plan PR 2, when the user is ready.
