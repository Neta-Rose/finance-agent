import { randomBytes, randomUUID } from "crypto";
import path from "path";
import type { DataSource } from "typeorm";
import { getApplicationDataSource } from "../../db/applicationDataSource.js";
import type { UserWorkspace } from "../../middleware/userIsolation.js";
import type { JobSource as LegacyJobSource } from "../../types/index.js";
import { readUserModelTier } from "./modelTier.js";
import { expandStepQueueJob } from "./expansion.js";
import {
  STEP_ARTIFACT_FILENAMES,
  type JobAction,
  type JobSource,
  type ModelTier,
  type StepKind,
} from "./types.js";

export interface AdmitStepQueueJobParams {
  workspace: UserWorkspace;
  action: JobAction;
  ticker?: string | undefined;
  source: LegacyJobSource | JobSource;
  notifyPerTicker?: boolean;
  budgetAdmittedAt?: Date | null;
}

export interface AdmitStepQueueJobResult {
  jobId: string;
  tickerCount: number;
  stepCount: number;
  modelTier: ModelTier;
}

function generateJobId(): string {
  const now = new Date();
  const dateStr = now
    .toISOString()
    .replace(/[-:]/g, "")
    .slice(0, 15)
    .replace("T", "_");
  return `job_${dateStr}_${randomBytes(3).toString("hex")}`;
}

function normalizeSource(source: LegacyJobSource | JobSource): JobSource {
  return source === "telegram_command" ? "telegram_command" : source === "dashboard_action" ? "dashboard_action" : "backend_job";
}

function stepOutputPath(ws: UserWorkspace, ticker: string, kind: StepKind): string {
  if (kind === "synthesis") return ws.strategyFile(ticker);
  const filename = STEP_ARTIFACT_FILENAMES[kind];
  return path.join(ws.reportsDir, ticker, filename);
}

function stepInputPaths(ws: UserWorkspace, ticker: string, kind: StepKind): string[] {
  if (kind.startsWith("analyst.")) return [ws.portfolioFile, ws.userMdFile, ws.strategyFile(ticker)];
  if (kind === "debate") {
    return [
      ws.reportFile(ticker, "fundamentals"),
      ws.reportFile(ticker, "technical"),
      ws.reportFile(ticker, "sentiment"),
      ws.reportFile(ticker, "macro"),
      ws.reportFile(ticker, "risk"),
    ];
  }
  return [
    ...stepInputPaths(ws, ticker, "debate"),
    path.join(ws.reportsDir, ticker, "debate.json"),
    ws.portfolioFile,
    ws.userMdFile,
  ];
}

async function insertStepQueueRows(
  ds: DataSource,
  params: AdmitStepQueueJobParams,
  jobId: string,
  modelTier: ModelTier
): Promise<{ tickerCount: number; stepCount: number }> {
  const expanded = await expandStepQueueJob(params.workspace, {
    action: params.action,
    ticker: params.ticker,
  });
  const now = new Date();
  let stepCount = 0;

  await ds.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO jobs
         (id, user_id, action, status, source, model_tier, notify_per_ticker, budget_admitted_at, triggered_at, started_at)
       VALUES ($1, $2, $3, 'running', $4, $5, $6, $7, $8, $8)`,
      [
        jobId,
        params.workspace.userId,
        params.action,
        normalizeSource(params.source),
        modelTier,
        params.notifyPerTicker ?? false,
        params.budgetAdmittedAt ?? null,
        now,
      ]
    );

    for (const tickerWork of expanded.tickers) {
      const tickerWorkItemId = randomUUID();
      await manager.query(
        `INSERT INTO ticker_work_items
           (id, job_id, user_id, ticker, status, position, started_at)
         VALUES ($1, $2, $3, $4, 'running', $5, $6)`,
        [
          tickerWorkItemId,
          jobId,
          params.workspace.userId,
          tickerWork.ticker,
          tickerWork.position,
          now,
        ]
      );

      for (const kind of tickerWork.stepKinds) {
        stepCount += 1;
        await manager.query(
          `INSERT INTO step_work_items
             (id, ticker_work_item_id, job_id, user_id, kind, status, model_tier_used, input_artifact_paths, output_artifact_path, created_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9)`,
          [
            randomUUID(),
            tickerWorkItemId,
            jobId,
            params.workspace.userId,
            kind,
            modelTier,
            stepInputPaths(params.workspace, tickerWork.ticker, kind),
            stepOutputPath(params.workspace, tickerWork.ticker, kind),
            now,
          ]
        );
      }
    }
  });

  return {
    tickerCount: expanded.tickers.length,
    stepCount,
  };
}

export async function admitStepQueueJob(params: AdmitStepQueueJobParams): Promise<AdmitStepQueueJobResult> {
  const ds = await getApplicationDataSource();
  const jobId = generateJobId();
  const modelTier = await readUserModelTier(params.workspace.userId);
  const inserted = await insertStepQueueRows(ds, params, jobId, modelTier);
  return {
    jobId,
    modelTier,
    ...inserted,
  };
}
