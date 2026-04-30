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
