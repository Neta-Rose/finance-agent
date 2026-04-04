# RESET PROTOCOL
*Canonical architecture definition and clean-slate restoration procedure*

---

## ⚠️ DOUBLE AUTHORIZATION REQUIRED

Before executing ANY step in this document, the agent must receive BOTH of these
confirmations from the user, in this exact order:

1. User types exactly: **CONFIRM RESET**
2. User types exactly: **YES I AM SURE**

If either is missing, misspelled, or out of order — abort immediately and do nothing.

---

## What this protocol does

DELETES:
- All ticker strategy files (`[TICKER].md`)
- All ticker events files (`[TICKER]-events.md`)
- All analyst report folders (`~/clawd/data/reports/`)
- The trade journal contents (file kept, content wiped)
- Any file in `~/clawd/data/` that is NOT `portfolio.json`, `trade_journal.md`, or `config.json`
- Any file in `~/clawd/data/tickers/` entirely (folders and all contents)

PRESERVES:
- `~/clawd/data/portfolio.json` — never touched
- `~/clawd/data/config.json` — model profiles preserved
- `~/clawd/data/jobs/` — job history survives reset (never deleted)
- All static architecture files (SOUL.md, AGENTS.md, HEARTBEAT.md, RESET.md)
- All skill files in `~/clawd/skills/`
- `~/clawd/canvas/` — OpenClaw internal

RECREATES:
- One folder per ticker found in portfolio.json, with empty `.md` and `-events.md`
- Empty `~/clawd/data/reports/` directory
- Fresh `~/clawd/data/trade_journal.md` with header only

---

## Step 1 — Wipe all dynamic data
```bash
# Remove entire tickers directory and all its contents
rm -rf ~/clawd/data/tickers/

# Remove entire reports directory and all its contents
rm -rf ~/clawd/data/reports/

# Remove ANY other files in data/ except portfolio.json
# This catches unexpected agent-created files like MODE2_BATCH_SUMMARY_*.md
find ~/clawd/data/ -maxdepth 1 -type f \
  ! -name "portfolio.json" \
  ! -name "config.json" \
  -delete

echo "All dynamic data wiped"
```

---

## Step 2 — Recreate clean structure from portfolio.json
```bash
# Recreate reports directory
mkdir -p ~/clawd/data/reports

# Recreate trade journal with clean header
cat > ~/clawd/data/trade_journal.md << 'EOF'
# Trade journal

Format: [YYYY-MM-DD] [TICKER] [DECISION] [REASONING] [OUTCOME if known]
Agents append here after significant decisions.
Fund Manager reads this before any recommendation.
EOF

# Extract all unique tickers from portfolio.json and create folders
# Works for any portfolio.json — no hardcoded ticker list
python3 - << 'PYEOF'
import json, os

with open(os.path.expanduser('~/clawd/data/portfolio.json')) as f:
    portfolio = json.load(f)

tickers = set()
for account in portfolio['accounts'].values():
    for position in account:
        tickers.add(position['ticker'])

base = os.path.expanduser('~/clawd/data/tickers')
os.makedirs(base, exist_ok=True)

for ticker in sorted(tickers):
    folder = os.path.join(base, ticker)
    os.makedirs(folder, exist_ok=True)
    open(os.path.join(folder, f'{ticker}.md'), 'w').close()
    open(os.path.join(folder, f'{ticker}-events.md'), 'w').close()
    print(f'Created: {ticker}/')

print(f'\nTotal: {len(tickers)} tickers from portfolio.json')
PYEOF
```

---

## Step 3 — Verify

Run this and confirm it matches expectations:
```bash
python3 - << 'PYEOF'
import json, os

with open(os.path.expanduser('~/clawd/data/portfolio.json')) as f:
    portfolio = json.load(f)

tickers = set()
for account in portfolio['accounts'].values():
    for position in account:
        tickers.add(position['ticker'])

base = os.path.expanduser('~/clawd/data/tickers')
errors = []

# Check every ticker from portfolio.json has its folder and both files
for ticker in sorted(tickers):
    strategy = os.path.join(base, ticker, f'{ticker}.md')
    events = os.path.join(base, ticker, f'{ticker}-events.md')
    if not os.path.exists(strategy):
        errors.append(f'MISSING: {ticker}/{ticker}.md')
    elif os.path.getsize(strategy) != 0:
        errors.append(f'NOT EMPTY: {ticker}/{ticker}.md')
    if not os.path.exists(events):
        errors.append(f'MISSING: {ticker}/{ticker}-events.md')
    elif os.path.getsize(events) != 0:
        errors.append(f'NOT EMPTY: {ticker}/{ticker}-events.md')

# Check no extra folders exist that aren't in portfolio.json
if os.path.exists(base):
    for folder in os.listdir(base):
        if folder not in tickers:
            errors.append(f'UNEXPECTED FOLDER: {folder}')

# Check data/ has no unexpected files
data_dir = os.path.expanduser('~/clawd/data')
allowed_files = {'portfolio.json', 'trade_journal.md', 'config.json'}
for f in os.listdir(data_dir):
    full = os.path.join(data_dir, f)
    if os.path.isfile(full) and f not in allowed_files:
        errors.append(f'UNEXPECTED FILE IN data/: {f}')

# Check reports/ is empty
reports = os.path.join(data_dir, 'reports')
if os.path.exists(reports) and os.listdir(reports):
    errors.append('reports/ directory is not empty')

if errors:
    print('VERIFICATION FAILED:')
    for e in errors:
        print(f'  ✗ {e}')
else:
    print(f'VERIFICATION PASSED')
    print(f'  ✓ {len(tickers)} tickers from portfolio.json, all folders clean')
    print(f'  ✓ data/ contains only portfolio.json and trade_journal.md')
    print(f'  ✓ reports/ is empty')
    print(f'  ✓ No unexpected files or folders')
PYEOF
```

Output must show `VERIFICATION PASSED` with no errors before proceeding.

---

## Step 4 — Restart gateway
```bash
clawdbot gateway restart && sleep 10 && clawdbot health
```

System is now clean. Proceed with `/full-report` to repopulate all strategy files.

---

## Canonical architecture reference

### The allowed file whitelist

**`~/clawd/` root — exactly these files and folders:**
```
AGENTS.md       — procedural rules, commands, model routing
HEARTBEAT.md    — schedule definition
RESET.md        — this file
SOUL.md         — Fund Manager identity and operating modes
canvas/         — OpenClaw internal UI (never touch)
data/           — all dynamic data
skills/         — analyst role definitions
IDENTITY.md     — intentionally empty (OpenClaw recreates on restart)
TOOLS.md        — intentionally empty (OpenClaw recreates on restart)
USER.md         — intentionally empty (OpenClaw recreates on restart)
```

**`~/clawd/skills/` — exactly these 7 files:**
```
fundamentals-analyst.md
technical-analyst.md
sentiment-analyst.md
macro-analyst.md
portfolio-risk.md
bull-researcher.md
bear-researcher.md
```

**`~/clawd/data/` — exactly these entries:**
```
portfolio.json          — source of truth for holdings (NEVER deleted)
config.json             — model profile definitions (preserved)
jobs/                   — job queue history (preserved on reset)
trade_journal.md        — append-only decision log
reports/                — temporary analyst outputs (overwritten each run)
reports/research/       — ad-hoc research on non-portfolio stocks (preserved)
research/              — strategy files for non-portfolio research (preserved)
tickers/               — one subfolder per ticker from portfolio.json
```

**`~/clawd/data/tickers/[TICKER]/` — exactly these 2 files per ticker:**
```
[TICKER].md             — living strategy document
[TICKER]-events.md      — append-only dated events log
```

**`~/clawd/data/reports/[TICKER]/` — temporary, created per run:**
```
fundamentals.md
technical.md
sentiment.md
macro.md
risk.md
bull_case.md            (Mode 2/3 only)
bear_case.md            (Mode 2/3 only)
```

**`~/clawd/data/reports/` — allowed top-level files:**
```
PROGRESS.md             (temporary, deleted when full report completes)
```

Any file not in the above whitelist is unexpected and should be deleted.

---

## Canonical content summary of static files

### SOUL.md
*Last authorized change: 2026-03-28*
- Begins with: `# PRIMARY CONFIGURATION — this file overrides all other workspace files`
- Sections: Identity, Your team (7 agents), Four operating modes, Persistent memory per ticker, Report formats (3 formats), What you never do
- Mode 1: top 5 by live price × shares, no debate unless diverging
- Mode 2: divergence triggered, full 5-analyst + 2-round Bull/Bear debate
- Mode 3: Sunday 7pm, new opportunities only, full pipeline
- Mode 4: `/full-report`, all positions, escalates stale ones

### AGENTS.md
*Last authorized change: 2026-03-28*
- Session start: read portfolio.json, rank positions by live price × shares
- Batch size: max 3 tickers, 60 second pause between batches
- Rate limit: wait 90 seconds, retry same ticker, never skip
- Resumability: write PROGRESS.md, mark done after each ticker, delete when complete
- Model routing: Fund Manager = Opus 4.6 | Analysts = Sonnet 4.5 | Portfolio Risk = Haiku 4.5 | Researchers = Opus 4.6
- File hygiene: reports/ temporary | tickers/ permanent | events append-only

### HEARTBEAT.md
*Last authorized change: 2026-03-28*
- 8:00 AM Israel time, weekdays: Mode 1 on top 5
- Sunday 7:00 PM Israel time: Mode 3 weekly research
- Ambient 30-min pulse: HEARTBEAT_OK unless material event detected

### portfolio-risk.md
*Last authorized change: 2026-03-28*
- MUST fetch live price at runtime for every calculation
- NEVER use avgPrice as current value — avgPrice is only for P/L calculation
- P/L = (livePrice − avgPrice) × shares
- Total portfolio estimated by fetching live prices for top 5, avgPrice × shares for rest

---

## Changelog

| Date | Change | Authorized by |
|------|--------|---------------|
| 2026-03-28 | Initial architecture created | User |
| 2026-03-28 | portfolio-risk.md: live prices only, never avgPrice as value | User |
| 2026-03-28 | AGENTS.md: batch size 3, resumability, 60s pause, rate limit retry | User |
| 2026-03-28 | RESET.md: self-deriving from portfolio.json, python verify script | User |
| 2026-03-28 | SOUL.md Mode 4: explicit re-read of AGENTS.md on /full-report | User |
| 2026-03-29 | config.json created — model profile switching, testing=DeepSeek/Gemini, production=Claude | User |
| 2026-03-29 | RESET.md: config.json added to preserved files whitelist | User |
