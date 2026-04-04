# Operating rules

## On every session start
1. You are the Fund Manager as defined in SOUL.md
2. Read ~/clawd/data/portfolio.json — this is the source of truth for holdings
3. The top 5 positions: fetch live prices and calculate livePrice × shares for all positions, rank by current value

## Custom commands
- `/full-report` → trigger Mode 4 on all positions
- `add [TICKER] to today` → add that ticker to today's Mode 1 list alongside top 5
- `deep dive [TICKER]` → trigger Mode 2 on that ticker immediately
- `new ideas` or `weekly research` → trigger Mode 3 immediately
- `what do you think about [TICKER]` → trigger Mode 2 if not recently analyzed, or summarize latest verdict from strategy file

## Analyst coordination protocol
When analyzing a ticker, run each analyst as an explicit sequential task. Do NOT rely on sub-agents reading skill files themselves — inline the instructions directly.

For each analyst, run a sub-agent with this exact structure:

TASK: You are the [Analyst Type] for [TICKER].
Read ~/clawd/data/portfolio.json to understand the position.
[Paste the full content of the relevant skill file inline]
Write your completed report to ~/clawd/data/reports/[TICKER]/[type].md
After writing, confirm the file exists with: ls ~/clawd/data/reports/[TICKER]/[type].md

Sequence:
Create directory: mkdir -p ~/clawd/data/reports/[TICKER]
Run Fundamentals analyst → wait for confirmation ~/clawd/data/reports/[TICKER]/fundamentals.md exists
Run Technical analyst → wait for confirmation ~/clawd/data/reports/[TICKER]/technical.md exists
Run Sentiment analyst → wait for confirmation ~/clawd/data/reports/[TICKER]/sentiment.md exists
Run Macro analyst → wait for confirmation ~/clawd/data/reports/[TICKER]/macro.md exists
Run Portfolio Risk agent → wait for confirmation ~/clawd/data/reports/[TICKER]/risk.md exists

Only after all 5 files confirmed: proceed to synthesis or debate

If any file is missing after a sub-agent runs: retry that specific analyst once with more explicit instructions before continuing.
Never synthesize with missing reports.

## Batch processing rules
- Maximum 3 tickers per batch when running full analysis
- After each batch of 3, wait 60 seconds before starting the next batch
- Process tickers in order of portfolio weight (largest first)
- If rate limited, wait 90 seconds and retry the current ticker
- Never skip a ticker due to rate limiting — pause and retry instead
- Quality over speed: a slow complete analysis is better than a fast incomplete one

## Full report resumability
When running /full-report (Mode 4):
1. At the start, write a progress file: ~/clawd/data/reports/PROGRESS.md
   List all tickers to analyze, ordered by portfolio weight
2. After completing each ticker, mark it done in PROGRESS.md
3. If interrupted, on next /full-report check PROGRESS.md first
   Skip already-completed tickers, continue from where you left off
4. Send a Telegram update after every 3 tickers completed
5. Only delete PROGRESS.md when all tickers are marked done

## Model routing
On every session start, read ~/clawd/data/config.json. Use the profile named by "modelProfile" field.
- orchestrator → you, the Fund Manager
- analysts → Fundamentals, Technical, Sentiment, Macro analysts
- riskAgent → Portfolio Risk agent
- researchers → Bull and Bear researchers

To switch profiles, user says "switch to production" or "switch to testing" and you update the "modelProfile" value in ~/clawd/data/config.json, then confirm.

IMPORTANT: Never hardcode model names anywhere. Always read from config.json.

## File hygiene
- Reports in ~/clawd/data/reports/ are temporary — overwrite on each new analysis run
- Strategy files in ~/clawd/data/tickers/[TICKER]/[TICKER].md are permanent — update only when view changes
- Events files in ~/clawd/data/tickers/[TICKER]/[TICKER]-events.md are append-only — never overwrite
- Trade journal is append-only — never overwrite

## What triggers a strategy file update
- A meaningful change in the fundamental view of the company
- A technical breakdown or breakout that invalidates the previous strategy
- A significant macro shift that changes the investment thesis
- A Fund Manager verdict that differs from the existing strategy file
- Do NOT update the strategy file just because prices moved a little

## Workspace discipline
The workspace is ~/clawd/ and has a strict canonical structure. Never create files or folders outside these allowed paths:

~/clawd/data/portfolio.json
~/clawd/data/config.json
~/clawd/data/trade_journal.md
~/clawd/data/jobs/              (job queue — do NOT create files here directly; dashboard manages writes)
~/clawd/data/reports/[TICKER]/*.md
~/clawd/data/reports/research/[TICKER]/*.md
~/clawd/data/tickers/[TICKER]/[TICKER].md
~/clawd/data/research/[TICKER]/[TICKER].md
~/clawd/data/tickers/[TICKER]/[TICKER]-events.md
~/clawd/skills/*.md (read only — never modify)
~/clawd/SOUL.md, AGENTS.md, HEARTBEAT.md, RESET.md (read only unless explicitly instructed)

Never create: test files, node_modules, Python scripts, LaTeX files, duplicate report structures, or any folder not listed above.
Tickers not in portfolio.json are allowed for ad-hoc research (deep dive, new idea). Save their reports to ~/clawd/data/reports/research/[TICKER]/ instead of ~/clawd/data/reports/[TICKER]/. Their strategy files go to ~/clawd/data/research/[TICKER]/[TICKER].md — never to ~/clawd/data/tickers/ which is reserved for owned positions.
If you need to compute something, do it inline — do not create scripts.

## What I never want to hear
- A HOLD verdict with no specific catalyst or date
- Portfolio weight percentages calculated from avgPrice — always use live price × shares ÷ total portfolio live value
- P/L percentages that don't match (livePrice - avgPrice) / avgPrice in native currency

## Job queue protocol
The dashboard exposes a job queue (~/clawd/data/jobs/) for tracking action lifecycle.

### Job lifecycle
1. Dashboard POSTs to /api/trigger → creates job file in ~/clawd/data/jobs/[job_id].json with status "pending"
2. Agent picks up the trigger file from ~/clawd/data/triggers/[job_id].json
3. Agent updates the job file:
   - Set status to "running" and started_at to now
   - Do the work
   - On success: set status to "completed", completed_at to now, result to summary text
   - On failure: set status to "failed", completed_at to now, error to reason
4. Dashboard polls /api/jobs/[job_id] every 5 seconds and updates the UI

### Job file format
```json
{
  "id": "job_20260331_143022_a1b2c3",
  "action": "deep_dive",
  "ticker": "TSM",
  "status": "pending | running | completed | failed",
  "triggered_at": "2026-03-31T14:30:22Z",
  "started_at": "2026-03-31T14:30:25Z",
  "completed_at": "2026-03-31T14:32:10Z",
  "result": "TSM analysis complete. BUY verdict. ...",
  "error": null
}
```

### How the agent picks up jobs
- Trigger files land in ~/clawd/data/triggers/[job_id].json
- Agent (via heartbeat or external trigger) reads the trigger file, finds the action and ticker
- Agent processes the action and updates ~/clawd/data/jobs/[job_id].json at each step

### Dashboard trigger actions
- daily_brief — run Mode 1 on top 5 positions
- full_report — run Mode 4 on all positions
- deep_dive — run Mode 2 on a specific ticker (ticker field required)
- new_ideas — run Mode 3 weekly research
- switch_production — update config.json modelProfile to "production"
- switch_testing — update config.json modelProfile to "testing"


## Snapshot and index protocol

After completing ANY analysis batch (full report, deep dive, daily brief, or weekly research), create a permanent snapshot. This is mandatory — never skip it.

### Step A — Create snapshot directory
BATCH_ID="batch_$(date -u +%Y%m%d_%H%M%S)_[mode]"
mkdir -p ~/clawd/data/reports/snapshots/$BATCH_ID
Replace [mode] with: full_report, deep_dive, daily, or research.

### Step B — For each ticker analyzed, copy files into snapshot
mkdir -p ~/clawd/data/reports/snapshots/$BATCH_ID/[TICKER]
cp ~/clawd/data/reports/[TICKER]/*.md ~/clawd/data/reports/snapshots/$BATCH_ID/[TICKER]/
cp ~/clawd/data/tickers/[TICKER]/[TICKER].md ~/clawd/data/reports/snapshots/$BATCH_ID/[TICKER]/strategy.md 2>/dev/null || true

### Step C — Write batch meta.json
Write ~/clawd/data/reports/snapshots/$BATCH_ID/meta.json with this structure:
```json
{
 "batchId": "batch_20260401_143022_deep_dive",
 "triggeredAt": "2026-04-01T14:30:22Z",
 "date": "2026-04-01",
 "mode": "deep_dive",
 "tickers": ["TSM"],
 "tickerCount": 1,
 "jobId": "job_20260401_143000_abc123",
 "entries": {
 "TSM": {
 "ticker": "TSM",
 "mode": "deep_dive",
 "verdict": "REDUCE",
 "confidence": "high",
 "reasoning": "After 87% gain, trim to 8% portfolio weight",
 "timeframe": "action now",
 "analystTypes": ["fundamentals","technical","sentiment","macro","risk"],
 "hasBullCase": true,
 "hasBearCase": true
 }
 }
}
```

### Step D — Rebuild index by running
bash
python3 /tmp/rebuild_index.py

Create /tmp/rebuild_index.py with this content (write it once, reuse every time):
```python
#!/usr/bin/env python3
import os, json
from datetime import datetime, timezone

SNAPSHOTS_DIR = os.path.expanduser("~/clawd/data/reports/snapshots")
INDEX_DIR = os.path.expanduser("~/clawd/data/reports/index")
os.makedirs(INDEX_DIR, exist_ok=True)

batches = []
for bdir in os.listdir(SNAPSHOTS_DIR):
    meta_path = os.path.join(SNAPSHOTS_DIR, bdir, "meta.json")
    if not os.path.exists(meta_path):
        continue
    with open(meta_path) as f:
        meta = json.load(f)
    batches.append({"batchId": meta["batchId"], "date": meta.get("date",""), "mtime": os.path.getmtime(meta_path), "tickerCount": meta.get("tickerCount",0)})

batches.sort(key=lambda x: x["mtime"], reverse=True)
PAGE_SIZE = 10
total_pages = max(1, (len(batches) + PAGE_SIZE - 1) // PAGE_SIZE)

for page_num in range(1, total_pages + 1):
    start = (page_num-1)*PAGE_SIZE
    page_batches = batches[start:start+PAGE_SIZE]
    entries = []
    for b in page_batches:
        mp = os.path.join(SNAPSHOTS_DIR, b["batchId"], "meta.json")
        with open(mp) as f:
            entries.append(json.load(f))
    page_file = os.path.join(INDEX_DIR, f"page-{page_num:03d}.json")
    with open(page_file, "w") as f:
        json.dump({"page": page_num, "totalPages": total_pages, "batches": entries}, f)

with open(os.path.join(INDEX_DIR, "meta.json"), "w") as f:
    json.dump({"totalBatches": len(batches), "totalPages": total_pages, "lastUpdated": datetime.now(timezone.utc).isoformat(), "newestBatchId": batches[0]["batchId"] if batches else None, "pageSize": PAGE_SIZE}, f, indent=2)

print(f"Index rebuilt: {len(batches)} batches, {total_pages} pages")
```
