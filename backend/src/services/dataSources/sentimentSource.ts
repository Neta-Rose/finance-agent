import { searchExaCached } from "../exaService.js";
import { sentimentCache } from "./cache.js";

/**
 * Sentiment data source — Phase 4, task 4.5.
 *
 * Spec: design.md §6.1 dataSources/sentimentSource; I1.4.
 *
 * Fetches news and analyst-action snippets from Exa and classifies
 * per-item sentiment polarity deterministically where possible.
 * The LLM receives the structured list and produces only the
 * `sentimentView` prose and `narrativeShift` enum.
 */

export interface SentimentSnippet {
  headline: string;
  url: string;
  publishedDate: string | null;
  /** Deterministic polarity classification. */
  polarity: "positive" | "negative" | "neutral";
}

export interface SentimentFacts {
  snippets: SentimentSnippet[];
  /** Deterministic aggregate: majority polarity of snippets. */
  aggregatePolarity: "positive" | "negative" | "neutral";
}

// Simple keyword-based polarity classifier.
const POSITIVE_KEYWORDS = [
  "beat", "beats", "surge", "surges", "rally", "rallies", "upgrade", "upgrades",
  "outperform", "buy", "strong", "record", "growth", "profit", "gain", "gains",
  "raised", "raise", "positive", "bullish", "upside",
];
const NEGATIVE_KEYWORDS = [
  "miss", "misses", "plunge", "plunges", "downgrade", "downgrades", "underperform",
  "sell", "weak", "loss", "losses", "decline", "declines", "cut", "cuts",
  "lowered", "lower", "negative", "bearish", "downside", "warning", "risk",
];

function classifyPolarity(text: string): "positive" | "negative" | "neutral" {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of POSITIVE_KEYWORDS) {
    if (lower.includes(kw)) score += 1;
  }
  for (const kw of NEGATIVE_KEYWORDS) {
    if (lower.includes(kw)) score -= 1;
  }
  if (score > 0) return "positive";
  if (score < 0) return "negative";
  return "neutral";
}

function aggregatePolarity(
  snippets: SentimentSnippet[]
): "positive" | "negative" | "neutral" {
  if (snippets.length === 0) return "neutral";
  let pos = 0;
  let neg = 0;
  for (const s of snippets) {
    if (s.polarity === "positive") pos++;
    else if (s.polarity === "negative") neg++;
  }
  if (pos > neg) return "positive";
  if (neg > pos) return "negative";
  return "neutral";
}

export async function getSentimentFacts(ticker: string): Promise<SentimentFacts> {
  const cacheKey = `sentiment:${ticker}`;
  const cached = sentimentCache.get(cacheKey);
  if (cached) return cached as SentimentFacts;

  const query = `${ticker} stock news analyst upgrade downgrade earnings`;
  const results = await searchExaCached(query, 6);

  const snippets: SentimentSnippet[] = [];
  if (Array.isArray(results)) {
    for (const item of results) {
      if (!item || typeof item !== "object") continue;
      const r = item as unknown as Record<string, unknown>;
      const headline =
        typeof r["title"] === "string" ? r["title"] :
        typeof r["headline"] === "string" ? r["headline"] : "";
      const url = typeof r["url"] === "string" ? r["url"] : "";
      const publishedDate =
        typeof r["publishedDate"] === "string" ? r["publishedDate"] :
        typeof r["date"] === "string" ? r["date"] : null;
      if (!headline) continue;
      snippets.push({
        headline: headline.slice(0, 200),
        url,
        publishedDate,
        polarity: classifyPolarity(headline),
      });
    }
  }

  const facts: SentimentFacts = {
    snippets,
    aggregatePolarity: aggregatePolarity(snippets),
  };

  sentimentCache.set(cacheKey, facts);
  return facts;
}
