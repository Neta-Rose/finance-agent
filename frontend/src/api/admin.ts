import type { AgentHealth, SupportMessageRecord } from "../types/api";

const ADMIN_KEY = () => sessionStorage.getItem("admin_key") ?? "";

const adminHeaders = (): HeadersInit => ({
  "Content-Type": "application/json",
  "X-Admin-Key": ADMIN_KEY(),
});

async function adminFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...adminHeaders(), ...opts?.headers },
  });
  if (res.status === 401) {
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.json();
}

export interface RateLimits {
  full_report: { maxPerPeriod: number; periodHours: number };
  daily_brief: { maxPerPeriod: number; periodHours: number };
  deep_dive: { maxPerPeriod: number; periodHours: number };
  new_ideas: { maxPerPeriod: number; periodHours: number };
  quick_check: { maxPerPeriod: number; periodHours: number };
}

export interface PointsBudget {
  dailyBudgetPoints: number;
}

export type ModelTier = "free" | "cheap" | "balanced" | "expensive";

export interface AdminDefaults {
  modelTier: ModelTier;
  pointsBudget: PointsBudget;
}

export interface PointsBalance {
  dailyBudgetPoints: number;
  pointsUsed: number;
  pointsRemaining: number;
  pctUsed: number;
  exhausted: boolean;
  windowStart: string;
  windowEnd: string;
}

export interface Schedule {
  dailyBriefTime: string;
  weeklyResearchDay: string;
  weeklyResearchTime: string;
  timezone: string;
}

export interface UserSummary {
  userId: string;
  displayName: string;
  state: string;
  portfolioLoaded: boolean;
  agentConfigured: boolean;
  hasTelegram: boolean;
  telegramChatId?: string;
  createdAt: string;
  rateLimits: RateLimits;
  pointsBudget: PointsBudget;
  schedule: Schedule;
  modelTier: ModelTier;
  modelProfile: string;
  agentHealth: AgentHealth;
  restriction: "readonly" | "blocked" | "suspended" | null;
  eligibilityIssue: string | null;
  integrityValid: boolean;
  integrityErrors: string[];
  integrityWarnings: string[];
}

export interface AdminStatus {
  gatewayRunning: boolean;
  totalUsers: number;
  activeAgents: number;
}

export interface SystemAgentSummary {
  agentId: string;
  workspace: string;
  configured: boolean;
  hasTelegram: boolean;
  telegramAccountId?: string;
  modelProfile: string;
  profileBroken: boolean;
  profileBrokenReason?: string;
  agentHealth: AgentHealth;
}

export interface ProfileDefinition {
  orchestrator: string;
  analysts: string;
  risk: string;
  researchers: string;
}

export type ProfilesRegistry = Record<string, ProfileDefinition>;

export type { AgentHealth };

export interface StepQueueJobSummary {
  id: string;
  user_id: string;
  action: string;
  status: string;
  model_tier: string;
  triggered_at: string;
  started_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  ticker_count: number;
  step_count: number;
  completed_steps: number;
  failed_steps: number;
}

export interface StepQueueTicker {
  id: string;
  job_id: string;
  user_id: string;
  ticker: string;
  status: string;
  position: number;
  started_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  skip_reason: string | null;
}

export interface StepQueueStep {
  id: string;
  ticker_work_item_id: string;
  job_id: string;
  user_id: string;
  kind: string;
  status: string;
  attempts: number;
  model_tier_used: string | null;
  cost_accrued_cents: number;
  output_artifact_path: string | null;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface StepQueueEvent {
  id: number;
  step_id: string;
  from_status: string | null;
  to_status: string;
  attempt_n: number | null;
  model_used: string | null;
  tier_used: string | null;
  error_class: string | null;
  error_message: string | null;
  occurred_at: string;
}

export interface StepQueueJobDetail {
  job: Record<string, unknown>;
  tickers: StepQueueTicker[];
  steps: StepQueueStep[];
  events: StepQueueEvent[];
}

export interface StepQueueModelAssignment {
  tier: string;
  step_kind: string;
  model: string;
  fallback: string | null;
  updated_at: string;
  updated_by: string;
}

export interface StepQueueModelsResponse {
  tiers: string[];
  stepKinds: string[];
  assignments: StepQueueModelAssignment[];
}

export interface StepQueueCostRow {
  user_id: string;
  ticker: string | null;
  step_kind: string;
  day: string;
  request_count: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: string | number;
  success_count: number;
  error_count: number;
}

export interface StepQueueCostResponse {
  days: number | null;
  from: string;
  to: string;
  rows: StepQueueCostRow[];
}

const DEFAULT_POINTS_BUDGET_VALUE = 500;

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundPoints(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function normalizePointsBudget(input: unknown): PointsBudget {
  const budget = input as { dailyBudgetPoints?: unknown } | null | undefined;
  const dailyBudgetPoints = toFiniteNumber(budget?.dailyBudgetPoints, DEFAULT_POINTS_BUDGET_VALUE);
  return {
    dailyBudgetPoints: roundPoints(
      dailyBudgetPoints > 0 ? dailyBudgetPoints : DEFAULT_POINTS_BUDGET_VALUE
    ),
  };
}

function normalizePointsBalance(input: unknown, budget: PointsBudget): PointsBalance {
  const balance = input as {
    dailyBudgetPoints?: unknown;
    pointsUsed?: unknown;
    pointsRemaining?: unknown;
    pctUsed?: unknown;
    exhausted?: unknown;
    windowStart?: unknown;
    windowEnd?: unknown;
  } | null | undefined;
  const dailyBudgetPoints = toFiniteNumber(balance?.dailyBudgetPoints, budget.dailyBudgetPoints);
  const pointsUsed = Math.max(0, roundPoints(toFiniteNumber(balance?.pointsUsed, 0)));
  const remainingFallback = Math.max(0, roundPoints(dailyBudgetPoints - pointsUsed));
  const pointsRemaining = Math.max(
    0,
    roundPoints(toFiniteNumber(balance?.pointsRemaining, remainingFallback))
  );
  const pctUsed = Math.max(
    0,
    Math.min(999, Math.round(toFiniteNumber(balance?.pctUsed, dailyBudgetPoints > 0 ? (pointsUsed / dailyBudgetPoints) * 100 : 0)))
  );
  const exhausted =
    typeof balance?.exhausted === "boolean" ? balance.exhausted : pointsRemaining <= 0;

  return {
    dailyBudgetPoints: roundPoints(dailyBudgetPoints),
    pointsUsed,
    pointsRemaining,
    pctUsed,
    exhausted,
    windowStart: typeof balance?.windowStart === "string" ? balance.windowStart : "",
    windowEnd: typeof balance?.windowEnd === "string" ? balance.windowEnd : "",
  };
}

function normalizeUserSummary(user: UserSummary & { tokenBudgets?: unknown }): UserSummary {
  return {
    ...user,
    pointsBudget: normalizePointsBudget(user.pointsBudget),
    modelTier: normalizeModelTier(user.modelTier),
  };
}

function normalizeModelTier(value: unknown): ModelTier {
  return value === "free" || value === "cheap" || value === "expensive" || value === "balanced"
    ? value
    : "balanced";
}

export const adminFetchUsers = async (): Promise<{ users: UserSummary[] }> =>
  adminFetch("/api/admin/users").then((payload) => {
    const users = Array.isArray(payload?.users)
      ? payload.users.map((user: unknown) =>
          normalizeUserSummary(user as UserSummary & { tokenBudgets?: unknown })
        )
      : [];
    return { users };
  });

export interface CreateUserPayload {
  userId: string;
  password: string;
  displayName: string;
  telegramChatId?: string;
  telegramBotToken?: string;
  schedule?: Schedule;
  rateLimits?: RateLimits;
}

export const adminCreateUser = async (payload: CreateUserPayload): Promise<void> => {
  await adminFetch("/api/admin/users", { method: "POST", body: JSON.stringify(payload) });
};

export const adminDeleteUser = async (userId: string): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
};

export const adminUpdatePointsBudget = async (userId: string, pointsBudget: Partial<PointsBudget>): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/points-budget`, {
    method: "PATCH",
    body: JSON.stringify(pointsBudget),
  });
};

export const adminUpdateUserModelTier = async (userId: string, modelTier: ModelTier): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/model-tier`, {
    method: "PATCH",
    body: JSON.stringify({ modelTier }),
  });
};

export const adminGetDefaults = async (): Promise<AdminDefaults> => {
  const payload = await adminFetch("/api/admin/defaults") as { defaults?: Partial<AdminDefaults> };
  return {
    modelTier: normalizeModelTier(payload.defaults?.modelTier),
    pointsBudget: normalizePointsBudget(payload.defaults?.pointsBudget),
  };
};

export const adminUpdateDefaults = async (patch: Partial<AdminDefaults>): Promise<AdminDefaults> => {
  const payload = await adminFetch("/api/admin/defaults", {
    method: "PATCH",
    body: JSON.stringify({ ...patch, updatedBy: "admin-ui" }),
  }) as { defaults?: Partial<AdminDefaults> };
  return {
    modelTier: normalizeModelTier(payload.defaults?.modelTier),
    pointsBudget: normalizePointsBudget(payload.defaults?.pointsBudget),
  };
};

export const adminAddTelegram = async (userId: string, botToken: string, chatId: string): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/telegram`, {
    method: "POST",
    body: JSON.stringify({ botToken, telegramChatId: chatId }),
  });
};

export const adminGetStatus = async (): Promise<AdminStatus> =>
  adminFetch("/api/admin/status");

export const adminGetSystemAgent = async (): Promise<SystemAgentSummary> =>
  adminFetch("/api/admin/system-agent");

export const adminFetchProfiles = async (): Promise<{ profiles: ProfilesRegistry }> =>
  adminFetch("/api/admin/profiles");

export const adminCreateProfile = async (name: string, definition: ProfileDefinition): Promise<void> => {
  await adminFetch("/api/admin/profiles", {
    method: "POST",
    body: JSON.stringify({ name, definition }),
  });
};

export const adminUpdateProfile = async (name: string, definition: ProfileDefinition): Promise<void> => {
  await adminFetch(`/api/admin/profiles/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: JSON.stringify(definition),
  });
};

export const adminDeleteProfile = async (name: string): Promise<void> => {
  await adminFetch(`/api/admin/profiles/${encodeURIComponent(name)}`, { method: "DELETE" });
};

export const adminSetUserProfile = async (userId: string, profileName: string): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/profile`, {
    method: "PATCH",
    body: JSON.stringify({ profileName }),
  });
};

export const adminSetSystemAgentProfile = async (profileName: string): Promise<void> => {
  await adminFetch("/api/admin/system-agent/profile", {
    method: "PATCH",
    body: JSON.stringify({ profileName }),
  });
};

// ── Observability ─────────────────────────────────────────────────────────────

export interface LlmRequestEvent {
  id: number;
  userId: string;
  purpose: string;
  ticker: string | null;
  jobId: string | null;
  sourceClass: "backend_job" | "telegram_command" | "dashboard_action" | "direct_chat" | "unknown_agent_session";
  analyst: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  status: "success" | "error" | "timeout";
  errorMessage: string | null;
  attributionSource: string;
  rejectionReason: string | null;
  timestamp: string;
}

export interface UserDailySummary {
  userId: string;
  date: string;
  requestCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  rejectedCount: number;
  unattributedCount: number;
}

export interface UserObservability {
  userId: string;
  todaySummary: UserDailySummary;
  history: UserDailySummary[];
  recent: LlmRequestEvent[];
  recentTotal: number;
  recentLimit: number;
  recentOffset: number;
  pointsBudget: PointsBudget;
  pointsBalance: PointsBalance;
}

export interface ObservabilityRangeSummary {
  from: string;
  to: string;
  users: UserDailySummary[];
}

export const adminGetUserObservability = async (
  userId: string,
  options?: { limit?: number; offset?: number }
): Promise<UserObservability> =>
  adminFetch(
    `/api/admin/observability/users/${encodeURIComponent(userId)}?limit=${options?.limit ?? 20}&offset=${options?.offset ?? 0}`
  ).then((payload) => {
    const pointsBudget = normalizePointsBudget(payload?.pointsBudget);
    const pointsBalance = normalizePointsBalance(payload?.pointsBalance, pointsBudget);
    return {
      ...(payload as UserObservability),
      history: Array.isArray(payload?.history) ? payload.history : [],
      recent: Array.isArray(payload?.recent) ? payload.recent : [],
      pointsBudget,
      pointsBalance,
    };
  });

export const adminGetObservabilitySummary = async (): Promise<{ date: string; users: UserDailySummary[] }> =>
  adminFetch("/api/admin/observability/summary") as Promise<{ date: string; users: UserDailySummary[] }>;

export const adminGetObservabilityRange = async (from: string, to: string): Promise<ObservabilityRangeSummary> => {
  const params = new URLSearchParams({ from, to });
  return adminFetch(`/api/admin/observability/range?${params.toString()}`) as Promise<ObservabilityRangeSummary>;
};

// ── Admin control API ─────────────────────────────────────────────────────────

export interface SystemControlPatch {
  locked?:      boolean;
  lockReason?:  string;
  lockedUntil?: string | null;
  broadcast?:   { text: string; type: "info" | "warning" | "error"; dismissible?: boolean; expiresAt?: string | null } | null;
}

export interface UserControlPatch {
  restriction:      "readonly" | "blocked" | "suspended";
  reason?:          string;
  restrictedUntil?: string | null;
  banner?:          { text: string; type: "info" | "warning" | "error"; dismissible?: boolean; expiresAt?: string | null } | null;
}

export interface SystemControlState {
  locked:      boolean;
  lockReason:  string;
  lockedAt:    string | null;
  lockedUntil: string | null;
  broadcast:   import("./control").Banner | null;
}

export const adminGetSystem = async (): Promise<SystemControlState> =>
  adminFetch("/api/admin/system") as Promise<SystemControlState>;

export const adminPatchSystem = async (patch: SystemControlPatch): Promise<void> => {
  await adminFetch("/api/admin/system", { method: "PATCH", body: JSON.stringify(patch) });
};

export const adminSetUserControl = async (userId: string, patch: UserControlPatch): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/control`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
};

export const adminClearUserControl = async (userId: string): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/control`, { method: "DELETE" });
};

export const adminForceLogout = async (userId: string): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/force-logout`, { method: "POST" });
};

export const adminKillJob = async (userId: string, jobId: string): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/jobs/${encodeURIComponent(jobId)}/kill`, { method: "POST" });
};

export const adminListStepQueueJobs = async (limit = 20, userId?: string): Promise<StepQueueJobSummary[]> => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (userId) params.set("userId", userId);
  const d = await adminFetch(`/api/admin/step-queue/jobs?${params.toString()}`) as { jobs: StepQueueJobSummary[] };
  return d.jobs;
};

export const adminGetStepQueueJob = async (jobId: string): Promise<StepQueueJobDetail> =>
  adminFetch(`/api/admin/step-queue/jobs/${encodeURIComponent(jobId)}`) as Promise<StepQueueJobDetail>;

export const adminGetStepQueueCost = async (
  range: number | { from: string; to: string } = 7
): Promise<StepQueueCostResponse> => {
  const params = new URLSearchParams(
    typeof range === "number"
      ? { days: String(range) }
      : { from: range.from, to: range.to }
  );
  return adminFetch(`/api/admin/step-queue/cost?${params.toString()}`) as Promise<StepQueueCostResponse>;
};

export const adminGetStepQueueModels = async (): Promise<StepQueueModelsResponse> =>
  adminFetch("/api/admin/step-queue/models") as Promise<StepQueueModelsResponse>;

export const adminUpdateStepQueueModel = async (
  tier: string,
  stepKind: string,
  payload: { model: string; fallback?: string | null; updatedBy?: string }
): Promise<StepQueueModelAssignment> => {
  const d = await adminFetch(`/api/admin/step-queue/models/${encodeURIComponent(tier)}/${encodeURIComponent(stepKind)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  }) as { assignment: StepQueueModelAssignment };
  return d.assignment;
};

export const adminListSupportMessages = async (limit = 100): Promise<SupportMessageRecord[]> => {
  const d = await adminFetch(`/api/admin/support/messages?limit=${encodeURIComponent(String(limit))}`) as { messages: SupportMessageRecord[] };
  return d.messages;
};

export const adminUpdateSupportMessageStatus = async (
  messageId: string,
  status: "open" | "closed"
): Promise<SupportMessageRecord> => {
  const d = await adminFetch(`/api/admin/support/messages/${encodeURIComponent(messageId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  }) as { message: SupportMessageRecord };
  return d.message;
};

// ── Admin job control API ─────────────────────────────────────────────────────

export interface AdminJob {
  id: string;
  action: string;
  ticker: string | null;
  status: "pending" | "running" | "completed" | "partial_completed" | "failed";
  triggered_at: string;
  started_at: string | null;
  completed_at: string | null;
  result: string | null;
  error: string | null;
}

export const adminListJobs = async (userId: string): Promise<AdminJob[]> => {
  const d = await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/jobs`) as { jobs: AdminJob[] };
  return d.jobs;
};

export const adminCreateJob = async (userId: string, action: string, ticker?: string): Promise<AdminJob> => {
  const d = await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/jobs`, {
    method: "POST",
    body: JSON.stringify({ action, ticker }),
  }) as { job: AdminJob };
  return d.job;
};

export const adminEditJob = async (userId: string, jobId: string, action?: string, ticker?: string): Promise<AdminJob> => {
  const d = await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/jobs/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    body: JSON.stringify({ action, ticker }),
  }) as { job: AdminJob };
  return d.job;
};

export const adminCancelJob = async (userId: string, jobId: string): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
};

export const adminContinueJob = async (userId: string, jobId: string): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/jobs/${encodeURIComponent(jobId)}/continue`, { method: "POST" });
};

export const adminWakeUser = async (userId: string): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/wake`, { method: "POST" });
};
