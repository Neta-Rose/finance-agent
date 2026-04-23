import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-service-"));
const usersDir = path.join(testRoot, "users");

const { hasRunnableTriggerFiles } = await import("./agentService.js");

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

test("hasRunnableTriggerFiles returns true when a trigger points at a pending job", async () => {
  const userId = "agent-trigger-pending";
  await writeJson(
    path.join(usersDir, userId, "data", "triggers", "job_test.json"),
    { id: "job_test" }
  );
  await writeJson(
    path.join(usersDir, userId, "data", "jobs", "job_test.json"),
    { id: "job_test", status: "pending" }
  );

  assert.equal(await hasRunnableTriggerFiles(userId, usersDir), true);
});

test("hasRunnableTriggerFiles returns false when all trigger-linked jobs are terminal", async () => {
  const userId = "agent-trigger-terminal";
  await writeJson(
    path.join(usersDir, userId, "data", "triggers", "job_test.json"),
    { id: "job_test" }
  );
  await writeJson(
    path.join(usersDir, userId, "data", "jobs", "job_test.json"),
    { id: "job_test", status: "failed" }
  );

  assert.equal(await hasRunnableTriggerFiles(userId, usersDir), false);
});

test("hasRunnableTriggerFiles returns true when the job file is missing but trigger exists", async () => {
  const userId = "agent-trigger-missing-job";
  await writeJson(
    path.join(usersDir, userId, "data", "triggers", "job_test.json"),
    { id: "job_test" }
  );

  assert.equal(await hasRunnableTriggerFiles(userId, usersDir), true);
});
