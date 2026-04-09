import { apiClient } from "./client";
import type { PortfolioResponse, VerdictsResponse } from "../types/api";
import type { CandlestickData, LineData } from "lightweight-charts";

export const fetchPortfolio = async (): Promise<PortfolioResponse> =>
 (await apiClient.get<PortfolioResponse>("/portfolio")).data;

export const fetchVerdicts = async (): Promise<VerdictsResponse> =>
 (await apiClient.get<VerdictsResponse>("/verdicts")).data;

export type PriceHistoryResponse = CandlestickData[] | LineData[];

export const fetchPositionHistory = async (
 ticker: string,
 timeframe: string
): Promise<PriceHistoryResponse> => {
 const { data } = await apiClient.get<PriceHistoryResponse>(
  `/history/${ticker}?timeframe=${timeframe}`
 );
 return data;
};

export const updatePosition = async (
 ticker: string,
 updates: { shares?: number; avgPriceILS?: number }
): Promise<void> => {
 await apiClient.patch(`/portfolio/position/${ticker}`, updates);
};
