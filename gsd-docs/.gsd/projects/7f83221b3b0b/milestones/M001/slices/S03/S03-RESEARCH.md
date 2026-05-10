# S03 — Research

**Date:** 2026-05-10

## Summary

Research could not be completed by the required parallel subagent path because the harness blocked subagent dispatch for this `research-slice` planning unit under the active tools policy. No codebase exploration was performed in this lane after the block, to avoid bypassing the enforced planning-unit tool gate.

This partial artifact exists so downstream orchestration has a durable record of the failure and can decide whether to rerun research in an execution-permitted context or manually plan S03 from the already inlined milestone context.

## Recommendation

Rerun S03 research in a context where subagent dispatch and/or code exploration is permitted. The next research attempt should focus on `backend/src/services/notificationService.ts`, `backend/src/routes/telegram.ts`, notification outbox persistence, and Web notification rendering, then produce a precise implementation landscape for central composers, channel renderers, Telegram splitting/formatting, and delivery-failure recording.

## Implementation Landscape

### Key Files

- `backend/src/services/notificationService.ts` — Known from milestone context as the current scattered notification publish/delivery path; likely primary seam for central composition.
- `backend/src/routes/telegram.ts` — Known from milestone context as Telegram transport/webhook path; likely primary seam for safe formatting, splitting, and failure handling.
- Frontend notification surfaces — Need discovery in a permitted research run to identify Web renderer/consumer paths.

### Build Order

1. Discover existing notification data model/outbox and publish call sites.
2. Define a semantic notification envelope and category composers for daily brief, deep dive, full report, and market/news-style notifications.
3. Add Web and Telegram renderers with tests for safe, bounded output.
4. Harden Telegram delivery failure recording and message splitting.

### Verification Approach

A future complete research pass should identify exact commands. Expected verification classes are backend unit tests for composers/renderers, Telegram formatting/splitting/failure-path tests, existing backend tests, frontend build/lint if Web rendering changes, and an explicit S08 live Telegram UAT step when credentials are available.

## BLOCKER

Parallel `subagent` dispatch failed with a hard harness block: `unit "research-slice" runs under tools-policy "planning" — subagent dispatch is not permitted in planning units`. The tool response explicitly said not to proceed or retry the same call, so the required one-time retry could not be performed without violating the mechanical gate.