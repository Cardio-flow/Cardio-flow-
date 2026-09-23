#!/bin/sh
# Restart the local in-memory dev server (fresh synthetic data)
for pid in $(pgrep -f "node.*tsx.*server/index"); do kill "$pid" 2>/dev/null; done
sleep 1
CARDIO_DATA_DIR=memory PORT=4310 setsid nohup npx tsx server/index.ts > /tmp/cf-dev.log 2>&1 &
for i in $(seq 1 30); do curl -sf localhost:4310/api/health >/dev/null && break; sleep 1; done
curl -s localhost:4310/api/health
