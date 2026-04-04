# Heartbeat schedule

## On every heartbeat and session start — check pending jobs

Before running any scheduled task, check ~/clawd/data/triggers/ for .json trigger files:
1. For each trigger file found: read it, extract action and ticker
2. Update ~/clawd/data/jobs/[job_id].json — set status to "running", started_at to now
3. Delete the trigger file immediately (prevents double-processing)
4. Execute the action:
   - "deep_dive" + ticker → run Mode 2 on that ticker
   - "daily_brief" → run Mode 1
   - "full_report" → run Mode 4
   - "new_ideas" → run Mode 3
   - "switch_production" → update ~/clawd/data/config.json modelProfile to "production", confirm
   - "switch_testing" → update ~/clawd/data/config.json modelProfile to "testing", confirm
5. On success: update job file with status "completed", completed_at, result summary (2-3 sentences)
6. On failure: update job file with status "failed", completed_at, error message
7. Only after job file is written and trigger file is deleted, proceed with any scheduled task

## Daily — 8:00 AM Israel time (UTC+3), weekdays only

Run Mode 1 daily brief:
1. Read ~/clawd/data/portfolio.json
2. Sort all positions by currentValueILS descending
3. Take top 5
4. For each: run all 5 analysts, check strategy file, assess status
5. Compile briefing and send to Telegram

## Weekly — Sunday 7:00 PM Israel time

Run Mode 3 weekly deep research:
1. Read portfolio.json to understand current exposures
2. Identify 3-5 new opportunities not already in portfolio
3. Run full analyst + debate pipeline on each
4. Send structured new-idea report to Telegram

## Heartbeat ambient check (every 30 minutes, outside scheduled tasks)

- If nothing is scheduled and no pending triggers: reply HEARTBEAT_OK
- If any position in portfolio.json has had a major news event flagged by recent Telegram conversation: run a quick sentiment check and report
- Do not run full analyst pipelines during ambient heartbeat — that is scheduled work only

(Why: lean HEARTBEAT.md with only three things: daily brief, weekly research, and ambient sentinel. Nothing else. Ambient heartbeat doesn't run expensive pipelines — it just watches.)
