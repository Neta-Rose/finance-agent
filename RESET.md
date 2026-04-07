# RESET.md — Per-User Reset Protocol
# Last authorized change: 2026-04-07

---

## ⚠️ DOUBLE AUTHORIZATION REQUIRED

Before executing any reset step, the agent must receive BOTH confirmations
from the user, in this exact order:

1. User types exactly: CONFIRM RESET
2. User types exactly: YES I AM SURE

If either is missing, misspelled, or out of order: abort immediately.
Never proceed with a partial confirmation.

---

## What this protocol does

### DELETES (per-user workspace only):
- All analyst report files: ~/clawd/users/[USER_ID]/data/reports/
- All strategy files content (files kept, content wiped to empty stubs)
- All events.jsonl content (files kept, wiped)
- Trade journal content (file kept, wiped)
- All job history: ~/clawd/users/[USER_ID]/data/jobs/
- All trigger files: ~/clawd/users/[USER_ID]/data/triggers/

### PRESERVES (never touched):
- ~/clawd/users/[USER_ID]/data/portfolio.json — source of truth
- ~/clawd/users/[USER_ID]/data/config.json — model profiles
- ~/clawd/users/[USER_ID]/data/state.json — reset to BOOTSTRAPPING
- ~/clawd/users/[USER_ID]/profile.json — user settings
- ~/clawd/users/[USER_ID]/auth.json — credentials
- ~/clawd/skills/ — shared read-only templates
- ~/clawd/SOUL.md, AGENTS.md, HEARTBEAT.md, RESET.md — system files

### NEVER touches:
- Any other user's workspace
- System files outside ~/clawd/users/[USER_ID]/
- The backend codebase

---

## Reset steps

### Step 1 — Wipe dynamic data
```bash
# Reports
rm -rf ~/clawd/users/[USER_ID]/data/reports/
mkdir -p ~/clawd/users/[USER_ID]/data/reports/snapshots
mkdir -p ~/clawd/users/[USER_ID]/data/reports/index

# Jobs and triggers
rm -f ~/clawd/users/[USER_ID]/data/jobs/*.json
rm -f ~/clawd/users/[USER_ID]/data/triggers/*.json
```

### Step 2 — Rebuild strategy stubs from portfolio.json
```python
import json, os
from datetime import datetime, timezone

USER_ID = "[USER_ID]" # injected at runtime
BASE = f"/root/clawd/users/{USER_ID}/data"
NOW = datetime.now(timezone.utc).isoformat()

with open(f"{BASE}/portfolio.json") as f:
    portfolio = json.load(f)

tickers = set()
for account in portfolio["accounts"].values():
    for pos in account:
        tickers.add(pos["ticker"])

for ticker in sorted(tickers):
    ticker_dir = f"{BASE}/tickers/{ticker}"
    os.makedirs(ticker_dir, exist_ok=True)

    stub = {
        "ticker": ticker,
        "updatedAt": NOW,
        "version": 1,
        "verdict": "HOLD",
        "confidence": "low",
        "reasoning": "Reset — awaiting fresh analysis.",
        "timeframe": "undefined",
        "positionSizeILS": 0,
        "positionWeightPct": 0,
        "entryConditions": [],
        "exitConditions": [],
        "catalysts": [],
        "bullCase": None,
        "bearCase": None,
        "lastDeepDiveAt": None,
        "deepDiveTriggeredBy": None
    }
    with open(f"{ticker_dir}/strategy.json", "w") as f:
        json.dump(stub, f, indent=2)

    # Wipe events.jsonl
    open(f"{ticker_dir}/events.jsonl", "w").close()

print(f"Reset complete: {len(tickers)} ticker stubs recreated")
```

### Step 3 — Reset state to BOOTSTRAPPING
```python
import json, os
from datetime import datetime, timezone

USER_ID = "[USER_ID]"
state_file = f"/root/clawd/users/{USER_ID}/data/state.json"

with open(state_file) as f:
    state = json.load(f)

state["state"] = "BOOTSTRAPPING"
state["lastFullReportAt"] = None
state["lastDailyAt"] = None
state["pendingDeepDives"] = []
state["bootstrapProgress"] = {
    "total": 0,  # will be set when full_report starts
    "completed": 0,
    "completedTickers": []
}

with open(state_file, "w") as f:
    json.dump(state, f, indent=2)

print("State reset to BOOTSTRAPPING")
```

### Step 4 — Verify
```python
import json, os

USER_ID = "[USER_ID]"
BASE = f"/root/clawd/users/{USER_ID}/data"

with open(f"{BASE}/portfolio.json") as f:
    portfolio = json.load(f)

tickers = set()
for account in portfolio["accounts"].values():
    for pos in account:
        tickers.add(pos["ticker"])

errors = []
for ticker in sorted(tickers):
    sfile = f"{BASE}/tickers/{ticker}/strategy.json"
    efile = f"{BASE}/tickers/{ticker}/events.jsonl"
    if not os.path.exists(sfile):
        errors.append(f"MISSING strategy.json: {ticker}")
    else:
        with open(sfile) as f:
            d = json.load(f)
        if d.get("reasoning") != "Reset — awaiting fresh analysis.":
            errors.append(f"NOT RESET: {ticker}/strategy.json")
    if not os.path.exists(efile):
        errors.append(f"MISSING events.jsonl: {ticker}")
    elif os.path.getsize(efile) != 0:
        errors.append(f"NOT EMPTY: {ticker}/events.jsonl")

reports_dir = f"{BASE}/reports"
for item in os.listdir(reports_dir):
    if item not in ("snapshots", "index"):
        errors.append(f"UNEXPECTED in reports/: {item}")

if errors:
    print("VERIFICATION FAILED:")
    for e in errors:
        print(f"  ✗ {e}")
else:
    print(f"VERIFICATION PASSED — {len(tickers)} tickers reset cleanly")
```

### Step 5 — Queue fresh full report
Create a new full_report trigger file so the agent runs a fresh analysis immediately after reset.
The dashboard /api/jobs/trigger endpoint handles this — or the user can type `/full-report`.

---

## What this reset does NOT do

- Does not delete the user account or credentials
- Does not modify portfolio.json — holdings are preserved
- Does not affect other users
- Does not touch the backend codebase or skill files
- Does not remove historical snapshots (those are in reports/snapshots/ which is preserved)
  → If you want to wipe snapshots too, say "RESET INCLUDING HISTORY" and confirm again
