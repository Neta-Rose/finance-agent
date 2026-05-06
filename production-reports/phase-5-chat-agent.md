# Production report — Phase 5: Chat agent (dashboard transport)

**Date:** 2026-05-06
**Initiative:** Platform Stabilization and Assistant
**Tasks:** 5.1–5.14 (code), 5.15 (operational — VPS flag flip)

---

## Goal

Ship the chat agent with the dashboard transport. One `agentChat` function, one tool registry, one output filter, one persona prompt. Telegram and WhatsApp transports land in Phase 6.

---

## 5.1 — DDL: four new chat tables

Appended to `db/application_postgres.sql`:

| Table | Purpose |
|---|---|
| `conversations` | One row per conversation; tracks turn count, cost, termination reason |
| `conversation_turns` | One row per turn (user/assistant/tool_result/system) |
| `tool_calls` | One row per tool invocation; audit precedence enforced (NFR6.4) |
| `output_filter_events` | One row per substitution made by the output filter |

Four corresponding TypeORM entities registered in `applicationDataSource.ts`.

---

## 5.2 — Persona prompt

`backend/src/services/chat/personaPrompt.ts`

- `buildPersonaPrompt(userDisplayName)` — returns the literal prompt string
- `validatePersonaPrompt(prompt)` — checks for forbidden substrings (SOUL.md, AGENTS.md, openclaw, etc.)
- `REDIRECT_LINE` — the off-scope redirect message, shared with the output filter

Prompt explicitly excludes SOUL/AGENTS/CLAUDE/HEARTBEAT/RESET content (F1.1). Stored in code, not assembled from per-user files (F1.3).

---

## 5.3 — Output filter

`backend/src/services/chat/outputFilter.ts`

- Static patterns: `step queue`, `openclaw`, `watchdog`, `userIsolation`, file path patterns
- Dynamic patterns: loaded from `feature_flags.forbidden_pattern_list`
- On `final_reply` match: entire message replaced with redirect line
- On `tool_result` match: offending substring removed; result still flows to model
- Each substitution writes one `output_filter_events` row (F2.3)

---

## 5.4 — Forbidden-pattern list seeded

`featureFlagService.ts` default flags updated to include a populated `forbidden_pattern_list` with file paths, internal terms, and model name prefixes. Also added `persona_redirect_line` flag.

---

## 5.5 — Read tools (9 tools)

`backend/src/services/chat/tools/readTools.ts`

`getPortfolio`, `getStrategy`, `getStrategies`, `getRecentReports`, `getCatalystsDueSoon`, `getEscalationHistory`, `getRiskSummary`, `getNotifications`, `searchWeb`.

All read tools: `cost_points = 0`, Zod input validation, structured error on malformed args, `tool_calls` audit row. `searchWeb` wraps Exa results in `<UNTRUSTED>` blocks (O8.1).

---

## 5.6 — Action tools (6 tools)

`backend/src/services/chat/tools/actionTools.ts`

`triggerQuickCheck` (5 pts), `triggerDeepDive` (20 pts), `triggerDailyBrief` (30 pts), `snoozeTicker` (0 pts), `markVerdictAddressed` (0 pts), `waitForJob` (0 pts).

All action tools: require confirmation handshake (E2.2), check user restriction (E2.4), write `tool_calls` audit row with `cost_points`. `triggerDeepDive` and `triggerQuickCheck` write `jobs.conversation_id` for correlation.

`waitForJob` polls Postgres `jobs` until terminal status or `max_wait_for_job_sec` timeout (G2.2–G2.4).

---

## 5.7 — Tool registry

`backend/src/services/chat/tools/registry.ts`

`buildToolRegistry(ctx)` returns the typed Read+Action array. Throws at build time if any tool name is not in `ALL_TOOL_NAMES` (E4.1). `FORBIDDEN_TOOL_NAMES` enumerated; startup guard asserts none are registered (E3.1–E3.3, F3.2).

---

## 5.8 — Conversation store + confirmation store

`conversationStore.ts` — `createConversation`, `loadConversation`, `appendTurn` (atomic increment + insert), `loadHistory`, `endConversation`, `incrementToolCallCount`.

`confirmationStore.ts` — in-memory, per-conversation pending-action store with 15-minute TTL. `put`, `peek`, `clear`, `parseConfirmation` (yes/no/unclear).

---

## 5.9 — `agentChat` loop

`backend/src/services/chat/agentChat.ts`

Single entry point for all three transports. Channel used only as an audit field (C1.3). Loop:
1. Feature gate + budget gate
2. Load or create conversation
3. Confirmation handshake check
4. Build persona prompt + tool registry + resolve model
5. Tool-calling loop: invoke provider → dispatch tool calls → filter results → next turn
6. Termination: `model_final` (no tool calls), `max_turns`, `token_cap`, `points_budget_exhausted`, `error`
7. Final reply filtered through output filter before returning

Action tools that need confirmation exit the loop with a proposal message and store the pending action in `confirmationStore`. The next `agentChat` call for the same conversation resolves it.

---

## 5.10 — Startup guards extended

`startupGuards.ts` now runs three Phase 5 guards after the Phase 3 execSync guard:
- F3.1: persona prompt non-empty and contains no forbidden content
- F3.2: no forbidden tool name in `ALL_TOOL_NAMES`
- F3.3: output filter pattern list non-empty

---

## 5.11 — Dashboard chat route

`backend/src/routes/chat.ts`

- `POST /api/chat/messages` — calls `agentChat`, returns `{ conversationId, replyText, terminationReason }`
- `GET /api/chat/conversations/:id` — returns conversation + turns (read-only)

Wired into `app.ts` behind `authMiddleware + userIsolationMiddleware`.

---

## 5.12 — Admin conversations endpoint

`GET /api/admin/conversations` with filters `userId`, `channel`, `terminationReason`, `since`, `until`, `limit`. Added to `admin.ts`.

---

## 5.13 — `chat_agent` model-tier assignments

`chat_agent` added to `STEP_KINDS` and `DEFAULT_MODEL_TIER_ASSIGNMENTS`. Default models: `google/gemini-2.5-flash` for free/cheap/balanced, `claude-sonnet-4-6` for expensive.

---

## 5.14 — Frontend: dashboard chat pane

`frontend/src/pages/Chat.tsx` — clean chat UI with:
- Suggestion chips for first-time users
- User messages right-aligned (blue), assistant messages left-aligned
- "Thinking…" spinner while waiting
- Enter to send, Shift+Enter for new line
- Conversation ID persisted in component state for multi-turn conversations

Routed at `/chat` behind `ProtectedRoute`. Added to `BottomNav` (replaced Reports tab with Chat tab). `chatTab` translation key added to both English and Hebrew.

---

## Files changed

```
NEW (backend)
  backend/src/services/chat/agentChat.ts
  backend/src/services/chat/personaPrompt.ts
  backend/src/services/chat/outputFilter.ts
  backend/src/services/chat/conversationStore.ts
  backend/src/services/chat/confirmationStore.ts
  backend/src/services/chat/tools/registry.ts
  backend/src/services/chat/tools/readTools.ts
  backend/src/services/chat/tools/actionTools.ts
  backend/src/routes/chat.ts
  backend/src/db/entities/{Conversation,ConversationTurn,ToolCall,OutputFilterEvent}Entity.ts

NEW (frontend)
  frontend/src/pages/Chat.tsx
  frontend/src/api/chat.ts

EDITED
  db/application_postgres.sql                          (+ 4 chat tables)
  backend/src/db/applicationDataSource.ts              (+ 4 entities)
  backend/src/services/security/startupGuards.ts       (+ F3.1/F3.2/F3.3 guards)
  backend/src/services/featureFlagService.ts           (+ populated forbidden_pattern_list)
  backend/src/services/stepQueue/types.ts              (+ chat_agent step kind)
  backend/src/services/stepQueue/modelTier.ts          (+ chat_agent model assignments)
  backend/src/routes/admin.ts                          (+ GET /api/admin/conversations)
  backend/src/app.ts                                   (+ chat route)
  frontend/src/App.tsx                                 (+ /chat route)
  frontend/src/components/ui/BottomNav.tsx             (+ Chat tab)
  frontend/src/store/i18n.ts                           (+ chatTab key)
```

---

## Operational steps on VPS (Task 5.15)

```bash
cd /root/clawd && ./deploy.sh

# Verify Phase 5 DDL applied
psql "$APP_DATABASE_URL" -c "\d conversations; \d conversation_turns; \d tool_calls;"

# Verify startup guards pass
journalctl -u clawd-backend -n 20
# Must NOT see: startup_guard.persona_prompt_empty
# Must NOT see: startup_guard.forbidden_tool_registered
# Must NOT see: startup_guard.output_filter_patterns_empty

# Flip the chat agent flags
psql "$APP_DATABASE_URL" -c "
  UPDATE feature_flags
  SET enabled = true, updated_at = NOW(), updated_by = 'operator'
  WHERE flag_name IN ('chat_agent_enabled', 'output_filter_enabled')
    AND scope_user_id IS NULL;"

# Test: send a message from the dashboard /chat page
# Verify conversation persisted
psql "$APP_DATABASE_URL" -c "
  SELECT id, user_id, channel, turn_count, total_cost_usd, termination_reason
  FROM conversations ORDER BY started_at DESC LIMIT 5;"

# Verify tool calls recorded
psql "$APP_DATABASE_URL" -c "
  SELECT tool_name, category, result_status, cost_points, occurred_at
  FROM tool_calls ORDER BY occurred_at DESC LIMIT 10;"

# Test output filter: send a message containing 'openclaw'
# Verify output_filter_events row written
psql "$APP_DATABASE_URL" -c "
  SELECT pattern, site_of_match, original_length_chars, occurred_at
  FROM output_filter_events ORDER BY occurred_at DESC LIMIT 5;"
```

**Rollback:** Flip `chat_agent_enabled = false`. Conversations persist (read-only).

```sql
UPDATE feature_flags SET enabled = false, updated_at = NOW(), updated_by = 'operator'
WHERE flag_name IN ('chat_agent_enabled', 'output_filter_enabled') AND scope_user_id IS NULL;
```
