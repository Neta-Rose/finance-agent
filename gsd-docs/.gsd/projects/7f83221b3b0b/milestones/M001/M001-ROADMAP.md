# M001: Pilot Confidence Pass

**Vision:** Make the already deployed portfolio-operations product precise, readable, connected, observable, and trustworthy enough for a first Web + Telegram pilot, while hiding unsupported WhatsApp and keeping user-facing copy nameless.

## Success Criteria

- Pilot-facing Web + Telegram surface is intentional, readable, and free of unsupported WhatsApp paths.
- Admin can review every visible pilot feature with short/detailed descriptions, error handling, status, and comments.
- Notifications are centrally composed, clear, and safely delivered/rendered on Web + Telegram.
- Chat supports multiple saved conversations and answers advisory questions usefully while protecting internals.
- Advisory/report/scoring surfaces are understandable enough for a pilot user to trust.
- Operational visibility supports a 10-user pilot.
- A final end-to-end pilot rehearsal passes.

## Slices

- [x] **S01: S01** `risk:high` `depends:[]`
  > After this: Admin can browse pilot-visible features, read short and detailed descriptions, update status/comment, and see per-feature error-handling expectations.

- [x] **S02: S02** `risk:medium` `depends:[]`
  > After this: Pilot users no longer see WhatsApp as supported, and user-facing copy uses neutral nameless product language.

- [x] **S03: S03** `risk:high` `depends:[]`
  > After this: Daily, deep-dive, full-report, and news/report-style notifications render as clear Web + Telegram messages with safe delivery behavior.

- [ ] **S04: S04** `risk:high` `depends:[]`
  > After this: User can create, reopen, rename, and archive/delete multiple saved chats, backed by Postgres with configurable 7-day TTL.

- [ ] **S05: Safe Useful Advisory Chat** `risk:high` `depends:[S04]`
  > After this: Chat can explain reports, verdicts, catalysts, and portfolio state while redirecting architecture/source/internal-doc requests.

- [ ] **S06: Advisory Readability + Scoring Clarity** `risk:medium` `depends:[S03,S05]`
  > After this: Report, strategy, Today, and scoring surfaces explain verdict, confidence, catalysts, score/factoid, and next action in readable language.

- [ ] **S07: Pilot Operational Visibility** `risk:medium` `depends:[S01,S03,S05]`
  > After this: Admin can inspect pilot readiness, notification delivery/failures, chat behavior, job failures, and budget/cost state enough to operate the pilot.

- [ ] **S08: End-to-End Pilot Rehearsal** `risk:high` `depends:[S01,S02,S03,S04,S05,S06,S07]`
  > After this: A seeded or real pilot user completes the full Web + Telegram advisory loop and admin can review readiness/failure evidence.

## Boundary Map

### S01 → S02
Produces:
- `docs/pilot-features/*.json` — stable feature catalog entries with `id`, `surface`, `title`, `shortSummary`, `detailedExplanation`, `happyPath`, `edgeCases`, `errorHandling`, `evidencePaths`, `pilotRecommendation`.
- `pilot_feature_reviews` Postgres state — mutable `status`, `admin_comment`, `updated_at`, `updated_by` keyed by feature ID.
- Admin inventory API/UI contract for listing entries and updating mutable review state.

Consumes:
- existing admin route/auth patterns.

### S02 → S03/S04/S05/S06/S08
Produces:
- Pilot-visible channel policy: Web + Telegram enabled, WhatsApp hidden/deferred.
- Naming/copy invariant: avoid spreading “Clawd” or “finance-agent” in pilot-facing copy.
- Feature inventory status entries marking WhatsApp and naming-sensitive surfaces.

Consumes from S01:
- Feature catalog and review status surface.

### S03 → S07/S08
Produces:
- Notification composition API for daily brief, deep dive, full report, and market/news-style messages.
- Channel renderers for Web and Telegram with safe formatting/splitting and delivery-failure recording.
- Invariant: notifications do not send raw unbounded strategy/report reasoning.

Consumes from S02:
- Pilot channel and naming policy.

### S04 → S05/S08
Produces:
- Backend conversation list/create/open/rename/archive-delete API.
- Conversation metadata shape with configurable 7-day TTL handling.
- Frontend saved-chat UI contract and last-opened-chat local preference.

Consumes from S02:
- Naming policy for chat copy.

### S05 → S06/S07/S08
Produces:
- Safe advisory request whitelist and blocked-internal request tests.
- Improved chat behavior for report/verdict/catalyst/portfolio explanations using existing tools/data.
- Telegram-compatible chat behavior expectations.

Consumes from S04:
- Saved chat lifecycle and backend conversation state.

### S06 → S08
Produces:
- Readability improvements for advisory/report/strategy/Today/scoring surfaces.
- Clear explanation patterns for verdict, reason, confidence, catalysts, score/factoid, and next action.

Consumes from S03:
- Notification composition outputs.
Consumes from S05:
- Chat explanation behavior.

### S07 → S08
Produces:
- Admin/operator surfaces for readiness, delivery/failure, chat behavior, job failures, and budget/cost state.
- Pilot operation checklist evidence.

Consumes from S01:
- Feature inventory state.
Consumes from S03:
- Notification delivery/failure state.
Consumes from S05:
- Chat safety/usefulness events.

### S08
Produces:
- Final pilot rehearsal evidence and UAT script.
- Milestone validation evidence across Web + Telegram advisory loop.

Consumes:
- All prior slices.
