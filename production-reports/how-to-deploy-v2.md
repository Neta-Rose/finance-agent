# How to deploy — Platform Stabilization v2 (Phases 0–6)

This is the consolidated deploy guide for the first major stabilization release.
It covers Phases 0 through 6 deployed as a single version.

**Time estimate:** 30–45 minutes including verification.

---

## What this version does

- **Phase 0** — Fixes the full-report schema validation bug. Unblocks users stuck in BOOTSTRAPPING.
- **Phase 1** — Adds 14 new Postgres tables for operational state. Dual-writes begin. Migration script moves existing JSON state into Postgres.
- **Phase 2** — Step queue absorbs `daily_brief` and `quick_check` job actions (behind a feature flag).
- **Phase 3** — OpenClaw retired. `agentService.ts` is a no-op stub. Workspace cleanup script removes retired files.
- **Phase 4** — Analyst handlers restructured as synthesizers. Deterministic facts pre-computed server-side.
- **Phase 5** — Chat agent ships. Dashboard `/chat` page live (behind a feature flag).
- **Phase 6** — Telegram and WhatsApp transports rewritten as thin adapters routing to the chat agent.

---

## Pre-deploy checklist

Complete these before running `./deploy.sh`.

### 1. Set required environment variables

Edit `/etc/systemd/system/clawd-backend.service`. Add or verify:

```ini
# Required for Phase 6 Telegram transport
Environment="TELEGRAM_SECRET=<your-telegram-bot-api-secret-token>"

# Required for Phase 6 WhatsApp transport (can be empty if not using WhatsApp yet)
Environment="WHATSAPP_VERIFY_TOKEN=<your-whatsapp-verify-token>"
Environment="WHATSAPP_APP_SECRET=<your-meta-app-secret>"

# Already set — verify it's not "changeme"
Environment="JWT_SECRET=<strong-random-secret>"

# Already set — verify it's present
Environment="APP_DATABASE_URL=postgresql://..."
Environment="ADMIN_KEY=..."
Environment="OPENROUTER_API_KEY=..."
```

After editing:
```bash
systemctl daemon-reload
```

> **Note:** `TELEGRAM_SECRET` is now read by the Telegram webhook. If it's unset, the webhook will accept all requests without signature verification (safe but insecure). Phase 9 adds a startup guard that refuses to start without it.

### 2. Verify Postgres is running

```bash
psql "$APP_DATABASE_URL" -c "SELECT 1;"
```

### 3. Verify no in-flight jobs

The migration script refuses to run for users with in-flight `step_work_items.status='running'` rows. Check:

```sql
SELECT user_id, COUNT(*) FROM step_work_items WHERE status = 'running' GROUP BY user_id;
```

If any exist, wait for them to complete or supersede them:
```bash
tsx backend/src/scripts/supersedeStuckJob.ts <job_id>
```

---

## Deploy sequence

### Step 1 — Pull and build

```bash
cd /root/clawd
git pull origin main
./deploy.sh
```

`deploy.sh` runs: `git pull` → `npm ci` + `npm run build` (backend) → `npm ci` + `npm run build` (frontend) → `systemctl restart clawd-backend` → health check.

### Step 2 — Verify the backend started

```bash
systemctl status clawd-backend
journalctl -u clawd-backend -n 30
```

**What to look for:**
- `Server started on port 8081` — good
- `Default feature flags ensured` — good
- `Application PostgreSQL data source initialized` — good
- `startup_guard.execsync_detected` — **bad**, means execSync was found in source. Contact support.
- `startup_guard.persona_prompt_empty` — **bad**, means the persona prompt is empty. Contact support.
- `startup_guard.forbidden_tool_registered` — **bad**, means a forbidden tool was registered. Contact support.
- Exit code 78 — **bad**, startup guard failed. Check logs for which guard.

### Step 3 — Verify DDL applied

```sql
-- Connect to the database
psql "$APP_DATABASE_URL"

-- Confirm new tables exist (should see all of these)
\dt users
\dt strategies
\dt feature_flags
\dt channel_bindings
\dt encrypted_secrets
\dt conversations
\dt conversation_turns
\dt tool_calls
\dt output_filter_events

-- Confirm feature flags seeded (expect 15+ rows)
SELECT flag_name, enabled, value_json::text
FROM feature_flags
WHERE scope_user_id IS NULL
ORDER BY flag_name;
```

Expected flags and their default values:

| Flag | Default |
|---|---|
| `chat_agent_enabled` | `false` |
| `output_filter_enabled` | `false` |
| `structured_outputs_enabled` | `false` |
| `self_correcting_retry_enabled` | `true` |
| `legacy_job_runners_enabled` | `true` |
| `asset_class_dispatch_enabled` | `false` |
| `transactions_ledger_enabled` | `false` |
| `snooze_enabled` | `false` |
| `max_turns` | `12` |
| `conversation_token_cap` | `120000` |
| `search_web_max_results` | `8` |
| `max_wait_for_job_sec` | `600` |
| `max_snooze_days` | `180` |
| `forbidden_pattern_list` | `[array of terms]` |
| `cors_allow_list` | `[]` |
| `coverage_limit` | `10` |

### Step 4 — Run the Phase 0 bugfix verification

Find users stuck in BOOTSTRAPPING and re-trigger their full reports:

```bash
# Find stuck users
for u in $(ls /root/clawd/users); do
  s=/root/clawd/users/$u/data/state.json
  if [ -f "$s" ]; then
    state=$(jq -r '.state // empty' "$s")
    completed=$(jq -r '.bootstrapProgress.completed // empty' "$s")
    if [ "$state" = "BOOTSTRAPPING" ] && [ "$completed" = "0" ]; then
      echo "STUCK: $u"
    fi
  fi
done

# Re-issue full_report for each stuck user
curl -X POST http://localhost:8081/api/admin/users/<USER_ID>/jobs \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"full_report"}'
```

Wait ~5 minutes, then verify:
```sql
SELECT id, user_id, action, status, completed_at, failure_reason
FROM jobs
WHERE action = 'full_report' AND triggered_at > NOW() - INTERVAL '10 minutes'
ORDER BY triggered_at DESC;

-- Confirm no new Zod failures
SELECT step_id, error_class, error_message, occurred_at
FROM step_lifecycle_events
WHERE error_class LIKE 'zod_%' AND occurred_at > NOW() - INTERVAL '10 minutes'
ORDER BY occurred_at DESC;
```

### Step 5 — Run the Phase 1 migration

This migrates existing JSON state into Postgres. **Dry-run first.**

```bash
cd /root/clawd

# Dry run for one user — inspect the JSON output
tsx backend/src/scripts/migrateUserStateToPostgres.ts --user <first_user_id>

# If the summary looks correct, commit for that user
tsx backend/src/scripts/migrateUserStateToPostgres.ts --user <first_user_id> --commit

# Verify parity (exit 0 = clean, exit 2 = blocking issues)
tsx backend/src/scripts/verifyMigrationParity.ts --user <first_user_id>

# When confident, migrate all users
tsx backend/src/scripts/migrateUserStateToPostgres.ts --all --commit
tsx backend/src/scripts/verifyMigrationParity.ts --all
```

**If the parity verifier reports issues:**
- `present in JSON, missing in DB` — the migration didn't insert the row. Check the migration summary for `corrupt_input_skipped` entries.
- `verdict differs` — the DB row has a different verdict than the JSON file. The JSON is still source of truth in Phase 1; this is a warning, not a blocker.

### Step 6 — Run the Phase 3 workspace cleanup

```bash
# Dry run first
tsx backend/src/scripts/cleanupOpenClawWorkspaces.ts --all

# Commit
tsx backend/src/scripts/cleanupOpenClawWorkspaces.ts --all --commit

# Wipe openclaw.json
psql "$APP_DATABASE_URL" -c "
  INSERT INTO migration_archive (id, user_id, source_path, reason, payload, archived_at)
  VALUES (gen_random_uuid(), 'system', '/root/.openclaw/openclaw.json',
          'openclaw_config_wiped',
          to_jsonb(pg_read_file('/root/.openclaw/openclaw.json')::text),
          NOW());"
echo '{}' > /root/.openclaw/openclaw.json

# Remove legacy bridge directory
rm -rf /root/clawd/data/triggers

# Verify
grep -r "execSync" /root/clawd/backend/src --include="*.ts" | grep -v ".test.ts"
# Expected: no output
```

### Step 7 — Verify Telegram channel bindings

The migration script should have seeded `channel_bindings` rows from `profile.json telegramChatId`:

```sql
SELECT channel, channel_identifier, user_id, bound_at
FROM channel_bindings
WHERE channel = 'telegram' AND unbound_at IS NULL;
```

If rows are missing, the migration script didn't run or the user had no `telegramChatId` in their profile. Users can re-bind via the Settings page "Get connect code" flow.

### Step 8 — Smoke test the API

```bash
# Health check
curl http://localhost:8081/api/health
# Expected: {"status":"ok"}

# Login
curl -X POST http://localhost:8081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"userId":"<user>","password":"<pass>"}'
# Expected: {"token":"..."}

# Strategies (should now read from DB)
curl http://localhost:8081/api/strategies \
  -H "Authorization: Bearer <token>"
# Expected: {"updatedAt":"...","strategies":[...]}
```

---

## Feature flag flips (do these after verifying the above)

### Flip 1 — Enable the chat agent (Phase 5)

Only do this after verifying the backend started cleanly and the migration ran.

```sql
UPDATE feature_flags
SET enabled = true, updated_at = NOW(), updated_by = 'operator'
WHERE flag_name IN ('chat_agent_enabled', 'output_filter_enabled')
  AND scope_user_id IS NULL;
```

Then test from the dashboard `/chat` page. Send a message. Verify:

```sql
-- Conversation created
SELECT id, user_id, channel, turn_count, termination_reason
FROM conversations ORDER BY started_at DESC LIMIT 3;

-- Tool calls recorded
SELECT tool_name, category, result_status, cost_points
FROM tool_calls ORDER BY occurred_at DESC LIMIT 10;
```

### Flip 2 — Enable structured outputs (Phase 4)

Only do this after verifying a full report runs cleanly with the chat agent enabled.

```sql
UPDATE feature_flags
SET enabled = true, updated_at = NOW(), updated_by = 'operator'
WHERE flag_name = 'structured_outputs_enabled' AND scope_user_id IS NULL;
```

Trigger a full report and verify `schema_mode` is populated:

```sql
SELECT kind, schema_mode, prose_fallback_used
FROM step_work_items
WHERE created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC;
```

### Flip 3 — Disable legacy job runners (Phase 2)

Only do this after verifying the step queue handles `daily_brief` and `quick_check` correctly.

```sql
UPDATE feature_flags
SET enabled = false, updated_at = NOW(), updated_by = 'operator'
WHERE flag_name = 'legacy_job_runners_enabled' AND scope_user_id IS NULL;
```

---

## What to expect after deploy

### Immediately working
- Dashboard loads normally
- Portfolio, strategies, reports, controls pages work as before
- Full reports and deep dives run through the step queue (they already did)
- Analyst handlers produce schema-valid output even when the LLM returns incomplete JSON
- Stuck BOOTSTRAPPING users unblock after re-triggering full reports

### Working after migration script
- Strategies page reads from Postgres (DB-first, JSON fallback)
- Notifications, escalation history, report index mirrored in Postgres

### Working after flag flips
- `/chat` page live after `chat_agent_enabled = true`
- Structured outputs after `structured_outputs_enabled = true`
- Step queue handles daily briefs after `legacy_job_runners_enabled = false`

### Telegram
- Inbound messages route to the chat agent (not slash commands)
- Replies delivered via bot token from `encrypted_secrets`
- Users who had `telegramChatId` in their profile are automatically bound

### WhatsApp
- Requires `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` env vars
- Requires webhook registration with Meta
- Users bind via Settings → "Get connect code"

---

## Rollback

If anything goes wrong, the safest rollback is:

```bash
# 1. Revert to the previous commit
git log --oneline -5  # find the pre-v2 commit hash
git revert --no-commit <hash>..HEAD
git commit -m "Emergency rollback to pre-v2"
./deploy.sh

# 2. The new tables are harmless to the old code — leave them in place.
#    If you want a clean slate:
psql "$APP_DATABASE_URL" -c "
  TRUNCATE strategies, report_batches, report_index, notifications_outbox,
           escalation_history, verdict_actions, ticker_snoozes,
           portfolio_risk_snapshots, admin_audit_log, migration_archive,
           feature_flags, channel_bindings, encrypted_secrets,
           conversations, conversation_turns, tool_calls,
           output_filter_events, users CASCADE;"
```

The JSON files in `users/` are never modified by any migration, so they remain intact as the source of truth for the rolled-back code.

---

## Quick reference — key SQL queries

```sql
-- Check feature flags
SELECT flag_name, enabled FROM feature_flags WHERE scope_user_id IS NULL ORDER BY flag_name;

-- Check recent jobs
SELECT id, user_id, action, status, triggered_at, failure_reason
FROM jobs ORDER BY triggered_at DESC LIMIT 10;

-- Check step failures
SELECT step_id, error_class, error_message, occurred_at
FROM step_lifecycle_events
WHERE error_class IS NOT NULL AND occurred_at > NOW() - INTERVAL '1 hour'
ORDER BY occurred_at DESC LIMIT 20;

-- Check conversations
SELECT id, user_id, channel, turn_count, total_cost_usd, termination_reason
FROM conversations ORDER BY started_at DESC LIMIT 10;

-- Check migration archive
SELECT reason, COUNT(*) FROM migration_archive
WHERE archived_at > NOW() - INTERVAL '1 day'
GROUP BY reason ORDER BY COUNT(*) DESC;

-- Flip a flag for a single user (for testing)
INSERT INTO feature_flags (flag_name, scope_user_id, enabled, value_json, updated_at, updated_by)
VALUES ('chat_agent_enabled', '<user_id>', true, NULL, NOW(), 'operator')
ON CONFLICT (flag_name, scope_user_id) DO UPDATE
  SET enabled = EXCLUDED.enabled, updated_at = NOW();
```
