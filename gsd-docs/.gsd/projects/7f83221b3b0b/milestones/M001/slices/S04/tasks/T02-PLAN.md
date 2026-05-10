---
estimated_steps: 5
estimated_files: 5
skills_used:
  - api-design
  - tdd
  - security-review
  - verify-before-complete
---

# T02: Expose authenticated saved-chat API and guard continuation

Executor skills: `api-design`, `tdd`, `security-review`, `verify-before-complete`.

Wire the saved-chat store into the authenticated chat API and the existing message send path. This task closes the backend product contract for create, list, open, rename, archive/delete, and continue previous chat while preventing cross-user, archived, or expired conversation reuse.

Steps:
1. Extend `backend/src/routes/chat.ts` with lifecycle endpoints under the existing protected `/api/chat` mount: `GET /chat/conversations`, `POST /chat/conversations`, `GET /chat/conversations/:id`, `PATCH /chat/conversations/:id`, and `DELETE /chat/conversations/:id` (soft archive).
2. Add Zod request/params schemas for IDs, optional create title, and rename title; keep response bodies small and typed.
3. Update `backend/src/services/chat/agentChat.ts` and/or the message route so `POST /chat/messages` validates an incoming `conversationId` belongs to the authenticated user, is not archived, and has not expired before appending a turn. New conversations should use the metadata/TTL creation path from T01 and infer a safe default title from the first user message only if no explicit title exists.
4. Add route-level dependency injection only if needed for tests, following the existing small test seam pattern used by admin routes; keep production wiring unchanged.
5. Add `backend/src/routes/chat.savedChats.test.ts` covering API shape, validation failures, cross-user refusal, archived/expired refusal, successful reopen history, successful rename, and delete/archive semantics.

Must-haves:
- `POST /chat/messages` must never append to a conversation owned by another user; returning 404 is acceptable to avoid disclosing existence.
- Archived or expired conversations are not continued; the API returns a clear stable error code such as `conversation_archived` or `conversation_expired` without leaking message content.
- `GET /chat/conversations/:id` still returns turn history for owned, non-archived conversations in the shape the frontend can render.
- Logs identify lifecycle failures by bounded user/conversation IDs and error code only; no raw user messages or assistant replies.

Failure Modes:
| Dependency | On error | On timeout | On malformed response |
|------------|----------|------------|------------------------|
| Conversation store | Map known not-found/archived/expired/validation cases to 4xx JSON; unknown DB errors to 500 with generic message | No manual retries; rely on request timeout and global error handler | Zod rejects malformed request bodies/params with 400 |
| Agent chat provider path | Existing provider error behavior remains unchanged after conversation validation | Existing provider timeout behavior remains unchanged | Existing output filtering remains unchanged |

Load Profile:
- Shared resources: authenticated API rate limiter and Postgres connection pool.
- Per-operation cost: list/open/rename/archive each use bounded DB queries; message send adds one metadata validation query before existing LLM work.
- 10x breakpoint: chat list size per user; cap/paginate list responses or plan a conservative default limit so the UI cannot request unbounded history.

Negative Tests:
- Malformed inputs: empty body, blank/oversized rename title, bad conversation ID format, invalid pagination.
- Error paths: database unavailable, store throws, provider disabled/budget exhausted still returns existing safe responses without creating inconsistent metadata.
- Boundary conditions: empty conversation list, zero-turn newly created chat, expired conversation at exact boundary, archived conversation history access.

## Inputs

- `backend/src/routes/chat.ts`
- `backend/src/services/chat/agentChat.ts`
- `backend/src/services/chat/conversationStore.ts`
- `backend/src/services/chat/conversationStore.savedChats.test.ts`
- `frontend/src/api/chat.ts`

## Expected Output

- `backend/src/routes/chat.ts`
- `backend/src/services/chat/agentChat.ts`
- `backend/src/routes/chat.savedChats.test.ts`
- `frontend/src/api/chat.ts`

## Verification

npm --prefix backend test -- src/routes/chat.savedChats.test.ts

## Observability Impact

Adds bounded route logging/error codes for saved-chat lifecycle failures and invalid continuation attempts; future agents can inspect HTTP responses and `conversations` metadata without exposing chat content.
