import { apiClient } from "./client";
import type { PortfolioResponse, VerdictsResponse } from "../types/api";

export const fetchPortfolio = async (): Promise<PortfolioResponse> =>
 (await apiClient.get<PortfolioResponse>("/portfolio")).data;

export const fetchVerdicts = async (): Promise<VerdictsResponse> =>
 (await apiClient.get<VerdictsResponse>("/verdicts")).data;
