# S04 — Research

**Date:** 2026-05-10

## Summary

Research could not be completed by the required parallel subagent path because the harness blocked subagent dispatch for this `research-slice` planning unit under the active tools policy. No codebase exploration was performed in this lane after the block, to avoid bypassing the enforced planning-unit tool gate.

This partial artifact exists so downstream orchestration has a durable record of the failure and can decide whether to rerun research in an execution-permitted context or manually plan S04 from the already inlined milestone context.

## Recommendation

Rerun S04 research in a context where subagent dispatch and/or code exploration is permitted. The next research attempt should focus on existing conversation tables/entities, chat routes, `backend/src/services/chat/agentChat.ts`, and `frontend/src/pages/Chat.tsx`, then produce a precise implementation landscape for conversation list/create/open/rename/archive-delete APIs, configurable 7-day TTL handling, frontend saved-chat UI, and last-opened-chat local preference.

## Implementation Landscape

### Key Files

- `backend/src/services/chat/agentChat.ts` — Known from milestone context as the existing chat loop/tool parsing path; must remain compatible with conversation lifecycle.
- `backend/src/services/chat/personaPrompt.ts` — Known from milestone context as current chat safety prompt; S04 should avoid changing safety behavior except where required for lifecycle metadata.
- `backend/src/services/chat/outputFilter.ts` — Known from milestone context as current output filtering; downstream S05 owns safety/usefulness tuning.
- `frontend/src/pages/Chat.tsx` — Known from milestone context as current single-session localStorage chat UI; likely primary frontend seam for saved-chat list and last-opened-chat preference.
- Existing conversation/conversation_turns persistence — Need discovery in a permitted research run to identify exact entity, migration, repository, and route files.

### Build Order

1. Discover existing conversation schema/entities/routes and whether metadata fields for title/archive/TTL already exist.
2. Define backend API contract for list, create, open, rename, archive/delete, and continue previous chat using Postgres as source of truth.
3. Add configurable TTL defaulting to 7 days, preferably as eligibility/expiry metadata rather than destructive cleanup in the first pass.
4. Update frontend chat UI to consume backend conversations while keeping localStorage only for last-opened-chat preference.

### Verification Approach

A future complete research pass should identify exact commands. Expected verification classes are backend API/integration tests for conversation lifecycle and TTL default/config override, chat behavior regression tests ensuring existing message flow still works, frontend component/build/lint checks for saved-chat UI, and a browser UAT path for create → send → reopen → rename → archive/delete.

## BLOCKER

Parallel `subagent` dispatch failed with a hard harness block: `unit "research-slice" runs under tools-policy "planning" — subagent dispatch is not permitted in planning units`. The tool response explicitly said not to proceed or retry the same call, so the required one-time retry could not be performed without violating the mechanical gate.