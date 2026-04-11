#!/bin/bash
set -e

CLAWD_DIR="/root/clawd"
LOG_FILE="/var/log/clawd-deploy.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Deploy started ==="

retry_until_ok() {
  local attempts="$1"
  local sleep_seconds="$2"
  shift 2

  local i=1
  while [ "$i" -le "$attempts" ]; do
    if "$@"; then
      return 0
    fi
    sleep "$sleep_seconds"
    i=$((i + 1))
  done
  return 1
}

if [ ! -f "$CLAWD_DIR/data/model-profiles.json" ]; then
  log "ERROR: Missing $CLAWD_DIR/data/model-profiles.json"
  exit 1
fi

# 1. Pull latest code
log "Pulling latest code..."
cd "$CLAWD_DIR"
git pull origin main

# 2. Build backend
log "Building backend..."
cd "$CLAWD_DIR/backend"
npm ci --silent
npm run build
log "Backend built ✓"

# 3. Build frontend
log "Building frontend..."
cd "$CLAWD_DIR/frontend"
npm ci --silent
npm run build
log "Frontend built ✓"

# 4. Restart backend service
log "Restarting backend service..."
systemctl restart clawd-backend

# 5. Health check
HEALTH=$(retry_until_ok 10 2 curl -sf http://localhost:8081/api/health 2>/dev/null || true)
if echo "$HEALTH" | grep -q '"ok"'; then
  log "Health check ✓ — $HEALTH"
else
  log "ERROR: Health check failed — $HEALTH"
  log "=== Deploy FAILED ==="
  exit 1
fi

if retry_until_ok 10 2 openclaw agents list --json >/dev/null 2>&1; then
  log "OpenClaw agents check ✓"
else
  log "ERROR: OpenClaw agents check failed"
  log "=== Deploy FAILED ==="
  exit 1
fi

if [ -f "/root/.openclaw/cron/jobs.json" ]; then
  log "OpenClaw cron state file ✓"
else
  log "ERROR: Missing /root/.openclaw/cron/jobs.json"
  log "=== Deploy FAILED ==="
  exit 1
fi

log "=== Deploy complete ==="
