# HEARTBEAT.md — Schedule and Trigger Protocol
# Last authorized change: 2026-04-07

---

## Backend-owned scheduling

The backend is the only scheduler for portfolio workflows.

You must never autonomously start:
- daily brief
- weekly review
- portfolio sweep
- exploratory research

You only act when a trigger file explicitly asks for work.

---

## On every session start — process pending jobs first

Before running any scheduled task:
1. Read ~/clawd/users/[USER_ID]/data/triggers/ for .json trigger files
2. For each trigger file found:
   a. Read it — extract action, ticker, job_id
   b. Update ~/clawd/users/[USER_ID]/data/jobs/[job_id].json:
      set status → "running", started_at → now
   c. Delete the trigger file immediately (prevents double-processing)
   d. Execute the action:
      - "full_report" → Mode 4 on all portfolio positions
      - "daily_brief" → Mode 1 on top 5 positions
      - "deep_dive" + ticker → Mode 2 on that ticker
      - "new_ideas" → Mode 3 weekly research
      - "quick_check" + ticker → Quick check using server briefing (see Quick Check section below)
      - "switch_production" → update config.json modelProfile → "production"
      - "switch_testing" → update config.json modelProfile → "testing"
   e. On success: update job file → status "completed", completed_at, result (max 200 chars)
   f. On failure: update job file → status "failed", completed_at, error (max 200 chars)
3. After ALL trigger files are processed:
   - if no more triggers remain, reply exactly `HEARTBEAT_OK`
   - stop immediately

---

## Ambient heartbeat — every 30 minutes

If no trigger files are pending:
- Reply: HEARTBEAT_OK
- Do NOT run analyst pipelines
- Do NOT fetch live prices
- Do NOT write any files

---

## State-aware behavior

Read ~/clawd/users/[USER_ID]/data/state.json before any triggered task:

- state = "UNINITIALIZED": do nothing. Inform user onboarding is required.
- state = "BOOTSTRAPPING": check bootstrapProgress.
  If full_report job is pending or running: report progress only, do not start new tasks.
  If full_report job is completed: transition state → "ACTIVE", run first daily brief.
- state = "ACTIVE": proceed only with the explicit triggered task.

---

## Daily brief output format (Telegram)
```
📊 Daily Brief — [DATE]
Portfolio: ₪[TOTAL] ([+/-]% today)

✅ TSM — HOLD (high) · On track · Next: earnings Q2
✅ NVDA — HOLD (high) · On track · AI capex thesis intact
⚠️ GOOGL — REDUCE (medium) · Escalated: catalyst expired
🔴 NNE — SELL (high) · Action needed

[X] on track · [Y] escalated · [Z] total positions
```

---

## Quick Check (Server-Assisted)

When processing "quick_check" action:

### Step 1: Use server briefing data
- The trigger file contains "briefing" data pre-loaded by server
- Use briefing.sentiment (or briefing.sentiment_error if missing)
- Use briefing.strategy (or briefing.strategy_error if missing)
- Check briefing.is_portfolio_ticker

### Step 2: Fast analysis (target: 30 seconds)
1. **Sentiment check**: Briefing.sentiment or quick web search if missing
2. **Catalyst check**: Check briefing.strategy.catalysts
3. **Portfolio context**: briefing.is_portfolio_ticker

### Step 3: Decision
- Any catalysts triggered? → escalate to deep_dive
- Unexpected major events? → escalate to deep_dive
- Strategy issues (null lastDeepDiveAt, missing catalyst dates)? → escalate

### Step 4: Create quick_check.json
Path: ~/clawd/users/[USER_ID]/data/reports/[TICKER]/quick_check.json
```json
{
  "ticker": "TICKER",
  "timestamp": "ISO_DATE",
  "sentiment_score": number|null,
  "catalyst_triggered": boolean,
  "unexpected_event": boolean,
  "needs_escalation": boolean,
  "escalation_reason": string|null,
  "escalated_to_job_id": string|null,
  "used_briefing": boolean
}
```

### Step 5: Escalate if needed
If needs_escalation = true:
- Create deep_dive trigger file for same ticker
- Set escalated_to_job_id to the new job ID

### Important: 2-minute timeout
Quick check MUST complete within 2 minutes. If taking longer, abort and mark job as failed.

---

## Mode 1 lightweight format (daily, non-escalated tickers only)

For each non-escalated ticker in daily brief, run only:
1. Sentiment analyst (news + analyst actions — fastest, most relevant daily signal)
2. Quick price check (live price vs exitConditions in strategy.json)

Do NOT run fundamentals, technical, macro, or risk analysts in daily brief
unless escalation is triggered. Those run in Mode 2 only.

This keeps daily briefs fast and cheap.
