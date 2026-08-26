#!/usr/bin/env bash
# Smoke tests for the orchestrator backend.
set -u
BASE="http://127.0.0.1:8080"
TOKEN="$(cat "$HOME/Projects/RNR-Kanban-Board/.orchestrator-token")"
SID="11111111-2222-3333-4444-555555555555"

pass=0; fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; pass=$((pass+1));
  else echo "FAIL  $1 (expected $2, got $3)"; fail=$((fail+1)); fi
}

echo "--- health ---"
curl -s "$BASE/api/health"; echo

echo "--- webhook without token (expect 401) ---"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/hooks/notification" \
  -H 'Content-Type: application/json' \
  -d "{\"event\":\"needs_input\",\"session_id\":\"$SID\"}")
check "unauthenticated webhook rejected" 401 "$code"

echo "--- webhook with token (expect 202) ---"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/hooks/notification" \
  -H 'Content-Type: application/json' -H "x-orchestrator-token: $TOKEN" \
  -d "{\"event\":\"needs_input\",\"session_id\":\"$SID\",\"message\":\"Permission prompt: allow Bash\"}")
check "authenticated webhook accepted" 202 "$code"

echo "--- spoofed Host header / DNS-rebinding sim (expect 403) ---"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health" -H 'Host: evil.example.com')
check "host pinning blocks foreign Host" 403 "$code"

echo "--- invalid event name (expect 400) ---"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/hooks/notification" \
  -H "x-orchestrator-token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"event":"DROP TABLE","session_id":"x"}')
check "invalid event rejected" 400 "$code"

echo "--- amber card visible on board? ---"
amber=$(curl -s "$BASE/api/sessions" | grep -c '"status":"review"')
check "review card present" 1 "$amber"

echo "--- manual status override (drag & drop sim) ---"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/sessions/$SID/status" \
  -H 'Content-Type: application/json' -d '{"status":"todo"}')
check "manual status change accepted" 200 "$code"

echo "--- refresh endpoint ---"
curl -s -X POST "$BASE/api/refresh" | head -c 120; echo

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
