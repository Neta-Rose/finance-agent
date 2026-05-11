/**
 * Advisory readability utilities — M001/S06.
 *
 * Converts raw verdict/confidence/catalyst/score data into plain readable
 * language for use in the StrategyModal, Reports feed, and chat surfaces.
 *
 * Rules:
 * - Never invent data. Return null/empty when fields are missing.
 * - Preserve the product language: "report" = analysis event, "strategy" = long-lived thesis.
 * - Keep copy neutral and nameless in user-visible strings.
 */

import type { Verdict } from "../types/api";

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/** Short imperative sentence for a verdict. */
export function verdictSentence(verdict: Verdict): string {
  switch (verdict) {
    case "BUY":    return "Consider adding or initiating a position.";
    case "ADD":    return "Add to your existing position.";
    case "HOLD":   return "Hold steady — no action needed now.";
    case "REDUCE": return "Trim the position to reduce exposure.";
    case "SELL":   return "Reduce or exit the position.";
    case "CLOSE":  return "Close out the position.";
    default:       return "Review the strategy for guidance.";
  }
}

/** Emoji signal for a verdict — used in compact list views. */
export function verdictSignal(verdict: Verdict): string {
  switch (verdict) {
    case "BUY":
    case "ADD":    return "✅";
    case "HOLD":   return "⏸";
    case "REDUCE": return "⚠️";
    case "SELL":
    case "CLOSE":  return "🔴";
    default:       return "•";
  }
}

/** Whether a verdict is actionable (not a passive hold). */
export function isActionableVerdict(verdict: Verdict): boolean {
  return verdict !== "HOLD";
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/** Plain-language explanation of what a confidence level means. */
export function confidenceExplanation(confidence: string): string {
  switch (confidence?.toLowerCase()) {
    case "high":   return "High confidence — strong data supports this view.";
    case "medium": return "Medium confidence — the picture is reasonably clear but some uncertainty remains.";
    case "low":    return "Low confidence — limited data; treat this as a preliminary signal.";
    default:       return "Confidence level not available.";
  }
}

/** Short label for confidence. */
export function confidenceLabel(confidence: string): string {
  switch (confidence?.toLowerCase()) {
    case "high":   return "High";
    case "medium": return "Medium";
    case "low":    return "Low";
    default:       return "—";
  }
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

/** Plain-language bucket for a numeric score (0–100). */
export function scoreBucket(score: number): "strong" | "watch" | "attention" | "unknown" {
  if (!Number.isFinite(score)) return "unknown";
  if (score >= 70) return "strong";
  if (score >= 40) return "watch";
  return "attention";
}

/** Readable label for a score bucket. */
export function scoreBucketLabel(score: number): string {
  switch (scoreBucket(score)) {
    case "strong":    return "Strong";
    case "watch":     return "Watch";
    case "attention": return "Needs attention";
    default:          return "—";
  }
}

/** Emoji for a score bucket — used in compact views. */
export function scoreBucketEmoji(score: number): string {
  switch (scoreBucket(score)) {
    case "strong":    return "✅";
    case "watch":     return "⚠️";
    case "attention": return "🔴";
    default:          return "•";
  }
}

/** One-sentence explanation of what the score means. */
export function scoreExplanation(score: number): string {
  if (!Number.isFinite(score)) return "No score available yet.";
  const bucket = scoreBucket(score);
  if (bucket === "strong")    return `Score ${score} — this position looks strong based on current analysis.`;
  if (bucket === "watch")     return `Score ${score} — worth watching; some signals warrant attention.`;
  return `Score ${score} — this position needs attention based on current signals.`;
}

// ---------------------------------------------------------------------------
// Catalysts
// ---------------------------------------------------------------------------

interface CatalystLike {
  description: string;
  expiresAt?: string | null;
  triggered?: boolean;
}

/** Format a catalyst for display: description + optional expiry. */
export function formatCatalyst(catalyst: CatalystLike): string {
  const desc = catalyst.description?.trim() ?? "";
  if (!desc) return "";
  if (catalyst.triggered) return `${desc} (triggered)`;
  if (!catalyst.expiresAt) return desc;
  const exp = new Date(catalyst.expiresAt);
  if (Number.isNaN(exp.getTime())) return desc;
  const now = Date.now();
  const daysUntil = Math.ceil((exp.getTime() - now) / (1000 * 60 * 60 * 24));
  if (daysUntil < 0) return `${desc} (expired)`;
  if (daysUntil === 0) return `${desc} (today)`;
  if (daysUntil === 1) return `${desc} (tomorrow)`;
  return `${desc} (in ${daysUntil}d)`;
}

/** Return the most urgent upcoming catalyst from a list, or null. */
export function nextCatalyst(catalysts: CatalystLike[]): CatalystLike | null {
  const upcoming = catalysts
    .filter((c) => !c.triggered && c.expiresAt)
    .sort((a, b) => {
      const ta = new Date(a.expiresAt!).getTime();
      const tb = new Date(b.expiresAt!).getTime();
      return ta - tb;
    });
  return upcoming[0] ?? null;
}

// ---------------------------------------------------------------------------
// Reasoning snippet
// ---------------------------------------------------------------------------

/**
 * Extract a readable snippet from strategy reasoning.
 * Returns the first 1–2 sentences, capped at maxChars.
 */
export function reasoningSnippet(reasoning: string | null | undefined, maxChars = 200): string {
  if (!reasoning?.trim()) return "";
  const trimmed = reasoning.trim();
  // Split on sentence boundaries
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  let result = "";
  for (const sentence of sentences) {
    const candidate = result ? `${result} ${sentence}` : sentence;
    if (candidate.length > maxChars) break;
    result = candidate;
    if (result.length >= maxChars * 0.6) break; // stop after first substantial sentence
  }
  if (!result) result = trimmed.slice(0, maxChars);
  if (result.length < trimmed.length && !result.match(/[.!?]$/)) result += "…";
  return result;
}

// ---------------------------------------------------------------------------
// Full advisory summary
// ---------------------------------------------------------------------------

interface AdvisorySummaryInput {
  ticker: string;
  verdict: Verdict;
  confidence: string;
  reasoning?: string | null;
  catalysts?: CatalystLike[];
  score?: number;
}

/**
 * Build a structured plain-text advisory summary for a position.
 * Used in chat explanations and notification bodies.
 *
 * Format:
 *   {ticker}: {verdict sentence}
 *   Confidence: {label} — {explanation}
 *   {reasoning snippet}
 *   Next catalyst: {catalyst} (if any)
 */
export function buildAdvisorySummary(input: AdvisorySummaryInput): string {
  const lines: string[] = [];

  lines.push(`${input.ticker}: ${verdictSentence(input.verdict)}`);

  lines.push(`Confidence: ${confidenceLabel(input.confidence)} — ${confidenceExplanation(input.confidence)}`);

  const snippet = reasoningSnippet(input.reasoning, 240);
  if (snippet) lines.push(snippet);

  if (input.catalysts && input.catalysts.length > 0) {
    const next = nextCatalyst(input.catalysts);
    if (next) lines.push(`Next catalyst: ${formatCatalyst(next)}`);
  }

  if (input.score !== undefined && Number.isFinite(input.score)) {
    lines.push(scoreExplanation(input.score));
  }

  return lines.join("\n");
}
