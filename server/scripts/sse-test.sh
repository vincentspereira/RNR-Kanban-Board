#!/usr/bin/env bash
# Verifies Server-Sent Events push live board updates.
set -eu
BASE="http://127.0.0.1:8080"
ROOT="$HOME/Projects/RNR-Kanban-Board"
TOKEN="$(cat "$ROOT/.orchestrator-token")"

timeout 6 curl -s -N "$BASE/api/events" > /tmp/sse.txt &
CURL_PID=$!
sleep 1

curl -s -o /dev/null -X POST "$BASE/hooks/notification" \
  -H 'Content-Type: application/json' -H "x-orchestrator-token: $TOKEN" \
  -d '{"event":"needs_input","session_id":"99999999-8888-7777-6666-555555555555","message":"SSE live test"}'

wait $CURL_PID 2>/dev/null || true

echo "=== SSE frames received ==="
head -c 600 /tmp/sse.txt
echo
if grep -q '"status":"review"' /tmp/sse.txt && grep -q 'SSE live test' /tmp/sse.txt; then
  echo "SSE PUSH: PASS"
else
  echo "SSE PUSH: FAIL"
  exit 1
fi
