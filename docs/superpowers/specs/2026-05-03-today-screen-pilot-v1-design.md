# Today Screen — Pilot v1 Design

**Date:** 2026-05-03
**Audience:** 2 pilot users arriving 2026-05-04
**Time budget:** one evening + one morning (~8 hours)
**Scope:** Frontend-only retrofit of `frontend/src/pages/Portfolio.tsx` into a "Today" screen
**Out of scope:** backend changes, agent prompt changes, schema changes, step-queue redesign (PR2-4)

---

## 1. Goal

The product README promises *"27 positions clear today, 3 positions need attention"* — a calm, single-screen reassurance experience. The current Portfolio page is a flat P/L grid with the daily-judgment story scattered across `/strategies`, `/alerts`, and `/reports`. Pilot users will land tomorrow and have no path to the 30-second answer the product is supposed to deliver.

This spec retrofits Portfolio.tsx to deliver that 30-second answer while keeping all secondary surfaces accessible to power users. The route stays at `/portfolio`. The page becomes "Today" in the user's eyes.

## 2. Three states

The page renders one of three top-of-page state blocks. Below the state block, page structure is identical across all three.

| State | Trigger | Top-of-page |
|---|---|---|
| **Setup** | `onboardStatus.state === "BOOTSTRAPPING"` (regardless of how many strategies exist) | `<SetupBanner>` — *"Clawd is preparing your portfolio."* Subline shows progress: *"Analyzed {N} of {M} positions · {ticker1, ticker2, ticker3} in progress"*. Channel-agnostic notification line: *"We'll notify you when ready"* — append *"on Telegram"* iff `onboardStatus.telegram.connected`. |
| **Attention** | `state === "ACTIVE"` AND `attentionItems.length > 0` | `<AttentionBlock>` — *"{N} need attention · {M} clear"* heading + stack of `<AttentionCard>` (one per ticker) |
| **Clear** | `state === "ACTIVE"` AND `attentionItems.length === 0` | `<HealthHero>` — portfolio score (0–100) + label + summary line |

State determination is pure frontend, computed from the existing `/api/onboard/status`, `/api/verdicts`, and `/api/jobs` responses. No new endpoints.

### Setup-state behavior details

**Progress numbers** are derived from `/api/jobs` filtered to `action === "deep_dive"`:

- `analyzed = jobs.filter(j => j.status === "completed").length` (across all time, not last 24h)
- Or, if `/api/onboard/status` exposes a `progress` field with bootstrapped count, prefer that
- `total` = number of unique tickers in portfolio
- "in progress" tickers = active jobs' `ticker` field

**Partial-bootstrap is shown live.** Strategies that already exist while the user is still in BOOTSTRAPPING DO render in the unified positions list below the setup banner, with their score chip and factoid. The user gets immediate value as each strategy arrives — they don't have to wait for the whole portfolio.

**Active-jobs banner suppression.** The existing "X jobs running" banner in `Portfolio.tsx:473–486` is **hidden** while `state === "BOOTSTRAPPING"` — the SetupBanner already conveys that information and stacking both is noise. When `state === "ACTIVE"`, the active-jobs banner stays as today (for ad-hoc deep dives the user triggers).

### Edge cases

- **All positions in attention (0 clear):** `<AttentionBlock>` renders normally; below it, the unified positions list is omitted entirely (no "no clear positions" placeholder — the attention block already tells the story). Account cards still render collapsed.
- **0 positions in portfolio:** existing `EmptyState` keeps rendering as today; state block does not render. Unchanged behavior.
- **Strategies exist but `state === "UNINITIALIZED"`:** treated as Setup (defensive — should not occur in practice).

## 3. Page structure (top-to-bottom)

```
1. TopBar               (existing) "Today" title, greeting, refresh, last-updated
2. State block          ONE of: SetupBanner | HealthHero | AttentionBlock
3. SummaryStrip         (existing, unchanged) Today % · Total · P/L · USD/ILS
4. Quick actions        (existing) [+ Add Position] [Manage Accounts]
5. Unified positions    NEW unified list of CLEAR positions only (attention items
                        appear ONLY in the AttentionBlock above). Sorted score asc →
                        weight desc. Each row: ticker · score chip · factoid · day%
                        · verdict badge
6. Account cards        (existing) DEFAULT COLLAPSED. Show ALL positions in the
                        account regardless of status (so reconciliation is intuitive
                        when expanded)
7. Combined Holdings    (existing toggle) DEFAULT COLLAPSED, kept as-is
```

### What changes from current Portfolio.tsx

- **Adds:** state block (#2), score chip + factoid on every position row (#5)
- **Reorganizes:** the per-account expandable structure (currently the only positions view) is demoted; a unified positions list sits above it
- **Drops:**
  - Duplicate "Manage Accounts" button in `<TopBar>` right slot (UI/UX backlog item P1)
  - Double `refetch()` call in `refreshPortfolio` (UI/UX backlog item P3)
- **Keeps unchanged:** AddPositionModal, AccountManagerModal, PositionDetailModal, Combined Holdings toggle

## 4. Attention classification

`classifyAttention(verdicts) → AttentionItem[]` is a pure frontend function. v1 logic:

```ts
type AttentionItem = {
  ticker: string;
  verdict: Verdict;          // SELL | REDUCE | CLOSE only in v1
  reason: AttentionReason;   // catalyst_expired | verdict_sell | verdict_reduce
  whyToday: string;          // 1-line, computed by whyToday()
};

function classifyAttention(verdicts: VerdictRow[]): AttentionItem[] {
  return verdicts
    .filter(v => ["SELL", "REDUCE", "CLOSE"].includes(v.verdict) || v.hasExpiredCatalysts)
    .map(v => ({ ticker: v.ticker, verdict: v.verdict, reason: deriveReason(v), whyToday: whyToday(v) }))
    .sort(byPriority); // catalyst_expired → verdict_sell → verdict_reduce
}
```

**Future extensibility (Phase 2 follow-up):** `classifyAttention` is shaped to mirror what a future backend `/api/attention` endpoint would return. When the backend evaluator service ships, the frontend swap is one line: `const items = await fetchAttention()` instead of `classifyAttention(verdicts)`. No other code changes.

## 5. Health score (clear state)

Score is computed per ticker, then aggregated to a portfolio score weighted by current portfolio weight.

### Per-ticker score (0–100)

| Component | Weight | Formula |
|---|---|---|
| Strategy freshness | 25 | full credit if `lastDeepDiveAt < 14d` ago, linear decay to 0 by 60d, 0 if null |
| Catalyst health | 25 | full credit if a future-dated non-triggered catalyst exists with `expiresAt` between 14–90d out; 15 if 0–14d or >90d; 0 if none |
| Exit proximity | 20 | full credit if `plPct > -10%`, linear decay to 0 at user's `stopLossThresholdPct` (default 25%) |
| Confidence | 15 | high=15, medium=9, low=3 |
| Day-move sanity | 15 | full if `\|dayChangePct\| < 3`, linear decay to 0 at `\|dayChangePct\| = 8` |

```ts
function healthScore(verdict: VerdictRow, position: PositionRow, stopLossPct: number) {
  return {
    score: clamp(0, 100, freshness + catalyst + exit + confidence + dayMove),
    breakdown: { freshness, catalyst, exit, confidence, dayMove },
  };
}
```

### Portfolio score

```ts
portfolioScore = Σ(tickerScore × weightPct) / Σ(weightPct)
```

Weights from `position.weightPct`. SELL/REDUCE/CLOSE positions are excluded from clear-state aggregation (they live in the attention block).

### Health label (drives `<HealthHero>` headline)

| Score | Label | Color |
|---|---|---|
| 85–100 | "Healthy" | green |
| 70–84 | "Steady" | cyan |
| <70 | "Watch" | amber |

A position with verdict BUY/ADD/HOLD can legitimately land below 70 (e.g., stale review + no catalyst + low confidence). It stays in the clear list, just labelled "Watch". The attention block is gated on verdict and expired catalysts only — not on score.

### Known compromise — exit proximity v1

The exit-proximity component reads `stopLossThresholdPct` from `USER.md` (via `/api/onboard/status` profile section, default 25%). Free-text `exitConditions` strings (e.g., *"Stop loss at $85"*) are **not parsed** in v1.

This is a documented compromise. Phase 2 follow-up #1 (below) replaces it with structured per-strategy exit levels. Stop loss is a core part of strategy, not a user-level default — the v1 fallback is temporary.

## 6. Per-ticker factoid (clear state)

`factoid(verdict, position) → string` is a pure function. First match wins:

| Priority | Condition | Output (en) |
|---|---|---|
| 1 | nearest catalyst < 14d out | `"Earnings in {N}d"` (or *"Catalyst in {N}d"* for non-earnings) |
| 2 | `lastDeepDiveAt > 22d` ago | `"Review due in {N}d"` |
| 3 | `lastDeepDiveAt < 7d` AND has future catalyst | `"Fresh review · catalyst {date}"` |
| 4 | (default) | `"Thesis on track · catalyst {date}"` if catalyst exists, else `"Thesis on track"` |

**Future extensibility (Phase 2 follow-up #3):** if `strategy.dailySnapshot` is populated by a future small-LLM daily job, the row uses `dailySnapshot ?? factoid(...)`. Frontend stays the same; data source becomes pluggable.

## 7. Drill-down (StrategyModal reorder)

Same component file (`frontend/src/components/portfolio/StrategyModal.tsx`), same data fetch (`fetchStrategy(ticker)`), same props, same `onDeepDive` callback. Render order changes only.

### Tap-target routing — explicit

Two different drill-downs serve two different questions. Both stay in v1; spec makes the routing explicit so it isn't accidentally collapsed:

| Surface | Tap target | Why |
|---|---|---|
| `<AttentionCard>` (in AttentionBlock) | **`<StrategyModal>`** | User is asking *"why does this need attention?"* — strategy + reasoning is the answer |
| `<PositionRow>` (in unified list or account cards) | **`<PositionDetailModal>`** (existing, unchanged) | User is asking *"tell me about this holding"* — P/L, history, edit. Existing behavior, preserved |
| Score chip on PositionRow | **no tap behavior** | Informational only. Factoid is the explanation. Tooltip-on-hover for desktop showing top components; on mobile the score chip is read-only |

`<PositionDetailModal>` already has a "View Strategy" affordance that opens `<StrategyModal>` — that path is unchanged. Users can always escalate from "details" view to "why" view.

### New layout (top → bottom)

```
[X]  TICKER  [VERDICT badge]                ← header (unchanged)
─────────────────────────────────────────
WHY THIS FIRED TODAY                         ← NEW pinned block
{whyToday(verdict)}

REASONING                                    ← pinned, was middle
{strategy.reasoning}

{Confidence label} · updated {timeAgo}       ← compact meta row

┌── Bull ─────┬── Bear ─────┐                ← NEW 2-col layout
│ {bullCase}  │ {bearCase}  │
└─────────────┴─────────────┘

▾ Conditions ({entryConditions.length + exitConditions.length})  ← collapsed expander
▾ Catalysts ({catalysts.length})              ← collapsed expander

─────────────────────────────────────────
[ Run Deep Dive ]                             ← unchanged sticky CTA
```

### `whyToday(verdict) → string` priority

| Priority | Condition | Output (en) |
|---|---|---|
| 1 | any catalyst with `expiresAt < now` AND not triggered | `"{description} expired {N} days ago"` |
| 2 | verdict === "SELL" or "CLOSE" | `"{verdict} · {reasoningSnippet}"` |
| 3 | verdict === "REDUCE" | `"REDUCE · {reasoningSnippet}"` |
| 4 | (defensive default) | `"Marked for attention"` |

`reasoningSnippet`: first sentence of `strategy.reasoning`, truncated to ~80 characters at the last word boundary, with ellipsis if truncated. Pure frontend; no backend involvement.

## 8. Data flow

| Endpoint | Already used? | Used for |
|---|---|---|
| `GET /api/onboard/status` | yes | `state` field; profile (`stopLossThresholdPct`); `telegram.connected` for setup-banner copy |
| `GET /api/portfolio` | yes | positions, day change, weights |
| `GET /api/verdicts` | yes | verdict, confidence, hasExpiredCatalysts, lastDeepDiveAt, catalyst array |
| `GET /api/jobs` | yes | active-jobs banner (kept, suppressed during BOOTSTRAPPING); SetupBanner progress numbers (count of completed deep_dive jobs + active tickers) |
| `GET /api/strategies/:ticker` | yes (StrategyModal) | strategy detail on drill-down |

**No new endpoints, no backend changes.**

## 9. New frontend modules

```
frontend/src/utils/today/
├── classifyAttention.ts    Pure: (verdicts) → AttentionItem[]
├── healthScore.ts          Pure: (verdict, position, stopLossPct) → { score, breakdown }
├── factoid.ts              Pure: (verdict, position, language) → string
└── whyToday.ts             Pure: (verdict, language) → string

frontend/src/components/today/
├── SetupBanner.tsx         BOOTSTRAPPING + no-strategies state
├── HealthHero.tsx          Clear state — portfolio score + label + summary
├── AttentionBlock.tsx      Heading + AttentionCard list
└── AttentionCard.tsx       One ticker — verdict, why-today, tap → StrategyModal
```

### Modified files

```
frontend/src/pages/Portfolio.tsx                   restructure top, swap positions ordering
frontend/src/components/portfolio/PositionRow.tsx  add score chip + factoid line
frontend/src/components/portfolio/StrategyModal.tsx render reorder + Why Today strip
frontend/src/store/i18n.ts                         ~12 new keys (en + he)
frontend/src/types/api.ts                          AttentionItem, HealthScore types
```

Approximate line budgets (informative, not normative):

- `classifyAttention.ts`: ~25 lines
- `healthScore.ts`: ~50 lines (5 component sub-functions + aggregator)
- `factoid.ts`: ~25 lines
- `whyToday.ts`: ~25 lines
- `SetupBanner.tsx`: ~30 lines
- `HealthHero.tsx`: ~50 lines
- `AttentionBlock.tsx` + `AttentionCard.tsx`: ~80 lines combined
- `PositionRow.tsx` additions: ~25 lines
- `StrategyModal.tsx` reorder: ~40 lines diff (add ~20, move existing)
- `Portfolio.tsx` restructure: ~60 lines diff (add unified-list section, default-collapse account cards)

## 10. i18n strings (en + he)

~12 new keys, both languages required (Hebrew-first pilot users likely).

| Key | English | Hebrew |
|---|---|---|
| `setupBannerTitle` | "Preparing your portfolio" | "מכין את התיק שלך" |
| `setupBannerBodyChannelAgnostic` | "We'll notify you when ready." | "נעדכן אותך כשהפעולה תסתיים." |
| `setupBannerBodyTelegram` | "We'll notify you on Telegram when ready." | "נעדכן אותך בטלגרם כשהפעולה תסתיים." |
| `setupBannerProgress` | "Analyzed {N} of {M} positions" | "נותחו {N} מתוך {M} פוזיציות" |
| `setupBannerInProgress` | "{tickers} in progress" | "{tickers} בתהליך" |
| `healthLabelHealthy` | "Healthy" | "בריא" |
| `healthLabelSteady` | "Steady" | "יציב" |
| `healthLabelWatch` | "Watch" | "מעקב" |
| `healthHeroSummary` | "{N} of {M} clear · reviewed {timeAgo}" | "{N} מתוך {M} תקין · נבדק {timeAgo}" |
| `attentionHeader` | "{N} need attention" | "{N} דורשות תשומת לב" |
| `attentionClearSuffix` | "{N} clear" | "{N} תקינות" |
| `factoidEarningsInDays` | "Earnings in {N}d" | "דוחות בעוד {N} ימים" |
| `factoidCatalystInDays` | "Catalyst in {N}d" | "קטליזטור בעוד {N} ימים" |
| `factoidReviewDue` | "Review due in {N}d" | "סקירה בעוד {N} ימים" |
| `factoidFreshReview` | "Fresh review · catalyst {date}" | "סקירה עדכנית · קטליזטור {date}" |
| `factoidThesisOnTrack` | "Thesis on track" | "התזה על המסלול" |
| `whyTodayCatalystExpired` | "{description} expired {N} days ago" | "{description} פג לפני {N} ימים" |
| `whyTodaySell` | "{verdict} · {reasoningSnippet}" | (same template) |
| `whyTodayMarkedForAttention` | "Marked for attention" | "סומן לתשומת לב" |

## 11. Time budget

| Slot | Work |
|---|---|
| **Evening (4–5h)** | All 4 utils, all 4 new components, `PositionRow` chip+factoid, `StrategyModal` reorder, English strings, deploy to staging, smoke-test on 1 test account |
| **Morning (3–4h)** | Hebrew translations, edge cases (no positions, all attention, mid-bootstrap, very small portfolio), final pixel polish, deploy to prod, sanity check on 2 pilot accounts |

## 12. Risk register & revert paths

| Change | Risk | Mitigation / revert |
|---|---|---|
| State block above existing portfolio layout | Empty/null data crashes | All utils return safe defaults; `<SetupBanner>` is the universal fallback |
| Score computation on edge data | Wrong score number | Each component is null-safe and bounded; clamp(0,100) at the boundary; portfolio score has a minimum-positions guard (returns null if `<2` positions, hides hero) |
| `<StrategyModal>` reorder | Existing callers break | Same component, same props, same fetch — only render order changes |
| Account cards default collapsed | Existing-user expectation regression | Toggle still works; one tap restores; preserve last-expanded state in `localStorage` |
| Score may surprise users (no explanation) | "Why is my score 76?" feedback | Desktop hover tooltip on score chip showing top component contributions; mobile = chip is read-only (factoid is the explanation). No tap-to-expand view in v1 |
| Re-render cost on 30-position portfolio | `classifyAttention` + `healthScore` + `factoid` per row each render | All four utils are pure; wrap in `useMemo` keyed on `verdicts` and `portfolio` query data; recompute only on data change |
| Stacked banners (ControlBanner + active-jobs + SetupBanner) | Visual clutter, esp. mobile | ControlBanner stays (safety-critical); active-jobs banner hidden during BOOTSTRAPPING; only one of {SetupBanner, HealthHero, AttentionBlock} renders at a time |

**Per-task revert:** each new module is a pure function or new component file; `git revert` of any single commit leaves the rest functional.

## 13. Phase 2 follow-ups (post-pilot, captured here for spec completeness)

1. **Structured exit levels in strategy schema.** Add `exitLevel: { type: "stop_loss" \| "exit_price" \| ..., value, currency }` to `strategy.json`. Update agent prompts (SOUL.md + synthesis step) to require it on every new/updated strategy. Score's exit-proximity component reads from strategy, not from user-level default.

2. **Backend alert evaluator service.** Replace frontend `classifyAttention` with `GET /api/attention`. Pluggable signal source: backend can compute from verdicts inline today, swap to DB-backed flags or external evaluator integration later. Frontend swap is a one-line change.

3. **Optional `dailySnapshot: string` field in strategy.** Small daily LLM job populates a 1-sentence current-state read per ticker. Frontend uses `dailySnapshot ?? factoid(...)`. Replaces deterministic factoid when present; graceful fallback when not.

## 14. Acceptance checks (must pass before declaring pilot-ready)

- [ ] Day 1 (BOOTSTRAPPING, 0 strategies) shows SetupBanner with "0 of M analyzed" progress
- [ ] Mid-bootstrap (BOOTSTRAPPING, 5 of 12 strategies) shows SetupBanner with "5 of 12 analyzed" AND those 5 strategies render in the unified list below with score+factoid
- [ ] Setup banner copy adapts: "We'll notify you on Telegram when ready" iff Telegram is connected, else channel-agnostic
- [ ] Active-jobs banner is HIDDEN while state === "BOOTSTRAPPING"; visible when state === "ACTIVE" and a deep dive is running
- [ ] Day N with all-clear shows HealthHero with portfolio score and label
- [ ] Day N with 1 SELL ticker shows AttentionBlock with that ticker; tap → StrategyModal
- [ ] PositionRow tap → PositionDetailModal (unchanged); StrategyModal accessible from there too (unchanged)
- [ ] StrategyModal shows "Why this fired today" pinned above reasoning
- [ ] Score chip + factoid render on every position row in clear/attention states
- [ ] All-attention edge case (5 of 5 SELL): AttentionBlock renders, unified positions list omitted, account cards still expandable
- [ ] Hebrew strings render correctly on all three states
- [ ] All score components null-safe: a position with `lastDeepDiveAt: null` and `catalysts: []` doesn't crash; renders score with safe defaults
- [ ] Score recomputes when `/api/verdicts` refreshes (no stale scores after refresh)
- [ ] No regressions: AddPositionModal, AccountManagerModal, PositionDetailModal, refresh button, Telegram banner, ControlBanner
- [ ] `npx tsc --noEmit` clean and `npm run build` clean in both `frontend/` and `backend/`
- [ ] `./deploy.sh` clean

---

**This spec is the source of truth for the implementation plan. Implementation plan to follow via `superpowers:writing-plans`.**
