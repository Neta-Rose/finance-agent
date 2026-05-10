# Project

## What This Is

This repository is a nameless portfolio-operations product for private investors who want their portfolio to feel actively watched without manually re-evaluating every position every day. The current system is already deployed on a VPS with backend, frontend, and Postgres. The pilot work is not greenfield; it is a confidence pass over an existing product that is close to a first 10-user pilot.

The product helps a user maintain durable strategy understanding for each position, monitor daily changes cheaply, escalate only when something meaningful changes, and receive clear advisory explanations through the Web app and Telegram.

## Core Value

The one thing that must work even if everything else is cut: the user gets trustworthy advisory clarity about their portfolio — what is clear, what needs attention, why, and what to do next — without noisy repeated deep analysis or silent failure.

## Project Shape

- **Complexity:** complex
- **Why:** The core system exists, but the pilot pass crosses backend state, Postgres, admin UI, Web UX, Telegram delivery, notifications, chat safety/usefulness, report readability, and operational visibility.

## Current State

The backend, frontend, and Postgres are deployed on the VPS. Onboarding is reported as working. Full reports and deep dives mostly work after several stabilization iterations. Existing code includes job orchestration, strategy/report services, notification outbox, Web dashboard, Telegram/WhatsApp transport code, chat tables, chat agent tooling, admin routes, feature flags, and model-tier configuration.

M001 has completed the admin pilot feature inventory (S01), pilot-facing WhatsApp hiding and neutral copy policy (S02), and central Web + Telegram notification composition/delivery hardening (S03). Remaining pilot gaps are concentrated in backend-backed saved chats, safe/useful advisory chat behavior, scoring/readability, operator visibility, and final end-to-end rehearsal.

## Architecture / Key Patterns

- Backend owns product control flow, scheduling, jobs, notifications, observability, and durable state.
- Postgres is the preferred store for operational/user-facing mutable state.
- JSON files may seed catalogs or durable artifacts, but admin-editable operational state should live in Postgres.
- Agents and LLMs are bounded research/advisory workers, not the source of product control flow.
- Web and Telegram are the pilot channels. WhatsApp is deferred and hidden from pilot-facing UI.
- User-facing product copy is currently nameless; do not spread “Clawd” or “finance-agent” as a brand.
- Notification publishers should use semantic `publishNotification` requests; `notificationService` owns composer rendering, category mapping, batch idempotency, channel records, and redacted diagnostics.
- Telegram notifications should remain bounded plain text with disabled link previews and shared splitting/failure-recording helpers.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping. As of S03, notification composition/readability/delivery requirements R005, R006, and R007 have verification evidence and are validated.

## Milestone Sequence

- [ ] M001: Pilot Confidence Pass — Make the existing Web + Telegram product precise, readable, connected, observable, and trustworthy enough for a first pilot.
