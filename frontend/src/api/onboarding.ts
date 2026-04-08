import { apiClient } from "./client";
import type { OnboardStatus, PortfolioResponse } from "../types/api";

export const fetchOnboardStatus = async (): Promise<OnboardStatus> =>
 (await apiClient.get<OnboardStatus>("/onboard/status")).data;

export const fetchPortfolio = async (): Promise<PortfolioResponse> =>
 (await apiClient.get<PortfolioResponse>("/portfolio")).data;

export const checkNeedsOnboarding = async (): Promise<boolean> => {
  try {
    const status = await fetchOnboardStatus();
    return !status.portfolioLoaded;
  } catch {
    return false; // fail open
  }
};

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
  exchange: "NYSE" | "NASDAQ" | "TASE" | "LSE" | "XETRA" | "EURONEXT" | "OTHER";
  shares: string;
  avgPrice: string;
  currency: "USD" | "ILA" | "GBP" | "EUR";
  account: string; // account name, e.g. "Main", "IBI"
}

export interface PortfolioPosition {
  ticker: string;
  exchange: string;
  shares: number;
  unitAvgBuyPrice: number;
  unitCurrency: "USD" | "ILA" | "GBP" | "EUR";
}

export const submitPortfolio = async (payload: {
  meta: { currency: string; transactionFeeILS: number; note: string };
  accounts: Record<string, PortfolioPosition[]>;
  schedule?: {
    dailyBriefTime: string;
    weeklyResearchDay: string;
    weeklyResearchTime: string;
    timezone: string;
  };
}): Promise<{ state: string; jobId: string; message: string }> =>
  (await apiClient.post("/onboard/portfolio", payload)).data;
