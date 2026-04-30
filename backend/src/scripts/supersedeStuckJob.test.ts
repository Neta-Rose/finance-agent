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
