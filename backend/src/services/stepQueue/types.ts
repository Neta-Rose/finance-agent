import type { JsonValue } from "../../types/index.js";

export const STEP_KINDS = [
  "analyst.fundamentals",
  "analyst.technical",
  "analyst.sentiment",
  "analyst.macro",
  "analyst.risk",
  "debate",
  "synthesis",
] as const;

export const ANALYST_STEP_KINDS = [
  "analyst.fundamentals",
  "analyst.technical",
  "analyst.sentiment",
  "analyst.macro",
  "analyst.risk",
] as const;

export const MODEL_TIERS = ["free", "cheap", "balanced", "expensive"] as const;

export type StepKind = (typeof STEP_KINDS)[number];
export type AnalystStepKind = (typeof ANALYST_STEP_KINDS)[number];
export type ModelTier = (typeof MODEL_TIERS)[number];

export type JobAction = "full_report" | "deep_dive";
export type JobSource = "dashboard_action" | "auto_brief" | "admin" | "backend_job" | "telegram_command";
export type JobStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled" | "superseded";
export type TickerWorkItemStatus = "pending" | "running" | "paused" | "completed" | "failed" | "skipped";
export type StepWorkItemStatus = "pending" | "running" | "completed" | "failed";
export type StepErrorClass = "zod" | "network" | "timeout" | "rate_limit" | "gather_inputs" | "handler";

export interface StepWorkItem {
  id: string;
  tickerWorkItemId: string;
  jobId: string;
  userId: string;
  kind: StepKind;
  status: StepWorkItemStatus;
  attempts: number;
  modelTierUsed: ModelTier | null;
  costAccruedCents: number;
  inputArtifactPaths: string[];
  outputArtifactPath: string | null;
  lastError: string | null;
  ownerLockId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface ClaimedStepWorkItem extends StepWorkItem {
  ticker: string;
}

export interface StepLifecycleEvent {
  stepId: string;
  fromStatus: StepWorkItemStatus | null;
  toStatus: StepWorkItemStatus;
  attemptN: number | null;
  modelUsed: string | null;
  tierUsed: ModelTier | null;
  errorClass: StepErrorClass | null;
  errorMessage: string | null;
}

export interface ExpandedTickerWork {
  ticker: string;
  position: number;
  fullDeepDive: boolean;
  stepKinds: StepKind[];
}

export interface ExpandedJobWork {
  action: JobAction;
  tickers: ExpandedTickerWork[];
}

export interface StepQueueJobSeed {
  id: string;
  userId: string;
  action: JobAction;
  source: JobSource;
  modelTier: ModelTier;
  notifyPerTicker: boolean;
  budgetAdmittedAt: Date | null;
  triggeredAt: Date;
  result: JsonValue | null;
}

export const STEP_ARTIFACT_FILENAMES: Record<StepKind, string> = {
  "analyst.fundamentals": "fundamentals.json",
  "analyst.technical": "technical.json",
  "analyst.sentiment": "sentiment.json",
  "analyst.macro": "macro.json",
  "analyst.risk": "risk.json",
  debate: "debate.json",
  synthesis: "strategy.json",
};

export function isStepKind(value: string): value is StepKind {
  return (STEP_KINDS as readonly string[]).includes(value);
}
