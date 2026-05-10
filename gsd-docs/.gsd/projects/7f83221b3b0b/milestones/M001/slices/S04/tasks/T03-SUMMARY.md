---
id: T03
parent: S04
milestone: M001
key_files:
  - frontend/src/pages/Chat.tsx
  - scripts/verify-saved-chat-ui.mjs
  - ../codex/production-reports/M001-S04-T03-saved-chat-ui.md
key_decisions:
  - Use derived `effectiveConversationId` state so stale localStorage preferences self-heal without effect-driven render cascades.
  - Keep malformed/non-string backend turn content as bounded fallback text instead of interpreting tool-call-like objects on the client.
duration: 
verification_result: mixed
completed_at: 2026-05-10T12:29:36.663Z
blocker_discovered: false
---

# T03: Wired the Chat page to backend saved conversations with accessible create, reopen, rename, archive, and send controls.

**Wired the Chat page to backend saved conversations with accessible create, reopen, rename, archive, and send controls.**

## What Happened

Replaced the legacy single-session browser storage chat implementation with a backend-backed saved-chat UI. The Chat page now lists saved conversations through React Query, opens the remembered conversation only when it still appears in the backend list, self-heals stale last-opened IDs by clearing the preference, fetches backend turn history for the selected chat, and sends messages against the selected backend conversation. Added accessible controls and states for creating a new saved chat, reopening chats from the list, inline rename with blank-title validation, archive/delete, empty lists, zero-turn chats, loading indicators, and recoverable API errors. Turn rendering remains plain text with defensive content normalization and no client-side tool-call interpretation. localStorage is now limited to `chat_last_opened_conversation_id`; message arrays and the old 14-day browser TTL/session schema were removed. Added a static saved-chat UI verifier and updated the required production report with validation evidence.

## Verification

Ran the required slice command after the final code change: `node scripts/verify-saved-chat-ui.mjs && npm --prefix frontend run lint && npm --prefix frontend run build`. It exited 0. The static verifier confirmed backend saved-chat API usage, last-opened-only localStorage, accessible lifecycle controls, defensive turn normalization, stale-ID self-healing, and no legacy/internal product copy. Frontend lint completed with 0 errors and 2 pre-existing warnings in `frontend/src/pages/Admin.tsx`. Frontend production build completed successfully; Vite emitted the existing large chunk warning. Browser verification was attempted with the browser tooling, but Playwright could not launch because the Chromium binary is missing in this environment.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `node scripts/verify-saved-chat-ui.mjs && npm --prefix frontend run lint && npm --prefix frontend run build` | 0 | ✅ pass | 12000ms |
| 2 | `Browser verification attempt: browser_mock_route could not launch Playwright because `/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell` is missing.` | -1 | unknown (coerced from string) | 0ms |

## Deviations

Added the required production report at `../codex/production-reports/M001-S04-T03-saved-chat-ui.md`. `frontend/src/api/chat.ts` already contained the T02 saved-chat helper functions, so this task reused them instead of changing that file. Browser verification was blocked by the environment missing Playwright Chromium.

## Known Issues

Frontend lint still reports two pre-existing warnings in `frontend/src/pages/Admin.tsx`. Vite still warns that the main built chunk is larger than 500 kB. Browser-based UI verification remains blocked until the Playwright Chromium binary is installed in the environment.

## Files Created/Modified

- `frontend/src/pages/Chat.tsx`
- `scripts/verify-saved-chat-ui.mjs`
- `../codex/production-reports/M001-S04-T03-saved-chat-ui.md`
