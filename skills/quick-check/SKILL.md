# Quick Check Skill
# Version: 1.0 (Server-Assisted)
# Last updated: 2026-04-11

## Purpose
Perform a quick check on a single ticker using pre-loaded data from server briefing.

## When to use
- Triggered by "quick_check" action in HEARTBEAT.md
- When a trigger file contains "briefing" data (server pre-loaded)
- Fallback: reads files directly if no briefing

## Input
Trigger file JSON with:
- `action`: "quick_check"
- `ticker`: ticker symbol
- `briefing`: (optional) server-preloaded data containing:
  - `sentiment`: sentiment.json data
  - `strategy`: strategy.json data  
  - `is_portfolio_ticker`: boolean
  - `sentiment_error` / `strategy_error`: if files missing

## Output
1. Creates `/data/reports/[TICKER]/quick_check.json`
2. Updates job status to "completed"
3. Optionally creates deep_dive trigger if escalation needed

## Logic
1. **Check for briefing data** in trigger file
2. **If briefing exists**:
   - Use briefing.sentiment, briefing.strategy
   - Skip file reading entirely
3. **If no briefing** (fallback):
   - Read sentiment.json
   - Read strategy.json
   - Read portfolio.json
4. **Analyze**:
   - Check sentiment for major events
   - Check strategy catalysts
   - Decide: escalate to deep_dive or not
5. **Write quick_check.json** with decision
6. **Update job** status

## Error handling
- If briefing has errors (e.g., "File not found"), log but continue
- If sentiment analysis fails, write partial result
- Always update job status (success/failure)

## Example quick_check.json
```json
{
  "ticker": "AAPL",
  "timestamp": "2026-04-11T14:31:32.000Z",
  "sentiment_score": 0.7,
  "catalyst_triggered": false,
  "unexpected_event": false,
  "needs_escalation": false,
  "escalation_reason": null,
  "escalated_to_job_id": null
}
```