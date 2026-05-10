# M001: Pilot Confidence Pass

**Gathered:** 2026-05-08
**Status:** Ready for planning

## Project Description

This is a nameless portfolio-operations product for private investors. The system is already deployed on a VPS with backend, frontend, and Postgres. It helps users feel their portfolio is continuously watched by keeping durable strategy understanding per position, monitoring daily changes cheaply, escalating only when something meaningful changes, and explaining advisory output through Web and Telegram.

The project should not spread “Clawd” or “finance-agent” as pilot-facing product names. Use neutral copy such as “your portfolio assistant,” “the assistant,” or “the product.” “finance-agent” is only a repository/GitHub identifier and may appear in README/repo context if needed.

## Why This Milestone

The product is close to a first pilot. Onboarding is working and major report/deep-dive infrastructure mostly works after several stabilization iterations, but the last-mile pilot experience is not yet precise enough to stand behind. The key gaps are readable notifications, Web + Telegram reliability, useful-but-safe chat, saved chats, scoring/readability, hidden WhatsApp, feature readiness inventory, and operational visibility.

This milestone hardens the existing product for a roughly 10-user pilot. It does not expand the product vision or attempt a major rebrand.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Use the Web app without being invited into unsupported WhatsApp setup.
- Receive clear Web and Telegram notifications for daily briefs, deep dives, full reports, and relevant news/report events.
- Read advisory surfaces that explain verdict, reason, confidence, catalysts, score/factoid, and next action.
- Use chat to ask practical questions like “explain this report,” “what does this verdict mean,” “what changed,” and “what catalysts are due soon.”
- Create and continue multiple saved chats.

### Entry point / environment

- Entry point: deployed Web app, Telegram bot/webhook, backend API, admin UI.
- Environment: production-like VPS deployment with Postgres.
- Live dependencies involved: Postgres, Telegram Bot API, LLM providers/OpenRouter, backend job/report services, Web frontend.

## Completion Class

- Contract complete means: requirement coverage exists, feature inventory entries exist, API contracts/tests pass, notification composition and chat lifecycle checks pass, and hidden/deferred surfaces are verified.
- Integration complete means: Web + Telegram advisory loop works across real backend, Postgres, notification, chat, and report/job subsystems.
- Operational complete means: admin can inspect feature readiness, notification delivery/failures, chat behavior, job failures, and budget/cost states enough to operate a 10-user pilot.

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- A seeded or real pilot user can move through active/onboarded portfolio state, trigger or observe a full report/deep dive, receive readable Web and Telegram notifications, ask chat to explain the advisory output, and continue a saved chat.
- Admin can browse the pilot feature inventory, see short and detailed explanations, update a feature status/comment, and use the inventory as an error-handling review surface.
- WhatsApp is not visible as a pilot-ready user path.
- User-facing copy avoids spreading “Clawd” or “finance-agent.”
- Telegram formatting/delivery failure modes are handled and observable.
- Chat protects internal architecture/source/docs while staying useful for advisory questions.

## Scope

### In Scope

- Web app and Telegram as day-one pilot channels.
- Pilot feature inventory with JSON seed/catalog files plus Postgres mutable admin state.
- Small admin UI for browsing feature inventory and editing status/comment.
- WhatsApp hidden/deferred from pilot UI.
- Nameless pilot-facing copy cleanup.
- Central notification composition layer with category-specific composers.
- Clear Web and Telegram notification rendering with restrained status markers.
- Telegram delivery hardening: safe formatting, splitting, failure recording.
- Backend-backed multiple saved chats with rename/archive/delete/continue previous chat and configurable 7-day TTL.
- Chat safe-usefulness balance: advisory whitelist/use cases plus internal-leak redirection.
- Advisory readability and scoring/Today explanation pass.
- Admin/operator visibility sufficient for pilot operation.
- End-to-end pilot rehearsal.

### Out of Scope / Non-Goals

- WhatsApp pilot hardening or presenting WhatsApp as pilot-ready.
- Major product rebrand.
- Large new advisory capabilities beyond pilot hardening.
- Cosmetic-only polish detached from trust, readability, operability, or pilot clarity.
- Revealing internal architecture/source/docs through user chat.
- Raw unbounded report text as notification body.

## Architectural Decisions

### Pilot Feature Inventory Storage

**Decision:** Use JSON seed/catalog files plus Postgres mutable review state plus a small admin UI.

**Rationale:** JSON files are good for stable catalog content and reviewable evidence paths. Admin edits need durable mutable state; writing project files from admin UI would be brittle and would create conflict risk. Postgres matches the existing product direction for operational, user-facing, cross-session state.

**Alternatives Considered:**
- JSON-only inventory — simple, but admin comments/status changes become file writes or a second hidden state store.
- Full CMS — too much scope for M001.

### Notification Composition

**Decision:** Add a central notification composition layer with category-specific composers and channel-specific renderers.

**Rationale:** Current notification strings are scattered and inconsistent. Daily/deep-dive/full-report/news notifications need different shapes, but all should produce a common semantic envelope with status, summary, body sections, suggested action, and rendering hints.

**Alternatives Considered:**
- Patch each publish call — fast but continues drift.
- One rigid notification template — too generic for different notification classes.

### Chat Persistence

**Decision:** Treat chat as a backend-backed product feature using existing conversation tables, not localStorage as source of truth.

**Rationale:** Users need multiple saved chats, previous-chat continuation, rename, and archive/delete. LocalStorage can remember the last opened chat, but Postgres should own durable chat state.

**Alternatives Considered:**
- Keep one local saved chat — insufficient for pilot expectations.
- New external chat storage — unnecessary because tables already exist.

### Chat Safety and Usefulness

**Decision:** Keep hard protection against internals while adding explicit safe advisory request classes and tests.

**Rationale:** The chat was previously too unsafe and may now be too restrictive. Pilot value requires practical report/verdict/catalyst explanations without leaking architecture, files, deployment, or internal docs.

**Alternatives Considered:**
- Remove strict filters — unsafe.
- Keep current redirect-heavy behavior — too low-value for pilot.

### WhatsApp Deferral

**Decision:** Hide/defer WhatsApp for M001 and do not spend pilot-hardening effort on it unless it actively breaks Web or Telegram.

**Rationale:** WhatsApp is harder to harden and currently has no active bindings. Web and Telegram are the pilot channels.

**Alternatives Considered:**
- Harden WhatsApp now — adds complexity and risk to pilot readiness.
- Delete WhatsApp backend code — unnecessary unless it interferes.

## Error Handling Strategy

Use sensible defaults and make them visible per feature in the pilot feature inventory. Each feature entry should include expected happy path, likely edge cases, intended error/fallback behavior, what the user sees, what admin/operator sees, and verification status.

Defaults:
- Web UI: no silent dead ends; unsupported pilot features show clear “not available in pilot” behavior or are hidden.
- Telegram: failed send is recorded; unsafe formatting falls back to safe/plain rendering; messages split safely.
- WhatsApp: hidden/deferred, so failure mode is “not visible in pilot.”
- Notifications: if data is partial, say what is known and missing; do not pretend certainty.
- Chat: helpful for advisory/report questions; guarded against internals; tool failures produce useful user-facing explanation without leaking implementation.
- Reports/deep dives: schema/job failures visible to admin and surfaced to users only in safe language where relevant.
- Feature inventory: seed descriptions are catalog data; admin status/comments are mutable DB state.

## Risks and Unknowns

- Chat may be too dependent on text-parsed tool calls and broad output filtering — this can make it under-useful.
- Telegram Markdown/raw text can break formatting or delivery.
- Notification composition must avoid becoming an over-generic abstraction.
- Feature inventory can become unreadable if entries lack scan-friendly summaries.
- Some report/schema/job reliability bugs may already be fixed, but M001 must verify rather than assume.
- Live credentials/webhook state must be verified carefully without exposing secrets.

## Existing Codebase / Prior Art

- `README.md` — product vision and strategy-first workflow.
- `backend/src/services/notificationService.ts` — current notification publish/delivery path; uses scattered raw title/body strings.
- `backend/src/routes/telegram.ts` — Telegram transport and webhook path; currently sends Markdown raw text.
- `backend/src/routes/whatsapp.ts` — WhatsApp transport; deferred for M001.
- `backend/src/services/chat/agentChat.ts` — existing chat loop and tool parsing.
- `backend/src/services/chat/personaPrompt.ts` — current chat safety prompt.
- `backend/src/services/chat/outputFilter.ts` — current final/tool output filtering.
- `frontend/src/pages/Chat.tsx` — current single-session localStorage chat UI.
- `frontend/src/pages/Admin.tsx` and `backend/src/routes/admin.ts` — admin UI/API extension points.
- `docs/superpowers/specs/2026-05-03-today-screen-pilot-v1-design.md` — Today/scoring/factoid prior art.
- `open-bugs/v5-deploy-bugs.md` — recent known issues; structured outputs likely fixed root-string schema failures, but budget/observability gaps remain relevant.
- Postgres aggregate check: users=5, channel_bindings=3, notifications_outbox=15, conversations=13, conversation_turns=50, jobs=21, telegram bindings=3, WhatsApp bindings=0, no pilot inventory table yet.

## Relevant Requirements

- R001-R002 — feature inventory and admin workflow.
- R003-R004 — naming and WhatsApp pilot constraints.
- R005-R007 — notification and Telegram reliability.
- R008-R011 — saved chats and safe useful chat.
- R012-R013 — advisory readability and scoring clarity.
- R014-R015 — operational visibility and end-to-end pilot proof.

## Technical Constraints

- Do not expose secrets, tokens, or private user data in logs or replies.
- Treat `/root/clawd/users/*` as sensitive; avoid bulk-modifying user data.
- Before production-touching changes or restarts, create a production report under `/root/codex/production-reports/`.
- Prefer typed Postgres-backed product state over new backend-owned state in user folders.
- Keep changes small, reversible, and aligned with existing Express/TypeORM/React patterns.
- Do not commit `.gsd/` planning artifacts.

## Integration Points

- Postgres — inventory review state, chat metadata/TTL, notifications/jobs/admin observability.
- Telegram Bot API — pilot notification and chat delivery.
- Web frontend — pilot UX, chat UI, admin feature inventory UI.
- Backend API — admin routes, chat routes, notifications, report/job services.
- LLM providers/OpenRouter — chat and report generation behavior.

## Testing Requirements

- Backend unit tests for notification composers, feature inventory state persistence, chat conversation APIs, Telegram formatting fallback, and safe-usefulness prompt handling where deterministic.
- API/integration checks for admin inventory and chat lifecycle.
- Frontend build and browser verification for admin inventory UI and chat UI.
- Live or operational Telegram verification when credentials/webhook are available; otherwise formatter and failure-path verification plus explicit UAT step.
- End-to-end pilot rehearsal before completion.

## Acceptance Criteria

- S01: JSON feature catalog exists; Postgres review state exists; admin UI can browse entries and edit status/comment; feature entries include error-handling expectations.
- S02: WhatsApp is hidden/deferred in pilot UI; user-facing copy avoids Clawd/finance-agent branding; feature inventory reflects hidden/deferred status.
- S03: Notifications are composed centrally; Web + Telegram render status titles and useful bodies; raw long reasoning is not sent; Telegram formatting/splitting/failure paths are handled.
- S04: Multiple backend-backed saved chats work; rename/archive/delete/continue previous chat work; TTL defaults to 7 days and is configurable.
- S05: Chat answers advisory/report/verdict/catalyst questions with real data and redirects internal architecture/source/doc requests.
- S06: Advisory/report/Today/scoring surfaces improve readability and explain verdict, reason, confidence, catalysts, score/factoid, and next action.
- S07: Admin/operator can inspect readiness, notification delivery/failures, chat behavior, job failures, and budget/cost states.
- S08: Final Web + Telegram pilot rehearsal passes end-to-end.

## Open Questions

- Exact live Telegram webhook/credential health — verify during S03/S08 without exposing secrets.
- Exact feature inventory size — enumerate during S01 from Web/admin surfaces.
- Exact report readability hot spots — identify during S06 from current UI and representative report artifacts.
