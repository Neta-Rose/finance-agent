#!/bin/bash
set -e

CLAWD_DIR="/root/clawd"
LOG_FILE="/var/log/clawd-deploy.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Deploy started ==="

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
sleep 3

# 5. Health check
HEALTH=$(curl -sf http://localhost:8081/api/health 2>/dev/null)
if echo "$HEALTH" | grep -q '"ok"'; then
  log "Health check ✓ — $HEALTH"
  log "=== Deploy complete ==="
else
  log "ERROR: Health check failed — $HEALTH"
  log "=== Deploy FAILED ==="
  exit 1
fi
