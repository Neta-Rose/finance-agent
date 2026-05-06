import { apiClient } from "./client";

export type VerdictDecision = "followed" | "dismissed" | "partial_acted";

export interface RecordVerdictActionInput {
  ticker: string;
  decision: VerdictDecision;
  note?: string;
}

export async function recordVerdictAction(input: RecordVerdictActionInput): Promise<{ verdictActionId: string }> {
  const res = await apiClient.post<{ verdictActionId: string }>("/verdict-actions", input);
  return res.data;
}

export interface CreateSnoozeInput {
  ticker: string;
  days?: number;
}

export async function createSnooze(input: CreateSnoozeInput): Promise<{ snoozeId: string; snoozeUntil: string }> {
  const res = await apiClient.post<{ snoozeId: string; snoozeUntil: string }>("/snoozes", input);
  return res.data;
}
