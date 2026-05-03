# Today Screen Pilot v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retrofit `frontend/src/pages/Portfolio.tsx` into a calm, answer-first "Today" screen — three states (Setup / Clear / Attention), 5-component health score per ticker, StrategyModal reorder for drill-down, before 2 pilot users arrive on 2026-05-04.

**Architecture:** Frontend-only. Four pure utility functions (`classifyAttention`, `healthScore`, `factoid`, `whyToday`) + four new components (`SetupBanner`, `HealthHero`, `AttentionBlock`, `AttentionCard`). Existing endpoints (`/api/portfolio`, `/api/verdicts`, `/api/onboard/status`, `/api/jobs`) — no backend changes. `StrategyModal` reordered in place. `PositionRow` extended with score chip + factoid. `Portfolio.tsx` top restructured.

**Tech Stack:** React 19.2, Vite 8.0, Tailwind v4 (CSS-var driven), Zustand, React Query, lucide-react, TypeScript 5.7. **No frontend test framework installed** — verification via `npx tsc --noEmit` and `npm run build`, then manual smoke-test on dev server.

**Working tree:** Direct on `main` (no worktree) given the 8-hour deadline. Each task commits independently; any single task is `git revert`-able.

**Spec:** `docs/superpowers/specs/2026-05-03-today-screen-pilot-v1-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/types/api.ts` | Modify | Add `AttentionItem`, `AttentionReason`, `HealthScore`, `HealthScoreBreakdown`, `HealthLabel` types |
| `frontend/src/store/i18n.ts` | Modify | Add ~16 new keys (en + he) |
| `frontend/src/utils/today/classifyAttention.ts` | Create | Pure: `(verdicts) → AttentionItem[]` |
| `frontend/src/utils/today/healthScore.ts` | Create | Pure: `(verdict, position, stopLossPct) → HealthScore` |
| `frontend/src/utils/today/factoid.ts` | Create | Pure: `(verdict, position, language) → string` |
| `frontend/src/utils/today/whyToday.ts` | Create | Pure: `(item, language) → string` |
| `frontend/src/components/today/SetupBanner.tsx` | Create | BOOTSTRAPPING-state banner with progress |
| `frontend/src/components/today/HealthHero.tsx` | Create | Clear-state portfolio score + label |
| `frontend/src/components/today/AttentionCard.tsx` | Create | One ticker — verdict, why-today, tap → StrategyModal |
| `frontend/src/components/today/AttentionBlock.tsx` | Create | Heading + AttentionCard list |
| `frontend/src/components/portfolio/PositionRow.tsx` | Modify | Add score chip + factoid line |
| `frontend/src/components/portfolio/StrategyModal.tsx` | Modify | Render reorder + "Why this fired today" pinned strip |
| `frontend/src/pages/Portfolio.tsx` | Modify | Wire state block; build unified positions list above account cards (default collapsed); suppress active-jobs banner during BOOTSTRAPPING |

---

## Time Budget

| Slot | Tasks | Hours |
|---|---|---|
| **Evening** | 1–11 | ~5.0 |
| **Morning** | 12–15 | ~2.5–3.0 |
| **Total** | | ~7.5–8.0 |

Each task ends with a passing `npx tsc --noEmit` and a commit. Build is never broken between tasks.

---

## Constants reused across tasks

```ts
// Health score component max weights (sum = 100)
const W_FRESHNESS = 25;
const W_CATALYST  = 25;
const W_EXIT      = 20;
const W_CONFIDENCE = 15;
const W_DAYMOVE   = 15;

// Default stop-loss threshold (v1 fallback — replaced in Phase 2 by per-user from onboard/status)
const DEFAULT_STOP_LOSS_PCT = 25;
```

These appear verbatim in Task 4. No magic numbers elsewhere.

---

## Task 1 — Add types to `api.ts`

**Files:**
- Modify: `frontend/src/types/api.ts` (append to end)

- [ ] **Step 1: Append new types**

Open `frontend/src/types/api.ts` and append at the end of the file:

```ts
// ============================================================
// Today screen — pilot v1
// ============================================================

export type AttentionReason =
  | "catalyst_expired"
  | "verdict_close"
  | "verdict_sell"
  | "verdict_reduce";

export interface ExpiredCatalystInfo {
  description: string;
  daysAgo: number;
}

export interface AttentionItem {
  ticker: string;
  verdict: Verdict;
  reason: AttentionReason;
  reasoningSnippet: string;
  expiredCatalyst: ExpiredCatalystInfo | null;
}

export interface HealthScoreBreakdown {
  freshness: number;   // 0..25
  catalyst: number;    // 0..25
  exit: number;        // 0..20
  confidence: number;  // 0..15
  dayMove: number;     // 0..15
}

export interface HealthScore {
  score: number; // 0..100, integer
  breakdown: HealthScoreBreakdown;
}

export type HealthLabel = "healthy" | "steady" | "watch";

export interface FactoidContext {
  // Optional future field — once strategy.dailySnapshot ships in Phase 2, the row
  // uses dailySnapshot ?? deterministicFactoid.
  dailySnapshot?: string | null;
}
```

- [ ] **Step 2: Type-check**

```bash
cd /root/clawd/frontend && npx tsc --noEmit
```
Expected: `0 errors`.

- [ ] **Step 3: Commit**

```bash
cd /root/clawd && git add frontend/src/types/api.ts
git commit -m "feat(today/types): add AttentionItem, HealthScore, HealthLabel types"
```

---

## Task 2 — Add i18n keys

**Files:**
- Modify: `frontend/src/store/i18n.ts`

- [ ] **Step 1: Add to TranslationKey union**

In `frontend/src/store/i18n.ts`, locate the `TranslationKey` union type and append new key names. Keep alphabetical or grouped — match the file's existing convention.

```ts
| "setupBannerTitle"
| "setupBannerBodyChannelAgnostic"
| "setupBannerBodyTelegram"
| "setupBannerProgress"
| "setupBannerInProgress"
| "healthLabelHealthy"
| "healthLabelSteady"
| "healthLabelWatch"
| "healthHeroSummary"
| "attentionHeader"
| "attentionClearSuffix"
| "factoidEarningsInDays"
| "factoidCatalystInDays"
| "factoidReviewDue"
| "factoidFreshReview"
| "factoidThesisOnTrack"
| "whyTodayCatalystExpired"
| "whyTodaySellClose"
| "whyTodayReduce"
| "whyTodayMarkedForAttention"
| "scoreChipLabel"
| "noClearPositions"
```

- [ ] **Step 2: Add English values**

In the `translations.en` block, add (preserve existing alphabetical/grouped order if the file uses one):

```ts
setupBannerTitle: "Preparing your portfolio",
setupBannerBodyChannelAgnostic: "We'll notify you when ready.",
setupBannerBodyTelegram: "We'll notify you on Telegram when ready.",
setupBannerProgress: "Analyzed {analyzed} of {total} positions",
setupBannerInProgress: "{tickers} in progress",
healthLabelHealthy: "Healthy",
healthLabelSteady: "Steady",
healthLabelWatch: "Watch",
healthHeroSummary: "{clear} of {total} clear · reviewed {timeAgo}",
attentionHeader: "{count} need attention",
attentionClearSuffix: "{count} clear",
factoidEarningsInDays: "Earnings in {days}d",
factoidCatalystInDays: "Catalyst in {days}d",
factoidReviewDue: "Review due in {days}d",
factoidFreshReview: "Fresh review · catalyst {date}",
factoidThesisOnTrack: "Thesis on track",
whyTodayCatalystExpired: "{description} expired {days} days ago",
whyTodaySellClose: "{verdict} · {reasoning}",
whyTodayReduce: "REDUCE · {reasoning}",
whyTodayMarkedForAttention: "Marked for attention",
scoreChipLabel: "Score",
noClearPositions: "All positions are in attention.",
```

- [ ] **Step 3: Add Hebrew values**

In the `translations.he` block, add:

```ts
setupBannerTitle: "מכין את התיק שלך",
setupBannerBodyChannelAgnostic: "נעדכן אותך כשהפעולה תסתיים.",
setupBannerBodyTelegram: "נעדכן אותך בטלגרם כשהפעולה תסתיים.",
setupBannerProgress: "נותחו {analyzed} מתוך {total} פוזיציות",
setupBannerInProgress: "{tickers} בתהליך",
healthLabelHealthy: "בריא",
healthLabelSteady: "יציב",
healthLabelWatch: "מעקב",
healthHeroSummary: "{clear} מתוך {total} תקין · נבדק {timeAgo}",
attentionHeader: "{count} דורשות תשומת לב",
attentionClearSuffix: "{count} תקינות",
factoidEarningsInDays: "דוחות בעוד {days} ימים",
factoidCatalystInDays: "קטליזטור בעוד {days} ימים",
factoidReviewDue: "סקירה בעוד {days} ימים",
factoidFreshReview: "סקירה עדכנית · קטליזטור {date}",
factoidThesisOnTrack: "התזה על המסלול",
whyTodayCatalystExpired: "{description} פג לפני {days} ימים",
whyTodaySellClose: "{verdict} · {reasoning}",
whyTodayReduce: "צמצם · {reasoning}",
whyTodayMarkedForAttention: "סומן לתשומת לב",
scoreChipLabel: "ציון",
noClearPositions: "כל הפוזיציות דורשות תשומת לב.",
```

- [ ] **Step 4: Add a small `tInterpolate` helper at the bottom of `i18n.ts`**

Existing `t(key, language)` returns the raw template. Add a helper next to it for `{name}`-style substitution:

```ts
export function tInterpolate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? `{${name}}` : String(v);
  });
}
```

- [ ] **Step 5: Type-check**

```bash
cd /root/clawd/frontend && npx tsc --noEmit
```
Expected: `0 errors`.

- [ ] **Step 6: Commit**

```bash
cd /root/clawd && git add frontend/src/store/i18n.ts
git commit -m "feat(today/i18n): add Today-screen keys (en + he) + tInterpolate helper"
```

---

## Task 3 — `classifyAttention.ts`

**Files:**
- Create: `frontend/src/utils/today/classifyAttention.ts`

- [ ] **Step 1: Create the file**

```ts
// frontend/src/utils/today/classifyAttention.ts
import type { AttentionItem, AttentionReason, VerdictRow, StrategyCatalyst } from "../../types/api";

/**
 * Classify which tickers need user attention TODAY.
 * Pure function. Mirrors the shape a future backend /api/attention endpoint would return,
 * so the swap is one line later.
 *
 * v1 rules — verdict-driven only:
 *   1. Has expired (non-triggered) catalyst → catalyst_expired
 *   2. Verdict CLOSE → verdict_close
 *   3. Verdict SELL → verdict_sell
 *   4. Verdict REDUCE → verdict_reduce
 *
 * Sorted by priority above (catalyst_expired first).
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
 * First-sentence snippet, truncated at last word boundary, max 80 chars.
 * Used by both classifyAttention (for AttentionCard) and whyToday (for StrategyModal pinned strip).
 */
export function snippet(reasoning: string | null | undefined, max = 80): string {
  if (!reasoning) return "";
  const trimmed = reasoning.trim();
  const firstSentence = trimmed.split(/(?<=[.!?])\s+/)[0] ?? trimmed;
  if (firstSentence.length <= max) return firstSentence;
  const cut = firstSentence.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut) + "…";
}
```

- [ ] **Step 2: Type-check**

```bash
cd /root/clawd/frontend && npx tsc --noEmit
```
Expected: `0 errors`.

- [ ] **Step 3: Commit**

```bash
cd /root/clawd && git add frontend/src/utils/today/classifyAttention.ts
git commit -m "feat(today/utils): add classifyAttention + reasoning snippet helper"
```

---

## Task 4 — `healthScore.ts`

**Files:**
- Create: `frontend/src/utils/today/healthScore.ts`

- [ ] **Step 1: Create the file**

```ts
// frontend/src/utils/today/healthScore.ts
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

export const DEFAULT_STOP_LOSS_PCT = 25;

/**
 * Per-ticker health score 0..100 + breakdown.
 * Pure. Null-safe on every input.
 *
 * Components:
 *   freshness (25)  — full credit if lastDeepDiveAt < 14d, decay to 0 by 60d, 0 if null
 *   catalyst  (25)  — full credit if a future-dated non-triggered catalyst exists 14–90d out;
 *                     15 if 0–14d or >90d; 0 if none
 *   exit      (20)  — full credit if plPct > -10%, linear decay to 0 at -stopLossPct
 *   confidence(15)  — high=15, medium=9, low=3
 *   dayMove   (15)  — full if |dayChangePct| < 3, decay to 0 at 8
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
  // Fall back to equal-weight if all weights zero (defensive — shouldn't happen).
  if (weightSum <= 0) {
    const avg = scores.reduce((a, b) => a + b.score, 0) / scores.length;
    return { score: Math.round(avg), label: labelFromScore(Math.round(avg)) };
  }
  const score = Math.round(weighted / weightSum);
  return { score, label: labelFromScore(score) };
}

export function labelFromScore(score: number): HealthLabel {
  if (score >= 85) return "healthy";
  if (score >= 70) return "steady";
  return "watch";
}

// ----- component scorers -----

function scoreFreshness(lastDeepDiveAt: string | null): number {
  if (!lastDeepDiveAt) return 0;
  const days = (Date.now() - new Date(lastDeepDiveAt).getTime()) / 86_400_000;
  if (days < 0) return W_FRESHNESS; // future-dated → treat as fresh
  if (days <= 14) return W_FRESHNESS;
  if (days >= 60) return 0;
  // linear decay 14 → 60 days
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
  // plPct stored as percent (e.g., -8.5 means down 8.5%). stopLossPct is a positive number.
  if (plPct >= -10) return W_EXIT;
  const drawdown = Math.abs(plPct);
  const stop = Math.max(11, stopLossPct); // guard against stop <= 10 ambiguity
  if (drawdown >= stop) return 0;
  // linear decay: -10% (full) → -stopLossPct (zero)
  const t = (drawdown - 10) / (stop - 10);
  return Math.round(W_EXIT * (1 - clamp(0, 1, t)));
}

function scoreConfidence(confidence: string | null | undefined): number {
  if (confidence === "high") return W_CONFIDENCE;          // 15
  if (confidence === "medium") return Math.round(W_CONFIDENCE * 0.6); // 9
  if (confidence === "low") return Math.round(W_CONFIDENCE * 0.2);    // 3
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
```

- [ ] **Step 2: Type-check**

```bash
cd /root/clawd/frontend && npx tsc --noEmit
```
Expected: `0 errors`.

- [ ] **Step 3: Commit**

```bash
cd /root/clawd && git add frontend/src/utils/today/healthScore.ts
git commit -m "feat(today/utils): add healthScore + portfolioHealthScore + label helpers"
```

---

## Task 5 — `factoid.ts`

**Files:**
- Create: `frontend/src/utils/today/factoid.ts`

- [ ] **Step 1: Create the file**

```ts
// frontend/src/utils/today/factoid.ts
import type { Language } from "../../store/i18n";
import type { StrategyCatalyst, VerdictRow } from "../../types/api";
import { t, tInterpolate } from "../../store/i18n";

/**
 * Per-ticker 1-liner for the clear-state position list.
 * Priority — first match wins:
 *   1. nearest catalyst < 14d   → "Earnings in Nd" or "Catalyst in Nd"
 *   2. lastDeepDiveAt > 22d ago → "Review due in Nd"
 *   3. lastDeepDiveAt < 7d AND  → "Fresh review · catalyst {date}"
 *      future catalyst exists
 *   4. default                  → "Thesis on track"
 *
 * Future: when strategy.dailySnapshot ships in Phase 2, the row uses
 * `dailySnapshot ?? factoid(...)` — graceful fallback.
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
      return tInterpolate(t("factoidFreshReview", language), { date: shortDate(nearest.expiresAt, language) });
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
  return d.toLocaleDateString(language === "he" ? "he-IL" : "en-US", { month: "short", day: "numeric" });
}
```

- [ ] **Step 2: Type-check**

```bash
cd /root/clawd/frontend && npx tsc --noEmit
```
Expected: `0 errors`.

- [ ] **Step 3: Commit**

```bash
cd /root/clawd && git add frontend/src/utils/today/factoid.ts
git commit -m "feat(today/utils): add factoid 1-liner generator (priority-ordered)"
```

---

## Task 6 — `whyToday.ts`

**Files:**
- Create: `frontend/src/utils/today/whyToday.ts`

- [ ] **Step 1: Create the file**

```ts
// frontend/src/utils/today/whyToday.ts
import type { AttentionItem } from "../../types/api";
import type { Language } from "../../store/i18n";
import { t, tInterpolate } from "../../store/i18n";

/**
 * 1-line "why this fired today" used in:
 *   - AttentionCard subtitle
 *   - StrategyModal pinned top strip
 *
 * Priority — matches AttentionItem.reason which is set in classifyAttention():
 *   1. catalyst_expired       → "{description} expired N days ago"
 *   2. verdict_sell|_close    → "SELL · {reasoningSnippet}"  (or CLOSE)
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
```

- [ ] **Step 2: Type-check**

```bash
cd /root/clawd/frontend && npx tsc --noEmit
```
Expected: `0 errors`.

- [ ] **Step 3: Commit**

```bash
cd /root/clawd && git add frontend/src/utils/today/whyToday.ts
git commit -m "feat(today/utils): add whyToday() 1-liner for attention drill-down"
```

---

## Task 7 — `SetupBanner.tsx`

**Files:**
- Create: `frontend/src/components/today/SetupBanner.tsx`

- [ ] **Step 1: Create the file**

```tsx
// frontend/src/components/today/SetupBanner.tsx
import { Loader2 } from "lucide-react";
import { t, tInterpolate } from "../../store/i18n";
import { usePreferencesStore } from "../../store/preferencesStore";

interface SetupBannerProps {
  analyzed: number;
  total: number;
  inProgressTickers: string[];
  telegramConnected: boolean;
}

export function SetupBanner({ analyzed, total, inProgressTickers, telegramConnected }: SetupBannerProps) {
  const language = usePreferencesStore((s) => s.language);

  const bodyTemplate = telegramConnected
    ? t("setupBannerBodyTelegram", language)
    : t("setupBannerBodyChannelAgnostic", language);

  const progress = tInterpolate(t("setupBannerProgress", language), { analyzed, total });

  const inProgress = inProgressTickers.length > 0
    ? tInterpolate(t("setupBannerInProgress", language), {
        tickers: inProgressTickers.slice(0, 3).join(", "),
      })
    : null;

  return (
    <div className="mx-4 mt-3 mb-1 px-4 py-3 rounded-xl border border-[var(--color-accent-blue)]/30 bg-[color-mix(in_srgb,var(--color-accent-blue)_8%,transparent)]">
      <div className="flex items-center gap-2 mb-1">
        <Loader2 size={16} className="animate-spin text-[var(--color-accent-blue)] shrink-0" />
        <h2 className="text-sm font-bold text-[var(--color-fg-default)]">
          {t("setupBannerTitle", language)}
        </h2>
      </div>
      <p className="text-xs text-[var(--color-fg-muted)] mb-1">{bodyTemplate}</p>
      <p className="text-[11px] text-[var(--color-fg-subtle)] tabular-nums">
        {progress}
        {inProgress ? <> · {inProgress}</> : null}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /root/clawd/frontend && npx tsc --noEmit
```
Expected: `0 errors`.

- [ ] **Step 3: Commit**

```bash
cd /root/clawd && git add frontend/src/components/today/SetupBanner.tsx
git commit -m "feat(today): add SetupBanner — Day-1 progress with channel-aware copy"
```

---

## Task 8 — `HealthHero.tsx`

**Files:**
- Create: `frontend/src/components/today/HealthHero.tsx`

- [ ] **Step 1: Create the file**

```tsx
// frontend/src/components/today/HealthHero.tsx
import { Activity } from "lucide-react";
import { t, tInterpolate } from "../../store/i18n";
import { usePreferencesStore } from "../../store/preferencesStore";
import { timeAgo } from "../../utils/format";
import type { HealthLabel } from "../../types/api";

interface HealthHeroProps {
  score: number;          // 0..100
  label: HealthLabel;     // "healthy" | "steady" | "watch"
  clearCount: number;
  totalCount: number;
  lastReviewedAt: string | null;
}

const LABEL_KEY: Record<HealthLabel, string> = {
  healthy: "healthLabelHealthy",
  steady: "healthLabelSteady",
  watch: "healthLabelWatch",
};

const LABEL_COLOR: Record<HealthLabel, string> = {
  healthy: "var(--color-accent-green)",
  steady: "var(--color-accent-blue)",
  watch: "var(--color-accent-yellow)",
};

export function HealthHero({ score, label, clearCount, totalCount, lastReviewedAt }: HealthHeroProps) {
  const language = usePreferencesStore((s) => s.language);
  const color = LABEL_COLOR[label];
  const labelText = t(LABEL_KEY[label] as Parameters<typeof t>[0], language);

  const summary = lastReviewedAt
    ? tInterpolate(t("healthHeroSummary", language), {
        clear: clearCount,
        total: totalCount,
        timeAgo: timeAgo(lastReviewedAt),
      })
    : tInterpolate(t("healthHeroSummary", language), {
        clear: clearCount,
        total: totalCount,
        timeAgo: "—",
      });

  return (
    <div
      className="mx-4 mt-3 mb-1 px-4 py-4 rounded-xl border"
      style={{
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        background: `linear-gradient(135deg, color-mix(in srgb, ${color} 10%, transparent), transparent 60%)`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity size={16} style={{ color }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>
            {labelText}
          </span>
        </div>
        <div className="text-right tabular-nums">
          <span className="text-2xl font-bold" style={{ color }}>{score}</span>
          <span className="text-xs text-[var(--color-fg-muted)] ml-1">/ 100</span>
        </div>
      </div>
      <p className="text-xs text-[var(--color-fg-muted)]">{summary}</p>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /root/clawd/frontend && npx tsc --noEmit
```
Expected: `0 errors`.

- [ ] **Step 3: Commit**

```bash
cd /root/clawd && git add frontend/src/components/today/HealthHero.tsx
git commit -m "feat(today): add HealthHero for clear-state — score, label, summary"
```

---

## Task 9 — `AttentionCard.tsx` + `AttentionBlock.tsx`

**Files:**
- Create: `frontend/src/components/today/AttentionCard.tsx`
- Create: `frontend/src/components/today/AttentionBlock.tsx`

- [ ] **Step 1: Create AttentionCard.tsx**

```tsx
// frontend/src/components/today/AttentionCard.tsx
import { ChevronRight } from "lucide-react";
import { VerdictBadge } from "../ui/Badge";
import { whyToday } from "../../utils/today/whyToday";
import { usePreferencesStore } from "../../store/preferencesStore";
import type { AttentionItem } from "../../types/api";

interface AttentionCardProps {
  item: AttentionItem;
  onClick: (ticker: string) => void;
}

const REASON_BORDER: Record<AttentionItem["reason"], string> = {
  catalyst_expired: "var(--color-accent-red)",
  verdict_close: "var(--color-accent-red)",
  verdict_sell: "var(--color-accent-red)",
  verdict_reduce: "var(--color-accent-yellow)",
};

export function AttentionCard({ item, onClick }: AttentionCardProps) {
  const language = usePreferencesStore((s) => s.language);
  const why = whyToday(item, language);
  const borderColor = REASON_BORDER[item.reason];

  return (
    <button
      type="button"
      onClick={() => onClick(item.ticker)}
      className="w-full text-start mx-4 my-1.5 px-3.5 py-3 rounded-xl bg-[var(--color-bg-subtle)] border border-[var(--color-border)] flex items-start gap-3 active:bg-[var(--color-bg-muted)] transition-colors"
      style={{ borderInlineStartWidth: 3, borderInlineStartColor: borderColor }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono font-bold text-[var(--color-fg-default)]">{item.ticker}</span>
          <VerdictBadge verdict={item.verdict} size="sm" />
        </div>
        <p className="text-xs text-[var(--color-fg-muted)] leading-snug">{why}</p>
      </div>
      <ChevronRight size={18} className="text-[var(--color-fg-subtle)] shrink-0 mt-1" />
    </button>
  );
}
```

- [ ] **Step 2: Create AttentionBlock.tsx**

```tsx
// frontend/src/components/today/AttentionBlock.tsx
import { AlertCircle } from "lucide-react";
import { AttentionCard } from "./AttentionCard";
import { t, tInterpolate } from "../../store/i18n";
import { usePreferencesStore } from "../../store/preferencesStore";
import type { AttentionItem } from "../../types/api";

interface AttentionBlockProps {
  items: AttentionItem[];
  clearCount: number;
  onCardClick: (ticker: string) => void;
}

export function AttentionBlock({ items, clearCount, onCardClick }: AttentionBlockProps) {
  const language = usePreferencesStore((s) => s.language);
  const header = tInterpolate(t("attentionHeader", language), { count: items.length });
  const clearSuffix = tInterpolate(t("attentionClearSuffix", language), { count: clearCount });

  return (
    <div className="mt-3">
      <div className="mx-4 mb-2 flex items-center gap-2">
        <AlertCircle size={14} className="text-[var(--color-accent-red)]" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-default)]">
          {header}
        </p>
        <span className="text-[11px] text-[var(--color-fg-subtle)]">· {clearSuffix}</span>
      </div>
      <div>
        {items.map((item) => (
          <AttentionCard key={item.ticker} item={item} onClick={onCardClick} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
cd /root/clawd/frontend && npx tsc --noEmit
```
Expected: `0 errors`.

- [ ] **Step 4: Commit**

```bash
cd /root/clawd && git add frontend/src/components/today/AttentionCard.tsx frontend/src/components/today/AttentionBlock.tsx
git commit -m "feat(today): add AttentionBlock + AttentionCard for attention-state UI"
```

---

## Task 10 — `PositionRow.tsx` adds score chip + factoid

**Files:**
- Modify: `frontend/src/components/portfolio/PositionRow.tsx`

This task adds two new props (`verdict`, `score`, `factoid` — verdict already passed) and renders the score chip + factoid in both mobile and desktop variants. Existing behavior preserved.

- [ ] **Step 1: Add `score` and `factoid` props to interface**

In `PositionRow.tsx`, locate the existing `PositionRowProps` (or equivalent) interface and add:

```ts
interface PositionRowProps {
  position: PositionRowType;
  verdict?: VerdictRow;
  hasAlert?: boolean;
  isChecking?: boolean;
  jobType?: "quick_check" | "deep_dive";
  onQuickCheck?: () => void;
  onClick?: () => void;
  // NEW
  score?: number;       // 0..100
  factoid?: string;
}
```

- [ ] **Step 2: Add score-chip helper inside the component**

Near the top of the component file (after imports), add:

```tsx
function ScoreChip({ score }: { score: number }) {
  const color =
    score >= 85 ? "var(--color-accent-green)"
    : score >= 70 ? "var(--color-accent-blue)"
    : "var(--color-accent-yellow)";
  return (
    <span
      className="inline-flex items-center justify-center text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
        minWidth: 28,
      }}
      title={`Health score ${score}/100`}
    >
      {score}
    </span>
  );
}
```

- [ ] **Step 3: Render chip + factoid in mobile card**

Locate the mobile-card branch (`md:hidden`-style block). After the ticker/exchange row, inject:

```tsx
{(score !== undefined || factoid) && (
  <div className="flex items-center gap-2 mt-1">
    {score !== undefined && <ScoreChip score={score} />}
    {factoid && (
      <span className="text-[11px] text-[var(--color-fg-muted)] truncate">{factoid}</span>
    )}
  </div>
)}
```

- [ ] **Step 4: Render chip in desktop table row**

Locate the desktop `<tr>` block. Modify the ticker `<td>` to include the chip stacked under the ticker:

```tsx
<td className="px-3 py-2.5">
  <div className="flex flex-col gap-0.5">
    <div className="flex items-center gap-1.5">
      <span className="font-mono font-bold text-sm text-[var(--color-fg-default)]">{position.ticker}</span>
      {position.priceStale && <span className="text-[9px] text-[var(--color-fg-subtle)]">stale</span>}
      {/* existing exchange/badges remain */}
    </div>
    <div className="flex items-center gap-1.5">
      {score !== undefined && <ScoreChip score={score} />}
      {factoid && (
        <span className="text-[10px] text-[var(--color-fg-muted)] truncate max-w-[160px]">{factoid}</span>
      )}
    </div>
  </div>
</td>
```

- [ ] **Step 5: Type-check**

```bash
cd /root/clawd/frontend && npx tsc --noEmit
```
Expected: `0 errors`.

- [ ] **Step 6: Commit**

```bash
cd /root/clawd && git add frontend/src/components/portfolio/PositionRow.tsx
git commit -m "feat(positionRow): score chip + factoid line on mobile and desktop"
```

---

## Task 11 — `StrategyModal.tsx` reorder + Why Today strip

**Files:**
- Modify: `frontend/src/components/portfolio/StrategyModal.tsx`

This task reorders the modal so reasoning is the first thing the user reads, with a pinned "Why this fired today" strip above it. Conditions and Catalysts collapse into expanders. Bull/Bear get a 2-column compact layout.

- [ ] **Step 1: Add new props**

Update `StrategyModalProps` to accept an optional pre-classified attention item (so the parent can pass it from the AttentionCard click without re-running the classifier):

```ts
interface StrategyModalProps {
  ticker: string | null;
  attentionItem?: import("../../types/api").AttentionItem | null;
  onClose: () => void;
  onDeepDive?: (ticker: string) => void;
}
```

- [ ] **Step 2: Replace the body of `StrategyContent` with reordered render**

Replace the existing `StrategyContent` function body (everything inside the `<div className="space-y-4">` wrapper) with:

```tsx
function StrategyContent({
  strategy,
  attentionItem,
}: {
  strategy: StrategyRow;
  attentionItem?: import("../../types/api").AttentionItem | null;
}) {
  const language = usePreferencesStore((s) => s.language);
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [catalystsOpen, setCatalystsOpen] = useState(false);
  const totalConditions = strategy.entryConditions.length + strategy.exitConditions.length;

  const whyTodayText = attentionItem ? whyToday(attentionItem, language) : null;

  return (
    <div className="space-y-4">
      {whyTodayText && (
        <div className="-mx-4 -mt-4 px-4 py-2.5 border-b border-[color-mix(in_srgb,var(--color-accent-red)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-accent-red)_10%,transparent)]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent-red)] mb-0.5">
            {/* Inline text — no new key needed; keep header short */}
            {language === "he" ? "למה זה הופיע היום" : "Why this fired today"}
          </p>
          <p className="text-sm text-[var(--color-fg-default)]">{whyTodayText}</p>
        </div>
      )}

      <div>
        <p className="text-[10px] font-medium text-[var(--color-fg-subtle)] uppercase mb-1.5">
          {t("reasoning", language)}
        </p>
        <p className="text-sm text-[var(--color-fg-default)] leading-relaxed">
          {strategy.reasoning}
        </p>
      </div>

      <div className="flex items-center gap-3 text-[10px] text-[var(--color-fg-muted)]">
        <ConfidenceBadge confidence={strategy.confidence} />
        <span>·</span>
        <span>{t("strategyUpdated", language)} {timeAgo(strategy.updatedAt)}</span>
        <span>·</span>
        <span>{tTimeframe(strategy.timeframe, language)}</span>
      </div>

      {(strategy.bullCase || strategy.bearCase) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-[var(--color-bg-muted)] rounded-lg p-2.5">
            <p className="text-[10px] font-medium text-[var(--color-accent-green)] uppercase mb-1">
              {t("bullCase", language)}
            </p>
            <p className="text-[11px] text-[var(--color-fg-muted)] leading-relaxed">
              {strategy.bullCase ?? t("comingSoon", language)}
            </p>
          </div>
          <div className="bg-[var(--color-bg-muted)] rounded-lg p-2.5">
            <p className="text-[10px] font-medium text-[var(--color-accent-red)] uppercase mb-1">
              {t("bearCase", language)}
            </p>
            <p className="text-[11px] text-[var(--color-fg-muted)] leading-relaxed">
              {strategy.bearCase ?? t("comingSoon", language)}
            </p>
          </div>
        </div>
      )}

      {totalConditions > 0 && (
        <Expander
          open={conditionsOpen}
          onToggle={() => setConditionsOpen((v) => !v)}
          title={`${t("entryConditions", language)} / ${t("exitConditions", language)} (${totalConditions})`}
        >
          {strategy.entryConditions.length > 0 && (
            <ul className="space-y-1 mb-3">
              {strategy.entryConditions.map((c, i) => (
                <li key={`e-${i}`} className="flex items-start gap-2 text-xs text-[var(--color-fg-default)]">
                  <span className="text-[var(--color-accent-blue)] shrink-0">•</span>
                  {c}
                </li>
              ))}
            </ul>
          )}
          {strategy.exitConditions.length > 0 && (
            <ul className="space-y-1">
              {strategy.exitConditions.map((c, i) => (
                <li key={`x-${i}`} className="flex items-start gap-2 text-xs text-[var(--color-fg-default)]">
                  <span className="text-[var(--color-accent-yellow)] shrink-0">•</span>
                  {c}
                </li>
              ))}
            </ul>
          )}
        </Expander>
      )}

      {strategy.catalysts.length > 0 && (
        <Expander
          open={catalystsOpen}
          onToggle={() => setCatalystsOpen((v) => !v)}
          title={`${t("catalysts", language)} (${strategy.catalysts.length})`}
        >
          <div className="bg-[var(--color-bg-muted)] rounded-lg px-3">
            {strategy.catalysts.map((cat, i) => <CatalystRow key={i} cat={cat} />)}
          </div>
        </Expander>
      )}
    </div>
  );
}

function Expander({
  open,
  onToggle,
  title,
  children,
}: { open: boolean; onToggle: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-medium text-[var(--color-fg-muted)] uppercase"
      >
        <span>{title}</span>
        <span className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && <div className="px-3 pb-3 pt-1 border-t border-[var(--color-border)]">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Add the new imports at top of file**

```tsx
import { useState } from "react";
import { whyToday } from "../../utils/today/whyToday";
```

- [ ] **Step 4: Wire the new prop through `StrategyModal`**

In the `StrategyModal` function, accept `attentionItem` and pass it down:

```tsx
export function StrategyModal({ ticker, attentionItem, onClose, onDeepDive }: StrategyModalProps) {
  // ...existing hooks...

  // ...inside the body:
  {data && <StrategyContent strategy={data} attentionItem={attentionItem ?? null} />}
}
```

- [ ] **Step 5: Type-check**

```bash
cd /root/clawd/frontend && npx tsc --noEmit
```
Expected: `0 errors`.

- [ ] **Step 6: Commit**

```bash
cd /root/clawd && git add frontend/src/components/portfolio/StrategyModal.tsx
git commit -m "feat(strategyModal): reorder for drill-down — Why-Today strip + reasoning pinned + collapsible sections"
```

---

## Task 12 — `Portfolio.tsx` integration

**Files:**
- Modify: `frontend/src/pages/Portfolio.tsx`

This is the biggest task. Roughly: compute attention/scores/factoids → render state block → unified positions list above accounts → keep account cards below (default-collapsed) → suppress active-jobs banner during BOOTSTRAPPING.

- [ ] **Step 1: Add imports**

Near the top of `Portfolio.tsx`, add:

```tsx
import { SetupBanner } from "../components/today/SetupBanner";
import { HealthHero } from "../components/today/HealthHero";
import { AttentionBlock } from "../components/today/AttentionBlock";
import { StrategyModal } from "../components/portfolio/StrategyModal";
import { classifyAttention } from "../utils/today/classifyAttention";
import { healthScore, portfolioHealthScore, DEFAULT_STOP_LOSS_PCT } from "../utils/today/healthScore";
import { factoid } from "../utils/today/factoid";
import { t } from "../store/i18n";
import type { AttentionItem } from "../types/api";
```

- [ ] **Step 2: Compute Today-screen state inside the component**

After the existing `verdictMap` `useMemo` (around line 183), add:

```tsx
// Today-screen state derivations
const onboardState = onboardStatus?.state ?? "UNINITIALIZED";
const telegramConnected = onboardStatus?.telegramConnected ?? false;
const isBootstrapping = onboardState === "BOOTSTRAPPING" || onboardState === "UNINITIALIZED";

const verdicts = verdictsData?.verdicts ?? [];

const attentionItems: AttentionItem[] = useMemo(
  () => classifyAttention(verdicts),
  [verdicts]
);

const attentionTickerSet = useMemo(
  () => new Set(attentionItems.map((i) => i.ticker)),
  [attentionItems]
);

const tickerScores = useMemo(() => {
  const map = new Map<string, number>();
  if (!portfolio) return map;
  const positionByTicker = new Map(portfolio.positions.map((p) => [p.ticker, p]));
  for (const v of verdicts) {
    const pos = positionByTicker.get(v.ticker);
    const { score } = healthScore(v, pos, DEFAULT_STOP_LOSS_PCT);
    map.set(v.ticker, score);
  }
  return map;
}, [verdicts, portfolio]);

const tickerFactoids = useMemo(() => {
  const map = new Map<string, string>();
  for (const v of verdicts) {
    map.set(v.ticker, factoid(v, language));
  }
  return map;
}, [verdicts, language]);

// Clear positions for the unified list (excludes attention items)
const clearPositions = useMemo(() => {
  if (!portfolio) return [];
  return portfolio.positions
    .filter((p) => !attentionTickerSet.has(p.ticker))
    .map((p) => ({
      ...p,
      _score: tickerScores.get(p.ticker),
      _factoid: tickerFactoids.get(p.ticker),
    }))
    .sort((a, b) => {
      const sa = a._score ?? 100;
      const sb = b._score ?? 100;
      if (sa !== sb) return sa - sb;       // worst score first
      return b.weightPct - a.weightPct;    // then biggest weight
    });
}, [portfolio, attentionTickerSet, tickerScores, tickerFactoids]);

// Portfolio health score (clear-state hero)
const portfolioHealth = useMemo(() => {
  const inputs = clearPositions
    .map((p) => ({ score: p._score ?? 70, weightPct: p.weightPct }))
    .filter((s) => Number.isFinite(s.score));
  return portfolioHealthScore(inputs);
}, [clearPositions]);

// Bootstrap progress numbers (from /api/jobs)
const bootstrapProgress = useMemo(() => {
  const ddJobs = (jobsData?.jobs ?? []).filter((j) => j.action === "deep_dive");
  const completed = ddJobs.filter((j) => j.status === "completed").length;
  const total = portfolio?.positions.length ?? 0;
  const inProgress = ddJobs
    .filter((j) => j.status === "running" || j.status === "pending")
    .map((j) => j.ticker)
    .filter((t): t is string => !!t);
  return { analyzed: Math.min(completed, total), total, inProgress };
}, [jobsData, portfolio]);

// Drill-down: tap an AttentionCard → open StrategyModal with the AttentionItem
const [strategyTicker, setStrategyTicker] = useState<string | null>(null);
const strategyAttentionItem = useMemo(
  () => attentionItems.find((i) => i.ticker === strategyTicker) ?? null,
  [attentionItems, strategyTicker]
);
```

- [ ] **Step 3: Render the state block above the SummaryStrip**

Locate the active-jobs banner block (`{activeJobs.length > 0 && (...)}` around line 473). Above it, add the state block. And gate the active-jobs banner so it does NOT render during BOOTSTRAPPING:

```tsx
{/* State block — Setup | Attention | Health */}
{isBootstrapping ? (
  <SetupBanner
    analyzed={bootstrapProgress.analyzed}
    total={bootstrapProgress.total}
    inProgressTickers={bootstrapProgress.inProgress}
    telegramConnected={telegramConnected}
  />
) : attentionItems.length > 0 ? (
  <AttentionBlock
    items={attentionItems}
    clearCount={clearPositions.length}
    onCardClick={(ticker) => setStrategyTicker(ticker)}
  />
) : portfolioHealth ? (
  <HealthHero
    score={portfolioHealth.score}
    label={portfolioHealth.label}
    clearCount={clearPositions.length}
    totalCount={portfolio?.positions.length ?? 0}
    lastReviewedAt={verdictsData?.updatedAt ?? null}
  />
) : null}

{/* Active-jobs banner — hidden during BOOTSTRAPPING (SetupBanner already conveys progress) */}
{!isBootstrapping && activeJobs.length > 0 && (
  // ... existing banner JSX unchanged ...
)}
```

- [ ] **Step 4: Insert the unified clear-positions list above the account cards**

After the SummaryStrip and the quick-action buttons, BEFORE the `accountSummaries.map(...)` block, render the unified list (only when there's at least one clear position):

```tsx
{!isBootstrapping && clearPositions.length > 0 && (
  <div className="px-4 pt-2 pb-2">
    <div className="md:hidden space-y-2">
      {clearPositions.map((position) => (
        <PositionRow
          key={`unified:${position.ticker}`}
          position={position}
          verdict={verdictMap[position.ticker]}
          hasAlert={false}
          isChecking={activeTickerChecks.has(position.ticker)}
          jobType={tickerJobType.get(position.ticker)}
          score={position._score}
          factoid={position._factoid}
          onQuickCheck={() => handleQuickCheck(position.ticker)}
          onClick={() => handlePositionClick(position)}
        />
      ))}
    </div>
    <div className="hidden md:block">
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            {[t("colTicker", language), t("colLivePrice", language), t("colDayPct", language), t("colValue", language), t("colPlPct", language), t("colPl", language), t("colWeight", language), t("colVerdict", language)].map((header) => (
              <th key={`unified:${header}`} className="px-3 py-2 text-left text-[10px] font-medium text-[var(--color-fg-subtle)] uppercase">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clearPositions.map((position) => (
            <PositionRow
              key={`unified:${position.ticker}`}
              position={position}
              verdict={verdictMap[position.ticker]}
              hasAlert={false}
              isChecking={activeTickerChecks.has(position.ticker)}
              jobType={tickerJobType.get(position.ticker)}
              score={position._score}
              factoid={position._factoid}
              onClick={() => handlePositionClick(position)}
            />
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}

{!isBootstrapping && clearPositions.length === 0 && attentionItems.length > 0 && (
  // 0 clear, all-attention — omit unified list entirely (no placeholder).
  // Account cards still render below, just with everything inside flagged.
  null
)}
```

- [ ] **Step 5: Default-collapse account cards**

Locate the `expandedAccounts` initialization in the existing `useEffect` (around line 332–351). Confirm the default value is `false` for new accounts (it already is). No code change needed for this — but add a small comment so it's obvious:

```tsx
// Default-collapsed: each account starts closed; the unified list above shows the answer.
```

- [ ] **Step 6: Drop the duplicate "Manage Accounts" button in TopBar**

If `<TopBar>` is rendered with a `right` prop containing a Manage-Accounts button, remove just the `right` prop. Keep the rest:

```tsx
<TopBar
  title={t("portfolio", language)}
  subtitle={formatILS(portfolio.totalILS ?? null)}
  greeting={getGreeting(onboardStatus?.displayName, language)}
  onRefresh={refetch}
  refreshing={isFetching}
/>
```

- [ ] **Step 7: Drop the double `refetch()` in `refreshPortfolio`**

Confirm `refreshPortfolio` is:

```tsx
const refreshPortfolio = async () => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
    queryClient.invalidateQueries({ queryKey: ["jobs"] }),
    queryClient.invalidateQueries({ queryKey: ["verdicts"] }),
  ]);
};
```

(No trailing `refetch()`.) Already done per memory — verify, no change if so.

- [ ] **Step 8: Render the new `<StrategyModal>` instance for AttentionCard taps**

At the end of the `Portfolio` return JSX, alongside the existing modals, add:

```tsx
<StrategyModal
  ticker={strategyTicker}
  attentionItem={strategyAttentionItem}
  onClose={() => setStrategyTicker(null)}
/>
```

(`PositionDetailModal` continues to handle `selectedPosition` separately. Two modal instances; only one shows at a time because each is gated on its own state.)

- [ ] **Step 9: Type-check**

```bash
cd /root/clawd/frontend && npx tsc --noEmit
```
Expected: `0 errors`.

- [ ] **Step 10: Visual smoke-test on dev server**

```bash
cd /root/clawd/frontend && npm run dev
```
Open `http://localhost:3000` (login if prompted). Verify:
- Portfolio loads without crashing
- Score chip + factoid render on each row
- (No real attention or bootstrap state to verify yet — Tasks 13–14 cover those)

- [ ] **Step 11: Commit**

```bash
cd /root/clawd && git add frontend/src/pages/Portfolio.tsx
git commit -m "feat(today): wire Portfolio.tsx — state block, unified clear list, default-collapsed accounts"
```

---

## Task 13 — Edge cases + final polish

**Files:**
- Modify: `frontend/src/pages/Portfolio.tsx` (touch-ups only)
- Modify: `frontend/src/components/today/AttentionBlock.tsx` (touch-ups only)

- [ ] **Step 1: Verify the all-attention case manually**

In the dev server, simulate an all-attention state by temporarily setting all verdicts to SELL via DevTools (or use a test account). Expected behavior per spec:
- AttentionBlock renders with all tickers
- Unified clear list omitted (no fallback message)
- Account cards still expandable, showing all positions

If any part fails, fix in `Portfolio.tsx`.

- [ ] **Step 2: Verify the partial-bootstrap case manually**

On a freshly-onboarded test account where `onboardStatus.state === "BOOTSTRAPPING"` and 1–2 strategies have completed:
- SetupBanner renders with "Analyzed N of M" + tickers in progress
- The N completed strategies appear in the unified clear list with score+factoid
- Active-jobs banner is HIDDEN

If the unified list doesn't render during bootstrap (it should — partial-bootstrap shows progress live), revisit the `!isBootstrapping &&` guard around the unified-list block in Task 12 Step 4 and remove it. Render unified list whenever `clearPositions.length > 0`, regardless of bootstrap state.

Apply this fix:

```tsx
// Before:
{!isBootstrapping && clearPositions.length > 0 && (...)}
// After:
{clearPositions.length > 0 && (...)}
```

- [ ] **Step 3: Verify the 0-positions case**

A user with no portfolio uploaded (state UNINITIALIZED, no positions) should see the existing `EmptyState` — no SetupBanner, no Today block. Confirm by code-reading the `if (!portfolio)` branch near the top of the `Portfolio` return — it should still render `<EmptyState>` and bypass the new state block. No change expected.

- [ ] **Step 4: Verify Hebrew rendering on all three states**

Switch language to Hebrew via Settings page. Visit Portfolio in each state. Verify:
- All new strings render in Hebrew
- Numbers stay LTR (tabular-nums style preserved)
- ChevronRight in AttentionCard mirrors automatically (uses `borderInlineStartColor` which respects RTL)

- [ ] **Step 5: Add ARIA labels to score chip**

In `PositionRow.tsx`, update the `ScoreChip` component to include `aria-label`:

```tsx
<span
  // ...existing...
  aria-label={`Health score ${score} of 100`}
  title={`Health score ${score}/100`}
>
```

- [ ] **Step 6: Type-check**

```bash
cd /root/clawd/frontend && npx tsc --noEmit
```
Expected: `0 errors`.

- [ ] **Step 7: Commit**

```bash
cd /root/clawd && git add -u
git commit -m "fix(today): partial-bootstrap renders strategies live; aria-label on score chip"
```

---

## Task 14 — Build + smoke test (production build)

- [ ] **Step 1: Run frontend build**

```bash
cd /root/clawd/frontend && npm run build 2>&1 | tail -30
```
Expected: `✓ built in ...` with no TypeScript or Vite errors.

- [ ] **Step 2: Run backend build (defensive — no backend changes, but verify)**

```bash
cd /root/clawd/backend && npm run build 2>&1 | tail -10
```
Expected: clean.

- [ ] **Step 3: Acceptance walkthrough on dev server**

Run dev server (`cd frontend && npm run dev`) and walk through the spec's acceptance checks (spec section 14):

- [ ] Day-1 (BOOTSTRAPPING, 0 strategies) shows SetupBanner with progress
- [ ] Mid-bootstrap (BOOTSTRAPPING, partial strategies) shows banner + unified list
- [ ] Setup banner copy adapts to telegram connection
- [ ] Active-jobs banner hidden during BOOTSTRAPPING
- [ ] All-clear shows HealthHero with portfolio score + label
- [ ] 1 SELL ticker shows AttentionBlock; tap → StrategyModal with Why-Today strip
- [ ] PositionRow tap → PositionDetailModal (existing)
- [ ] StrategyModal shows Why Today above Reasoning
- [ ] Score chip + factoid on every clear row (mobile + desktop)
- [ ] All-attention edge case: AttentionBlock visible, no unified list, accounts still expandable
- [ ] Hebrew renders on all states
- [ ] Refresh button still works
- [ ] AddPositionModal, AccountManagerModal, PositionDetailModal still work
- [ ] ControlBanner still shows when set

If any check fails, fix and re-test.

- [ ] **Step 4: Commit any fixes**

```bash
cd /root/clawd && git status
# If any uncommitted fixes:
git add -u && git commit -m "fix(today): smoke-test polish"
```

---

## Task 15 — Deploy

- [ ] **Step 1: Confirm clean working tree**

```bash
cd /root/clawd && git status
```
Expected: clean.

- [ ] **Step 2: Deploy**

```bash
cd /root/clawd && ./deploy.sh
```
Expected: `git pull` succeeds, both builds succeed, `systemctl restart clawd-backend` returns clean, health-check at `http://localhost:8081/api/health` returns `{"status":"ok"}`.

- [ ] **Step 3: Production sanity check**

Open the production URL. Log in as a test account. Walk the same acceptance checklist from Task 14 Step 3 against production.

- [ ] **Step 4: Document the pilot kickoff**

```bash
cd /root/clawd && git log --oneline -20 > /tmp/today-screen-pilot-v1-shipped.txt
```

(Optional — for the user's own record. Not committed.)

---

## Self-Review (executed inline before saving)

**Spec coverage:** Each spec section maps to at least one task —

- §1 Goal → covered by overall plan
- §2 Three states → Task 12 Step 3 (state block render)
- §3 Page structure → Task 12 (entire)
- §4 Attention classification → Task 3
- §5 Health score → Task 4
- §6 Factoid → Task 5
- §7 Drill-down (StrategyModal) → Task 11 + Task 12 Step 8 (instance wiring)
- §8 Data flow → Task 12 (consumes existing endpoints)
- §9 New modules → Tasks 3–9
- §10 i18n → Task 2
- §11 Time budget → header table
- §12 Risk register → Task 13 (edge-case verification)
- §13 Phase 2 follow-ups → out of scope (captured for post-pilot)
- §14 Acceptance checks → Task 14 Step 3

**Placeholder scan:** All steps have concrete code or commands. No "TBD"/"add error handling"/"similar to Task N" — full code repeated where needed.

**Type consistency:** `AttentionItem`, `HealthScore`, `HealthLabel`, `AttentionReason`, `HealthScoreBreakdown` defined in Task 1, used consistently in Tasks 3, 4, 6, 7, 8, 9, 12. Function signatures match between definition and call sites:
- `classifyAttention(verdicts: VerdictRow[]): AttentionItem[]` — defined Task 3, called Task 12
- `healthScore(verdict, position, stopLossPct): HealthScore` — defined Task 4, called Task 12
- `portfolioHealthScore(inputs): { score, label } | null` — defined Task 4, called Task 12
- `factoid(verdict, language): string` — defined Task 5, called Task 12
- `whyToday(item, language): string` — defined Task 6, called Tasks 9 (AttentionCard) and 11 (StrategyModal)

i18n keys defined in Task 2 are referenced by Tasks 5, 6, 7, 8, 9 — all match exactly.

`tInterpolate(template, vars)` — added Task 2, used Tasks 5, 6, 7, 8, 9.

No gaps found.
