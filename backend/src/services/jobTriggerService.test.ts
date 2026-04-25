import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "job-trigger-service-"));
process.env["USERS_DIR"] = path.join(testRoot, "users");
process.env["DATA_DIR"] = path.join(testRoot, "data");

const [{ buildWorkspace }, { triggerUserJob }] = await Promise.all([
  import("../middleware/userIsolation.js"),
  import("./jobTriggerService.js"),
]);

async function seedProfileRegistry(): Promise<void> {
  await fs.mkdir(process.env["DATA_DIR"]!, { recursive: true });
  await fs.writeFile(
    path.join(process.env["DATA_DIR"]!, "model-profiles.json"),
    JSON.stringify(
      {
        testing: {
          orchestrator: "openrouter/deepseek/deepseek-v3",
          analysts: "openrouter/google/gemini-2.5-flash-lite",
          risk: "openrouter/google/gemini-2.5-flash-lite",
          researchers: "openrouter/deepseek/deepseek-v3",
        },
        production: {
          orchestrator: "openrouter/anthropic/claude-opus-4",
          analysts: "openrouter/anthropic/claude-sonnet-4",
          risk: "openrouter/anthropic/claude-sonnet-4",
          researchers: "openrouter/anthropic/claude-opus-4",
        },
      },
      null,
      2
    ),
    "utf-8"
  );
}

async function setupUser(userId: string, rateLimits?: unknown) {
  const ws = buildWorkspace(userId, process.env["USERS_DIR"]!);
  await fs.mkdir(ws.root, { recursive: true });
  await fs.mkdir(ws.jobsDir, { recursive: true });
  await fs.mkdir(path.join(ws.root, "data"), { recursive: true });
  await fs.writeFile(
    path.join(ws.root, "profile.json"),
    JSON.stringify(
      {
        userId,
        displayName: userId,
        createdAt: new Date().toISOString(),
        rateLimits,
        pointsBudget: { dailyBudgetPoints: 500 },
      },
      null,
      2
    ),
    "utf-8"
  );
  return ws;
}

await seedProfileRegistry();

test("telegram-command triggers respect job rate limits", async () => {
  const ws = await setupUser("neta", {
    deep_dive: { maxPerPeriod: 1, periodHours: 24 },
  });

  await fs.writeFile(
    ws.jobFile("job_existing"),
    JSON.stringify(
      {
        id: "job_existing",
        action: "deep_dive",
        ticker: "AAPL",
        source: "dashboard_action",
        status: "completed",
        triggered_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        result: null,
        error: null,
      },
      null,
      2
    ),
    "utf-8"
  );

  const result = await triggerUserJob({
    workspace: ws,
    action: "deep_dive",
    ticker: "TSM",
    source: "telegram_command",
  });

  assert.equal(result.statusCode, 429);
  assert.equal(result.body["error"], "rate_limit_exceeded");
});

test("dashboard action returns existing duplicate running deep dive", async () => {
  const ws = await setupUser("guy", {
    deep_dive: { maxPerPeriod: 5, periodHours: 24 },
  });

  const existingJob = {
    id: "job_duplicate",
    action: "deep_dive",
    ticker: "TSM",
    source: "dashboard_action",
    status: "running",
    triggered_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    completed_at: null,
    result: null,
    error: null,
  };
  await fs.writeFile(ws.jobFile(existingJob.id), JSON.stringify(existingJob, null, 2), "utf-8");

  const result = await triggerUserJob({
    workspace: ws,
    action: "deep_dive",
    ticker: "TSM",
    source: "dashboard_action",
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body["jobId"], existingJob.id);
});

test("dashboard action returns existing duplicate paused deep dive", async () => {
  const ws = await setupUser("paused-user");

  const existingJob = {
    id: "job_paused",
    action: "deep_dive",
    ticker: "ONDS",
    source: "dashboard_action",
    status: "paused",
    triggered_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    result: null,
    error: "Needs more balance to start",
  };
  await fs.writeFile(ws.jobFile(existingJob.id), JSON.stringify(existingJob, null, 2), "utf-8");

  const result = await triggerUserJob({
    workspace: ws,
    action: "deep_dive",
    ticker: "ONDS",
    source: "dashboard_action",
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body["jobId"], existingJob.id);
});

test("deep dive jobs are stamped as budget-admitted after passing start-gate checks", async () => {
  const ws = await setupUser("budget-admission");

  const result = await triggerUserJob({
    workspace: ws,
    action: "deep_dive",
    ticker: "TSM",
    source: "dashboard_action",
  });

  assert.equal(result.statusCode, 201);
  const raw = JSON.parse(await fs.readFile(ws.jobFile(result.body["jobId"] as string), "utf-8")) as {
    budget_admitted_at?: string | null;
    action: string;
  };
  assert.equal(raw.action, "deep_dive");
  assert.match(raw.budget_admitted_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
});
