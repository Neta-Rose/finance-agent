/**
 * Score color decisions — single source of truth for the design pivot.
 * Every score in the app (portfolio, position, ticker chip) flows through here.
 * Never compute score color inline.
 *
 * Thresholds:
 *   65+ → green
 *   45+ → amber
 *   <45 → red
 */

export type ScoreLevel = "green" | "amber" | "red";

export function scoreLevel(score: number): ScoreLevel {
  if (score >= 65) return "green";
  if (score >= 45) return "amber";
  return "red";
}

export function scoreColor(score: number): string {
  return {
    green: "var(--color-green)",
    amber: "var(--color-amber)",
    red: "var(--color-red)",
  }[scoreLevel(score)];
}

export function scoreBg(score: number): string {
  return {
    green: "var(--color-green-bg)",
    amber: "var(--color-amber-bg)",
    red: "var(--color-red-bg)",
  }[scoreLevel(score)];
}

export function scoreBorder(score: number): string {
  return {
    green: "var(--color-green-border)",
    amber: "var(--color-amber-border)",
    red: "var(--color-red-border)",
  }[scoreLevel(score)];
}
