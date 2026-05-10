---
estimated_steps: 5
estimated_files: 5
skills_used:
  - tdd
  - api-design
  - verify-before-complete
---

# T01: Add saved-chat metadata and lifecycle store contracts

Executor skills: `tdd`, `api-design`, `verify-before-complete`.

Extend the existing conversation persistence layer so conversations can be listed and managed as saved chats without moving turns out of Postgres. This task owns schema/DDL, typed entity/store metadata, TTL calculation, and service-level tests; it should not touch the frontend.

Steps:
1. Update `db/application_postgres.sql` and `backend/src/db/entities/ConversationEntity.ts` to add saved-chat metadata columns: `title`, `archived_at`, `expires_at`, and an activity/update timestamp suitable for list ordering.
2. Add `chat_conversation_ttl_days` to the built-in value flags in `backend/src/services/featureFlagService.ts`, defaulting to `7`, and make the store defensively coerce invalid/low values back to 7 days.
3. Extend `backend/src/services/chat/conversationStore.ts` with small, typed functions for saved-chat lifecycle: create with optional title/TTL, list non-archived saved dashboard conversations for a user, load-for-user with archived/expired state, rename with length validation, archive/delete via soft archive, and update activity when turns are appended.
4. Add service tests in `backend/src/services/chat/conversationStore.savedChats.test.ts` using mocked data-source/query seams or a narrow injectable test dependency; assert default TTL, override TTL, archive exclusion, rename validation, and per-user filtering.
5. Keep existing chat turn/tool-call behavior compatible; do not change safety prompts or advisory answer behavior in this task.

Must-haves:
- Store APIs return a metadata shape the API and UI can share: id, title, channel, startedAt, updatedAt/lastActivityAt, archivedAt, expiresAt, turnCount, totalCostUsd, model/termination metadata where already available.
- TTL is eligibility metadata (`expires_at`) in this slice, not destructive cleanup.
- Archive/delete is soft archive (`archived_at`) so audit/history is preserved.
- Tests prove user A cannot list or mutate user B's conversations through store-level filters.

Failure Modes:
| Dependency | On error | On timeout | On malformed response |
|------------|----------|------------|------------------------|
| Application Postgres / TypeORM data source | Throw a typed or clearly prefixed store error for route mapping; do not fall back to local files | Let request-level timeout/error handling surface the failure; no retry loop in lifecycle calls | Coerce numeric/date fields defensively in row mappers and fail closed on invalid IDs/titles |

Load Profile:
- Shared resources: Postgres connection pool and `conversations` indexes.
- Per-operation cost: list should be a single indexed query by `user_id`, `channel`, `archived_at`, and activity/start time; rename/archive should be one update scoped by `id` and `user_id`.
- 10x breakpoint: unindexed list scans over stale conversations, so add indexes for list/expiry/archive access in DDL.

Negative Tests:
- Malformed inputs: blank title, oversized title, invalid TTL flag values.
- Error paths: database unavailable/configured false where applicable, missing conversation ID, wrong user ID.
- Boundary conditions: empty list, expired conversation, archived conversation, conversations with zero turns.

## Inputs

- `db/application_postgres.sql`
- `backend/src/db/entities/ConversationEntity.ts`
- `backend/src/services/featureFlagService.ts`
- `backend/src/services/chat/conversationStore.ts`

## Expected Output

- `db/application_postgres.sql`
- `backend/src/db/entities/ConversationEntity.ts`
- `backend/src/services/featureFlagService.ts`
- `backend/src/services/chat/conversationStore.ts`
- `backend/src/services/chat/conversationStore.savedChats.test.ts`

## Verification

npm --prefix backend test -- src/services/chat/conversationStore.savedChats.test.ts

## Observability Impact

Adds inspectable saved-chat metadata in Postgres (`title`, `archived_at`, `expires_at`, activity timestamp) and typed store errors/return states so route/API failures can be diagnosed without reading chat contents.
