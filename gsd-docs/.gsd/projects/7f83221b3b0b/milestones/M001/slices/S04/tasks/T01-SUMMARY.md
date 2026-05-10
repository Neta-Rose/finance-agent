---
id: T01
parent: S04
milestone: M001
key_files:
  - db/application_postgres.sql
  - backend/src/db/entities/ConversationEntity.ts
  - backend/src/services/featureFlagService.ts
  - backend/src/services/chat/conversationStore.ts
  - backend/src/services/chat/conversationStore.savedChats.test.ts
  - ../codex/production-reports/M001-S04-T01-saved-chat-metadata-store.md
key_decisions:
  - Use additive nullable/defaulted conversation columns and soft archive to preserve existing chat history and auditability.
  - Expose saved-chat lifecycle errors through ConversationStoreError codes for downstream route mapping instead of falling back to files.
  - Keep TTL as `expires_at` eligibility metadata only; no destructive cleanup is performed in this task.
duration: 
verification_result: mixed
completed_at: 2026-05-10T12:16:52.502Z
blocker_discovered: false
---

# T01: Added Postgres-backed saved-chat metadata, TTL defaults, lifecycle store contracts, and service tests.

**Added Postgres-backed saved-chat metadata, TTL defaults, lifecycle store contracts, and service tests.**

## What Happened

Extended the conversation persistence foundation for saved dashboard chats without moving turns out of Postgres. The conversations DDL and TypeORM entity now include title, updated/activity timestamp, archived_at, and expires_at, with indexes for saved-chat list/archive/expiry access. Added the built-in chat_conversation_ttl_days value flag defaulting to 7 and implemented defensive TTL coercion in the store. Added typed saved-chat lifecycle store functions for create, list, owner-scoped load with active/archived/expired state, rename validation, and soft archive; append/end/tool-count updates now refresh updated_at. Added mocked data-source service tests covering default/override TTL, invalid TTL coercion, archive exclusion, ownership filtering, rename validation, missing/wrong-user mutation failures, empty/malformed database states, and zero-turn metadata mapping.

## Verification

Ran TypeScript build and saved-chat store tests after the final code change. `npm --prefix backend run build` passed. The isolated saved-chat test command passed 8/8 tests. The task-plan command `npm --prefix backend test -- src/services/chat/conversationStore.savedChats.test.ts` was run; all saved-chat subtests passed, but the project runner executes the full backend suite and still fails three unrelated notification tests. Slice-level route/UI verification files for later tasks are not present yet (`backend/src/routes/chat.savedChats.test.ts`, `scripts/verify-saved-chat-ui.mjs`).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm --prefix backend run build` | 0 | ✅ pass | 8436ms |
| 2 | `node --test --import ./backend/node_modules/tsx/dist/loader.mjs backend/src/services/chat/conversationStore.savedChats.test.ts` | 0 | ✅ pass | 674ms |
| 3 | `npm --prefix backend test -- src/services/chat/conversationStore.savedChats.test.ts` | 1 | ❌ fail — saved-chat subtests passed; unrelated notification tests failed because backend runner executes all tests | 12382ms |
| 4 | `test -e backend/src/routes/chat.savedChats.test.ts && test -e scripts/verify-saved-chat-ui.mjs` | 1 | ❌ fail — later slice verification artifacts not created in T01 scope | 10ms |

## Deviations

Added a required production report at `../codex/production-reports/M001-S04-T01-saved-chat-metadata-store.md` per repository operating rules. Also captured a backend test-runner gotcha because the scoped npm test command runs the whole suite.

## Known Issues

The backend test runner currently executes all backend tests even when a file path is forwarded, so the required task command exits 1 due to pre-existing unrelated notification test failures. Later slice verification files for route and UI checks do not exist yet and are expected to be delivered by downstream tasks.

## Files Created/Modified

- `db/application_postgres.sql`
- `backend/src/db/entities/ConversationEntity.ts`
- `backend/src/services/featureFlagService.ts`
- `backend/src/services/chat/conversationStore.ts`
- `backend/src/services/chat/conversationStore.savedChats.test.ts`
- `../codex/production-reports/M001-S04-T01-saved-chat-metadata-store.md`
