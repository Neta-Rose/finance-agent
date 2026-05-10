---
id: T02
parent: S04
milestone: M001
key_files:
  - backend/src/routes/chat.ts
  - backend/src/services/chat/agentChat.ts
  - backend/src/services/chat/conversationStore.ts
  - backend/src/services/chat/conversationStore.savedChats.test.ts
  - backend/src/routes/chat.savedChats.test.ts
  - frontend/src/api/chat.ts
  - backend/scripts/run-tests.mjs
  - ../codex/production-reports/M001-S04-T02-saved-chat-api.md
key_decisions:
  - Use route-level dependency injection only for saved-chat route tests while keeping production wiring unchanged.
  - Use stable saved-chat API error codes with HTTP 400/404/410/503/500 semantics rather than 200-with-error responses.
  - Keep lifecycle logs bounded and content-free to avoid leaking user messages or assistant replies.
duration: 
verification_result: passed
completed_at: 2026-05-10T12:22:53.133Z
blocker_discovered: false
---

# T02: Exposed authenticated saved-chat lifecycle APIs and guarded dashboard chat continuation by owner, archive, and expiry state.

**Exposed authenticated saved-chat lifecycle APIs and guarded dashboard chat continuation by owner, archive, and expiry state.**

## What Happened

Added authenticated saved-chat lifecycle routes under `/api/chat` for list, create, open/history, rename, and soft archive. The route contract uses Zod validation, stable machine-readable error codes, bounded pagination, and content-free lifecycle logs that include only event, bounded user/conversation IDs, and error code. Updated `agentChat` so supplied conversation IDs are owner-scoped and rejected when missing, archived, or expired before any append/provider work; new dashboard conversations now use the saved-chat metadata creation path with a safe inferred default title. Extended the frontend chat API wrapper with typed saved-chat list/create/open/rename/archive methods. Fixed the backend test runner so explicit `*.test.ts` file arguments actually scope verification to the requested file instead of appending the whole backend suite, which was blocking the task-plan command with unrelated notification failures.

## Verification

Verified the exact task-plan route command, the previously failing saved-chat store command, and the backend TypeScript build after the final changes. Route tests cover API shape, validation failures, cross-user refusal, archived/expired refusal, successful reopen history, rename, archive semantics, database unavailable, and generic store errors. Store tests pass with backward-compatible dependency injection and bounded list SQL. Build passes with no TypeScript errors. LSP diagnostics were attempted, but no language server was available in this environment.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm --prefix backend test -- src/routes/chat.savedChats.test.ts` | 0 | ✅ pass | 926ms |
| 2 | `npm --prefix backend test -- src/services/chat/conversationStore.savedChats.test.ts` | 0 | ✅ pass | 697ms |
| 3 | `npm --prefix backend run build` | 0 | ✅ pass | 4357ms |
| 4 | `node --test --import ./backend/node_modules/tsx/dist/loader.mjs backend/src/routes/chat.savedChats.test.ts backend/src/services/chat/conversationStore.savedChats.test.ts` | 0 | ✅ pass | 757ms |

## Deviations

Added a minimal fix to `backend/scripts/run-tests.mjs` so the task-plan `npm --prefix backend test -- <file.test.ts>` verification command scopes correctly. Added the required production report at `../codex/production-reports/M001-S04-T02-saved-chat-api.md`.

## Known Issues

None.

## Files Created/Modified

- `backend/src/routes/chat.ts`
- `backend/src/services/chat/agentChat.ts`
- `backend/src/services/chat/conversationStore.ts`
- `backend/src/services/chat/conversationStore.savedChats.test.ts`
- `backend/src/routes/chat.savedChats.test.ts`
- `frontend/src/api/chat.ts`
- `backend/scripts/run-tests.mjs`
- `../codex/production-reports/M001-S04-T02-saved-chat-api.md`
