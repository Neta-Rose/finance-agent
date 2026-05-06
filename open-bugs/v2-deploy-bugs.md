# Bug Report: Platform Stabilization v2 Deploy (Phases 0–6)

**Date discovered:** 2026-05-06  
**Deployed by:** Claude Code (Sonnet 4.6) on VPS  
**Status:** Open (all bugs below are unresolved unless marked FIXED)

---

## Changes made during this deploy session (bugs in the Kiro-built code, now fixed)

These were found during deploy and patched in commits `ce7cab0` and `8c53436`.

### FIXED — 18 TypeScript compilation errors

The merged branch did not compile. Errors were spread across 18 files and fell into 4 categories:

1. **Unused imports/variables** (`noUnusedLocals`/`noUnusedParameters` strict mode) — dead imports left behind during refactoring: `getUserAgentStatus`, `getUserControl`, `hasPendingAgentManagedWork`, `shouldRestartGatewayAfterStartupReconciliation`, `FORBIDDEN_TOOL_NAMES` in `agentChat.ts`, `toolDefs`, `toolT0`, `CLAWD_ROOT`, `StrategySchema` in `quickCheck.ts`, `ctx` in `buildReadTools`/`buildActionTools`, `FileText` in `BottomNav.tsx`, `z` in llmProviders/index.ts, `pe` in fundamentalsSource.ts, `UserWorkspace` and `getApplicationDataSource` in chat.ts, `getActiveUserEligibility`/`readState` in server.ts.

2. **`exactOptionalPropertyTypes` violations** — `conversationId?: string` (optional) being assigned a `string | undefined` value to parameters typed `conversationId?: string` with exactOptionalPropertyTypes. Fixed with conditional spread `...(val ? { key: val } : {})` in chat.ts, telegram.ts, whatsapp.ts. Same fix applied to `thinkingBudget` and `timeoutMs` in selfCorrectingRetry.ts and structuredOutputs.ts. Fixed `note: string | undefined` vs `note?: string | null` in actionTools.ts. Fixed escalation history `ticker` and notification `unreadOnly` optional params.

3. **`startupGuards.ts` structural issues** — Two exported `runStartupGuards` functions (Phase 3 and Phase 5 versions coexisted). Also, `Dirent` type annotation used wrong overload causing type errors on `entry.name`. Fixed by removing the Phase 3 stub and restructuring `fs.readdir` result handling.

4. **Type cast issues** — `ExaSearchResult` not assignable to `Record<string, unknown>` in readTools.ts and sentimentSource.ts. `Strategy.catalysts` possibly undefined in synthesis.ts dualWriteStrategy call. `JSONSchema7` import from `json-schema` not found under `moduleResolution: "bundler"` — replaced with inline `type JSONSchema7 = Record<string, unknown>`.

### FIXED — Startup guard false positive (execSync in its own comment)

`startupGuards.ts` scans source files for the regex pattern matching `import { execSync }`. The file's own comments contained the literal text `import { execSync } from "child_process"` (as documentation examples), which the regex matched. Server exited with code 78 on every start. Fixed by excluding `startupGuards.ts` itself from the scan.

### FIXED — DDL `NOW()` in partial index predicate

`db/application_postgres.sql` had:
```sql
CREATE INDEX IF NOT EXISTS idx_ticker_snoozes_active
  ON ticker_snoozes (user_id, ticker, snooze_until DESC)
  WHERE snooze_until > NOW();
```
PostgreSQL requires index predicate functions to be IMMUTABLE. `NOW()` is VOLATILE. This caused the DDL application to fail, preventing all Phase 1+ tables from being created. Fixed by removing the `WHERE` clause, making it a plain index.

### FIXED — Feature flag seeding parameter type inference failure

`ensureDefaultFeatureFlags` used:
```sql
SELECT $1, NULL, $2, $3::jsonb, NOW(), 'system_default'
 WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = $1 ...)
```
PostgreSQL couldn't infer the type of `$1` when it appeared both in the SELECT list and the EXISTS subquery. Fixed by adding explicit `$1::VARCHAR` and `$2::BOOLEAN` casts.

### FIXED — `admitStepQueueJob` FK violation on every step-queue job trigger

`admission.ts` inserted an audit row into `step_lifecycle_events` using `gen_random_uuid()` as `step_id`:
```sql
INSERT INTO step_lifecycle_events (step_id, ...) VALUES (gen_random_uuid(), ...)
```
The table has `step_id UUID NOT NULL REFERENCES step_work_items(id)`. A random UUID never exists in `step_work_items`. This caused every user-triggered deep dive, quick check, daily brief, and full report to fail with a FK violation immediately after admission. Fixed by replacing the INSERT with a `logger.info` call.

### FIXED (partially) — Watchdog null-row crash on UPDATE RETURNING

The watchdog's `sweepStuckSteps` and `sweepStuckJobs` used:
```typescript
const result = await ds.query(`UPDATE ... RETURNING id, ...`) as Array<{id: string, ...}>;
for (const row of result) { ... row.id ... }
```
This caused `row.id = undefined`, which then triggered a NOT NULL constraint violation when trying to insert lifecycle events. Added null guards (`filter(r => r && r.id)`) to prevent the crash. **Root cause not yet fixed** — see Bug 1 below.

---

## Open Bugs (unresolved)

---

### Bug 1 — CRITICAL: ALL chat messages fail — TypeORM UPDATE RETURNING wraps result as `[rows, rowCount]`

**Symptom:** Every chat message from any user fails with:
```
chat route error user=soofke: duplicate key value violates unique constraint "conversation_turns_pkey"
```

**Observable state:** All conversations in the DB have `turn_count = 1` and exactly one user turn at `turn_index = 0`. No assistant turns ever get inserted. Every conversation is left open (no `ended_at`).

**Root cause:** TypeORM 0.3.28's `PostgresQueryRunner.query()` returns UPDATE statements differently from SELECT/INSERT:
```javascript
// PostgresQueryRunner.js, line ~201
case "UPDATE":
    result.raw = [raw.rows, raw.rowCount];  // ← NOT raw.rows alone!
    break;
default:
    result.raw = raw.rows;
```
So `ds.query("UPDATE ... RETURNING turn_count")` returns `[[{ turn_count: 2 }], 1]` — an array where element 0 is the rows array and element 1 is the row count.

`appendTurn` in `conversationStore.ts` (line 122–123) does:
```typescript
const updated = await manager.query(`UPDATE conversations SET turn_count = turn_count + 1 ... RETURNING turn_count`, ...) as Array<{ turn_count: number }>;
const turnIndex = (updated[0]?.turn_count ?? 1) - 1;
```
With the actual result `[[{ turn_count: 2 }], 1]`:
- `updated[0]` = `[{ turn_count: 2 }]` (the rows array, not a row)
- `updated[0]?.turn_count` = `undefined` (array has no `.turn_count` property)
- `turnIndex = (undefined ?? 1) - 1 = 0` — **always 0**

User turn (first `appendTurn`) inserts at `(conv_id, 0)` — succeeds.  
Assistant turn (second `appendTurn`) also computes index 0 → **duplicate key**.

The error propagates to the chat route's outer catch → HTTP 500 → no `conversationId` in response → frontend creates a fresh conversation on retry → same failure repeats forever.

**The executor already knows this pattern.** `executor.ts` line 55 has:
```typescript
function mutationRows<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0]) && (typeof result[1] === "number" || result.length === 2)) {
    return result[0] as T[];
  }
  return Array.isArray(result) ? result as T[] : [];
}
```
`conversationStore.ts` and `watchdog.ts` were written without this wrapper.

**Affected sites (UPDATE...RETURNING not using `mutationRows`):**
| File | Line | Query | Effect |
|---|---|---|---|
| `conversationStore.ts` | 115 | `UPDATE conversations ... RETURNING turn_count` | `turnIndex` always 0, every assistant turn fails |
| `watchdog.ts` | 78 | `UPDATE step_work_items ... RETURNING id, kind, user_id, job_id` | stuck steps not tracked in lifecycle events |
| `watchdog.ts` | 120 | `UPDATE jobs ... RETURNING id, action, user_id` | stuck jobs not fully cleaned up |
| `watchdog.ts` | 154 | `UPDATE jobs ... RETURNING id, action, user_id` | abandoned jobs not fully cleaned up |
| `channelBindingStore.ts` | 125 | `UPDATE channel_bindings ... RETURNING channel` | unbind result not readable |
| `notificationStore.ts` | 191 | `UPDATE notifications_outbox ... RETURNING id` | mark-read result not readable |
| `snoozeStore.ts` | 127 | `UPDATE ticker_snoozes ... RETURNING id` | unsnooze result not readable |

**Fix:** Export `mutationRows` from `executor.ts` (or a shared utility) and replace every `await ds.query(UPDATE ... RETURNING ...)` cast with `mutationRows(await ds.query(...))`. In `appendTurn` specifically:
```typescript
// Change:
const updated = await manager.query(...) as Array<{ turn_count: number }>;
const turnIndex = (updated[0]?.turn_count ?? 1) - 1;

// To:
const rawUpdated = await manager.query(...);
const updatedRows = (Array.isArray(rawUpdated) && Array.isArray(rawUpdated[0])) ? rawUpdated[0] : rawUpdated;
const turnCount = (updatedRows as Array<{ turn_count: number }>)[0]?.turn_count;
if (!turnCount) throw new Error(`Conversation not found: ${conversationId}`);
const turnIndex = turnCount - 1;
```

Also note: the `?? 1` fallback in the current code silently produces `turnIndex = 0` when the conversation doesn't exist, instead of throwing. This should be an explicit error.

---

### Bug 2 — CRITICAL: Debate and synthesis steps fail for balanced/expensive users — invalid OpenRouter model IDs

**Symptom:**
```
Step queue step failed: step=... kind=debate user=example4 error=Error: OpenRouter request failed 400: 
{"error":{"message":"claude-sonnet-4-6 is not a valid model ID","code":400}}
```

**Root cause:** The `model_tier_assignments` table for `balanced` and `expensive` tiers uses bare Anthropic model IDs (`claude-sonnet-4-6`, `claude-opus-4-7`) without the `anthropic/` prefix required by OpenRouter's API.

OpenRouter expects: `anthropic/claude-sonnet-4-6`  
What the DB has: `claude-sonnet-4-6`

**Affected tiers in DB:**
| tier | step_kind | model (current, broken) | should be |
|---|---|---|---|
| balanced | debate | `claude-sonnet-4-6` | `anthropic/claude-sonnet-4-6` |
| balanced | synthesis | `claude-sonnet-4-6` | `anthropic/claude-sonnet-4-6` |
| expensive | debate | `claude-opus-4-7` | `anthropic/claude-opus-4-7` |
| expensive | synthesis | `claude-opus-4-7` | `anthropic/claude-opus-4-7` |
| expensive | analyst.* | `claude-sonnet-4-6` | `anthropic/claude-sonnet-4-6` |

Also affected: `DEFAULT_MODEL_TIER_ASSIGNMENTS` in `modelTier.ts` hardcodes `"claude-sonnet-4-6"` for expensive analysts and `"claude-opus-4-7"` for expensive debate/synthesis — these will fail the same way if the DB row is ever missing and the code falls back to defaults.

**Note on `namespaceModelForUser`:** This function was presumably intended to prepend a per-user OpenRouter proxy prefix (`clawd-${userId}/model`), but its implementation is a no-op:
```typescript
export function namespaceModelForUser(userId: string, model: string): string {
  const normalized = model.startsWith("openrouter/") ? model.slice("openrouter/".length) : model;
  return normalized.startsWith(`clawd-${userId}/`) ? normalized : normalized;  // both branches identical
}
```
If this was supposed to route through a per-user OpenRouter proxy, it never did. Either complete the implementation or remove the function.

**Fix:** Update the `model_tier_assignments` rows in the DB and in the `DEFAULT_MODEL_TIER_ASSIGNMENTS` constant:
```sql
UPDATE model_tier_assignments
SET model = 'anthropic/claude-sonnet-4-6'
WHERE model = 'claude-sonnet-4-6';

UPDATE model_tier_assignments
SET model = 'anthropic/claude-opus-4-7'
WHERE model = 'claude-opus-4-7';
```

---

### Bug 3 — HIGH: `fundamentals.ts` does not filter invalid URLs from `sources[]`

**Symptom:**
```
Step queue step failed: step=... kind=analyst.fundamentals user=example4 error=[
  { "validation": "url", "code": "invalid_string", "message": "Invalid url", "path": ["sources", 0] }
]
```

**Root cause:** The `normalizeRaw` in `fundamentals.ts` passes `sources` through without URL validation:
```typescript
sources: Array.isArray(obj["sources"]) && obj["sources"].length > 0 ? obj["sources"] : ["https://finance.yahoo.com/"],
```
When the LLM returns non-URL strings in `sources` (empty string, plain text like "Yahoo Finance", relative paths), the Zod schema rejects them. The analyst schemas require `z.string().url()` for each source.

**Contrast with other analysts** — `sentiment.ts`, `technical.ts`, and `macro.ts` all correctly filter:
```typescript
const sourcesRaw = Array.isArray(obj["sources"]) ? (obj["sources"] as unknown[]) : [];
const sources = sourcesRaw.filter((s): s is string => typeof s === "string" && /^https?:\/\//.test(s));
...
sources: sources.length > 0 ? sources : ["https://finance.yahoo.com/"],
```

**Fix:** Apply the same filter pattern to `fundamentals.ts` `normalizeRaw`.

---

### Bug 4 — HIGH: Chat agent never passes tool definitions to the LLM

**Symptom:** The chat agent always responds as a plain text assistant with no ability to call tools (`getPortfolio`, `getStrategy`, `triggerQuickCheck`, etc.).

**Root cause:** `agentChat.ts` builds the tool registry (`buildToolRegistry(toolCtx)`) but never passes tool definitions to `provider.invoke`:
```typescript
resp = await provider.invoke({
  model: modelName,
  messages: [{ role: "system", content: persona }, ...messages],
  // Comment: "we embed the tool list in the system prompt as JSON for now"
  // But no such embedding actually happens.
});
```
The comment describes the intended implementation, not the actual one. The persona prompt (`buildPersonaPrompt`) does not include any tool definitions. The LLM has no knowledge of available tools and will never emit a `tool_use` block. The `tools` variable is built but only used as a lookup table for dispatching tool calls that will never arrive.

**Why this matters:** The chat agent is a core Phase 5 feature. Without tool calling, it can only respond to questions from its training data — it cannot look up live portfolio data, trigger analyses, or record verdict actions.

**Fix:** Either:
1. Append a JSON tool manifest to the system prompt (low-effort, works with all OpenRouter models): append `JSON.stringify(tools.map(toolToProviderDef))` to the persona.
2. Use native tool calling via Anthropic provider (correct long-term approach): pass `tools` in the OpenRouter API call using the `tools` parameter (OpenRouter supports this for Claude models).

Note: `toolToProviderDef` was removed from the `agentChat.ts` import during the TypeScript fix (it was genuinely unused at the time). Will need to be re-added.

---

### Bug 5 — MEDIUM: `resolveStepModel` does not return `provider` — chat always uses OpenRouter

**Symptom:** The expensive tier chat agent uses OpenRouter even though the DB has `provider='anthropic'` for expensive tier rows.

**Root cause:** `ResolvedModel` interface has no `provider` field:
```typescript
export interface ResolvedModel { tier: ModelTier; primary: string; fallback: string | null; }
```
`agentChat.ts` attempts to read it anyway:
```typescript
const providerName = (resolvedModel as { provider?: string } | null)?.provider ?? "openrouter";
```
This always evaluates to `"openrouter"`. The `provider` column in `model_tier_assignments` is never used for chat.

**Fix:** Add `provider: ProviderName` to `ResolvedModel` and populate it in `resolveStepModel`. Note: currently all chat_agent tier assignments use `provider='openrouter'` anyway, but this will matter if the expensive tier is moved to `anthropic`.

---

### Bug 6 — LOW: Watchdog scan fires every 5 minutes with spurious log entries

**Symptom:** Every 5 minutes the watchdog logs confusing WARNs/ERRORs even when no jobs are stuck. The null guards added in the deploy fix prevent crashes but the underlying issue persists.

**Root cause:** Same as Bug 1 — `UPDATE ... RETURNING` results are `[rows, rowCount]` not `rows[]`. The null guard `result.filter(r => r && r.id)` silently drops all rows (since `r` is the rows-array, not a row, and arrays don't have `.id`). The WARN messages for `reset stuck step step_id=undefined` still fire before the guard (those WARNs are in the loop before the guard).

Actually, re-reading the watchdog code after the fix: the `validRows = Array.isArray(result) ? result.filter(r => r && r.id) : []` guard correctly filters out the malformed rows. The WARNs at 12:15 were from the last run of the OLD code before restart. Post-fix logs need to be checked to confirm the warnings are gone.

**Fix:** Apply `mutationRows` pattern to all three watchdog UPDATE RETURNING queries.

---

## Code review findings (additional quality issues)

These are not causing immediate failures but indicate technical debt:

### R1 — `namespaceModelForUser` is a no-op dead function
File: `backend/src/services/stepQueue/modelTier.ts:102`  
Both branches of the conditional return the same value. The function was presumably intended to route models through a per-user OpenRouter proxy prefix but was never completed. Either implement it or delete it and inline the `openrouter/` prefix strip.

### R2 — `agentChat.ts` builds a tool registry that is never used for anything
File: `backend/src/services/chat/agentChat.ts:186`  
`buildToolRegistry(toolCtx)` is called and the result assigned to `tools`, but tools are never communicated to the LLM. The registry is only used for post-hoc tool-call dispatch — dispatching tool calls that the LLM will never make because it doesn't know the tools exist. This is related to Bug 4.

### R3 — `appendTurn` silent fallback masks missing conversations
File: `backend/src/services/chat/conversationStore.ts:123`  
`const turnIndex = (updated[0]?.turn_count ?? 1) - 1` silently produces `turnIndex = 0` when the conversation doesn't exist (no row matched by the UPDATE). Should throw `new Error("conversation_not_found: " + conversationId)` instead.

### R4 — `conversationStore.ts` uses `manager.query()` inside transaction for both UPDATE and INSERT, but only the INSERT works
The transaction is structurally correct (UPDATE + INSERT are atomic), but because the UPDATE RETURNING result is misread, the INSERT index is wrong. Once Bug 1 is fixed, the transaction structure is fine.

### R5 — Chat startup guard (F3.3) always passes, even with empty pattern list
File: `backend/src/services/security/startupGuards.ts`  
`isForbiddenPatternListPopulated()` is called to check that the output filter has patterns. But the `forbidden_pattern_list` feature flag is seeded with a default list at startup (`ensureDefaultFeatureFlags`), so this guard will always pass unless explicitly cleared. It does not protect against misconfiguration where the list was wiped.

### R6 — `featureFlagService.ts` `setFeatureFlag` and `getFeatureValue` don't validate the returned UPDATE result
Several flag update operations use `ds.query(UPDATE ...)` without checking whether the row actually existed/was updated. A misspelled flag name silently does nothing.

### R7 — Step queue `executor.ts` does not handle the case where `admitOrReuseStepQueueJob` succeeds but the step queue is empty
After admission, the executor polls for pending steps. If for some reason the admitted steps are immediately picked up by a concurrent executor instance (e.g., after a rapid restart), the triggering request returns successfully but the job is already running — causing subtle double-execution risk. This is unlikely in the current single-instance deployment but worth noting.

### R8 — `admission.ts` imports `randomBytes` but never uses it
File: `backend/src/services/stepQueue/admission.ts:1`  
Dead import left after refactoring. Will not cause a runtime error but is noise.

### R9 — Watchdog fires every 5 minutes with concurrent Promise.all sweeps — no concurrency guard
File: `backend/src/services/scheduler/watchdog.ts`  
If a watchdog sweep takes longer than 5 minutes (e.g., stuck DB connection), the next sweep fires concurrently. This could cause multiple sweeps to process the same stuck rows, leading to spurious lifecycle event duplicates. A simple `let scanning = false` guard would prevent this.

### R10 — `personas_redirect_line` stored as a JSON string in feature_flags, not plain text
The `persona_redirect_line` flag has `value_json = "\"I can help with portfolio analysis...\""` — a JSON-encoded string (string within a string). When read back with `getFeatureValue<string>()`, the outer JSON parse produces the string correctly, but operators editing this in psql will find it confusing.

---

## Pre-existing bug (from open-bugs/full-report-schema-validation-failure.md)

The analyst `normalizeRaw` deficiencies for `technical`, `macro`, `sentiment`, and `risk` handlers are still unresolved and documented in the other file. Bug 3 above (fundamentals URL filtering) is a NEW instance of the same pattern (missing normalization floor) not covered by that file.
