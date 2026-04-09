import type { AgentHealth } from "../types/api";

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
    sessionStorage.removeItem("admin_key");
    window.location.href = "/admin";
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
  schedule: Schedule;
  modelProfile: string;
  agentHealth: AgentHealth;
}

export interface AdminStatus {
  gatewayRunning: boolean;
  totalUsers: number;
  activeAgents: number;
}

export interface ProfileDefinition {
  orchestrator: string;
  analysts: string;
  risk: string;
  researchers: string;
}

export type ProfilesRegistry = Record<string, ProfileDefinition>;

export type { AgentHealth };

export const adminFetchUsers = async (): Promise<{ users: UserSummary[] }> =>
  adminFetch("/api/admin/users");

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

export const adminUpdateLimits = async (userId: string, limits: Partial<RateLimits>): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/limits`, {
    method: "PATCH",
    body: JSON.stringify(limits),
  });
};

export const adminAddTelegram = async (userId: string, botToken: string, chatId: string): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/telegram`, {
    method: "POST",
    body: JSON.stringify({ botToken, telegramChatId: chatId }),
  });
};

export const adminGetStatus = async (): Promise<AdminStatus> =>
  adminFetch("/api/admin/status");

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
