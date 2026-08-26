#!/usr/bin/env bash
# Integration checks for the v0.2 feature set.
set -u
ROOT="$HOME/Projects/RNR-Kanban-Board"
BASE="http://127.0.0.1:8080"
TOKEN="$(cat "$ROOT/.orchestrator-token")"

echo "== hooks-snippet endpoint (C6) =="
curl -s "$BASE/api/hooks-snippet" | head -c 220; echo

echo "== terminalActive flag present (A3) =="
curl -s "$BASE/api/sessions" | grep -o '"terminalActive":[a-z]*' | sort | uniq -c | head -3

echo "== refresh (C1 stall flags run inside) =="
curl -s -X POST "$BASE/api/refresh"; echo

sleep 1
echo "== persistence snapshot written (A2) =="
if [ -f "$ROOT/.orchestrator-state.json" ]; then
  echo "state file exists; preview:"
  head -c 180 "$ROOT/.orchestrator-state.json"; echo
else
  echo "FAIL: state file missing"
fi

echo "== worktree merge guard on fake session (B1 safety) =="
curl -s -X POST "$BASE/api/sessions/11111111-2222-3333-4444-555555555555/worktree/merge" \
  -H "x-orchestrator-token: $TOKEN"; echo

echo "== resolve-grid graceful failure outside Windows Terminal (B2) =="
curl -s -X POST "$BASE/api/resolve-grid" -H "x-orchestrator-token: $TOKEN"; echo
