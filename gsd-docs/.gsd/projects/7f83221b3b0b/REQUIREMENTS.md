# Requirements

This file is the explicit capability and coverage contract for the project.

## Active

### R001 — Pilot-visible feature inventory with scan-friendly summaries, detailed explanations, ownership, evidence paths, and error-handling expectations for every visible pilot feature.
- Class: launchability
- Status: active
- Description: Pilot-visible feature inventory with scan-friendly summaries, detailed explanations, ownership, evidence paths, and error-handling expectations for every visible pilot feature.
- Why it matters: The owner needs to stand behind every visible feature in a 10-user pilot instead of discovering ambiguous or half-supported features during use.
- Source: user
- Primary owning slice: M001/S01
- Supporting slices: M001/S07, M001/S08
- Validation: mapped
- Notes: Inventory must support quick scanning and detailed reading.

### R002 — Admin can browse pilot feature inventory entries and edit mutable review state: status, comment, and incorrect-description marker.
- Class: admin/support
- Status: active
- Description: Admin can browse pilot feature inventory entries and edit mutable review state: status, comment, and incorrect-description marker.
- Why it matters: The owner needs a practical workflow for marking what needs fixes, what is beta, what is hidden, and what is ready.
- Source: user
- Primary owning slice: M001/S01
- Supporting slices: M001/S07
- Validation: mapped
- Notes: Use JSON seed/catalog files plus Postgres mutable review state.

### R007 — Telegram binding and delivery must handle safe formatting, message splitting, and recorded delivery failures.
- Class: integration
- Status: active
- Description: Telegram binding and delivery must handle safe formatting, message splitting, and recorded delivery failures.
- Why it matters: Telegram is a day-one pilot channel; broken formatting or invisible send failures break trust.
- Source: inferred
- Primary owning slice: M001/S03
- Supporting slices: M001/S08
- Validation: mapped
- Notes: Current code uses Markdown with raw text, which is a known delivery/formatting risk.

### R014 — Admin/operator can inspect readiness, notification delivery/failures, chat behavior, job failures, and budget/cost states enough to operate a 10-user pilot.
- Class: operability
- Status: active
- Description: Admin/operator can inspect readiness, notification delivery/failures, chat behavior, job failures, and budget/cost states enough to operate a 10-user pilot.
- Why it matters: Silent failures or untraceable cost/events are pilot blockers.
- Source: inferred
- Primary owning slice: M001/S07
- Supporting slices: M001/S01, M001/S03, M001/S05
- Validation: mapped
- Notes: Visibility should use existing admin/observability surfaces where possible.

### R015 — A seeded or real pilot user must complete the full Web + Telegram advisory loop before the milestone is complete.
- Class: launchability
- Status: active
- Description: A seeded or real pilot user must complete the full Web + Telegram advisory loop before the milestone is complete.
- Why it matters: Unit checks do not prove the assembled pilot experience works.
- Source: inferred
- Primary owning slice: M001/S08
- Supporting slices: M001/S01, M001/S02, M001/S03, M001/S04, M001/S05, M001/S06, M001/S07
- Validation: mapped
- Notes: Rehearsal includes active/onboarded portfolio, full report or deep dive, Web notification, Telegram notification, chat explanation, saved chat continuation, and admin inventory review.

## Validated

### R003 — User-facing product copy should avoid spreading "Clawd" or "finance-agent"; neutral phrases like "your portfolio assistant" are preferred.
- Class: constraint
- Status: validated
- Description: User-facing product copy should avoid spreading "Clawd" or "finance-agent"; neutral phrases like "your portfolio assistant" are preferred.
- Why it matters: The project currently has no final product name, and old branding/internal names should not leak into the pilot experience.
- Source: user
- Primary owning slice: M001/S02
- Supporting slices: M001/S03, M001/S05, M001/S06
- Validation: S02 verified neutral pilot-facing copy in frontend translations and README with `scripts/verify-pilot-surface.mjs`; full slice verification passed with frontend lint/build.
- Notes: Old/internal names may remain in internal implementation, API headers, dormant backend code, and repository identifiers; pilot-facing i18n/README copy is now guarded by the policy script.

### R004 — WhatsApp must not be presented as a pilot-ready channel in user-facing UI.
- Class: constraint
- Status: validated
- Description: WhatsApp must not be presented as a pilot-ready channel in user-facing UI.
- Why it matters: WhatsApp is harder to harden now and would create a dead-end or unreliable pilot experience.
- Source: user
- Primary owning slice: M001/S02
- Supporting slices: M001/S01, M001/S08
- Validation: S02 removed visible WhatsApp setup/selection from Settings, forces WhatsApp disabled in Settings notification saves, and verifies pilot catalog entries do not promote WhatsApp as ready.
- Notes: Dormant WhatsApp backend/webhook/notification compatibility code remains out of scope for S02 as long as it is not user-visible or advertised as pilot-ready.

### R005 — Daily brief, deep dive, full report, and market/news notifications must be composed through a central semantic layer instead of scattered ad hoc strings.
- Class: core-capability
- Status: validated
- Description: Daily brief, deep dive, full report, and market/news notifications must be composed through a central semantic layer instead of scattered ad hoc strings.
- Why it matters: Current messages are too raw or too vague and undermine advisory trust.
- Source: user
- Primary owning slice: M001/S03
- Supporting slices: M001/S07
- Validation: S03 verified that daily brief, deep dive, full report, quick-check/new-ideas, market/news, and step-queue completion publishers now call the central semantic notification composer. Fresh verification passed: `npm --prefix backend test -- --test-name-pattern "notification composer|notification service|telegram delivery"`, `npm --prefix backend run build`, `node scripts/verify-pilot-surface.mjs`, `npm --prefix frontend run lint`, and `npm --prefix frontend run build` (gsd_exec d8e857f6-9849-426c-95de-b822cee69fcf).
- Notes: Categories may have different shapes but should share a common composed envelope.

### R006 — Web and Telegram notifications must have clear status titles, restrained markers, useful body text, and actionable explanation.
- Class: primary-user-loop
- Status: validated
- Description: Web and Telegram notifications must have clear status titles, restrained markers, useful body text, and actionable explanation.
- Why it matters: Users need an immediate green/attention signal without losing the truthful detail that makes the message trustworthy.
- Source: user
- Primary owning slice: M001/S03
- Supporting slices: M001/S06, M001/S08
- Validation: S03 semantic composer and notification service tests validate clear bounded Web records and plain-text Telegram messages with status cues, useful body text, and action/open cues while clipping unbounded reasoning. Full planned slice verification passed in gsd_exec d8e857f6-9849-426c-95de-b822cee69fcf.
- Notes: Use markers like ✅ clear, ⚠️ attention, 🔎 deep dive, 📌 catalyst. Titles can carry the big status signal; bodies must remain substantive.

### R008 — Chat must support multiple saved conversations from backend state, including create, reopen, continue previous chat, rename, and archive/delete.
- Class: core-capability
- Status: validated
- Description: Chat must support multiple saved conversations from backend state, including create, reopen, continue previous chat, rename, and archive/delete.
- Why it matters: The pilot chat should feel like a real assistant surface, not one local browser session.
- Source: user
- Primary owning slice: M001/S04
- Supporting slices: M001/S05, M001/S08
- Validation: S04 implemented list/create/open-history/continue-by-ID/rename/soft-archive routes under /api/chat/conversations, agentChat guards by owner/archive/expiry, and Chat.tsx wired to backend with React Query. Backend and route tests pass; verify-saved-chat-ui.mjs passes substantive checks.
- Notes: Existing conversations tables should be extended rather than using localStorage as source of truth.

### R009 — Saved chats should expire or become eligible for cleanup after a configurable TTL, defaulting to 7 days.
- Class: continuity
- Status: validated
- Description: Saved chats should expire or become eligible for cleanup after a configurable TTL, defaulting to 7 days.
- Why it matters: Keeps chat useful without accumulating unbounded stale history or cost/context risk.
- Source: user
- Primary owning slice: M001/S04
- Supporting slices: M001/S07
- Validation: S04 added `chat_conversation_ttl_days` feature flag (default 7), `expires_at` column on conversations, TTL coercion for invalid values, and store tests covering default and override behavior. agentChat rejects expired conversation IDs with `conversation_expired` error code.
- Notes: Quick DB check found chat_agent_enabled but no existing TTL flag.

### R010 — Chat must protect internal architecture/source/docs while still answering safe advisory/product-use questions practically.
- Class: compliance/security
- Status: validated
- Description: Chat must protect internal architecture/source/docs while still answering safe advisory/product-use questions practically.
- Why it matters: Previous chat behavior leaked internals; current behavior may be too restrictive. Pilot users need usefulness without unsafe disclosure.
- Source: user
- Primary owning slice: M001/S05
- Supporting slices: M001/S04, M001/S07
- Validation: S05 implemented persona prompt with explicit internal-disclosure block and redirect line, output filter with static+dynamic patterns (replaces on final_reply, strips on tool_result), startup guards, and 15 chatSafetyPolicy tests. `node scripts/verify-advisory-readability.mjs` passes all 8 checks including persona prompt coverage and no-Clawd invariant.
- Notes: Favor a whitelist of safe request classes plus explicit tests for blocked internal requests.

### R011 — Users must be able to ask chat to explain reports, verdicts, catalysts, and portfolio state using real tools/data instead of guessing.
- Class: primary-user-loop
- Status: validated
- Description: Users must be able to ask chat to explain reports, verdicts, catalysts, and portfolio state using real tools/data instead of guessing.
- Why it matters: Chat should let users understand advisory output without reading long reports manually.
- Source: user
- Primary owning slice: M001/S05
- Supporting slices: M001/S06, M001/S08
- Validation: S05 implemented 10 read tools (getPortfolio, getStrategy, getStrategies, getRecentReports, getReportSummary, getCatalystsDueSoon, getEscalationHistory, getRiskSummary, getNotifications, searchWeb) and 6 action tools with structured answer format guidance (verdict → reason → confidence → next action). `getReportSummary` wraps report text in UNTRUSTED blocks. `node scripts/verify-advisory-readability.mjs` confirms getReportSummary in allowlist and persona prompt covers all 8 advisory classes.
- Notes: Include safe-usefulness prompt tests.

### R012 — Advisory surfaces must make verdict, reason, confidence, catalysts, and next action easier to read and understand.
- Class: quality-attribute
- Status: validated
- Description: Advisory surfaces must make verdict, reason, confidence, catalysts, and next action easier to read and understand.
- Why it matters: Long unclear text makes the advisory system hard to trust even when analysis is technically present.
- Source: user
- Primary owning slice: M001/S06
- Supporting slices: M001/S03, M001/S05
- Validation: S06 built `frontend/src/utils/advisory.ts` with `verdictSentence`, `confidenceExplanation`, `formatCatalyst`, `buildAdvisorySummary` and wired them into Reports.tsx and StrategyModal.tsx. `node scripts/verify-advisory-readability.mjs` check [8] confirms all surfaces consume the helpers.
- Notes: Applies to report/strategy/notification/chat-facing summaries.

### R013 — Scores and Today/factoid surfaces must be understandable rather than mysterious numbers.
- Class: quality-attribute
- Status: validated
- Description: Scores and Today/factoid surfaces must be understandable rather than mysterious numbers.
- Why it matters: Users need to understand why something is green, watch, or attention.
- Source: user
- Primary owning slice: M001/S06
- Supporting slices: M001/S01, M001/S08
- Validation: S06 built `scoreBucket`, `scoreBucketLabel`, `scoreBucketEmoji`, `scoreExplanation` in `frontend/src/utils/advisory.ts` and wired them into Reports.tsx, StrategyModal.tsx, and AttentionCard.tsx. `node scripts/verify-advisory-readability.mjs` check [8] confirms AttentionCard uses `scoreBucketLabel`.
- Notes: Existing Today-screen design doc provides prior art.

## Deferred

### R016 — WhatsApp can become a supported delivery/chat channel in a later version.
- Class: integration
- Status: deferred
- Description: WhatsApp can become a supported delivery/chat channel in a later version.
- Why it matters: It is valuable long-term but too complex to harden for the immediate pilot.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Hide/block for M001.

### R017 — A richer CMS-like feature-management system is not required for M001.
- Class: admin/support
- Status: deferred
- Description: A richer CMS-like feature-management system is not required for M001.
- Why it matters: The immediate need is a small admin review workflow, not a general content platform.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: JSON seed plus DB review state is enough.

### R018 — Choosing and propagating a final public product name is deferred.
- Class: launchability
- Status: deferred
- Description: Choosing and propagating a final public product name is deferred.
- Why it matters: Naming should not block pilot hardening, but old/internal names should not leak.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Use nameless neutral copy for now.

### R019 — New major advisory features outside pilot confidence are deferred.
- Class: differentiator
- Status: deferred
- Description: New major advisory features outside pilot confidence are deferred.
- Why it matters: M001 should harden what exists rather than expand the product and increase risk.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Future milestones can expand capability after pilot proof.

## Out of Scope

### R020 — The product must not invite pilot users into WhatsApp setup or imply WhatsApp is supported for the pilot.
- Class: anti-feature
- Status: out-of-scope
- Description: The product must not invite pilot users into WhatsApp setup or imply WhatsApp is supported for the pilot.
- Why it matters: Prevents a known unreliable/deferred channel from damaging trust.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Enforced by S02.

### R021 — User chat must not reveal internal architecture, source files, deployment details, or internal docs.
- Class: compliance/security
- Status: out-of-scope
- Description: User chat must not reveal internal architecture, source files, deployment details, or internal docs.
- Why it matters: This was a prior safety issue and is not acceptable in pilot.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Enforced and tested by S05.

### R022 — Notifications must not push raw long strategy reasoning or unbounded report text as the message body.
- Class: anti-feature
- Status: out-of-scope
- Description: Notifications must not push raw long strategy reasoning or unbounded report text as the message body.
- Why it matters: Raw report dumps are unreadable, may break channels, and undermine the calm daily experience.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Enforced by S03.

### R023 — Cosmetic-only changes that do not improve trust, readability, operability, or pilot clarity are out of scope for M001.
- Class: anti-feature
- Status: out-of-scope
- Description: Cosmetic-only changes that do not improve trust, readability, operability, or pilot clarity are out of scope for M001.
- Why it matters: Keeps the milestone focused on pilot confidence.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Visual polish is welcome when it improves comprehension.

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
|---|---|---|---|---|---|
| R001 | launchability | active | M001/S01 | M001/S07, M001/S08 | mapped |
| R002 | admin/support | active | M001/S01 | M001/S07 | mapped |
| R003 | constraint | validated | M001/S02 | M001/S03, M001/S05, M001/S06 | S02 verified neutral pilot-facing copy in frontend translations and README with `scripts/verify-pilot-surface.mjs`; full slice verification passed with frontend lint/build. |
| R004 | constraint | validated | M001/S02 | M001/S01, M001/S08 | S02 removed visible WhatsApp setup/selection from Settings, forces WhatsApp disabled in Settings notification saves, and verifies pilot catalog entries do not promote WhatsApp as ready. |
| R005 | core-capability | validated | M001/S03 | M001/S07 | S03 verified that daily brief, deep dive, full report, quick-check/new-ideas, market/news, and step-queue completion publishers now call the central semantic notification composer. Fresh verification passed: `npm --prefix backend test -- --test-name-pattern "notification composer|notification service|telegram delivery"`, `npm --prefix backend run build`, `node scripts/verify-pilot-surface.mjs`, `npm --prefix frontend run lint`, and `npm --prefix frontend run build` (gsd_exec d8e857f6-9849-426c-95de-b822cee69fcf). |
| R006 | primary-user-loop | validated | M001/S03 | M001/S06, M001/S08 | S03 semantic composer and notification service tests validate clear bounded Web records and plain-text Telegram messages with status cues, useful body text, and action/open cues while clipping unbounded reasoning. Full planned slice verification passed in gsd_exec d8e857f6-9849-426c-95de-b822cee69fcf. |
| R007 | integration | active | M001/S03 | M001/S08 | mapped |
| R008 | core-capability | validated | M001/S04 | M001/S05, M001/S08 | S04 list/create/open/rename/archive routes, agentChat owner+archive+expiry guards, Chat.tsx React Query wiring; backend and route tests pass. |
| R009 | continuity | validated | M001/S04 | M001/S07 | S04 chat_conversation_ttl_days flag (default 7), expires_at column, TTL coercion, store tests for default and override, agentChat rejects expired IDs. |
| R010 | compliance/security | validated | M001/S05 | M001/S04, M001/S07 | S05 persona prompt, output filter, startup guards, 15 chatSafetyPolicy tests, verify-advisory-readability.mjs passes. |
| R011 | primary-user-loop | validated | M001/S05 | M001/S06, M001/S08 | S05 10 read tools + 6 action tools, structured answer format, getReportSummary in allowlist, verify-advisory-readability.mjs passes. |
| R012 | quality-attribute | validated | M001/S06 | M001/S03, M001/S05 | S06 advisory.ts with verdictSentence/confidenceExplanation/formatCatalyst/buildAdvisorySummary wired into Reports and StrategyModal; verify-advisory-readability.mjs check [8] passes. |
| R013 | quality-attribute | validated | M001/S06 | M001/S01, M001/S08 | S06 scoreBucket/scoreBucketLabel/scoreBucketEmoji/scoreExplanation wired into Reports, StrategyModal, AttentionCard; verify-advisory-readability.mjs check [8] passes. |
| R014 | operability | active | M001/S07 | M001/S01, M001/S03, M001/S05 | mapped |
| R015 | launchability | active | M001/S08 | M001/S01, M001/S02, M001/S03, M001/S04, M001/S05, M001/S06, M001/S07 | mapped |
| R016 | integration | deferred | none | none | unmapped |
| R017 | admin/support | deferred | none | none | unmapped |
| R018 | launchability | deferred | none | none | unmapped |
| R019 | differentiator | deferred | none | none | unmapped |
| R020 | anti-feature | out-of-scope | none | none | n/a |
| R021 | compliance/security | out-of-scope | none | none | n/a |
| R022 | anti-feature | out-of-scope | none | none | n/a |
| R023 | anti-feature | out-of-scope | none | none | n/a |

## Coverage Summary

- Active requirements: 5 (R001, R002, R007, R014, R015)
- Mapped to slices: 5
- Validated: 10 (R003, R004, R005, R006, R008, R009, R010, R011, R012, R013)
- Unmapped active requirements: 0
