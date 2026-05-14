#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRIMARY_NODE="/opt/homebrew/opt/node@22/bin/node"
NODE_BIN="${NODE22_BIN:-}"
CURRENT_NODE="$(command -v node || true)"

node_major_version() {
  local binary="$1"
  [[ -x "$binary" ]] || return 1
  "$binary" -p 'process.versions.node.split(".")[0]' 2>/dev/null
}

if [[ -z "$NODE_BIN" ]]; then
  if [[ -x "$PRIMARY_NODE" ]]; then
    NODE_BIN="$PRIMARY_NODE"
  elif [[ -n "$CURRENT_NODE" ]] && [[ "$(node_major_version "$CURRENT_NODE")" == "22" ]]; then
    NODE_BIN="$CURRENT_NODE"
  else
    echo "[lint] Node 22 binary not found. Install node@22 or set NODE22_BIN." >&2
    exit 1
  fi
fi

cd "$ROOT"
export PATH="$(dirname "$NODE_BIN"):$PATH"
export NODE="$NODE_BIN"
export npm_node_execpath="$NODE_BIN"
export NODE_BINARY="$NODE_BIN"
export NEXT_TELEMETRY_DISABLED=1
export NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-dev}"

run_with_heartbeat() {
  local label="$1"
  shift
  local heartbeat_seconds="${LINT_HEARTBEAT_SECONDS:-10}"
  local timeout_seconds="${LINT_STEP_TIMEOUT_SECONDS:-900}"
  local elapsed=0

  "$@" &
  local pid=$!

  while kill -0 "$pid" 2>/dev/null; do
    sleep "$heartbeat_seconds"
    elapsed=$((elapsed + heartbeat_seconds))
    if kill -0 "$pid" 2>/dev/null; then
      printf '[lint] %s still running... %ss elapsed\n' "$label" "$elapsed"
      if [[ "$elapsed" -ge "$timeout_seconds" ]]; then
        printf '[lint] %s exceeded %ss, stopping it.\n' "$label" "$timeout_seconds" >&2
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        return 124
      fi
    fi
  done

  wait "$pid"
}

printf '[lint] using %s at %s\n' "$($NODE_BIN -v)" "$NODE_BIN"
printf '[lint] checking source hygiene...\n'
run_with_heartbeat "source hygiene" "$NODE_BIN" scripts/source-hygiene.mjs

if [[ "${RUN_TYPECHECK:-0}" == "1" ]]; then
  printf '[lint] RUN_TYPECHECK=1, delegating TypeScript no-emit check to scripts/run-typecheck.sh...\n'
  TYPECHECK_HEARTBEAT_SECONDS="${TYPECHECK_HEARTBEAT_SECONDS:-${LINT_HEARTBEAT_SECONDS:-30}}" \
    TYPECHECK_STEP_TIMEOUT_SECONDS="${TYPECHECK_STEP_TIMEOUT_SECONDS:-${LINT_STEP_TIMEOUT_SECONDS:-900}}" \
    scripts/run-typecheck.sh "${TYPECHECK_SCOPE:-full}"
else
  printf '[lint] skipping TypeScript no-emit check by default; run npm run typecheck for the full pass.\n'
fi

if [[ "${RUN_NEXT_LINT:-0}" == "1" ]]; then
  printf '[lint] RUN_NEXT_LINT=1, running Next ESLint with a visible heartbeat...\n'
  run_with_heartbeat "Next ESLint" "$NODE_BIN" node_modules/next/dist/bin/next lint --dir app --dir components --dir lib --dir pages
fi

printf '[lint] completed.\n'
