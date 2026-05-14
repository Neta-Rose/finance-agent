---
id: S06
milestone: M001
status: complete
completed_at: 2026-05-12T00:00:00.000Z
requirements_advanced: [R012, R013]
verification_result: passed
---

# S06: Advisory Readability + Scoring Clarity — Summary

**Outcome:** Report, strategy, Today, and scoring surfaces now explain verdict, confidence, catalysts, score/factoid, and next action in readable language. A `frontend/src/utils/advisory.ts` utility centralizes all readability helpers and is consumed across Reports, StrategyModal, and AttentionCard. The S06 verifier confirms all 8 invariants pass.

## What Was Built

**Advisory Readability Utility (`frontend/src/utils/advisory.ts`)**

13 exported functions covering all advisory surfaces:

| Function | Purpose |
|---|---|
| `verdictSentence` | Plain-English sentence for a verdict (e.g. "Hold your position") |
| `verdictSignal` | Signal classification: bullish / bearish / neutral |
| `isActionableVerdict` | Whether the verdict requires user action (SELL, REDUCE, BUY, ADD) |
| `confidenceExplanation` | Human explanation of confidence level |
| `confidenceLabel` | Short label (High / Medium / Low) |
| `scoreBucket` | Numeric score → bucket: `clear` / `watch` / `attention` |
| `scoreBucketLabel` | Readable label for the bucket |
| `scoreBucketEmoji` | Emoji for the bucket (✅ / 👀 / ⚠️) |
| `scoreExplanation` | Sentence explaining what the score means |
| `formatCatalyst` | Formats a catalyst with expiry and triggered state |
| `nextCatalyst` | Picks the soonest upcoming catalyst from a list |
| `reasoningSnippet` | Clips reasoning to a readable length |
| `buildAdvisorySummary` | Assembles a full advisory summary object for display |

The utility contains no internal product names (Clawd, openclaw, step queue, watchdog, /root/, finance-agent).

**Frontend Surfaces Updated**

- `frontend/src/pages/Reports.tsx` — uses `verdictSentence`, `confidenceExplanation`, `scoreExplanation`, `formatCatalyst`.
- `frontend/src/components/portfolio/StrategyModal.tsx` — uses `scoreBucketLabel`, `confidenceExplanation`, `nextCatalyst`.
- `frontend/src/components/today/AttentionCard.tsx` — uses `scoreBucketLabel`.

**Verifier (`scripts/verify-advisory-readability.mjs`)**

8 static checks:
1. `advisory.ts` exports all 13 required functions.
2. `advisory.ts` contains no internal product names.
3. Persona prompt covers all 8 safe advisory classes.
4. Persona prompt does not expose "Clawd".
5. `getReportSummary` is in the read tool allowlist.
6. `chatSafetyPolicy.test.ts` exists.
7. Settings.tsx WhatsApp policy intact (S02 invariant).
8. Reports, StrategyModal, and AttentionCard consume the readability helpers.

## Verification Evidence

| Command | Exit Code | Verdict |
|---|---|---|
| `node scripts/verify-advisory-readability.mjs` | 0 | ✅ pass (8/8 checks) |
| `npm --prefix frontend run lint` | 0 | ✅ pass (2 pre-existing warnings in Admin.tsx, unrelated) |
| `npm --prefix frontend run build` | 0 | ✅ pass |

## Requirements Advanced

- **R012** (advisory surfaces explain verdict, reason, confidence, catalysts, next action): fully implemented — `verdictSentence`, `confidenceExplanation`, `formatCatalyst`, `buildAdvisorySummary` consumed across Reports and StrategyModal.
- **R013** (scores and Today/factoid surfaces are understandable): fully implemented — `scoreBucket`, `scoreBucketLabel`, `scoreBucketEmoji`, `scoreExplanation` consumed in Reports, StrategyModal, and AttentionCard.

## Files Created/Modified

- `frontend/src/utils/advisory.ts`
- `frontend/src/pages/Reports.tsx`
- `frontend/src/components/portfolio/StrategyModal.tsx`
- `frontend/src/components/today/AttentionCard.tsx`
- `scripts/verify-advisory-readability.mjs`
