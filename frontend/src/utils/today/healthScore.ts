import type {
  HealthLabel,
  HealthScore,
  HealthScoreBreakdown,
  PositionRow,
  StrategyCatalyst,
  VerdictRow,
} from "../../types/api";

const W_FRESHNESS = 25;
const W_CATALYST = 25;
const W_EXIT = 20;
const W_CONFIDENCE = 15;
const W_DAYMOVE = 15;

/**
 * Default stop-loss threshold percent.
 * v1 fallback — Phase 2 will read per-user from /api/onboard/status,
 * and post-Phase 2 will read structured `exitLevel` from strategy.
 */
export const DEFAULT_STOP_LOSS_PCT = 25;

/**
 * Per-ticker health score 0..100 with breakdown.
 * Pure function. Null-safe on every input.
 *
 * Components (sum to 100):
 *   freshness  (25) — full credit if lastDeepDiveAt < 14d, decay to 0 by 60d, 0 if null
 *   catalyst   (25) — full credit if a future-dated non-triggered catalyst exists 14–90d out;
 *                     60% credit if 0–14d or >90d; 0 if none
 *   exit       (20) — full credit if plPct > -10%, linear decay to 0 at -stopLossPct
 *   confidence (15) — high=15, medium=9, low=3
 *   dayMove    (15) — full if |dayChangePct| < 3, decay to 0 at 8
 */
export function healthScore(
  verdict: VerdictRow,
  position: PositionRow | undefined,
  stopLossPct: number = DEFAULT_STOP_LOSS_PCT
): HealthScore {
  const freshness = scoreFreshness(verdict.lastDeepDiveAt);
  const catalyst = scoreCatalyst(verdict.catalysts ?? []);
  const exit = scoreExit(position?.plPct ?? 0, stopLossPct);
  const confidence = scoreConfidence(verdict.confidence);
  const dayMove = scoreDayMove(position?.dayChangePct ?? 0);

  const breakdown: HealthScoreBreakdown = { freshness, catalyst, exit, confidence, dayMove };
  const sum = freshness + catalyst + exit + confidence + dayMove;
  const score = Math.round(clamp(0, 100, sum));

  return { score, breakdown };
}

/**
 * Aggregate per-ticker scores into a portfolio health score, weighted by portfolio weight.
 * Falls back to equal-weight if all weights are zero (defensive).
 */
export function portfolioHealthScore(
  scores: Array<{ score: number; weightPct: number }>
): { score: number; label: HealthLabel } | null {
  if (scores.length === 0) return null;

  let weightSum = 0;
  let weighted = 0;
  for (const s of scores) {
    const w = Math.max(0, s.weightPct ?? 0);
    weightSum += w;
    weighted += s.score * w;
  }

  if (weightSum <= 0) {
    const avg = scores.reduce((a, b) => a + b.score, 0) / scores.length;
    const score = Math.round(avg);
    return { score, label: labelFromScore(score) };
  }

  const score = Math.round(weighted / weightSum);
  return { score, label: labelFromScore(score) };
}

export function labelFromScore(score: number): HealthLabel {
  // Aligned with scoreLevel() in scoreColor.ts — single source of truth for thresholds.
  // 65+ green/healthy, 45+ amber/steady, <45 red/watch.
  if (score >= 65) return "healthy";
  if (score >= 45) return "steady";
  return "watch";
}

// ----- component scorers -----

function scoreFreshness(lastDeepDiveAt: string | null): number {
  if (!lastDeepDiveAt) return 0;
  const days = (Date.now() - new Date(lastDeepDiveAt).getTime()) / 86_400_000;
  if (days < 0) return W_FRESHNESS; // future-dated → treat as fresh
  if (days <= 14) return W_FRESHNESS;
  if (days >= 60) return 0;
  // Linear decay 14 → 60 days
  return Math.round(W_FRESHNESS * (1 - (days - 14) / (60 - 14)));
}

function scoreCatalyst(catalysts: StrategyCatalyst[]): number {
  const now = Date.now();
  let bestDays: number | null = null;
  for (const c of catalysts) {
    if (!c.expiresAt) continue;
    if (c.triggered) continue;
    const days = (new Date(c.expiresAt).getTime() - now) / 86_400_000;
    if (days <= 0) continue; // expired catalysts handled by classifyAttention, not here
    if (bestDays === null || days < bestDays) bestDays = days;
  }
  if (bestDays === null) return 0;
  if (bestDays >= 14 && bestDays <= 90) return W_CATALYST;
  // Outside sweet spot → partial credit
  return Math.round(W_CATALYST * 0.6);
}

function scoreExit(plPct: number, stopLossPct: number): number {
  // plPct in percent (e.g., -8.5 means down 8.5%). stopLossPct is positive.
  if (plPct >= -10) return W_EXIT;
  const drawdown = Math.abs(plPct);
  const stop = Math.max(11, stopLossPct); // guard against stop <= 10 ambiguity
  if (drawdown >= stop) return 0;
  // Linear decay: -10% (full credit) → -stopLossPct (zero)
  const t = (drawdown - 10) / (stop - 10);
  return Math.round(W_EXIT * (1 - clamp(0, 1, t)));
}

function scoreConfidence(confidence: string | null | undefined): number {
  if (confidence === "high") return W_CONFIDENCE;                       // 15
  if (confidence === "medium") return Math.round(W_CONFIDENCE * 0.6);    // 9
  if (confidence === "low") return Math.round(W_CONFIDENCE * 0.2);       // 3
  return 0;
}

function scoreDayMove(dayChangePct: number): number {
  const m = Math.abs(dayChangePct ?? 0);
  if (m < 3) return W_DAYMOVE;
  if (m >= 8) return 0;
  return Math.round(W_DAYMOVE * (1 - (m - 3) / (8 - 3)));
}

// ----- helpers -----

function clamp(min: number, max: number, n: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
