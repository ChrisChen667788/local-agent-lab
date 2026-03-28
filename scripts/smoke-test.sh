#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3011}"
FAILURES=0

check_http_200() {
  local label="$1"
  local url="$2"
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" "$url" || true)"
  if [[ "$code" == "200" ]]; then
    echo "[ok] $label -> $code"
  else
    echo "[fail] $label -> $code"
    FAILURES=$((FAILURES + 1))
  fi
}

check_json_field() {
  local label="$1"
  local url="$2"
  local js="$3"
  local body
  body="$(curl -fsS "$url" || true)"
  if [[ -z "$body" ]]; then
    echo "[fail] $label -> empty response"
    FAILURES=$((FAILURES + 1))
    return
  fi
  if printf "%s" "$body" | node -e "const fs=require('fs'); const input=fs.readFileSync(0,'utf8'); const data=JSON.parse(input); if (!(${js})) process.exit(1);" ; then
    echo "[ok] $label"
  else
    echo "[fail] $label"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "== UI =="
check_http_200 "Agent" "$BASE_URL/agent"
check_http_200 "Admin" "$BASE_URL/admin"

echo
echo "== Agent APIs =="
check_json_field "Sessions route" "$BASE_URL/api/agent/sessions" "Array.isArray(data.sessions)"
check_json_field "Local 0.6B runtime" "$BASE_URL/api/agent/runtime?targetId=local-qwen3-0.6b" "data.targetId==='local-qwen3-0.6b'"
check_json_field "Local 4B runtime" "$BASE_URL/api/agent/runtime?targetId=local-qwen3-4b-4bit" "data.targetId==='local-qwen3-4b-4bit'"

echo
echo "== Admin APIs =="
check_json_field "Knowledge base snapshot" "$BASE_URL/api/admin/knowledge-base" "Array.isArray(data.documents)"
check_json_field "Latest benchmark progress" "$BASE_URL/api/admin/benchmark/progress?latest=1" "typeof data === 'object'"
check_json_field "Dashboard summary" "$BASE_URL/api/admin/dashboard?targetId=anthropic-claude&windowMinutes=720" "typeof data.summary === 'object'"

if [[ "${SMOKE_RUN_REMOTE_BENCHMARK:-0}" == "1" ]]; then
  echo
  echo "== Optional remote benchmark smoke =="
  curl -fsS "$BASE_URL/api/admin/benchmark" \
    -H "Content-Type: application/json" \
    -d '{
      "benchmarkMode":"prompt",
      "prompt":"请用一句话概括本地 Agent 工作台的价值。",
      "runs":1,
      "contextWindow":8192,
      "targetIds":["openai-gpt-5.4"],
      "providerProfile":"balanced",
      "thinkingMode":"standard"
    }' >/tmp/local-agent-smoke-benchmark.json
  check_json_field "Remote benchmark smoke" "file:///tmp/local-agent-smoke-benchmark.json" "Array.isArray(data.results) && data.results.length>0"
fi

echo
if [[ "$FAILURES" -gt 0 ]]; then
  echo "Smoke test finished with $FAILURES failure(s)."
  exit 1
fi

echo "Smoke test passed."
