# S06: Advisory Readability + Scoring Clarity

**Goal:** Make report, strategy, Today, and scoring surfaces explain verdict, confidence, catalysts, score/factoid, and next action in readable language that a pilot user can understand without reading long raw analysis.
**Demo:** A user opening a report sees a plain-English verdict sentence, a confidence explanation, a score bucket label with emoji, formatted catalysts, and a next-action hint — not raw JSON or opaque numbers.

## Must-Haves

- R012 is advanced by a `frontend/src/utils/advisory.ts` utility that exports readable helpers for verdict, confidence, score, catalyst, and summary surfaces, consumed by Reports, StrategyModal, and AttentionCard.
- R013 is advanced by `scoreBucket`, `scoreBucketLabel`, `scoreBucketEmoji`, and `scoreExplanation` helpers that turn numeric scores into understandable labels.
- The persona prompt (S05) covers all 8 safe advisory classes so chat can explain these surfaces.
- `getReportSummary` is in the read tool allowlist so chat can fetch and explain report content.
- Verification passes: `node scripts/verify-advisory-readability.mjs` (8 checks), frontend lint, frontend build.

## Proof Level

- This slice proves: integration
- Real runtime required: no — static verifier + lint + build
- Human/UAT required: no for slice completion; S08 owns live pilot rehearsal

## Integration Closure

- Upstream surfaces consumed: S03 notification composition outputs; S05 chat explanation behavior and persona prompt; existing `Reports.tsx`, `Strategies.tsx`, `frontend/src/components/portfolio/StrategyModal.tsx`, `frontend/src/components/today/AttentionCard.tsx`.
- New wiring introduced: `frontend/src/utils/advisory.ts` readability utility; advisory helpers consumed across Reports, StrategyModal, AttentionCard; `scripts/verify-advisory-readability.mjs` verifier.
- What remains: S07 operator visibility; S08 live rehearsal.

## Verification

- Runtime signals: no new backend signals; frontend surfaces render readable labels from advisory helpers.
- Inspection surfaces: `scripts/verify-advisory-readability.mjs` checks 8 invariants statically.
- Failure visibility: verifier exits non-zero if any required export is missing or any surface fails to consume the helpers.
- Redaction constraints: advisory.ts must not contain internal product names (Clawd, openclaw, step queue, watchdog, /root/, finance-agent).

## Tasks

- [x] **T01: Build `frontend/src/utils/advisory.ts` readability utility** `est:2h`
  Executor skills: `frontend-design`, `accessibility`, `verify-before-complete`.
  - Files: `frontend/src/utils/advisory.ts`
  - Exports: `verdictSentence`, `verdictSignal`, `isActionableVerdict`, `confidenceExplanation`, `confidenceLabel`, `scoreBucket`, `scoreBucketLabel`, `scoreBucketEmoji`, `scoreExplanation`, `formatCatalyst`, `nextCatalyst`, `reasoningSnippet`, `buildAdvisorySummary`
  - Verify: no internal names, all 13 exports present

- [x] **T02: Wire advisory helpers into Reports, StrategyModal, and AttentionCard** `est:2h`
  Executor skills: `react-best-practices`, `frontend-design`, `verify-before-complete`.
  - Files: `frontend/src/pages/Reports.tsx`, `frontend/src/components/portfolio/StrategyModal.tsx`, `frontend/src/components/today/AttentionCard.tsx`
  - Verify: `verdictSentence`, `confidenceExplanation`, `scoreExplanation`, `formatCatalyst` in Reports; `scoreBucketLabel`, `confidenceExplanation`, `nextCatalyst` in StrategyModal; `scoreBucketLabel` in AttentionCard

- [x] **T03: Write S06 verifier and run full verification** `est:1h`
  Executor skills: `verify-before-complete`.
  - Files: `scripts/verify-advisory-readability.mjs`
  - Verify: `node scripts/verify-advisory-readability.mjs && npm --prefix frontend run lint && npm --prefix frontend run build`

## Files Likely Touched

- frontend/src/utils/advisory.ts
- frontend/src/pages/Reports.tsx
- frontend/src/components/portfolio/StrategyModal.tsx
- frontend/src/components/today/AttentionCard.tsx
- scripts/verify-advisory-readability.mjs
