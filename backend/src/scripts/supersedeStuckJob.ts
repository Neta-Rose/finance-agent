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
