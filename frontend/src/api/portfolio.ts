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
 updates: { shares?: number; avgPriceILS?: number; account?: string }
): Promise<void> => {
 await apiClient.patch(`/portfolio/position/${ticker}`, updates);
};

export interface AddPositionPayload {
  ticker: string;
  exchange: string;
  shares: number;
  unitAvgBuyPrice: number;
  unitCurrency: "USD" | "ILA" | "GBP" | "EUR";
  account: string;
  force: boolean;
}

export const addPosition = async (payload: AddPositionPayload): Promise<void> => {
  await apiClient.post("/portfolio/position", payload);
};

export const deletePosition = async (ticker: string, account: string): Promise<void> => {
  await apiClient.delete(`/portfolio/position/${ticker}`, { params: { account } });
};

export const addAccount = async (name: string): Promise<void> => {
  await apiClient.post("/portfolio/accounts", { name });
};

export const deleteAccount = async (name: string): Promise<void> => {
  await apiClient.delete(`/portfolio/accounts/${encodeURIComponent(name)}`);
};
