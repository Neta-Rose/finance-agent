# Production report — Phase 3: OpenClaw retirement and shell-injection elimination

**Date:** 2026-05-05
**Initiative:** Platform Stabilization and Assistant
**Tasks:** 3.1–3.6 (code), 3.4 + 3.7 (operational — VPS)

---

## Goal

Remove OpenClaw as an orchestration layer. After this phase: no `execSync`, no `agentService` OpenClaw calls, no per-user `data/triggers/`, no analyst skill markdown files, no `~/.openclaw/openclaw.json` reads. The step queue is the only orchestrator.

---

## 3.1 — Postgres-only watchdog

New: `backend/src/services/scheduler/watchdog.ts`.

Replaces `watchdogService.ts` (file-based). Three sweeps every 5 minutes:

1. **Step-level sweep** — resets `step_work_items.status='running'` rows exceeding kind-specific timeouts back to `'pending'`. Timeouts: `quick_check.evaluate` / `tracking.evaluate` → 5 min; all analyst/debate/synthesis → 20 min. Writes `step_lifecycle_events` row with `error_class='timeout'` for each reset.

2. **Job-level sweep** — marks `jobs.status='running'` rows exceeding action-specific timeouts as `'failed'`. Timeouts: `daily_brief` → 60 min; `deep_dive` → 180 min; `full_report` → 240 min. Also fails any still-pending steps for the timed-out job.

3. **Pending-job sweep** — marks `jobs.status='pending'` rows never picked up after 90 minutes as `'failed'`.

No filesystem reads. No OpenClaw calls.

`startJobCompletionWatcher()` removed from `server.ts` — the Postgres-only watchdog covers its responsibilities.

---

## 3.2 — `agentService.ts` replaced with a no-op stub

All OpenClaw-management functions replaced with no-ops that:
- Return safe defaults (`false`, `""`, `{}`, `RETIRED_HEALTH`)
- Log `logger.warn` when called, so straggler calls are visible in production logs
- Contain **zero** `execSync`, `exec`, `execFile`, or `child_process` imports

Exported types (`AgentHealth`) and constants (`SYSTEM_AGENT_ID`) preserved so all 8 callers compile without changes.

---

## 3.3 — Analyst skill markdown files deleted

Seven files removed from `skills/`:
```
skills/fundamentals-analyst.md
skills/technical-analyst.md
skills/sentiment-analyst.md
skills/macro-analyst.md
skills/portfolio-risk.md
skills/bull-researcher.md
skills/bear-researcher.md
```

Analyst prompts live only in `backend/src/services/stepQueue/handlers/` per [B3.2].

---

## 3.4 — `cleanupOpenClawWorkspaces.ts`

New: `backend/src/scripts/cleanupOpenClawWorkspaces.ts`.

Idempotent per-user cleanup (dry-run by default; `--commit` to delete):
- Removes: `SOUL.md`, `AGENTS.md`, `HEARTBEAT.md`, `RESET.md`, `IDENTITY.md`, `TOOLS.md`, `data/triggers/`, `skills` symlink
- Archives every removed file to `migration_archive` before deletion
- Emits one summary `migration_archive` row per user
- Removes the legacy bridge directory `/root/clawd/data/triggers/`

---

## 3.5 — `workspaceService.ts` stops creating retired files

`createUserWorkspace` changes:
- `data/triggers/` directory no longer created [B1.3]
- `skills` symlink no longer created [B2.1]
- `loadWorkspaceTemplateManifest` filters `SOUL.md`, `AGENTS.md`, `HEARTBEAT.md`, `RESET.md` from `sharedFiles` and `emptyFiles` regardless of manifest file content [B2.1]

---

## 3.6 — execSync startup guard

New: `backend/src/services/security/startupGuards.ts`.

`runStartupGuards()` scans `backend/src/**/*.ts` (excluding `*.test.ts`) for actual `import { execSync }` or `require("child_process")` statements. Backend exits with code 78 (EX_CONFIG) on any match — systemd will not auto-restart.

Called at the top of `bootstrap()` in `server.ts` before any other initialization.

Phase 5 and Phase 8 will add more guards (persona prompt, tool registry, JWT secret, CORS, encryption key, CSP directives) to the same function.

---

## 3.7 — `~/.openclaw/openclaw.json` wipe (operational)

Archive the file to `migration_archive`, then replace with `{}`. The `agentService.ts` stub's `readConfig()` returns `{}` regardless.

---

## Files changed

```
NEW
  backend/src/services/scheduler/watchdog.ts
  backend/src/services/security/startupGuards.ts
  backend/src/scripts/cleanupOpenClawWorkspaces.ts

REWRITTEN (stub)
  backend/src/services/agentService.ts

EDITED
  backend/src/services/workspaceService.ts    (retired files filtered)
  backend/src/server.ts                       (new watchdog, startup guard, removed legacy watcher)
  backend/src/app.ts                          (removed /llm/v1 proxy route)

DELETED
  skills/fundamentals-analyst.md
  skills/technical-analyst.md
  skills/sentiment-analyst.md
  skills/macro-analyst.md
  skills/portfolio-risk.md
  skills/bull-researcher.md
  skills/bear-researcher.md
```

---

## Operational steps on VPS

```bash
cd /root/clawd && ./deploy.sh

# Verify startup guard passes
journalctl -u clawd-backend -n 20
# Must NOT see: startup_guard.execsync_detected

# Run workspace cleanup (dry run first)
tsx backend/src/scripts/cleanupOpenClawWorkspaces.ts --all
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

find /root/clawd/users -name "triggers" -type d
# Expected: no output

psql "$APP_DATABASE_URL" -c "
  SELECT user_id, source_path, reason, archived_at
  FROM migration_archive
  WHERE reason = 'openclaw_workspace_file_removed'
  ORDER BY archived_at DESC LIMIT 20;"
```

**Rollback:** Phase 3 is the first phase where rollback is destructive after the `migration_archive` retention window (730 days). Within the window, restore files from `migration_archive` rows. The OpenClaw binary itself is not removed; `openclaw gateway start` can be re-run if needed. The `agentService.ts` stub can be reverted via `git revert`.
