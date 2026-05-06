# Bug Report: Platform Stabilization v2 Deploy (Phases 0–6)

**Date discovered:** 2026-05-06
**Deployed by:** Claude Code (Sonnet 4.6) on VPS
**Status:** All open bugs fixed in this commit.

---

## Changes made during this deploy session (bugs in the Kiro-built code, now fixed)

These were found during deploy and patched in commits `ce7cab0` and `8c53436`.

### FIXED — 18 TypeScript compilation errors
### FIXED — Startup guard false positive (execSync in its own comment)
### FIXED — DDL `NOW()` in partial index predicate
### FIXED — Feature flag seeding parameter type inference failure
### FIXED — `admitStepQueueJob` FK violation on every step-queue job trigger
### FIXED (partially) — Watchdog null-row crash on UPDATE RETURNING

---

## Open Bugs — now fixed in this commit

---

### FIXED — Bug 1: ALL chat messages fail — TypeORM UPDATE RETURNING wraps result as `[rows, rowCount]`

**Root cause:** TypeORM 0.3.x wraps UPDATE RETURNING results as `[rows, rowCount]` not `rows[]`.
`appendTurn` in `conversationStore.ts` read `updated[0]?.turn_count` where `updated[0]` was the rows array, not a row — so `turn_count` was always `undefined`, `turnIndex` was always `0`, and every assistant turn hit a duplicate-key constraint.

**Fix:** Created `backend/src/services/dbUtils.ts` with `unwrapMutationRows<T>()` that normalises both TypeORM result shapes. Applied to all UPDATE RETURNING call sites:
- `conversationStore.ts` — `appendTurn` (critical path)
- `watchdog.ts` — all three sweep functions
- `channelBindingStore.ts` — `unbindChannel`
- `notificationStore.ts` — `markRead`
- `snoozeStore.ts` — `cancelSnooze`

Also added explicit `conversation_not_found` error when the UPDATE matches no rows (was silently producing `turnIndex = 0`).

---

### FIXED — Bug 2: Debate and synthesis steps fail — invalid OpenRouter model IDs

**Root cause:** `DEFAULT_MODEL_TIER_ASSIGNMENTS` used bare Anthropic model IDs (`claude-sonnet-4-6`, `claude-opus-4-7`) without the `anthropic/` prefix required by OpenRouter.

**Fix:** Updated `modelTier.ts` defaults to use correct OpenRouter-prefixed IDs:
- `balanced` debate/synthesis: `anthropic/claude-sonnet-4-5`
- `expensive` all steps: `anthropic/claude-sonnet-4-5` / `anthropic/claude-opus-4-5`

Also removed the dead `namespaceModelForUser` no-op function (R1).

**VPS SQL migration required:**
```sql
UPDATE model_tier_assignments
SET model = 'anthropic/claude-sonnet-4-5', updated_at = NOW(), updated_by = 'bugfix'
WHERE model IN ('claude-sonnet-4-6', 'claude-sonnet-4-5');

UPDATE model_tier_assignments
SET model = 'anthropic/claude-opus-4-5', updated_at = NOW(), updated_by = 'bugfix'
WHERE model IN ('claude-opus-4-7', 'claude-opus-4-5');
```

---

### FIXED — Bug 3: `fundamentals.ts` does not filter invalid URLs from `sources[]`

**Root cause:** `normalizeRaw` in `fundamentals.ts` passed `sources` through without URL validation, unlike the other three analyst handlers.

**Fix:** Applied the same `filter((s) => typeof s === "string" && /^https?:\/\//.test(s))` pattern used by `technical.ts`, `macro.ts`, and `sentiment.ts`.

---

### FIXED — Bug 4: Chat agent never passes tool definitions to the LLM

**Root cause:** `agentChat.ts` built the tool registry but never communicated tool definitions to the provider. The LLM had no knowledge of available tools and would never emit tool calls.

**Fix:** The tool manifest is now embedded in the system prompt as structured JSON. The model is instructed to emit tool calls in a `\`\`\`tool_call\n{...}\n\`\`\`` block. `extractToolUseBlocks` now parses both native `tool_use` blocks (for future Anthropic/OpenAI providers) and the text-based format (for current OpenRouter).

Tool call blocks are stripped from the final reply text before showing to the user.

---

### FIXED — Bug 5: `resolveStepModel` does not return `provider`

**Root cause:** `ResolvedModel` had no `provider` field; `agentChat.ts` used an unsafe cast that always evaluated to `"openrouter"`.

**Fix:** Added `provider: string` to `ResolvedModel`. `resolveStepModel` now reads the `provider` column from `model_tier_assignments` and includes it in the result. `agentChat.ts` uses `resolvedModel?.provider` directly.

---

### FIXED — Bug 6: Watchdog spurious log entries

**Root cause:** Same as Bug 1 — UPDATE RETURNING result misread. Also added a concurrency guard (`let scanning = false`) to prevent overlapping sweeps (R9).

---

### FIXED — Feed page disappeared from nav

**Root cause:** The BottomNav was updated to add the Chat tab by replacing the Reports/Feed tab. The Feed page is critical — it shows report history and will show news in the future.

**Fix:** Restored the Reports tab. Nav is now: Portfolio, Chat, Reports, Strategies, Settings. Controls is still accessible via direct URL `/controls` and from the Settings page.

---

## VPS actions required after deploying this fix

### 1. Deploy
```bash
cd /root/clawd && git pull origin main && ./deploy.sh
```

### 2. Fix model IDs in the database
```sql
-- Fix Claude model IDs to use OpenRouter-prefixed format
UPDATE model_tier_assignments
SET model = 'anthropic/claude-sonnet-4-5', updated_at = NOW(), updated_by = 'bugfix'
WHERE model IN ('claude-sonnet-4-6', 'claude-sonnet-4-5')
  AND model NOT LIKE 'anthropic/%';

UPDATE model_tier_assignments
SET model = 'anthropic/claude-opus-4-5', updated_at = NOW(), updated_by = 'bugfix'
WHERE model IN ('claude-opus-4-7', 'claude-opus-4-5')
  AND model NOT LIKE 'anthropic/%';

-- Verify
SELECT tier, step_kind, model FROM model_tier_assignments ORDER BY tier, step_kind;
```

### 3. Verify chat works
- Open the dashboard `/chat` page
- Send a message like "What's my portfolio?"
- Verify the assistant responds with portfolio data (not just generic text)
- Verify `tool_calls` rows are being written:
```sql
SELECT tool_name, category, result_status, occurred_at
FROM tool_calls ORDER BY occurred_at DESC LIMIT 10;
```

### 4. Verify deep dives work
- Trigger a deep dive from the Controls page
- Verify it completes without the 400 model ID error:
```sql
SELECT step_id, error_class, error_message, occurred_at
FROM step_lifecycle_events
WHERE error_class IS NOT NULL AND occurred_at > NOW() - INTERVAL '10 minutes'
ORDER BY occurred_at DESC;
```

### 5. Verify the Feed page is back
- Open the dashboard — the bottom nav should show: Portfolio, Chat, Reports, Strategies, Settings
- Navigate to Reports — the feed should load

---

## Remaining code review items (not causing failures, lower priority)

- **R5** — Chat startup guard (F3.3) always passes even with empty pattern list (static patterns are always present, so this is safe but not a true guard against misconfiguration)
- **R6** — `setFeatureFlag` doesn't validate UPDATE result
- **R7** — Theoretical double-execution risk on rapid restart (single-instance deployment, low priority)
- **R8** — Dead `randomBytes` import in `admission.ts`
- **R10** — `persona_redirect_line` stored as JSON-encoded string (confusing in psql but functionally correct)
