# S04: Backend-Backed Saved Chats

**Goal:** Implement backend-backed saved chats so a pilot user can create, reopen, continue, rename, and archive saved dashboard chat conversations from Postgres, with localStorage limited to remembering the last-opened conversation and chat expiry eligibility defaulting to a configurable 7-day TTL.
**Demo:** User can create, reopen, rename, and archive/delete multiple saved chats, backed by Postgres with configurable 7-day TTL.

## Must-Haves

- R008 is advanced by Postgres-backed conversation lifecycle support: list, create, open history, continue by ID, rename, and archive/delete are implemented for the authenticated dashboard user.
- R009 is advanced by conversation metadata that includes an expiry/cleanup eligibility timestamp derived from configurable `chat_conversation_ttl_days`, defaulting to 7 days, with tests for default and override behavior.
- The message send path refuses cross-user, archived, or expired conversation IDs instead of silently appending to the wrong conversation.
- The frontend chat page displays saved conversations from the backend, restores the last-opened chat preference from localStorage, opens backend history, renames chats, archives chats, creates new chats, and continues the selected saved chat.
- Verification passes: backend saved-chat store tests, backend chat lifecycle route tests, frontend saved-chat UI policy script, frontend lint, and frontend build.

## Proof Level

- This slice proves: - This slice proves: integration
- Real runtime required: no for automated proof; tests use route/service seams and build/lint rather than a live deployed browser session
- Human/UAT required: no for slice completion; S08 owns live pilot rehearsal

## Integration Closure

- Upstream surfaces consumed: S02 nameless pilot copy policy, existing `conversations` / `conversation_turns` tables in `db/application_postgres.sql`, `backend/src/services/chat/conversationStore.ts`, `backend/src/services/chat/agentChat.ts`, `backend/src/routes/chat.ts`, `frontend/src/api/chat.ts`, and `frontend/src/pages/Chat.tsx`.
- New wiring introduced in this slice: authenticated `/api/chat/conversations` lifecycle endpoints backed by Postgres, message continuation guarded by user/archive/expiry checks, and the real Chat page consuming the saved-chat API.
- What remains before the milestone is truly usable end-to-end: S05 still needs safe/useful advisory answer behavior, and S08 still needs live Web + Telegram pilot rehearsal.

## Verification

- Runtime signals: chat lifecycle routes should log bounded `chat conversation lifecycle` events for create/rename/archive/list failures and invalid continuation attempts without logging message content.
- Inspection surfaces: `conversations` rows expose `title`, `archived_at`, `expires_at`, `updated_at`/last activity, turn counts, and cost; route tests document the API shape.
- Failure visibility: API responses distinguish validation errors, not found/unauthorized/archived/expired conversations, and database unavailable states.
- Redaction constraints: never log chat message text, assistant reply text, tokens, secrets, or user PII beyond bounded user/conversation IDs.

## Tasks

- [x] **T01: Add saved-chat metadata and lifecycle store contracts** `est:2h`
  Executor skills: `tdd`, `api-design`, `verify-before-complete`.
  - Files: `db/application_postgres.sql`, `backend/src/db/entities/ConversationEntity.ts`, `backend/src/services/featureFlagService.ts`, `backend/src/services/chat/conversationStore.ts`, `backend/src/services/chat/conversationStore.savedChats.test.ts`
  - Verify: npm --prefix backend test -- src/services/chat/conversationStore.savedChats.test.ts

- [x] **T02: Expose authenticated saved-chat API and guard continuation** `est:2h`
  Executor skills: `api-design`, `tdd`, `security-review`, `verify-before-complete`.
  - Files: `backend/src/routes/chat.ts`, `backend/src/services/chat/agentChat.ts`, `backend/src/services/chat/conversationStore.ts`, `backend/src/routes/chat.savedChats.test.ts`, `frontend/src/api/chat.ts`
  - Verify: npm --prefix backend test -- src/routes/chat.savedChats.test.ts

- [x] **T03: Wire the Chat page to backend saved conversations** `est:2h`
  Executor skills: `react-best-practices`, `frontend-design`, `accessibility`, `verify-before-complete`.
  - Files: `frontend/src/api/chat.ts`, `frontend/src/pages/Chat.tsx`, `scripts/verify-saved-chat-ui.mjs`
  - Verify: node scripts/verify-saved-chat-ui.mjs && npm --prefix frontend run lint && npm --prefix frontend run build

## Files Likely Touched

- db/application_postgres.sql
- backend/src/db/entities/ConversationEntity.ts
- backend/src/services/featureFlagService.ts
- backend/src/services/chat/conversationStore.ts
- backend/src/services/chat/conversationStore.savedChats.test.ts
- backend/src/routes/chat.ts
- backend/src/services/chat/agentChat.ts
- backend/src/routes/chat.savedChats.test.ts
- frontend/src/api/chat.ts
- frontend/src/pages/Chat.tsx
- scripts/verify-saved-chat-ui.mjs
