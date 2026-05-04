import type { Language } from "../../store/preferencesStore";
import type { StrategyCatalyst, VerdictRow } from "../../types/api";
import { t, tInterpolate } from "../../store/i18n";

/**
 * Per-ticker 1-liner for the clear-state position list.
 *
 * Priority — first match wins:
 *   1. nearest catalyst < 14d   → "Earnings in {N}d" or "Catalyst in {N}d"
 *   2. lastDeepDiveAt > 22d ago → "Review due in {N}d"
 *   3. lastDeepDiveAt < 7d AND  → "Fresh review · catalyst {date}"
 *      future catalyst exists
 *   4. default                  → "Thesis on track"
 *
 * Phase 2: when `strategy.dailySnapshot` ships, the row uses
 *   `dailySnapshot ?? factoid(...)` — graceful fallback.
 */
export function factoid(verdict: VerdictRow, language: Language): string {
  const now = Date.now();

  const futureCatalysts = (verdict.catalysts ?? [])
    .filter((c) => c.expiresAt && !c.triggered && new Date(c.expiresAt).getTime() > now)
    .sort(byNearest);

  const nearest = futureCatalysts[0];

  // 1. Imminent catalyst
  if (nearest && nearest.expiresAt) {
    const days = daysUntil(nearest.expiresAt);
    if (days <= 14) {
      const isEarnings = /earning/i.test(nearest.description);
      const key = isEarnings ? "factoidEarningsInDays" : "factoidCatalystInDays";
      return tInterpolate(t(key, language), { days });
    }
  }

  // 2. Review overdue
  if (verdict.lastDeepDiveAt) {
    const daysSince = (now - new Date(verdict.lastDeepDiveAt).getTime()) / 86_400_000;
    if (daysSince > 22) {
      const dueIn = Math.max(1, Math.round(30 - daysSince));
      return tInterpolate(t("factoidReviewDue", language), { days: dueIn });
    }
  }

  // 3. Fresh review with future catalyst
  if (verdict.lastDeepDiveAt && nearest && nearest.expiresAt) {
    const daysSince = (now - new Date(verdict.lastDeepDiveAt).getTime()) / 86_400_000;
    if (daysSince < 7) {
      return tInterpolate(t("factoidFreshReview", language), {
        date: shortDate(nearest.expiresAt, language),
      });
    }
  }

  // 4. Default
  return t("factoidThesisOnTrack", language);
}

function byNearest(a: StrategyCatalyst, b: StrategyCatalyst): number {
  return new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime();
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function shortDate(iso: string, language: Language): string {
  const d = new Date(iso);
  return d.toLocaleDateString(language === "he" ? "he-IL" : "en-US", {
    month: "short",
    day: "numeric",
  });
}
