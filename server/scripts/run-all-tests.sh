#!/usr/bin/env bash
# Runs every verification suite against a live server instance.
set -u
ROOT="$HOME/Projects/RNR-Kanban-Board"
SERVER_DIR="$ROOT/server"

source ~/.nvm/nvm.sh >/dev/null 2>&1

cd "$SERVER_DIR" || exit 1
node src/index.js > /tmp/orch.log 2>&1 &
PID=$!
sleep 3

echo "================ UNIT TESTS ================"
npm test 2>&1 | grep -E 'ℹ (tests|pass|fail)'

echo "================ SMOKE TESTS ================"
bash scripts/smoke-test.sh
SMOKE_RC=$?

echo "================ FEATURE CHECKS ================"
bash scripts/feature-test.sh

kill "$PID" 2>/dev/null
wait "$PID" 2>/dev/null
exit $SMOKE_RC
