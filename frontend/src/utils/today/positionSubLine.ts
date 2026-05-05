import type { VerdictRow } from "../../types/api";

/**
 * One-line position summary shown in the PositionRow sub-line slot.
 *
 * Priority:
 *  1. Triggered catalyst with short description (≤ 40 chars)
 *  2. Nearest upcoming catalyst  →  "catalyst Mon Day"
 *  3. Verdict default:
 *       HOLD        →  "thesis on track"
 *       REDUCE      →  "consider reducing"
 *       SELL/CLOSE  →  "exit signal"
 *       BUY/ADD     →  "buy signal"
 *  4. Bare weight fallback (no verdict)
 *
 * Always appends " · {weight}%" to the chosen text.
 * HOLD default is verdict-matched and will never appear on REDUCE/SELL/CLOSE positions.
 */
export function positionSubLine(verdict: VerdictRow | undefined, weightPct: number): string {
  const w = `${weightPct.toFixed(1)}%`;

  if (verdict?.catalysts?.length) {
    // 1. Triggered catalyst with a concise description
    const triggered = verdict.catalysts.find(
      (c) => c.triggered && c.description.length <= 40
    );
    if (triggered) {
      const text =
        triggered.description.length <= 35
          ? triggered.description
          : `${triggered.description.slice(0, 32)}…`;
      return `${text} · ${w}`;
    }

    // 2. Nearest future catalyst
    const now = Date.now();
    const upcoming = verdict.catalysts
      .filter((c) => !c.triggered && c.expiresAt && new Date(c.expiresAt).getTime() > now)
      .sort((a, b) => new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime())[0];
    if (upcoming) {
      const d = new Date(upcoming.expiresAt!);
      const month = d.toLocaleString("en", { month: "short" });
      return `catalyst ${month} ${d.getDate()} · ${w}`;
    }
  }

  // 3. Verdict default — strictly verdict-matched so HOLD text never appears on REDUCE etc.
  switch (verdict?.verdict) {
    case "HOLD":   return `thesis on track · ${w}`;
    case "REDUCE": return `consider reducing · ${w}`;
    case "SELL":
    case "CLOSE":  return `exit signal · ${w}`;
    case "BUY":
    case "ADD":    return `buy signal · ${w}`;
    default:       return `· ${w}`;
  }
}
