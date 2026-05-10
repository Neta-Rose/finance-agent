---
estimated_steps: 5
estimated_files: 3
skills_used:
  - react-best-practices
  - frontend-design
  - accessibility
  - verify-before-complete
---

# T03: Wire the Chat page to backend saved conversations

Executor skills: `react-best-practices`, `frontend-design`, `accessibility`, `verify-before-complete`.

Replace the current single localStorage-backed chat session with a real backend-backed saved-chat experience. localStorage should only remember the last-opened conversation ID; messages and chat metadata must come from the API added by T02.

Steps:
1. Extend `frontend/src/api/chat.ts` types and functions for list, create, open history, rename, and archive/delete using the backend response shape from T02.
2. Refactor `frontend/src/pages/Chat.tsx` to load saved conversations via React Query, open the last remembered conversation ID from localStorage if it is still available, fetch/render backend turns, and send messages to the selected conversation.
3. Add real UI controls for New chat, conversation list/reopen, inline or prompt-based rename, archive/delete, empty states, loading states, and recoverable API errors. Use neutral pilot-facing copy from S02; do not introduce old/internal product names.
4. Keep localStorage scoped to a small `chat_last_opened_conversation_id` preference. Remove storage of message arrays and the old 14-day browser TTL logic.
5. Add `scripts/verify-saved-chat-ui.mjs` with static assertions that the Chat page no longer stores message arrays/14-day TTL locally, uses backend saved-chat API functions, includes rename and archive/delete controls, and avoids old/internal names in the added chat copy.

Must-haves:
- A user can create a new backend chat, send a message, reopen it from the saved list, rename it, and archive/delete it from the UI.
- The selected chat's backend turns render as plain text; no client-side tool-call interpretation is introduced.
- Last-opened chat preference is best-effort only and self-heals if the backend no longer returns that chat.
- UI controls are keyboard-accessible buttons/inputs with clear labels and disabled/loading states.

Failure Modes:
| Dependency | On error | On timeout | On malformed response |
|------------|----------|------------|------------------------|
| Saved-chat API | Show a recoverable inline error/toast and keep current local input state | Show loading then recoverable error after Axios timeout | TypeScript/API typing plus defensive turn-content normalization prevents rendering crashes |
| localStorage preference | Ignore read/write failures and continue with backend list/default empty state | N/A | Remove invalid IDs and do not attempt to parse stored message arrays |

Load Profile:
- Shared resources: frontend query cache and backend list endpoint.
- Per-operation cost: one list query on page load, one history query when opening a chat, one mutation per create/rename/archive/send.
- 10x breakpoint: long conversation lists or histories; render bounded list metadata and rely on backend history/list limits instead of storing all chats in browser storage.

Negative Tests:
- Malformed inputs: blank rename title, empty send text, missing selected conversation after archive.
- Error paths: list/open/send/rename/archive API failure, database unavailable response, expired conversation response.
- Boundary conditions: no saved chats, newly created zero-turn chat, last-opened ID not found, archived selected chat disappearing from list.

## Inputs

- `frontend/src/api/chat.ts`
- `frontend/src/pages/Chat.tsx`
- `backend/src/routes/chat.savedChats.test.ts`

## Expected Output

- `frontend/src/api/chat.ts`
- `frontend/src/pages/Chat.tsx`
- `scripts/verify-saved-chat-ui.mjs`

## Verification

node scripts/verify-saved-chat-ui.mjs && npm --prefix frontend run lint && npm --prefix frontend run build

## Observability Impact

Adds visible UI loading/error states for saved-chat lifecycle calls and preserves a minimal last-opened preference so frontend failures are diagnosable without depending on hidden browser-stored message state.
