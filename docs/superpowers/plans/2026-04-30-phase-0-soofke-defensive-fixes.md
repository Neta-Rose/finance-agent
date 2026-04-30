# Phase 0 — Soofke Defensive Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the bleeding on soofke's stuck `full_report` job (paused since 2026-04-27) by reconciling status divergence, cleaning hallucinated artifacts, marking the job superseded, and surfacing the situation in the UI. Independent of the larger step-queue redesign.

**Architecture:** Three additive backend pieces (Zod schema patch, startup reconciler service, idempotent admin script) and two frontend pieces (type extension, banner component). The reconciler runs on backend startup; the script is run manually for soofke once. No existing logic is modified beyond the bootstrap hook and one Controls-page render.

**Tech Stack:** Node 22 / TypeScript / Express / Zod / TypeORM (already wired). Backend test runner: `node:test` + `node:assert/strict` with `tsx` loader. Frontend: React 19 / Vite / React Query / Tailwind v4. No frontend test framework installed; frontend changes verified manually in the dev server.

**Spec reference:** `docs/superpowers/specs/2026-04-30-step-queue-execution-redesign-design.md` Section 10.1 (Phase 0).

---

## File map

**Backend — create:**
- `backend/src/services/jobStateReconciler.ts` — startup-time reconciler that fixes `full_report_state.json` whenever it disagrees with a `paused`/`failed`/`cancelled`/`superseded` job file
- `backend/src/services/jobStateReconciler.test.ts` — node:test tests for the reconciler
- `backend/src/scripts/supersedeStuckJob.ts` — CLI script: mark a specific user's job as `superseded`, delete named hallucinated artifacts, idempotent
- `backend/src/scripts/supersedeStuckJob.test.ts` — node:test tests for the script

**Backend — modify:**
- `backend/src/schemas/job.ts:28` — add `"superseded"` to the `status` enum
- `backend/src/server.ts:68-109` — call the reconciler from `reconcileStartupOperationalState`

**Frontend — create:**
- `frontend/src/components/jobs/SupersededJobBanner.tsx` — banner component shown when the user has any `superseded` job

**Frontend — modify:**
- `frontend/src/types/api.ts:159` (the `JobStatus` definition) — add `"superseded"` to the union
- `frontend/src/pages/Controls.tsx` — render `<SupersededJobBanner />` near top, sourcing from the existing `fetchJobs()` query

---

## Task 1: Add `superseded` to backend JobSchema

**Files:**
- Modify: `backend/src/schemas/job.ts:28`

- [ ] **Step 1: Read the current schema to confirm exact line shape**

Run: `cat backend/src/schemas/job.ts`
Expected: line 28 reads `status: z.enum(["pending", "paused", "running", "completed", "failed", "cancelled"]),`

- [ ] **Step 2: Edit the enum**

Edit `backend/src/schemas/job.ts`, replace the `status:` line with:

```typescript
  status: z.enum(["pending", "paused", "running", "completed", "failed", "cancelled", "superseded"]),
```

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: zero errors. (If any consumer of `JobSchema` does an exhaustive switch over `status` without a default branch, it will fail here — fix by adding a `case "superseded":` branch that mirrors the `cancelled` branch.)

- [ ] **Step 4: Commit**

```bash
git add backend/src/schemas/job.ts
git commit -m "feat: add superseded status to JobSchema enum"
```

---

## Task 2: Create the startup reconciler service (TDD)

**Files:**
- Create: `backend/src/services/jobStateReconciler.ts`
- Test: `backend/src/services/jobStateReconciler.test.ts`

The reconciler scans all jobs in a user's `data/jobs/` directory. For any job whose `status` is *terminal-or-paused* (`paused`, `failed`, `cancelled`, `superseded`), if `data/reports/full_report_state.json` exists with `status: "running"` (and references that same `jobId`), it rewrites the state file to match the job's status. Returns a count of repairs.

- [ ] **Step 1: Write the failing test file**

Create `backend/src/services/jobStateReconciler.test.ts` with the full content below:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { UserWorkspace } from "../middleware/userIsolation.js";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "job-state-reconciler-"));
const usersDir = path.join(testRoot, "users");
process.env["USERS_DIR"] = usersDir;

interface TestContext {
  ws: UserWorkspace;
  reconcilePausedJobStates: typeof import("./jobStateReconciler.js")["reconcilePausedJobStates"];
}

async function setup(userId: string): Promise<TestContext> {
  const [{ buildWorkspace }, mod] = await Promise.all([
    import("../middleware/userIsolation.js"),
    import("./jobStateReconciler.js"),
  ]);
  const ws = buildWorkspace(userId, usersDir);
  await fs.mkdir(ws.jobsDir, { recursive: true });
  await fs.mkdir(ws.reportsDir, { recursive: true });
  return { ws, reconcilePausedJobStates: mod.reconcilePausedJobStates };
}

async function writeJson(p: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(value, null, 2), "utf-8");
}

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf-8")) as T;
}

test("returns 0 when user has no jobs", async () => {
  const { ws, reconcilePausedJobStates } = await setup("user-no-jobs");
  const repairs = await reconcilePausedJobStates(ws);
  assert.equal(repairs, 0);
});

test("returns 0 when full_report_state.json does not exist", async () => {
  const { ws, reconcilePausedJobStates } = await setup("user-no-state");
  await writeJson(ws.jobFile("job_test_1"), {
    id: "job_test_1",
    action: "full_report",
    ticker: null,
    status: "paused",
    triggered_at: "2026-04-26T07:09:56.648Z",
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
  });
  const repairs = await reconcilePausedJobStates(ws);
  assert.equal(repairs, 0);
});

test("rewrites state.json from running to paused when matching paused job exists", async () => {
  const { ws, reconcilePausedJobStates } = await setup("user-divergent");
  const jobId = "job_20260426_144855_1abcd8";
  await writeJson(ws.jobFile(jobId), {
    id: jobId,
    action: "full_report",
    ticker: null,
    status: "paused",
    triggered_at: "2026-04-26T07:09:56.648Z",
    started_at: "2026-04-27T11:47:00.000Z",
    completed_at: "2026-04-27T11:53:00.000Z",
    result: null,
    error: "execution_constraints: Unable to run detailed market analysis",
  });
  const statePath = path.join(ws.reportsDir, "full_report_state.json");
  await writeJson(statePath, {
    version: 1,
    jobId,
    status: "running",
    currentTicker: "QQQ",
    currentStep: "Fundamentals",
    updatedAt: "2026-04-27T11:53:37.948Z",
  });

  const repairs = await reconcilePausedJobStates(ws);
  assert.equal(repairs, 1);

  const state = await readJson<{ status: string; updatedAt: string }>(statePath);
  assert.equal(state.status, "paused");
  assert.notEqual(state.updatedAt, "2026-04-27T11:53:37.948Z"); // bumped
});

test("is idempotent: second call repairs nothing", async () => {
  const { ws, reconcilePausedJobStates } = await setup("user-idempotent");
  const jobId = "job_idem";
  await writeJson(ws.jobFile(jobId), {
    id: jobId,
    action: "full_report",
    ticker: null,
    status: "paused",
    triggered_at: "2026-04-26T07:09:56.648Z",
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
  });
  const statePath = path.join(ws.reportsDir, "full_report_state.json");
  await writeJson(statePath, { version: 1, jobId, status: "running", updatedAt: "2026-04-27T00:00:00.000Z" });

  assert.equal(await reconcilePausedJobStates(ws), 1);
  assert.equal(await reconcilePausedJobStates(ws), 0);
});

test("does not touch state.json belonging to a different jobId", async () => {
  const { ws, reconcilePausedJobStates } = await setup("user-mismatched-job");
  await writeJson(ws.jobFile("job_old_paused"), {
    id: "job_old_paused",
    action: "full_report",
    ticker: null,
    status: "paused",
    triggered_at: "2026-04-20T00:00:00.000Z",
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
  });
  const statePath = path.join(ws.reportsDir, "full_report_state.json");
  await writeJson(statePath, {
    version: 1,
    jobId: "job_currently_running",
    status: "running",
    updatedAt: "2026-04-30T10:00:00.000Z",
  });

  const repairs = await reconcilePausedJobStates(ws);
  assert.equal(repairs, 0);
  const state = await readJson<{ status: string }>(statePath);
  assert.equal(state.status, "running");
});

test("repairs state.json regardless of whether status is paused, failed, cancelled, or superseded", async () => {
  for (const terminalStatus of ["paused", "failed", "cancelled", "superseded"] as const) {
    const { ws, reconcilePausedJobStates } = await setup(`user-${terminalStatus}`);
    const jobId = `job_${terminalStatus}`;
    await writeJson(ws.jobFile(jobId), {
      id: jobId,
      action: "full_report",
      ticker: null,
      status: terminalStatus,
      triggered_at: "2026-04-26T00:00:00.000Z",
      started_at: null,
      completed_at: null,
      result: null,
      error: null,
    });
    const statePath = path.join(ws.reportsDir, "full_report_state.json");
    await writeJson(statePath, { version: 1, jobId, status: "running", updatedAt: "2026-04-27T00:00:00.000Z" });

    assert.equal(await reconcilePausedJobStates(ws), 1, `should repair when job status=${terminalStatus}`);
    const state = await readJson<{ status: string }>(statePath);
    assert.equal(state.status, terminalStatus);
  }
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd backend && npx tsx --test src/services/jobStateReconciler.test.ts`
Expected: failure — `Cannot find module './jobStateReconciler.js'` (the implementation does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/jobStateReconciler.ts` with the full content below:

```typescript
import { promises as fs } from "fs";
import path from "path";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import { logger } from "./logger.js";

const TERMINAL_OR_PAUSED = new Set(["paused", "failed", "cancelled", "superseded"]);

interface JobLite {
  id?: string;
  status?: string;
}

interface FullReportStateLite {
  jobId?: string;
  status?: string;
  updatedAt?: string;
}

async function readJsonOrNull<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Scan one user's jobs/ directory. If any job is in a terminal-or-paused
 * status, but the report state file references that same job AND claims
 * status="running", rewrite the state file to match the job. Returns the
 * count of repairs made. Idempotent.
 */
export async function reconcilePausedJobStates(ws: UserWorkspace): Promise<number> {
  const statePath = path.join(ws.reportsDir, "full_report_state.json");
  const state = await readJsonOrNull<FullReportStateLite>(statePath);
  if (!state || state.status !== "running" || !state.jobId) {
    return 0;
  }

  const jobPath = ws.jobFile(state.jobId);
  const job = await readJsonOrNull<JobLite>(jobPath);
  if (!job || !job.status || !TERMINAL_OR_PAUSED.has(job.status)) {
    return 0;
  }

  const updated = {
    ...state,
    status: job.status,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(statePath, JSON.stringify(updated, null, 2), "utf-8");
  logger.info(
    `Reconciled full_report_state.json for ${ws.userId}: running -> ${job.status} (jobId=${state.jobId})`
  );
  return 1;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx tsx --test src/services/jobStateReconciler.test.ts`
Expected: 6 tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/jobStateReconciler.ts backend/src/services/jobStateReconciler.test.ts
git commit -m "feat: add jobStateReconciler for paused/state divergence"
```

---

## Task 3: Hook reconciler into backend bootstrap

**Files:**
- Modify: `backend/src/server.ts:22, 68-109`

- [ ] **Step 1: Add the import**

Edit `backend/src/server.ts`, in the import block near line 22 add:

```typescript
import { reconcilePausedJobStates } from "./services/jobStateReconciler.js";
```

- [ ] **Step 2: Call the reconciler inside `reconcileStartupOperationalState`**

Edit `backend/src/server.ts`. Inside `reconcileStartupOperationalState`'s `for (const userId of userIds)` loop, add the reconciler call after `repairActiveUserState(userId)` and before `reconcileWorkspaceIntegrity`. Replace the existing `for` loop body with:

```typescript
    for (const userId of userIds) {
      await repairActiveUserState(userId);
      const workspace = buildWorkspace(userId, USERS_DIR);
      await reconcilePausedJobStates(workspace);
      const workspaceReconciliation = await reconcileWorkspaceIntegrity(userId);
      if (workspaceReconciliation.changed) {
        workspaceRepairs += 1;
      }

      const state = await readState(userId);
      const userCtrl = await getUserControl(userId);
      const agentStatus = await getUserAgentStatus(userId);
      const hasAgentManagedWork = await hasPendingAgentManagedWork(workspace);
      const eligibility = state.state === "ACTIVE"
        ? await getActiveUserEligibility(userId)
        : { eligible: true, reason: null };
      const changed = await reconcileUserHeartbeatCron(
        userId,
        agentStatus.configured && shouldUserHeartbeatBeEnabled({
          state: state.state,
          restriction: userCtrl.restriction,
          eligibilityIssue: eligibility.eligible ? null : eligibility.reason,
          hasAgentManagedWork,
        })
      );
      if (changed) runtimeChanges += 1;
    }
```

(This change moves the existing `const workspace = buildWorkspace(...)` line up so it can be reused, and inserts the new `await reconcilePausedJobStates(workspace)` call.)

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Smoke test by starting the backend**

Run: `cd backend && npx tsx src/server.ts`
Expected: log output includes a line of the form `Reconciled full_report_state.json for soofke: running -> paused (jobId=job_20260426_144855_1abcd8)` (this is the soofke divergence the spec calls out). Then `Startup operational reconciliation complete: ...`.

If soofke's divergence is already fixed by something else by this point, the line is absent — that's also fine.

Stop the server (Ctrl+C).

- [ ] **Step 5: Verify soofke's state file is now consistent**

Run: `cat /root/clawd/users/soofke/data/reports/full_report_state.json | python3 -c "import sys,json;j=json.load(sys.stdin);print(j.get('status'),j.get('jobId'))"`
Expected: `paused job_20260426_144855_1abcd8` (or whatever terminal status the job has).

- [ ] **Step 6: Commit**

```bash
git add backend/src/server.ts
git commit -m "feat: run jobStateReconciler on backend startup"
```

---

## Task 4: Create the supersedeStuckJob script (TDD)

**Files:**
- Create: `backend/src/scripts/supersedeStuckJob.ts`
- Test: `backend/src/scripts/supersedeStuckJob.test.ts`

The script marks a specific job as `superseded` (sets status, sets `error`/`failure_reason`, sets `completed_at` if not present) and deletes a list of named artifact paths if they exist. Idempotent. Exposes both a programmatic function and a CLI entry point.

- [ ] **Step 1: Write the failing test file**

Create `backend/src/scripts/supersedeStuckJob.test.ts` with the full content below:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { UserWorkspace } from "../middleware/userIsolation.js";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "supersede-job-"));
const usersDir = path.join(testRoot, "users");
process.env["USERS_DIR"] = usersDir;

interface TestContext {
  ws: UserWorkspace;
  supersedeStuckJob: typeof import("./supersedeStuckJob.js")["supersedeStuckJob"];
}

async function setup(userId: string): Promise<TestContext> {
  const [{ buildWorkspace }, mod] = await Promise.all([
    import("../middleware/userIsolation.js"),
    import("./supersedeStuckJob.js"),
  ]);
  const ws = buildWorkspace(userId, usersDir);
  await fs.mkdir(ws.jobsDir, { recursive: true });
  await fs.mkdir(ws.reportsDir, { recursive: true });
  return { ws, supersedeStuckJob: mod.supersedeStuckJob };
}

async function writeJson(p: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(value, null, 2), "utf-8");
}

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf-8")) as T;
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

test("marks paused job as superseded with given reason and timestamp", async () => {
  const { ws, supersedeStuckJob } = await setup("u1");
  await writeJson(ws.jobFile("job_x"), {
    id: "job_x",
    action: "full_report",
    ticker: null,
    status: "paused",
    triggered_at: "2026-04-26T00:00:00.000Z",
    started_at: "2026-04-27T00:00:00.000Z",
    completed_at: null,
    result: null,
    error: null,
  });

  const report = await supersedeStuckJob({
    workspace: ws,
    jobId: "job_x",
    reason: "Replaced by step-queue execution; see new full_report",
    deleteArtifactPaths: [],
  });

  assert.equal(report.jobUpdated, true);
  assert.equal(report.deleted.length, 0);

  const job = await readJson<{ status: string; error: string; completed_at: string }>(ws.jobFile("job_x"));
  assert.equal(job.status, "superseded");
  assert.equal(job.error, "Replaced by step-queue execution; see new full_report");
  assert.match(job.completed_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("preserves existing completed_at when present", async () => {
  const { ws, supersedeStuckJob } = await setup("u2");
  await writeJson(ws.jobFile("job_x"), {
    id: "job_x",
    action: "full_report",
    ticker: null,
    status: "paused",
    triggered_at: "2026-04-26T00:00:00.000Z",
    started_at: "2026-04-27T00:00:00.000Z",
    completed_at: "2026-04-27T11:53:00.000Z",
    result: null,
    error: "old",
  });

  await supersedeStuckJob({
    workspace: ws,
    jobId: "job_x",
    reason: "r",
    deleteArtifactPaths: [],
  });

  const job = await readJson<{ completed_at: string }>(ws.jobFile("job_x"));
  assert.equal(job.completed_at, "2026-04-27T11:53:00.000Z");
});

test("deletes named artifacts when they exist", async () => {
  const { ws, supersedeStuckJob } = await setup("u3");
  await writeJson(ws.jobFile("job_x"), {
    id: "job_x",
    action: "full_report",
    ticker: null,
    status: "paused",
    triggered_at: "2026-04-26T00:00:00.000Z",
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
  });
  const a = path.join(ws.jobsDir, "full_report_analysis.py");
  const b = path.join(ws.reportsDir, "full_report_basic_20260427_1147.json");
  await fs.writeFile(a, "print('hello')", "utf-8");
  await fs.writeFile(b, "{}", "utf-8");

  const report = await supersedeStuckJob({
    workspace: ws,
    jobId: "job_x",
    reason: "r",
    deleteArtifactPaths: [a, b],
  });

  assert.deepEqual(report.deleted.sort(), [a, b].sort());
  assert.equal(await exists(a), false);
  assert.equal(await exists(b), false);
});

test("silently skips artifact paths that don't exist", async () => {
  const { ws, supersedeStuckJob } = await setup("u4");
  await writeJson(ws.jobFile("job_x"), {
    id: "job_x",
    action: "full_report",
    ticker: null,
    status: "paused",
    triggered_at: "2026-04-26T00:00:00.000Z",
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
  });

  const report = await supersedeStuckJob({
    workspace: ws,
    jobId: "job_x",
    reason: "r",
    deleteArtifactPaths: [path.join(ws.jobsDir, "missing.py")],
  });

  assert.equal(report.deleted.length, 0);
});

test("is idempotent: second run on already-superseded job is a no-op success", async () => {
  const { ws, supersedeStuckJob } = await setup("u5");
  await writeJson(ws.jobFile("job_x"), {
    id: "job_x",
    action: "full_report",
    ticker: null,
    status: "superseded",
    triggered_at: "2026-04-26T00:00:00.000Z",
    started_at: null,
    completed_at: "2026-04-27T11:53:00.000Z",
    result: null,
    error: "Replaced by step-queue execution; see new full_report",
  });

  const report = await supersedeStuckJob({
    workspace: ws,
    jobId: "job_x",
    reason: "Replaced by step-queue execution; see new full_report",
    deleteArtifactPaths: [],
  });

  assert.equal(report.jobUpdated, false); // no change made
});

test("throws when job file does not exist", async () => {
  const { ws, supersedeStuckJob } = await setup("u6");
  await assert.rejects(
    supersedeStuckJob({ workspace: ws, jobId: "missing", reason: "r", deleteArtifactPaths: [] }),
    /not found/i
  );
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd backend && npx tsx --test src/scripts/supersedeStuckJob.test.ts`
Expected: failure — `Cannot find module './supersedeStuckJob.js'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/scripts/supersedeStuckJob.ts` with the full content below:

```typescript
import { promises as fs } from "fs";
import { resolveConfiguredPath } from "../services/paths.js";
import { buildWorkspace, type UserWorkspace } from "../middleware/userIsolation.js";
import { logger } from "../services/logger.js";

export interface SupersedeStuckJobInput {
  workspace: UserWorkspace;
  jobId: string;
  reason: string;
  deleteArtifactPaths: string[];
}

export interface SupersedeStuckJobReport {
  jobUpdated: boolean;
  deleted: string[];
}

export async function supersedeStuckJob(
  input: SupersedeStuckJobInput
): Promise<SupersedeStuckJobReport> {
  const { workspace, jobId, reason, deleteArtifactPaths } = input;
  const jobPath = workspace.jobFile(jobId);

  let raw: string;
  try {
    raw = await fs.readFile(jobPath, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Job ${jobId} not found at ${jobPath}`);
    }
    throw err;
  }

  const job = JSON.parse(raw) as Record<string, unknown>;
  const alreadySuperseded =
    job["status"] === "superseded" && job["error"] === reason;

  let jobUpdated = false;
  if (!alreadySuperseded) {
    job["status"] = "superseded";
    job["error"] = reason;
    if (!job["completed_at"]) {
      job["completed_at"] = new Date().toISOString();
    }
    await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");
    jobUpdated = true;
  }

  const deleted: string[] = [];
  for (const p of deleteArtifactPaths) {
    try {
      await fs.unlink(p);
      deleted.push(p);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  logger.info(
    `supersedeStuckJob: user=${workspace.userId} jobId=${jobId} jobUpdated=${jobUpdated} deleted=${deleted.length}`
  );

  return { jobUpdated, deleted };
}

// CLI entry point.
// Usage:
//   npx tsx src/scripts/supersedeStuckJob.ts <userId> <jobId> "<reason>" [path1 path2 ...]
// Example:
//   npx tsx src/scripts/supersedeStuckJob.ts soofke job_20260426_144855_1abcd8 \
//     "Replaced by step-queue execution; see new full_report" \
//     /root/clawd/users/soofke/data/jobs/full_report_analysis.py \
//     /root/clawd/users/soofke/data/jobs/full_report_simple.py \
//     /root/clawd/users/soofke/data/reports/full_report_basic_20260427_1147.json
async function main(): Promise<void> {
  const [userId, jobId, reason, ...artifactPaths] = process.argv.slice(2);
  if (!userId || !jobId || !reason) {
    console.error(
      "Usage: supersedeStuckJob <userId> <jobId> <reason> [artifactPath ...]"
    );
    process.exit(2);
  }
  const usersDir = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
  const ws = buildWorkspace(userId, usersDir);
  const report = await supersedeStuckJob({
    workspace: ws,
    jobId,
    reason,
    deleteArtifactPaths: artifactPaths,
  });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1]?.endsWith("supersedeStuckJob.ts")) {
  void main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx tsx --test src/scripts/supersedeStuckJob.test.ts`
Expected: 6 tests pass, 0 failures.

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/supersedeStuckJob.ts backend/src/scripts/supersedeStuckJob.test.ts
git commit -m "feat: add supersedeStuckJob CLI script"
```

---

## Task 5: Add `superseded` to frontend JobStatus type

**Files:**
- Modify: `frontend/src/types/api.ts` (the `JobStatus` definition)

- [ ] **Step 1: Locate the current `JobStatus` definition**

Run: `grep -nE "^export type JobStatus|^type JobStatus" frontend/src/types/api.ts`
Expected: a single line, e.g. `export type JobStatus = "pending" | "paused" | "running" | "completed" | "failed" | "cancelled";`

- [ ] **Step 2: Edit the union to include `superseded`**

Edit that one line so it becomes:

```typescript
export type JobStatus = "pending" | "paused" | "running" | "completed" | "failed" | "cancelled" | "superseded";
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: zero errors. (If any switch statement on `JobStatus` becomes non-exhaustive, fix it by adding a `case "superseded":` branch that does the same as `case "cancelled":` or `case "failed":`, whichever is closer in semantics.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/api.ts
git commit -m "feat: add superseded to frontend JobStatus union"
```

---

## Task 6: Create the SupersededJobBanner component

**Files:**
- Create: `frontend/src/components/jobs/SupersededJobBanner.tsx`

The banner is a presentational component. It receives the list of jobs and renders a banner if at least one is `superseded`. No fetching of its own — the parent passes data (Controls already fetches jobs via React Query). Plain Tailwind, matches existing surface (`Card`-like rounded panel, `var(--color-...)` tokens).

- [ ] **Step 1: Read an existing simple component for styling reference**

Run: `cat frontend/src/components/ui/Card.tsx`
Expected: shows current surface conventions (border radius, padding, color vars). Take note for the banner styling.

- [ ] **Step 2: Write the component**

Create `frontend/src/components/jobs/SupersededJobBanner.tsx` with the full content below:

```tsx
import { AlertTriangle } from "lucide-react";
import type { Job } from "../../types/api";

interface SupersededJobBannerProps {
  jobs: Job[];
}

export function SupersededJobBanner({ jobs }: SupersededJobBannerProps) {
  const superseded = jobs.filter((j) => j.status === "superseded");
  if (superseded.length === 0) return null;

  const latest = superseded.sort((a, b) =>
    (b.triggered_at ?? "").localeCompare(a.triggered_at ?? "")
  )[0];
  const action = latest?.action ?? "job";

  return (
    <div
      role="status"
      className="mb-3 rounded-md border px-3 py-2 flex items-start gap-2 text-[13px]"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-bg-subtle)",
        color: "var(--color-fg-default)",
      }}
    >
      <AlertTriangle
        size={16}
        className="mt-[2px] shrink-0"
        style={{ color: "var(--color-accent-red)" }}
      />
      <div>
        Your previous <span className="font-semibold">{action.replace("_", " ")}</span>{" "}
        ran into a system issue and didn't complete. A new run will be available soon.
        Your portfolio data and existing strategies are untouched.
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/jobs/SupersededJobBanner.tsx
git commit -m "feat: add SupersededJobBanner component"
```

---

## Task 7: Render the banner in Controls page

**Files:**
- Modify: `frontend/src/pages/Controls.tsx`

The Controls page already calls `fetchJobs()` via React Query (line 4 imports `fetchJobs`). We render the banner using that same data — no second request.

- [ ] **Step 1: Locate the existing `fetchJobs` query in Controls.tsx**

Run: `grep -n "fetchJobs\|useQuery" frontend/src/pages/Controls.tsx`
Expected: at least one `useQuery({ queryKey: [...], queryFn: fetchJobs })` call. Note its surrounding component name, the query result variable, and where its rendered output is composed.

- [ ] **Step 2: Add the banner import**

Edit `frontend/src/pages/Controls.tsx`. Near the other component imports add:

```typescript
import { SupersededJobBanner } from "../components/jobs/SupersededJobBanner";
```

- [ ] **Step 3: Render the banner near the top of the page body**

Inside the same component that uses `fetchJobs`, find the JSX root that wraps the page body (typically a `<div>` directly inside the returned tree, after `<TopBar />`). Render `<SupersededJobBanner jobs={jobsData?.jobs ?? []} />` immediately as the first child of that wrapper, where `jobsData` is whatever variable name the existing query result uses.

If the existing query returns `JobsResponse` shaped like `{ jobs: Job[] }`, this renders correctly. If it returns `Job[]` directly, pass it as `jobs={jobsData ?? []}` instead. Confirm the shape by looking at the type returned by `fetchJobs` in `frontend/src/api/jobs.ts`.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Smoke test in dev**

Run two terminals:

```bash
# Terminal 1
cd backend && npx tsx src/server.ts
```

```bash
# Terminal 2
cd frontend && npm run dev
```

Open `http://localhost:3000`, log in as soofke (use her credentials), navigate to `/controls`. Expected: the banner is **not** yet visible, because the cleanup script has not been run for soofke (Task 8 does that). Move on; we'll verify rendering after Task 8.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Controls.tsx
git commit -m "feat: render SupersededJobBanner on /controls"
```

---

## Task 8: Run the cleanup script for soofke (deployment step)

**Files:** none modified — this is a one-time operational action.

- [ ] **Step 1: Confirm soofke's current job + artifact state**

Run:
```bash
cat /root/clawd/users/soofke/data/jobs/job_20260426_144855_1abcd8.json | python3 -c "import sys,json;j=json.load(sys.stdin);print('status=',j.get('status'),'error=',j.get('error'))"
ls -la /root/clawd/users/soofke/data/jobs/full_report_analysis.py /root/clawd/users/soofke/data/jobs/full_report_simple.py /root/clawd/users/soofke/data/reports/full_report_basic_20260427_1147.json 2>/dev/null
```
Expected: job status is currently `paused` with the `execution_constraints` error; the three hallucinated artifacts exist on disk. If the artifacts are already absent, that is fine — the script is idempotent.

- [ ] **Step 2: Run the deploy script (which builds + restarts the backend service)**

Run: `cd /root/clawd && ./deploy.sh`
Expected: deploy completes; `systemctl status clawd-backend` reports `active (running)`. Backend logs (`journalctl -u clawd-backend -n 30 --no-pager`) include the reconciler line for soofke if her state was still divergent at startup.

- [ ] **Step 3: Run the supersedeStuckJob script**

Run:
```bash
cd /root/clawd/backend && npx tsx src/scripts/supersedeStuckJob.ts \
  soofke \
  job_20260426_144855_1abcd8 \
  "Replaced by step-queue execution; see new full_report" \
  /root/clawd/users/soofke/data/jobs/full_report_analysis.py \
  /root/clawd/users/soofke/data/jobs/full_report_simple.py \
  /root/clawd/users/soofke/data/reports/full_report_basic_20260427_1147.json
```
Expected output: a JSON report like `{ "jobUpdated": true, "deleted": [ ... three paths ... ] }`.

- [ ] **Step 4: Verify**

Run:
```bash
cat /root/clawd/users/soofke/data/jobs/job_20260426_144855_1abcd8.json | python3 -c "import sys,json;j=json.load(sys.stdin);print('status=',j.get('status'),'error=',j.get('error'),'completed_at=',j.get('completed_at'))"
ls /root/clawd/users/soofke/data/jobs/full_report_analysis.py /root/clawd/users/soofke/data/jobs/full_report_simple.py /root/clawd/users/soofke/data/reports/full_report_basic_20260427_1147.json 2>&1 | head
```
Expected:
- job status now reads `superseded`
- error reads `Replaced by step-queue execution; see new full_report`
- the three hallucinated files are absent (`No such file or directory` for each).

- [ ] **Step 5: Verify the banner renders for soofke in production**

Open the production frontend (or local dev server if production access isn't trivial), log in as soofke, navigate to `/controls`. Expected: the banner is visible at the top of the page reading the "previous full report ran into a system issue" message. No console errors. No layout breakage.

- [ ] **Step 6: Document the run (optional but useful)**

If it doesn't already exist, append a short note to `docs/core-stabilization-plan.md` or to a maintenance log noting the date/time, the user, the job ID, and that Phase 0 cleanup ran successfully. (Skip if your team uses a different operations log.)

---

## Self-review checklist (run after the engineer completes the plan)

- [ ] Backend `npm test` (or its equivalent: `cd backend && npx tsc --noEmit && node --test --import tsx 'src/**/*.test.ts'`) passes with the two new test files included.
- [ ] `git log --oneline -10` shows 7 new commits in order: schema, reconciler, bootstrap hook, script, frontend type, banner, controls render. Plus the deployment is recorded as part of Task 8.
- [ ] Soofke's `data/jobs/job_20260426_144855_1abcd8.json` has `status: "superseded"`.
- [ ] Soofke's three hallucinated artifacts no longer exist.
- [ ] Soofke's `data/reports/full_report_state.json`, if it still exists, has `status: "superseded"` (matching the job).
- [ ] `/controls` shows the banner for soofke and does NOT show it for users without a `superseded` job.
- [ ] No code path mocks the database or filesystem in tests — they use real tmpdirs.
