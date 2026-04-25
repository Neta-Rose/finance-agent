import { apiClient } from "./client";

export interface UserPointsBalanceSnapshot {
  dailyBudgetPoints: number;
  pointsUsed: number;
  pointsRemaining: number;
  pctUsed: number;
  exhausted: boolean;
  windowStart: string;
  windowEnd: string;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundPoints(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function normalizeBalance(payload: unknown): UserPointsBalanceSnapshot {
  const raw = payload as Partial<UserPointsBalanceSnapshot> | null | undefined;
  const dailyBudgetPoints = Math.max(0, roundPoints(toFiniteNumber(raw?.dailyBudgetPoints, 0)));
  const pointsUsed = Math.max(0, roundPoints(toFiniteNumber(raw?.pointsUsed, 0)));
  const pointsRemaining = Math.max(
    0,
    roundPoints(toFiniteNumber(raw?.pointsRemaining, Math.max(0, dailyBudgetPoints - pointsUsed)))
  );
  return {
    dailyBudgetPoints,
    pointsUsed,
    pointsRemaining,
    pctUsed: Math.max(
      0,
      Math.min(999, Math.round(toFiniteNumber(raw?.pctUsed, dailyBudgetPoints > 0 ? (pointsUsed / dailyBudgetPoints) * 100 : 0)))
    ),
    exhausted: typeof raw?.exhausted === "boolean" ? raw.exhausted : pointsRemaining <= 0,
    windowStart: typeof raw?.windowStart === "string" ? raw.windowStart : "",
    windowEnd: typeof raw?.windowEnd === "string" ? raw.windowEnd : "",
  };
}

export const fetchBalance = async (): Promise<UserPointsBalanceSnapshot> =>
  normalizeBalance((await apiClient.get("/me/balance")).data);
