# Pilot Surface Gating + Nameless Copy — Research

**Date:** 2026-05-09

## Summary

Research for S02 could not be completed in this planning unit because the tool policy mechanically blocked required subagent dispatch for parallel slice research.

## BLOCKER

The required `subagent` parallel dispatch failed before any slice research could run:

> HARD BLOCK: unit "research-slice" runs under tools-policy "planning" — subagent dispatch is not permitted in planning units. This is a mechanical gate enforced by manifest.tools (#4934).

The protocol allows one retry per failed slice, but the policy error explicitly says not to retry or rationalize past the block. Because the failure is deterministic and tool-policy enforced, retrying individually would not be productive or compliant.

## Recommendation

Run S02 research from an execution context where `subagent` and/or code-read tools are permitted, or directly execute a research task that is allowed to inspect the codebase and persist `.gsd` artifacts. The intended research scope remains: find user-facing WhatsApp surfaces and hide/defer them for the pilot, locate pilot-facing copy containing “Clawd” or “finance-agent,” replace with neutral product language, and ensure S01 feature inventory entries/status can reflect WhatsApp and naming-sensitive surfaces once S01 exists.

## Implementation Landscape

### Key Files

- Unknown — code exploration was blocked before discovery could occur.

### Build Order

1. Re-run S02 research in an execution-capable context.
2. Search frontend, backend response text, Telegram/chat/onboarding copy, and docs that are rendered to users for WhatsApp, Clawd, and finance-agent references.
3. Identify gating/copy tasks and verification commands.

### Verification Approach

Verification could not be researched in this unit. Future research should include code search assertions for forbidden pilot-facing terms, frontend build/tests, and browser/admin or onboarding checks proving WhatsApp is not presented as pilot-ready.
