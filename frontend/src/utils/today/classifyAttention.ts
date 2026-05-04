import type { AttentionItem, AttentionReason, StrategyCatalyst, VerdictRow } from "../../types/api";

/**
 * Classify which tickers need user attention TODAY.
 *
 * Pure function. v1 logic — verdict-driven only:
 *   1. Has expired (non-triggered) catalyst → catalyst_expired
 *   2. Verdict CLOSE → verdict_close
 *   3. Verdict SELL  → verdict_sell
 *   4. Verdict REDUCE → verdict_reduce
 *
 * Sorted by priority above (catalyst_expired first), then by ticker.
 *
 * Phase 2: this function will be replaced by `await fetchAttention()` once a
 * backend evaluator service ships. The returned shape stays identical.
 */

const REASON_PRIORITY: Record<AttentionReason, number> = {
  catalyst_expired: 0,
  verdict_close: 1,
  verdict_sell: 2,
  verdict_reduce: 3,
};

export function classifyAttention(verdicts: VerdictRow[]): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const v of verdicts) {
    const expired = findExpiredCatalyst(v.catalysts ?? []);

    if (expired) {
      items.push({
        ticker: v.ticker,
        verdict: v.verdict,
        reason: "catalyst_expired",
        reasoningSnippet: snippet(v.reasoning),
        expiredCatalyst: {
          description: expired.description,
          daysAgo: daysAgo(expired.expiresAt!),
        },
      });
      continue;
    }

    let reason: AttentionReason | null = null;
    if (v.verdict === "CLOSE") reason = "verdict_close";
    else if (v.verdict === "SELL") reason = "verdict_sell";
    else if (v.verdict === "REDUCE") reason = "verdict_reduce";

    if (reason) {
      items.push({
        ticker: v.ticker,
        verdict: v.verdict,
        reason,
        reasoningSnippet: snippet(v.reasoning),
        expiredCatalyst: null,
      });
    }
  }

  return items.sort((a, b) => {
    const cmp = REASON_PRIORITY[a.reason] - REASON_PRIORITY[b.reason];
    return cmp !== 0 ? cmp : a.ticker.localeCompare(b.ticker);
  });
}

function findExpiredCatalyst(catalysts: StrategyCatalyst[]): StrategyCatalyst | null {
  const now = Date.now();
  for (const c of catalysts) {
    if (!c.expiresAt) continue;
    if (c.triggered) continue;
    if (new Date(c.expiresAt).getTime() < now) return c;
  }
  return null;
}

function daysAgo(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * First-sentence snippet of reasoning, truncated at last word boundary.
 * Used by classifyAttention (AttentionCard subtitle) and whyToday (StrategyModal pinned strip).
 */
export function snippet(reasoning: string | null | undefined, max = 80): string {
  if (!reasoning) return "";
  const trimmed = reasoning.trim();
  if (!trimmed) return "";
  const firstSentence = trimmed.split(/(?<=[.!?])\s+/)[0] ?? trimmed;
  if (firstSentence.length <= max) return firstSentence;
  const cut = firstSentence.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut) + "…";
}
