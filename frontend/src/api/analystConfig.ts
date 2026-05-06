import { apiClient } from "./client";

export interface AnalystConfigEntry {
  stepKind: string;
  enabled: boolean;
  costPoints: number;
  toggleable: boolean;
}

export interface AnalystConfigResponse {
  config: AnalystConfigEntry[];
  toggleable: string[];
  costPoints: Record<string, number>;
}

export async function fetchAnalystConfig(): Promise<AnalystConfigResponse> {
  const res = await apiClient.get<AnalystConfigResponse>("/analyst-config");
  return res.data;
}

export async function patchAnalystConfig(stepKind: string, enabled: boolean): Promise<void> {
  await apiClient.patch(`/analyst-config/${encodeURIComponent(stepKind)}`, { enabled });
}
