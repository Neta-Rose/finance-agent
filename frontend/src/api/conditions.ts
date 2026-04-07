import { apiClient } from "./client";
import type { ConditionReport } from "../types/api";

export const fetchConditionCheck = async (): Promise<ConditionReport> =>
 (await apiClient.get<ConditionReport>("/conditions/check")).data;

export const fetchPendingConditions = async () =>
 (await apiClient.get<{ pendingDeepDives: string[]; count: number }>("/conditions/pending")).data;
