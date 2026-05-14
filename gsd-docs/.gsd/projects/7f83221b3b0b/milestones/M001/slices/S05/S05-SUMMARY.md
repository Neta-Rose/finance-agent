---
id: S05
milestone: M001
status: complete
completed_at: 2026-05-12T00:00:00.000Z
requirements_advanced: [R010, R011]
verification_result: passed
---

# S05: Safe Useful Advisory Chat — Summary

**Outcome:** Chat answers advisory questions about the user's portfolio using real tools and data, while reliably blocking internal-disclosure requests. The persona prompt, output filter, tool registry, and startup guards form a layered safety system verified by 15 automated tests.

## What Was Built

**Persona Prompt (`personaPrompt.ts`)**
- Stored in code, not per-user files (F1.3).
- Explicitly excludes SOUL/AGENTS/CLAUDE/HEARTBEAT/RESET content (F1.1).
- 8 safe advisory request classes with concrete examples: portfolio overview, verdict/strategy explanation, catalyst/timeline, report explanation, risk/concentration, escalation/attention, notifications, actions.
- Structured answer format guidance: verdict → reason → confidence → next action.
- Tighter internal-disclosure block with explicit redirect for each class (architecture, source, infrastructure, other users, general financial advice, file/directory access).
- Redirect line: `"I can help with your portfolio positions, strategies, verdicts, catalysts, recent reports, and the actions I have tools for. What would you like to know?"`
- Does not expose "Clawd" or any internal product name in the user-visible prompt body.
- `validatePersonaPrompt()` called by startup guard (F3.1).

**Output Filter (`outputFilter.ts`)**
- Runs on every tool result before returning to the model AND on every final reply before transport (F2.2).
- Static patterns (always active): `step queue`, `openclaw`, `watchdog`, `userIsolation`, `/root/clawd` paths, `/root/.openclaw` paths, `users/*/data` paths.
- Dynamic patterns loaded from `feature_flags.forbidden_pattern_list` at runtime.
- On `final_reply` match: entire message replaced with redirect line (prevents partial leaks).
- On `tool_result` match: offending substring removed; result flows back to model for recovery.
- Each substitution writes one `output_filter_events` row with conversationId, turnIndex, site, pattern label, originalLength (F2.3).
- Startup guard validates `forbidden_pattern_list` is populated (F3.3).

**Tool Registry (`tools/registry.ts`, `readTools.ts`, `actionTools.ts`)**
- **Read tools** (10, cost=0): `getPortfolio`, `getStrategy`, `getStrategies`, `getRecentReports`, `getReportSummary`, `getCatalystsDueSoon`, `getEscalationHistory`, `getRiskSummary`, `getNotifications`, `searchWeb`.
- **Action tools** (6): `triggerQuickCheck` (5pts), `triggerDeepDive` (20pts), `triggerDailyBrief` (30pts), `snoozeTicker` (0pts), `markVerdictAddressed` (0pts), `waitForJob` (0pts).
- **Forbidden tools** (asserted absent at startup, E3.1–E3.3): `readFile`, `writeFile`, `listFiles`, `deleteFile`, `runShell`, `executeCode`, `readSoul`, `readAgents`, `readClaude`, `readHeartbeat`, `readReset`, `readOpenClaw`, `listUsers`, `readOtherUserPortfolio`, `readOtherUserStrategy`, `adminTrigger`, `restartService`, `restartGateway`, `editConfig`, `setUserRestriction`, `setSystemLock`.
- All tools validated against allowlist at build time (E4.1); any name not in the allowlist throws.
- `getReportSummary` wraps report text in `<UNTRUSTED kind="report_content">` blocks (O8.1).
- `searchWeb` wraps results in `<UNTRUSTED kind="web_search">` blocks.
- Action tools require explicit user confirmation via `confirmationStore` handshake (E2.2).
- Action tools deduct points from user budget and refuse for restricted users or locked system (E2.3, E2.4).
- All tools write `tool_calls` audit rows with category, cost_points, latency, status.

**Agent Chat Loop (`agentChat.ts`)**
- Single entry point for all three transports; channel used only as audit field (C1.3).
- Loads persona prompt with embedded tool manifest as JSON in system prompt.
- Extracts tool-call blocks from model text response (OpenRouter text-based approach).
- Confirmation gate: action tools propose action, exit loop, wait for yes/no in next turn.
- Tool result filtering before feeding back to model (F2.2).
- Terminates on: `model_final`, `max_turns`, `token_cap`, `points_budget_exhausted`, `error`.

**Safety Tests (`chatSafetyPolicy.test.ts`)**
- 15 tests covering: persona prompt validation, output filter substitutions on final_reply and tool_result, tool allowlist enforcement, redirect line integrity, internal term blocking.

## Verification Evidence

| Command | Exit Code | Verdict |
|---|---|---|
| `npm --prefix backend test -- src/services/chat/chatSafetyPolicy.test.ts` | 0 | ✅ pass (15/15) |
| `node scripts/verify-advisory-readability.mjs` | 0 | ✅ pass (all 8 checks) |
| `npm --prefix backend run build` | 0 | ✅ pass |

## Requirements Advanced

- **R010** (protect internals while answering safe questions): fully implemented — persona prompt whitelist, output filter dual-mode, startup guards, 15 safety tests.
- **R011** (explain reports/verdicts/catalysts/portfolio using real tools): fully implemented — 10 read tools + 6 action tools, structured answer format, `getReportSummary` in allowlist.

## Files Created/Modified

- `backend/src/services/chat/personaPrompt.ts`
- `backend/src/services/chat/outputFilter.ts`
- `backend/src/services/chat/tools/registry.ts`
- `backend/src/services/chat/tools/readTools.ts`
- `backend/src/services/chat/tools/actionTools.ts`
- `backend/src/services/chat/agentChat.ts`
- `backend/src/services/chat/chatSafetyPolicy.test.ts`
- `backend/src/db/entities/OutputFilterEventEntity.ts`
