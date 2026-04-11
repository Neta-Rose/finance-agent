# HEARTBEAT.md — Schedule and Trigger Protocol
# Last authorized change: 2026-04-07

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
      - "switch_production" → update config.json modelProfile → "production"
      - "switch_testing" → update config.json modelProfile → "testing"
   e. On success: update job file → status "completed", completed_at, result (max 200 chars)
   f. On failure: update job file → status "failed", completed_at, error (max 200 chars)
3. Only after ALL trigger files are processed: proceed to scheduled tasks below

---

## Scheduled tasks

### Daily brief — 8:00 AM Israel time (UTC+3), weekdays only
Override time with user's schedule.dailyBriefTime from profile.json.

1. Read ~/clawd/users/[USER_ID]/data/portfolio.json
2. Fetch live prices for all positions, sort by currentValueILS descending
3. Take top 5 positions
4. Run condition check (conditionEngine equivalent):
   - For each top-5 ticker: read strategy.json
   - Check expired catalysts, hold_no_catalyst, stale_low_confidence
5. For tickers with no escalation needed:
   - Run Mode 1 (lightweight — fundamentals + sentiment only, no technical/macro/risk)
   - Report: ON_TRACK or WATCH
6. For tickers needing escalation:
   - Immediately run Mode 2 (full pipeline + bull/bear debate)
   - Update strategy.json
7. Send Telegram briefing:
   - Header: date, portfolio total value, daily P/L
   - Per ticker: verdict badge, one-line status, any escalation note
   - Footer: X on-track, Y escalated, Z pending deep dives

### Weekly research — Sunday 7:00 PM Israel time
Override day/time with user's schedule from profile.json.

1. Run Mode 3 — new opportunities research
2. Half from sectors already in portfolio
3. Half from new sectors/asset classes
4. Full 5-analyst + bull/bear pipeline per candidate
5. Write to ~/clawd/users/[USER_ID]/data/research/[TICKER]/strategy.json
6. Send Telegram: structured new-idea cards

---

## Ambient heartbeat — every 30 minutes

If no scheduled task is running and no trigger files pending:
- Reply: HEARTBEAT_OK
- Do NOT run analyst pipelines
- Do NOT fetch live prices
- Do NOT write any files

Exception: if a Telegram message arrived since last heartbeat that mentions
a specific ticker + urgent language ("crash", "news", "dropped", "spiked"):
- Run a quick sentiment check on that ticker only (sentiment analyst, no other analysts)
- Report finding to Telegram
- Do NOT update strategy.json from an ambient check — flag only

---

## State-aware behavior

Read ~/clawd/users/[USER_ID]/data/state.json before any scheduled task:

- state = "UNINITIALIZED": do nothing. Inform user onboarding is required.
- state = "BOOTSTRAPPING": check bootstrapProgress.
  If full_report job is pending or running: report progress only, do not start new tasks.
  If full_report job is completed: transition state → "ACTIVE", run first daily brief.
- state = "ACTIVE": proceed normally with schedule above.

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

## Mode 1 lightweight format (daily, non-escalated tickers only)

For each non-escalated ticker in daily brief, run only:
1. Sentiment analyst (news + analyst actions — fastest, most relevant daily signal)
2. Quick price check (live price vs exitConditions in strategy.json)

Do NOT run fundamentals, technical, macro, or risk analysts in daily brief
unless escalation is triggered. Those run in Mode 2 only.

This keeps daily briefs fast and cheap.
