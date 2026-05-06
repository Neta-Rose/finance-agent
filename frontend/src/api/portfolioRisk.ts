import { apiClient } from "./client";

export interface ConcentrationEntry {
  key: string;
  pct: number;
}

export interface PortfolioRiskSnapshot {
  id: string;
  userId: string;
  snapshotAt: string;
  totalValueIls: number;
  concentrationBySingleNamePct: ConcentrationEntry[];
  concentrationBySectorPct: ConcentrationEntry[];
  concentrationByCurrencyPct: ConcentrationEntry[];
  concentrationByAssetClassPct: ConcentrationEntry[];
  largestSinglePositionTicker: string | null;
  largestSinglePositionPct: number | null;
}

export async function fetchPortfolioRiskSnapshot(): Promise<PortfolioRiskSnapshot | null> {
  try {
    const res = await apiClient.get<{ snapshot: PortfolioRiskSnapshot | null }>("/portfolio/risk");
    return res.data.snapshot;
  } catch {
    return null;
  }
}
