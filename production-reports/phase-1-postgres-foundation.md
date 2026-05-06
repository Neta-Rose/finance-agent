# Production report — Phase 1: Postgres operational state foundation

**Date:** 2026-05-05
**Initiative:** Platform Stabilization and Assistant
**Tasks:** 1.1–1.7 (code), 1.8 (operational — VPS)

---

## Goal

Stop using per-user JSON files as the source of truth for operational state. Move strategies, escalation history, notifications, report index, and supporting tables (verdict actions, snoozes, portfolio risk snapshots, channel bindings, encrypted secrets, admin audit, migration archive, feature flags) into Postgres. Phase 1 dual-writes; Phase 2 cuts readers over.

---

## What is now true that wasn't before

- `db/application_postgres.sql` describes the full operational schema for the rest of the initiative — every later phase ships ALTERs against tables that exist today.
- `feature_flags` rows seeded at boot mean rollout switches are queryable by SQL the moment the backend starts.
- Every analyst step writes its strategy to **both** the legacy JSON file and the `strategies` table. Catalyst-trigger updates, full-report promotions, escalation-history records, notification publish events, and report-batch index rows all dual-write.
- A migration script takes one user from "all state in JSON" to "all state mirrored in Postgres" with idempotent re-runs, structured corrupt-input archival, an in-flight-step quiesce check, and a parity verifier.

---

## 1.1 — DDL

14 new tables (~210 lines of SQL) appended to `db/application_postgres.sql`. All idempotent via `CREATE TABLE IF NOT EXISTS`. Re-running on every backend boot is a no-op.

| § | Table | Purpose |
|---|---|---|
| 4.1 | `users` | Replaces `auth.json` + `profile.json` + parts of `state.json`/`config.json` |
| 4.2 | `strategies` | Replaces `data/tickers/[T]/strategy.json` as source of truth |
| 4.3 | `report_batches`, `report_index` | Replace `data/reports/index/*.json` |
| 4.4 | `notifications_outbox` | Replaces `feed/notifications.json` |
| 4.5 | `escalation_history` | Replaces `data/escalation_history.json` |
| 4.8 | `verdict_actions` | New: followed/dismissed/partial_acted records (L1) |
| 4.9 | `ticker_snoozes` | New: signal-set-keyed snooze suppression (L2) |
| 4.10 | `portfolio_risk_snapshots` | New: append-only concentration metrics (L3) |
| 4.13 | `admin_audit_log` | New: one row per admin request (O9) |
| 4.14 | `migration_archive` | New: audit of every destructive migration step (P2.2) |
| 4.15 | `feature_flags` | New: rollout switches and admin-tunable values (P3) |
| 4.16 | `channel_bindings` | New: Telegram chat / WhatsApp phone → user_id |
| 4.17 | `encrypted_secrets` | New: third-party bearer tokens at rest (O5) |

Plus one ALTER: `tracked_assets.asset_class VARCHAR(16) DEFAULT 'equity'`.

**Spec deviation:** `feature_flags` was specified with `PRIMARY KEY (flag_name, COALESCE(scope_user_id, ''))`. Postgres does not allow expressions in primary keys. Substituted `BIGSERIAL PRIMARY KEY` plus two partial unique indexes. Uniqueness invariant is identical.

---

## 1.2 — Feature flag service

New: `backend/src/services/featureFlagService.ts`.

- `isFeatureEnabled(name, userId?)` — scoped → global → built-in default
- `getFeatureValue<T>(name, userId?)` — same precedence
- `setFeatureFlag(...)` — idempotent upsert
- `ensureDefaultFeatureFlags(ds)` — idempotent seed for 14 default flags

Default flags seeded at boot:
- **Rollout switches (8 booleans):** all `false` except `legacy_job_runners_enabled=true` and `self_correcting_retry_enabled=true`
- **Scalars (5):** `max_turns=12`, `conversation_token_cap=120000`, `search_web_max_results=8`, `max_wait_for_job_sec=600`, `max_snooze_days=180`
- **Lists (3):** `forbidden_pattern_list=[]`, `cors_allow_list=[]`, `coverage_limit=10`

Reads fail-closed: DB error returns the safe built-in default rather than throwing.

---

## 1.3 — TypeORM entities

14 new entity files in `backend/src/db/entities/`, one per new table. `TrackedAssetEntity.ts` extended with `assetClass`. All registered in `applicationDataSource.ts`.

---

## 1.4 — Twelve typed stores

| Store | Key surface |
|---|---|
| `strategyStore.ts` | `readStrategy`, `writeStrategy` (FOR UPDATE), `listStrategies`, `bumpVersion` |
| `strategyExportService.ts` | `dualWriteStrategy`, `exportStrategyToFile`, `renderStrategyJson` |
| `reportIndexStore.ts` | `putReportBatch` (transactional), `readReportBatch`, `listReportBatches`, `listReportIndex` |
| `notificationStore.ts` | `insertNotification`, `updateDelivery`, `listNotifications`, `markRead` |
| `escalationHistoryStore.ts` | `recordEscalation` (returns `inserted: boolean`), `listEscalationHistory`, `hasEscalation` |
| `snoozeStore.ts` | `createSnooze`, `findActiveSnooze`, `listActiveSnoozes`, `cancelSnooze` |
| `verdictActionsStore.ts` | `recordVerdictAction`, `listVerdictActions` |
| `portfolioRiskStore.ts` | `insertPortfolioRiskSnapshot`, `getLatestPortfolioRiskSnapshot` |
| `migrationArchiveStore.ts` | `recordArchive`, `listArchive` |
| `channelBindingStore.ts` | `bindChannel`, `lookupByChannelId`, `unbindChannel`, `setConversationId` |
| `security/adminAuditStore.ts` | `writeAdminAudit`, `listAdminAudit` |
| `security/encryptedSecretsStore.ts` | `upsertEncryptedSecret`, `readEncryptedSecret`, `deleteEncryptedSecret` |

**Phase 1 encryption posture:** `encryptedSecretsStore` ships with identity encryption (`key_id = 0`) — plaintext stored verbatim. Same posture as pre-migration `openclaw.json`. Phase 8 introduces libsodium and re-encrypts under `key_id = 1`.

---

## 1.5 — Dual-write into existing JSON write paths

Dual-writes are asymmetric: DB errors are logged and swallowed. JSON remains source of truth. Six write paths wired:

1. `synthesis.ts` → `strategies` table
2. `conditionEngine.ts` (catalyst trigger) → `strategies` table
3. `fullReportService.ts` (promotion) → `strategies` table
4. `quickCheckService.ts` (escalation) → `escalation_history` table
5. `notificationService.ts` (publish + delivery) → `notifications_outbox` table
6. `completionEffects.ts` (report batch) → `report_batches` + `report_index` tables

---

## 1.6 — Migration script

`backend/src/scripts/migrateUserStateToPostgres.ts`

- Dry-run by default; `--commit` to write
- `--user <id>` or `--all`
- Per-user advisory lock; refuses to run with in-flight `step_work_items.status='running'` rows
- Eight section migrators inside a single transaction: user row, strategies, report index, notifications, escalation history, synthetic opening lots (archived for Phase 7 replay), channel bindings, Telegram tokens
- Corrupt inputs archived to `migration_archive` with `reason='corrupt_input_skipped'`
- Summary `migration_archive` row per user with row counts

---

## 1.7 — Parity verifier

`backend/src/scripts/verifyMigrationParity.ts`

Read-only. Compares JSON state to DB rows for strategies, escalation history, and notifications. Exit code 2 on blocking divergence.

---

## Known limitations

1. **Identity encryption** — Telegram tokens stored verbatim until Phase 8.
2. **Synthetic opening lots archived, not inserted** — `position_transactions` ships in Phase 7.
3. **Silent dual-write drift** — DB outage logs a warning but doesn't retry. Run `verifyMigrationParity.ts` after activity.
4. **Duplicate-key warnings on notification retry** — swallowed by migration script; logged by publish path.
5. **`feature_flags` surrogate PK** — `BIGSERIAL` + partial unique indexes instead of expression PK.
6. **`signalSetFingerprint` is sha256 first-32-hex** — 128 bits of entropy, fits `VARCHAR(64)`.
7. **No store/script tests** — deferred; `verifyMigrationParity.ts` is the explicit drift detector.

---

## Files changed

### New (28)
```
backend/src/services/featureFlagService.ts
backend/src/services/strategyStore.ts
backend/src/services/strategyExportService.ts
backend/src/services/reportIndexStore.ts
backend/src/services/notificationStore.ts
backend/src/services/escalationHistoryStore.ts
backend/src/services/snoozeStore.ts
backend/src/services/verdictActionsStore.ts
backend/src/services/portfolioRiskStore.ts
backend/src/services/migrationArchiveStore.ts
backend/src/services/channelBindingStore.ts
backend/src/services/security/adminAuditStore.ts
backend/src/services/security/encryptedSecretsStore.ts
backend/src/db/entities/{User,Strategy,ReportBatch,ReportIndex,Notification,
  EscalationHistory,VerdictAction,TickerSnooze,PortfolioRiskSnapshot,
  AdminAuditLog,MigrationArchive,FeatureFlag,ChannelBinding,EncryptedSecret}Entity.ts
backend/src/scripts/migrateUserStateToPostgres.ts
backend/src/scripts/verifyMigrationParity.ts
```

### Edited (10)
```
db/application_postgres.sql                    (+~210 lines DDL)
backend/src/server.ts                          (+ ensureDefaultFeatureFlags in bootstrap)
backend/src/db/applicationDataSource.ts        (+ 14 entities registered)
backend/src/db/entities/TrackedAssetEntity.ts  (+ assetClass column)
backend/src/services/stepQueue/handlers/synthesis.ts      (+ dualWriteStrategy)
backend/src/services/stepQueue/completionEffects.ts       (+ putReportBatch dual-write)
backend/src/services/conditionEngine.ts                   (+ catalyst dual-write)
backend/src/services/fullReportService.ts                 (+ promotion dual-write)
backend/src/services/quickCheckService.ts                 (+ escalation dual-write)
backend/src/services/notificationService.ts               (+ outbox + delivery dual-writes)
```

---

## Operational steps on VPS (Task 1.8)

```bash
cd /root/clawd && ./deploy.sh

# Verify DDL applied
psql "$APP_DATABASE_URL" -c "\d users; \d strategies; \d feature_flags"

# Confirm 14 feature flags seeded
psql "$APP_DATABASE_URL" -c "
  SELECT flag_name, enabled, value_json
  FROM feature_flags WHERE scope_user_id IS NULL ORDER BY flag_name;"

# Dry run for one user
tsx backend/src/scripts/migrateUserStateToPostgres.ts --user <id>

# Commit for that user
tsx backend/src/scripts/migrateUserStateToPostgres.ts --user <id> --commit

# Verify parity (exit 0 = clean, exit 2 = blocking issues)
tsx backend/src/scripts/verifyMigrationParity.ts --user <id>

# Migrate all users
tsx backend/src/scripts/migrateUserStateToPostgres.ts --all --commit
tsx backend/src/scripts/verifyMigrationParity.ts --all

# Sanity checks
psql "$APP_DATABASE_URL" -c "
  SELECT user_id, COUNT(*) AS strategies FROM strategies GROUP BY user_id;
  SELECT user_id, COUNT(*) AS notifs FROM notifications_outbox GROUP BY user_id;
  SELECT reason, COUNT(*) FROM migration_archive
    WHERE archived_at > NOW() - INTERVAL '1 day'
    GROUP BY reason ORDER BY COUNT(*) DESC;"
```

**Rollback:** Phase 1 adds tables and dual-writes; it does not remove any JSON files. Rolling back means reverting the code deploy. New tables can be truncated if needed:

```sql
TRUNCATE strategies, report_batches, report_index, notifications_outbox,
         escalation_history, verdict_actions, ticker_snoozes,
         portfolio_risk_snapshots, admin_audit_log, migration_archive,
         feature_flags, channel_bindings, encrypted_secrets, users CASCADE;
```
