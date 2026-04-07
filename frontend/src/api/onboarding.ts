import { apiClient } from "./client";
import type { OnboardStatus } from "../types/api";

export const fetchOnboardStatus = async (): Promise<OnboardStatus> =>
 (await apiClient.get<OnboardStatus>("/onboard/status")).data;

export interface OnboardInitPayload {
 userId: string;
 password: string;
 displayName: string;
 telegramChatId: string;
 schedule: {
 dailyBriefTime: string;
 weeklyResearchDay: string;
 weeklyResearchTime: string;
 timezone: string;
 };
}

export const submitOnboardInit = async (
 payload: OnboardInitPayload,
 adminKey: string
): Promise<{ userId: string; created: boolean; nextStep: string }> =>
 (
 await apiClient.post("/onboard/init", payload, {
 headers: { "X-Admin-Key": adminKey },
 })
 ).data;

export interface PositionEntry {
 id: string;
 ticker: string;
 exchange: "NYSE" | "NASDAQ" | "TASE";
 shares: string;
 avgPrice: string;
 currency: "USD" | "ILA";
 account: "main" | "second";
}

export interface PortfolioPosition {
 ticker: string;
 exchange: string;
 shares: number;
 unitAvgBuyPrice: number;
 unitCurrency: "USD" | "ILA";
}

export const submitPortfolio = async (payload: {
 meta: { currency: string; transactionFeeILS: number; note: string };
 accounts: { main: PortfolioPosition[]; second?: PortfolioPosition[] };
}): Promise<{ state: string; jobId: string; message: string }> =>
 (await apiClient.post("/onboard/portfolio", payload)).data;
