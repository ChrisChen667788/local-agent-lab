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
    echo "[typecheck] Node 22 binary not found. Install node@22 or set NODE22_BIN." >&2
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

MODE="${1:-full}"
HEARTBEAT_SECONDS="${TYPECHECK_HEARTBEAT_SECONDS:-${LINT_HEARTBEAT_SECONDS:-30}}"
STEP_TIMEOUT_SECONDS="${TYPECHECK_STEP_TIMEOUT_SECONDS:-${LINT_STEP_TIMEOUT_SECONDS:-900}}"
CACHE_DIR="node_modules/.cache/first-llm-studio/typecheck"
mkdir -p "$CACHE_DIR"

partition_project() {
  case "$1" in
    full) echo "tsconfig.typecheck.json" ;;
    agent) echo "tsconfig.typecheck.agent.json" ;;
    admin) echo "tsconfig.typecheck.admin.json" ;;
    core) echo "tsconfig.typecheck.core.json" ;;
    app) echo "tsconfig.typecheck.app.json" ;;
    *) return 1 ;;
  esac
}

all_partitions=(core agent admin app)
typecheck_pathspecs=(
  app
  components
  lib
  pages
  scripts
  package.json
  package-lock.json
  tsconfig.json
  ':(glob)tsconfig*.json'
  next.config.mjs
  tailwind.config.ts
)

changed_files() {
  git status --porcelain=v1 -- "${typecheck_pathspecs[@]}" 2>/dev/null \
    | sed -E 's/^...//' \
    | sed -E 's/^.* -> //' \
    | awk 'NF' \
    | sort -u
}

partitions_for_changed_files() {
  local saw_any=0
  local needs_core=0
  local needs_agent=0
  local needs_admin=0
  local needs_app=0
  local needs_full=0

  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    saw_any=1
    case "$file" in
      tsconfig*.json|package.json|package-lock.json|scripts/run-typecheck.sh|scripts/run-lint.sh)
        needs_core=1
        needs_agent=1
        needs_admin=1
        needs_app=1
        ;;
      app/api/agent/*|app/api/agent/**/*|app/agent/*|app/agent/**/*|components/agent/*|components/agent/**/*|lib/agent/*|lib/agent/**/*)
        needs_agent=1
        ;;
      app/api/admin/*|app/api/admin/**/*|app/admin/*|app/admin/**/*|components/admin/*|components/admin/**/*|lib/finetune/*|lib/finetune/**/*|lib/community/*|lib/community/**/*)
        needs_admin=1
        ;;
      lib/*|lib/**/*|scripts/*|scripts/**/*)
        needs_core=1
        ;;
      app/*|app/**/*|components/*|components/**/*|pages/*|pages/**/*)
        needs_app=1
        ;;
      *)
        ;;
    esac
  done < <(changed_files)

  if [[ "$saw_any" -eq 0 ]]; then
    echo "full"
    return
  fi

  if [[ "$needs_full" -eq 1 ]]; then
    echo "full"
    return
  fi
  [[ "$needs_core" -eq 1 ]] && echo "core"
  [[ "$needs_agent" -eq 1 ]] && echo "agent"
  [[ "$needs_admin" -eq 1 ]] && echo "admin"
  [[ "$needs_app" -eq 1 ]] && echo "app"
}

run_with_heartbeat() {
  local label="$1"
  shift
  local elapsed=0

  "$@" &
  local pid=$!

  while kill -0 "$pid" 2>/dev/null; do
    sleep "$HEARTBEAT_SECONDS"
    elapsed=$((elapsed + HEARTBEAT_SECONDS))
    if kill -0 "$pid" 2>/dev/null; then
      printf '[typecheck] %s still running... %ss elapsed\n' "$label" "$elapsed"
      if [[ "$elapsed" -ge "$STEP_TIMEOUT_SECONDS" ]]; then
        printf '[typecheck] %s exceeded %ss, stopping it.\n' "$label" "$STEP_TIMEOUT_SECONDS" >&2
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        return 124
      fi
    fi
  done

  wait "$pid"
}

run_partition() {
  local partition="$1"
  local project
  project="$(partition_project "$partition")" || {
    echo "[typecheck] Unknown partition: $partition" >&2
    return 2
  }
  local started
  started="$(date +%s)"
  printf '[typecheck] %s -> %s\n' "$partition" "$project"
  if [[ "${TYPECHECK_DRY_RUN:-0}" == "1" ]]; then
    printf '[typecheck] dry-run: skipped %s\n' "$partition"
    return 0
  fi
  run_with_heartbeat "$partition" "$NODE_BIN" node_modules/typescript/bin/tsc --noEmit --pretty false -p "$project"
  local ended
  ended="$(date +%s)"
  printf '[typecheck] %s completed in %ss\n' "$partition" "$((ended - started))"
}

validate_partition() {
  local partition="$1"
  local project
  project="$(partition_project "$partition")" || {
    echo "[typecheck] Unknown partition: $partition" >&2
    return 2
  }
  local file_count
  file_count="$("$NODE_BIN" node_modules/typescript/bin/tsc --showConfig -p "$project" \
    | "$NODE_BIN" -e "let input=''; process.stdin.on('data', c => input += c); process.stdin.on('end', () => { const config = JSON.parse(input); console.log((config.files || []).length); });")"
  printf '[typecheck] validate %-5s -> %-34s %s files\n' "$partition" "$project" "$file_count"
}

printf '[typecheck] using %s at %s\n' "$($NODE_BIN -v)" "$NODE_BIN"

case "$MODE" in
  full|agent|admin|core|app)
    run_partition "$MODE"
    ;;
  partitions)
    for partition in "${all_partitions[@]}"; do
      run_partition "$partition"
    done
    ;;
  validate)
    validate_partition full
    for partition in "${all_partitions[@]}"; do
      validate_partition "$partition"
    done
    ;;
  changed)
    selected=()
    while IFS= read -r partition; do
      [[ -n "$partition" ]] && selected+=("$partition")
    done < <(partitions_for_changed_files | awk 'NF' | sort -u)
    if [[ "${#selected[@]}" -eq 0 ]]; then
      echo "[typecheck] No TypeScript-relevant changes detected."
      exit 0
    fi
    printf '[typecheck] changed partitions: %s\n' "${selected[*]}"
    for partition in "${selected[@]}"; do
      run_partition "$partition"
    done
    ;;
  *)
    echo "Usage: $0 [full|partitions|changed|validate|core|agent|admin|app]" >&2
    exit 2
    ;;
esac

printf '[typecheck] completed.\n'
