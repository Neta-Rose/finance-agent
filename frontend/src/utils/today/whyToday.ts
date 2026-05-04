import type { AttentionItem } from "../../types/api";
import type { Language } from "../../store/preferencesStore";
import { t, tInterpolate } from "../../store/i18n";

/**
 * 1-line "why this fired today" — used in:
 *   - AttentionCard subtitle
 *   - StrategyModal pinned top strip
 *
 * Priority — matches AttentionItem.reason set by classifyAttention():
 *   1. catalyst_expired       → "{description} expired N days ago"
 *   2. verdict_sell|_close    → "SELL · {reasoningSnippet}" (or CLOSE)
 *   3. verdict_reduce         → "REDUCE · {reasoningSnippet}"
 *   4. (defensive)            → "Marked for attention"
 */
export function whyToday(item: AttentionItem, language: Language): string {
  if (item.reason === "catalyst_expired" && item.expiredCatalyst) {
    return tInterpolate(t("whyTodayCatalystExpired", language), {
      description: item.expiredCatalyst.description,
      days: item.expiredCatalyst.daysAgo,
    });
  }

  if (item.reason === "verdict_sell" || item.reason === "verdict_close") {
    return tInterpolate(t("whyTodaySellClose", language), {
      verdict: item.verdict,
      reasoning: item.reasoningSnippet,
    });
  }

  if (item.reason === "verdict_reduce") {
    return tInterpolate(t("whyTodayReduce", language), {
      reasoning: item.reasoningSnippet,
    });
  }

  return t("whyTodayMarkedForAttention", language);
}
