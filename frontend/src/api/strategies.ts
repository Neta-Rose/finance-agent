import { apiClient } from "./client";
import type { StrategiesResponse, StrategyRow } from "../types/api";

export const fetchStrategies = async (): Promise<StrategiesResponse> =>
 (await apiClient.get<StrategiesResponse>("/strategies")).data;

export const fetchStrategy = async (ticker: string): Promise<StrategyRow> =>
 (await apiClient.get<StrategyRow>(`/strategies/${ticker}`)).data;
