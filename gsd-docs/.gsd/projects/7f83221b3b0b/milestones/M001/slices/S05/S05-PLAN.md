# S05: Safe Useful Advisory Chat

**Goal:** Make the chat agent answer advisory questions about the user's portfolio using real tools and data, while reliably blocking internal-disclosure requests (architecture, source files, deployment details, internal docs).
**Demo:** User can ask "What's the verdict on AAPL?", "Summarize the last deep dive", "What catalysts are coming up?" and get grounded answers. Requests for source code, internal paths, or system architecture are redirected without leaking anything.

## Must-Haves

- R010 is advanced by a persona prompt stored in code (not per-user files) that explicitly enumerates blocked request classes and redirects them with a consistent redirect line.
- R010 is advanced by an output filter that runs on every tool result and every final reply, replacing internal terms with the redirect line on final replies and stripping them from tool results.
- R011 is advanced by 8 safe advisory request classes with concrete examples, structured answer format guidance (verdict → reason → confidence → next action), and a tool registry of 10 read tools + 6 action tools that give the model real data.
- Startup guards validate the persona prompt, forbidden pattern list, and tool allowlist at boot.
- Verification passes: `chatSafetyPolicy.test.ts` (15 tests), `scripts/verify-advisory-readability.mjs`, backend build.

## Proof Level

- This slice proves: integration
- Real runtime required: no — tests use mocked stores and build/lint
- Human/UAT required: no for slice completion; S08 owns live pilot rehearsal

## Integration Closure

- Upstream surfaces consumed: S04 saved conversation lifecycle and backend conversation state; existing `agentChat.ts`, `personaPrompt.ts`, `outputFilter.ts`, `tools/registry.ts`, `tools/readTools.ts`, `tools/actionTools.ts`.
- New wiring introduced: expanded persona prompt with structured answer format and tighter internal-disclosure block; output filter with static + dynamic patterns; startup guards; `chatSafetyPolicy.test.ts`; `getReportSummary` added to read tool allowlist.
- What remains: S06 readability helpers for frontend surfaces; S08 live rehearsal.

## Verification

- Runtime signals: output filter writes `output_filter_events` rows on substitution; tool_calls audit rows record category, cost, latency, status.
- Inspection surfaces: `output_filter_events` table; `tool_calls` table; eventStore logs with purpose='chat'.
- Failure visibility: startup guard refuses boot if persona prompt is empty or forbidden pattern list is unpopulated; tool allowlist assertion throws at build time if forbidden names appear.
- Redaction constraints: never log message text, assistant reply text, tokens, secrets, or user PII beyond bounded user/conversation IDs.

## Tasks

- [x] **T01: Harden persona prompt with structured advisory answer format and tighter internal-disclosure block** `est:1h`
  - Files: `backend/src/services/chat/personaPrompt.ts`
  - Verify: persona prompt validates, no forbidden terms, covers 8 advisory classes

- [x] **T02: Implement output filter with static + dynamic patterns and DB persistence** `est:2h`
  - Files: `backend/src/services/chat/outputFilter.ts`, `backend/src/db/entities/OutputFilterEventEntity.ts`
  - Verify: filter replaces on final_reply, strips on tool_result, writes output_filter_events rows

- [x] **T03: Wire tool registry with read + action allowlist and startup guards** `est:2h`
  - Files: `backend/src/services/chat/tools/registry.ts`, `backend/src/services/chat/tools/readTools.ts`, `backend/src/services/chat/tools/actionTools.ts`
  - Verify: forbidden tool names absent at startup, all tools validated against allowlist

- [x] **T04: Write chatSafetyPolicy tests and run full verification** `est:1h`
  - Files: `backend/src/services/chat/chatSafetyPolicy.test.ts`
  - Verify: `npm --prefix backend test -- src/services/chat/chatSafetyPolicy.test.ts`, `node scripts/verify-advisory-readability.mjs`, `npm --prefix backend run build`

## Files Likely Touched

- backend/src/services/chat/personaPrompt.ts
- backend/src/services/chat/outputFilter.ts
- backend/src/services/chat/tools/registry.ts
- backend/src/services/chat/tools/readTools.ts
- backend/src/services/chat/tools/actionTools.ts
- backend/src/services/chat/agentChat.ts
- backend/src/services/chat/chatSafetyPolicy.test.ts
- backend/src/db/entities/OutputFilterEventEntity.ts
