# Production Migrations Guide

This document describes every migration step required on the VPS for each phase of the
Platform Stabilization and Assistant initiative. It is the operator's checklist — run
these commands in order, one phase at a time, after deploying the corresponding code.

**General rules**
- Always deploy code first (`./deploy.sh`), then run migrations.
- Every migration is idempotent. Re-running is safe.
- The DDL file (`db/application_postgres.sql`) is applied automatically on backend start
  via `applicationDataSource.ts`. You do not need to run it manually unless the backend
  fails to start.
- Scripts live in `backend/src/scripts/` and are run with `tsx` from the `backend/`
  directory.
- `$APP_DATABASE_URL` and `$ADMIN_KEY` are environment variables from the systemd unit.

---

## Phase 0 — Pre-phase bugfix (analyst handler deterministic floors)

**Code change only. No database migration required.**

After deploying, re-trigger full-report jobs for users stuck in `BOOTSTRAPPING`:

```bash
# 1. Find stuck users
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

# 2. Re-issue full_report for each stuck user (replace <USER_ID>)
curl -X POST http://localhost:8081/api/admin/users/<USER_ID>/jobs \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"full_report"}'

# 3. Confirm no new Zod failures
psql "$APP_DATABASE_URL" -c "
  SELECT step_id, error_class, error_message, occurred_at
  FROM step_lifecycle_events
  WHERE error_class LIKE 'zod_%'
    AND occurred_at > NOW() - INTERVAL '15 minutes'
  ORDER BY occurred_at DESC;"
```

**Rollback:** `git revert` the four handler files and redeploy. No DB state to undo.

---

## Phase 1 — Postgres operational state foundation

### Step 1 — Deploy code

```bash
cd /root/clawd && ./deploy.sh
```

The backend start will automatically apply the new DDL (14 new tables + `tracked_assets.asset_class`
column) and seed the 14 default feature-flag rows.

### Step 2 — Verify DDL applied

```sql
-- Connect to the database
psql "$APP_DATABASE_URL"

-- Confirm new tables exist
\dt users
\dt strategies
\dt feature_flags
\dt channel_bindings
\dt encrypted_secrets
\dt migration_archive

-- Confirm feature flags seeded (expect 14 rows)
SELECT flag_name, enabled, value_json
FROM feature_flags
WHERE scope_user_id IS NULL
ORDER BY flag_name;

-- Confirm tracked_assets has the new column
\d tracked_assets
-- Should show: asset_class | character varying(16) | not null | default 'equity'
```

### Step 3 — Run the per-user state migration (dry run first)

```bash
cd /root/clawd

# Dry run for one user — inspect the JSON output
tsx backend/src/scripts/migrateUserStateToPostgres.ts --user <USER_ID>

# If the summary looks correct, commit for that user
tsx backend/src/scripts/migrateUserStateToPostgres.ts --user <USER_ID> --commit

# Verify parity (exit 0 = clean, exit 2 = blocking issues)
tsx backend/src/scripts/verifyMigrationParity.ts --user <USER_ID>

# When confident, migrate all users
tsx backend/src/scripts/migrateUserStateToPostgres.ts --all --commit
tsx backend/src/scripts/verifyMigrationParity.ts --all
```

The migration script:
- Refuses to run for a user with in-flight `step_work_items.status='running'` rows.
  Wait for those jobs to finish or supersede them first.
- Archives every corrupt input to `migration_archive` and continues.
- Writes a summary `migration_archive` row per user with row counts.

### Step 4 — Verify dual-writes are landing

After the migration and a few minutes of normal operation:

```sql
-- Strategies should mirror the JSON files
SELECT user_id, COUNT(*) AS strategies FROM strategies GROUP BY user_id;

-- Notifications should be accumulating
SELECT user_id, COUNT(*) AS notifs FROM notifications_outbox GROUP BY user_id;

-- Escalation history
SELECT user_id, COUNT(*) AS escalations FROM escalation_history GROUP BY user_id;

-- Report batches
SELECT user_id, COUNT(*) AS batches FROM report_batches GROUP BY user_id;

-- Migration archive trail
SELECT reason, COUNT(*)
FROM migration_archive
WHERE archived_at > NOW() - INTERVAL '1 day'
GROUP BY reason ORDER BY COUNT(*) DESC;
```

**Rollback:** Phase 1 adds tables and dual-writes; it does not remove any JSON files or
change any reader. Rolling back means reverting the code deploy. The new tables can be
left in place (they are unused by the old code) or truncated if you want a clean slate:

```sql
-- Only if you want to fully undo Phase 1 DB state:
TRUNCATE strategies, report_batches, report_index, notifications_outbox,
         escalation_history, verdict_actions, ticker_snoozes,
         portfolio_risk_snapshots, admin_audit_log, migration_archive,
         feature_flags, channel_bindings, encrypted_secrets, users CASCADE;
```

---

## Phase 2 — Step queue absorbs daily_brief, quick_check, full_report, deep_dive

### Step 1 — Deploy code

```bash
cd /root/clawd && ./deploy.sh
```

The backend start applies the Phase-2 DDL automatically:
- `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(64)`

### Step 2 — Verify DDL applied

```sql
\d jobs
-- Should show: conversation_id | character varying(64) | nullable
```

### Step 3 — Verify step-queue admission for all job types

Trigger one of each job type from the dashboard or admin API and confirm the job
appears in the `jobs` table with `step_work_items` rows:

```sql
-- After triggering a daily_brief:
SELECT j.id, j.action, j.status, j.user_id, j.triggered_at,
       COUNT(t.id) AS ticker_items, COUNT(s.id) AS step_items
FROM jobs j
LEFT JOIN ticker_work_items t ON t.job_id = j.id
LEFT JOIN step_work_items s ON s.job_id = j.id
WHERE j.triggered_at > NOW() - INTERVAL '5 minutes'
GROUP BY j.id
ORDER BY j.triggered_at DESC;
```

### Step 4 — Flip the legacy-runner flag off

Once you have confirmed the step-queue path is working for all four job types:

```sql
UPDATE feature_flags
SET enabled = false, updated_at = NOW(), updated_by = 'operator'
WHERE flag_name = 'legacy_job_runners_enabled'
  AND scope_user_id IS NULL;
```

**Rollback:** Flip the flag back to `true`:

```sql
UPDATE feature_flags
SET enabled = true, updated_at = NOW(), updated_by = 'operator'
WHERE flag_name = 'legacy_job_runners_enabled'
  AND scope_user_id IS NULL;
```

---

## Phase 3 — OpenClaw retirement and shell-injection elimination

### Step 1 — Deploy code

```bash
cd /root/clawd && ./deploy.sh
```

The backend will refuse to start if any `execSync` import remains in source (startup
guard). If the deploy fails with exit code 78, check the logs:

```bash
journalctl -u clawd-backend -n 50
```

### Step 2 — Run the workspace cleanup script

```bash
cd /root/clawd
tsx backend/src/scripts/cleanupOpenClawWorkspaces.ts --all --commit
```

This removes per-user `SOUL.md`, `AGENTS.md`, `HEARTBEAT.md`, `RESET.md`,
`data/triggers/`, and any `skills` symlinks. Every removed file is archived to
`migration_archive` first.

### Step 3 — Wipe the OpenClaw config

```bash
# Archive the current config first
psql "$APP_DATABASE_URL" -c "
  INSERT INTO migration_archive (id, user_id, source_path, reason, payload, archived_at)
  VALUES (gen_random_uuid(), 'system', '~/.openclaw/openclaw.json',
          'openclaw_config_wiped',
          to_jsonb(pg_read_file('/root/.openclaw/openclaw.json')::text),
          NOW());"

# Then wipe it
echo '{}' > /root/.openclaw/openclaw.json
```

### Step 4 — Remove the legacy bridge directory

```bash
rm -rf /root/clawd/data/triggers
```

### Step 5 — Verify

```sql
-- Confirm cleanup archive rows exist
SELECT user_id, source_path, reason, archived_at
FROM migration_archive
WHERE reason = 'openclaw_workspace_file_removed'
ORDER BY archived_at DESC
LIMIT 20;
```

```bash
# Confirm no execSync in source
grep -r "execSync" /root/clawd/backend/src --include="*.ts" | grep -v ".test.ts"
# Expected: no output

# Confirm no triggers directories remain
find /root/clawd/users -name "triggers" -type d
# Expected: no output
```

**Rollback:** Phase 3 is the first phase where rollback is destructive after the
`migration_archive` retention window (730 days). Within the window, restore files from
`migration_archive` rows. The OpenClaw binary itself is not removed; `openclaw gateway
start` can be re-run if needed.

---

## Phase 4 — Provider-native structured outputs + self-correcting retry

### Step 1 — Deploy code

```bash
cd /root/clawd && ./deploy.sh
```

The backend start applies Phase-4 DDL automatically:
- `ALTER TABLE step_work_items ADD COLUMN IF NOT EXISTS schema_mode VARCHAR(32)`
- `ALTER TABLE step_work_items ADD COLUMN IF NOT EXISTS structured_output_provider VARCHAR(32)`
- `ALTER TABLE step_work_items ADD COLUMN IF NOT EXISTS prose_fallback_used BOOLEAN NOT NULL DEFAULT FALSE`
- `ALTER TABLE step_lifecycle_events ADD COLUMN IF NOT EXISTS schema_mode VARCHAR(32)`
- `ALTER TABLE model_tier_assignments ADD COLUMN IF NOT EXISTS thinking_budget INTEGER NOT NULL DEFAULT 0`
- `ALTER TABLE model_tier_assignments ADD COLUMN IF NOT EXISTS provider VARCHAR(32) NOT NULL DEFAULT 'openrouter'`
- `ALTER TABLE llm_requests ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(64)`
- `ALTER TABLE llm_requests ADD COLUMN IF NOT EXISTS tool_call_id UUID`
- `ALTER TABLE llm_requests ADD COLUMN IF NOT EXISTS schema_mode VARCHAR(32)`

### Step 2 — Verify DDL applied

```sql
\d step_work_items
-- Should show: schema_mode, structured_output_provider, prose_fallback_used

\d model_tier_assignments
-- Should show: thinking_budget, provider
```

### Step 3 — Flip the structured-outputs flag on

```sql
UPDATE feature_flags
SET enabled = true, updated_at = NOW(), updated_by = 'operator'
WHERE flag_name = 'structured_outputs_enabled'
  AND scope_user_id IS NULL;
```

### Step 4 — Verify

After triggering a full report, confirm analyst steps record `schema_mode`:

```sql
SELECT s.kind, s.schema_mode, s.prose_fallback_used, e.error_class
FROM step_work_items s
LEFT JOIN step_lifecycle_events e ON e.step_id = s.id
WHERE s.created_at > NOW() - INTERVAL '10 minutes'
ORDER BY s.created_at DESC;
-- schema_mode should be 'provider_native' on success
-- error_class 'zod_self_corrected' means the self-correcting retry fired
```

**Rollback:** Flip `structured_outputs_enabled = false`. The handlers fall back to the
prior `response_format: { type: "json_object" }` path which is kept for one phase as a
safety net.

---

## Phase 5 — Chat agent (dashboard transport only)

### Step 1 — Deploy code

```bash
cd /root/clawd && ./deploy.sh
```

The backend start applies Phase-5 DDL automatically:
- `CREATE TABLE IF NOT EXISTS conversations`
- `CREATE TABLE IF NOT EXISTS conversation_turns`
- `CREATE TABLE IF NOT EXISTS tool_calls`
- `CREATE TABLE IF NOT EXISTS output_filter_events`

### Step 2 — Seed the forbidden-pattern list and persona redirect line

```sql
-- Seed the forbidden-pattern list (required by startup guard when chat is enabled)
UPDATE feature_flags
SET enabled = true,
    value_json = '["~/clawd/","users/",".openclaw","data/triggers/","node_modules/",
                   "step queue","openclaw","watchdog","userIsolation","workspace","clawd",
                   "claude-","gpt-","gemini-","deepseek-","o1-","o3-"]'::jsonb,
    updated_at = NOW(), updated_by = 'operator'
WHERE flag_name = 'forbidden_pattern_list' AND scope_user_id IS NULL;

-- Seed the CORS allow-list (required by startup guard)
UPDATE feature_flags
SET enabled = true,
    value_json = '["https://your-domain.com"]'::jsonb,
    updated_at = NOW(), updated_by = 'operator'
WHERE flag_name = 'cors_allow_list' AND scope_user_id IS NULL;
-- Replace "your-domain.com" with the actual frontend origin.
```

### Step 3 — Seed the chat_agent model-tier assignment

```sql
-- Insert a chat_agent row for each tier (adjust models to your preference)
INSERT INTO model_tier_assignments (tier, step_kind, model, fallback, updated_at, updated_by, thinking_budget, provider)
VALUES
  ('free',      'chat_agent', 'google/gemini-2.5-flash', NULL, NOW(), 'operator', 0, 'openrouter'),
  ('cheap',     'chat_agent', 'deepseek/deepseek-chat',  NULL, NOW(), 'operator', 0, 'openrouter'),
  ('balanced',  'chat_agent', 'google/gemini-2.5-flash', NULL, NOW(), 'operator', 0, 'openrouter'),
  ('expensive', 'chat_agent', 'claude-opus-4-5',         NULL, NOW(), 'operator', 8000, 'anthropic')
ON CONFLICT (tier, step_kind) DO UPDATE SET
  model = EXCLUDED.model,
  fallback = EXCLUDED.fallback,
  thinking_budget = EXCLUDED.thinking_budget,
  provider = EXCLUDED.provider,
  updated_at = NOW(),
  updated_by = EXCLUDED.updated_by;
```

### Step 4 — Enable the chat agent

```sql
UPDATE feature_flags
SET enabled = true, updated_at = NOW(), updated_by = 'operator'
WHERE flag_name IN ('chat_agent_enabled', 'output_filter_enabled')
  AND scope_user_id IS NULL;
```

### Step 5 — Restart the backend (startup guards re-run)

```bash
systemctl restart clawd-backend
journalctl -u clawd-backend -n 20
# Should NOT see exit code 78 (startup guard failure)
```

### Step 6 — Verify

```sql
-- After sending a chat message from the dashboard:
SELECT id, user_id, channel, turn_count, total_cost_usd, termination_reason
FROM conversations
ORDER BY started_at DESC LIMIT 5;

SELECT conversation_id, turn_index, role, tokens_in, tokens_out
FROM conversation_turns
ORDER BY created_at DESC LIMIT 10;

-- Confirm output filter is running
SELECT pattern, site_of_match, occurred_at
FROM output_filter_events
ORDER BY occurred_at DESC LIMIT 10;
```

**Rollback:** Flip `chat_agent_enabled = false`. Conversations persist (read-only).

---

## Phase 6 — Telegram and WhatsApp transports

### Step 1 — Deploy code

```bash
cd /root/clawd && ./deploy.sh
```

No new DDL. `channel_bindings` and `encrypted_secrets` already exist from Phase 1.

### Step 2 — Set required environment variables

Add to the systemd unit (`/etc/systemd/system/clawd-backend.service`):

```ini
Environment="TELEGRAM_SECRET=<your-telegram-bot-api-secret-token>"
Environment="WHATSAPP_VERIFY_TOKEN=<your-whatsapp-verify-token>"
```

Then reload and restart:

```bash
systemctl daemon-reload
systemctl restart clawd-backend
journalctl -u clawd-backend -n 20
# Must NOT see: startup_guard.telegram_secret_unset
```

### Step 3 — Verify Telegram binding migration

The Phase 1 migration already seeded `channel_bindings` rows from `profile.json
telegramChatId`. Confirm:

```sql
SELECT channel, channel_identifier, user_id, bound_at
FROM channel_bindings
WHERE channel = 'telegram' AND unbound_at IS NULL;
```

### Step 4 — Test inbound Telegram

Send a message from a bound Telegram chat. Confirm:

```sql
SELECT id, user_id, channel, turn_count, termination_reason
FROM conversations
WHERE channel = 'telegram'
ORDER BY started_at DESC LIMIT 3;
```

**Rollback:** Flip `chat_agent_enabled = false` to take both transports offline. The
legacy Telegram slash-command path is gone after Phase 6; users on Telegram are without
service until forward-roll resumes.

---

## Phase 7 — Snooze, transactions ledger, corporate actions, asset-class dispatch, position-level rules

### Step 1 — Deploy code

```bash
cd /root/clawd && ./deploy.sh
```

The backend start applies Phase-7 DDL automatically:
- `CREATE TABLE IF NOT EXISTS position_transactions`
- `CREATE TABLE IF NOT EXISTS corporate_actions`
- `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS asset_class VARCHAR(16)`
- `ALTER TABLE ticker_work_items ADD COLUMN IF NOT EXISTS asset_class VARCHAR(16)`
- `ALTER TABLE position_transactions ADD COLUMN IF NOT EXISTS fx_rate NUMERIC(18,8)`

### Step 2 — Replay synthetic opening lots from migration_archive

The Phase 1 migration archived synthetic lot data but did not insert `position_transactions`
rows (the table didn't exist yet). Replay them now:

```bash
cd /root/clawd
tsx backend/src/scripts/replayOpeningLots.ts --all --commit
```

This script reads `migration_archive` rows with `reason='synthetic_opening_lot_inserted'`
and inserts the corresponding `position_transactions` rows.

### Step 3 — Flip Phase-7 flags on

```sql
UPDATE feature_flags
SET enabled = true, updated_at = NOW(), updated_by = 'operator'
WHERE flag_name IN (
  'transactions_ledger_enabled',
  'snooze_enabled',
  'asset_class_dispatch_enabled'
) AND scope_user_id IS NULL;
```

### Step 4 — Verify

```sql
-- Confirm opening lots were inserted
SELECT user_id, ticker, transaction_type, quantity, unit_price, transaction_at, note
FROM position_transactions
WHERE note = 'synthetic_opening_lot'
ORDER BY transaction_at DESC LIMIT 10;

-- Confirm asset-class dispatch is recording
SELECT j.user_id, t.ticker, t.asset_class, j.action
FROM ticker_work_items t
JOIN jobs j ON j.id = t.job_id
WHERE j.triggered_at > NOW() - INTERVAL '1 hour'
ORDER BY j.triggered_at DESC LIMIT 20;
```

**Rollback:** Flip the three flags back to `false`. `position_transactions` rows are
append-only; they remain but are not read by the cost-basis path when the flag is off.

---

## Phase 8 — Security I (cookies, CSRF, encryption, helmet, audit, secrets logging)

### Step 1 — Set required environment variables

**These must be set BEFORE deploying.** The backend will refuse to start without them.

```bash
# Generate a strong JWT secret (min 32 chars, not "changeme")
openssl rand -hex 32
# → set as JWT_SECRET in the systemd unit

# Generate a 32-byte libsodium key
openssl rand -hex 32
# → set as ENCRYPTION_KEY_HEX in the systemd unit

# Set the CORS allow-list (already done in Phase 5 via feature_flags,
# but the startup guard also checks the env-level override if present)
```

Edit `/etc/systemd/system/clawd-backend.service`:

```ini
Environment="JWT_SECRET=<strong-random-secret>"
Environment="ENCRYPTION_KEY_HEX=<64-hex-chars>"
```

```bash
systemctl daemon-reload
```

### Step 2 — Deploy code

```bash
cd /root/clawd && ./deploy.sh
```

The backend will exit 78 if `JWT_SECRET` is missing/`changeme` or `ENCRYPTION_KEY_HEX`
is invalid. Check logs:

```bash
journalctl -u clawd-backend -n 30
```

### Step 3 — Re-encrypt Telegram tokens under libsodium

The Phase 1 migration stored Telegram tokens with identity encryption (`key_id=0`).
Now that the real key is loaded, re-encrypt them:

```bash
cd /root/clawd
tsx backend/src/scripts/reencryptTelegramTokens.ts --commit
```

Verify:

```sql
SELECT user_id, secret_kind, key_id, ciphertext_hash, rotated_at
FROM encrypted_secrets
ORDER BY user_id;
-- key_id should now be 1 for all rows
-- rotated_at should be set
```

### Step 4 — Verify security headers

```bash
curl -I https://your-domain.com/api/health
# Should see:
# Strict-Transport-Security: max-age=15768000; includeSubDomains; preload
# Content-Security-Policy: default-src 'self'; ...
# X-Frame-Options: DENY (or frameAncestors 'none' in CSP)
```

### Step 5 — Verify admin audit log

```sql
-- After any admin action:
SELECT actor_admin_id, action_type, target_user_id, result_status, occurred_at
FROM admin_audit_log
ORDER BY occurred_at DESC LIMIT 10;
```

**Rollback:** Revert the auth middleware to header-based JWT (git revert). The SPA must
also be reverted to read JWT from `localStorage`. Encrypted secrets remain encrypted;
the legacy plaintext was removed in Phase 3 so a Phase 8 rollback does NOT restore
plaintext to `openclaw.json`. Decrypt on demand via `readEncryptedSecret` if needed.

---

## Phase 9 — Security II (Telegram secret enforcement, prompt-injection wrapping)

### Step 1 — Deploy code

```bash
cd /root/clawd && ./deploy.sh
```

The backend will refuse to start if `TELEGRAM_SECRET` is unset (startup guard added in
this phase). Confirm it is set in the systemd unit (it was set in Phase 6 Step 2).

### Step 2 — Verify

```bash
# Send a forged Telegram webhook (wrong secret)
curl -X POST http://localhost:8081/api/telegram/webhook \
  -H "X-Telegram-Bot-Api-Secret-Token: wrong-secret" \
  -H "Content-Type: application/json" \
  -d '{"message":{"text":"test","chat":{"id":"123"}}}'
# Expected: 401

# Confirm audit row written
psql "$APP_DATABASE_URL" -c "
  SELECT action_type, result_status, occurred_at
  FROM admin_audit_log
  WHERE action_type = 'telegram_webhook_signature_failed'
  ORDER BY occurred_at DESC LIMIT 3;"
```

**Rollback:** The Telegram secret-token check is left in place; rollback removes only
the startup refusal guard. This is a security regression while rolled back.

---

## Phase 10 — Dishonest-UI removal and dead-code purge

### Step 1 — Deploy code

```bash
cd /root/clawd && ./deploy.sh
```

No database migration required. This phase is code-only.

### Step 2 — Verify

- Dashboard: confirm `new_ideas` card is hidden (or visible only if `new_ideas_enabled`
  flag is set).
- Dashboard: confirm `switch_production` / `switch_testing` cards are gone from the
  user-facing Controls page.
- Dashboard: confirm theme picker shows only implemented themes (or is hidden if only
  one theme exists).

```sql
-- Confirm coverage_limit is now read from feature_flags, not hardcoded
SELECT flag_name, value_json FROM feature_flags WHERE flag_name = 'coverage_limit';
```

**Rollback:** `git revert` the deletion commits and redeploy. No DB state at risk.

---

## Quick reference — feature flag flips per phase

| Phase | Flag | Value after phase |
|---|---|---|
| 1 | `legacy_job_runners_enabled` | `true` (stays on until Phase 2 verified) |
| 1 | `self_correcting_retry_enabled` | `true` |
| 2 | `legacy_job_runners_enabled` | `false` (flip after verifying step-queue path) |
| 4 | `structured_outputs_enabled` | `true` |
| 5 | `chat_agent_enabled` | `true` |
| 5 | `output_filter_enabled` | `true` |
| 7 | `transactions_ledger_enabled` | `true` |
| 7 | `snooze_enabled` | `true` |
| 7 | `asset_class_dispatch_enabled` | `true` |

All flags can be flipped per-user by inserting a scoped row:

```sql
INSERT INTO feature_flags (flag_name, scope_user_id, enabled, value_json, updated_at, updated_by)
VALUES ('chat_agent_enabled', '<user_id>', true, NULL, NOW(), 'operator')
ON CONFLICT (flag_name, scope_user_id) DO UPDATE
  SET enabled = EXCLUDED.enabled, updated_at = NOW();
```

---

## Emergency: full rollback to pre-initiative state

If you need to roll back everything to the state before Phase 1:

```bash
# 1. Revert to the last pre-initiative commit
git log --oneline | grep "pre-initiative" # find the commit hash
git revert --no-commit <hash>..HEAD
git commit -m "Emergency rollback to pre-initiative state"
./deploy.sh

# 2. Optionally truncate the new tables (the old code ignores them)
psql "$APP_DATABASE_URL" -c "
  TRUNCATE strategies, report_batches, report_index, notifications_outbox,
           escalation_history, verdict_actions, ticker_snoozes,
           portfolio_risk_snapshots, admin_audit_log, migration_archive,
           feature_flags, channel_bindings, encrypted_secrets,
           conversations, conversation_turns, tool_calls, output_filter_events,
           position_transactions, corporate_actions, users CASCADE;"
```

The JSON files in `users/` are never modified by any phase migration, so they remain
intact as the source of truth for the rolled-back code.
