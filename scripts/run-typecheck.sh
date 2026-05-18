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
TARGET="${2:-}"
HEARTBEAT_SECONDS="${TYPECHECK_HEARTBEAT_SECONDS:-${LINT_HEARTBEAT_SECONDS:-30}}"
STEP_TIMEOUT_SECONDS="${TYPECHECK_STEP_TIMEOUT_SECONDS:-${LINT_STEP_TIMEOUT_SECONDS:-900}}"
CACHE_DIR="node_modules/.cache/first-llm-studio/typecheck"
mkdir -p "$CACHE_DIR"

partition_project() {
  case "$1" in
    full) echo "tsconfig.typecheck.json" ;;
    core-shared) echo "tsconfig.typecheck.core-shared.json" ;;
    core-i18n) echo "tsconfig.typecheck.core-i18n.json" ;;
    core-demo-data) echo "tsconfig.typecheck.core-demo-data.json" ;;
    core-agent) echo "tsconfig.typecheck.core-agent.json" ;;
    core-finetune) echo "tsconfig.typecheck.core-finetune.json" ;;
    core-community) echo "tsconfig.typecheck.core-community.json" ;;
    core-scripts) echo "tsconfig.typecheck.core-scripts.json" ;;
    agent-api) echo "tsconfig.typecheck.agent-api.json" ;;
    agent-ui) echo "tsconfig.typecheck.agent-ui.json" ;;
    agent-full) echo "tsconfig.typecheck.agent.json" ;;
    admin) echo "tsconfig.typecheck.admin.json" ;;
    app) echo "tsconfig.typecheck.app.json" ;;
    *) return 1 ;;
  esac
}

core_partitions=(core-shared core-i18n core-demo-data core-agent core-finetune core-community core-scripts)
agent_partitions=(agent-api agent-ui)
product_partitions=("${agent_partitions[@]}" admin app)
all_partitions=("${core_partitions[@]}" "${product_partitions[@]}")
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

emit_all_partitions() {
  local partition
  for partition in "${all_partitions[@]}"; do
    echo "$partition"
  done
}

partitions_for_changed_files() {
  local saw_any=0
  local needs_all=0
  local needs_core_shared=0
  local needs_core_i18n=0
  local needs_core_demo_data=0
  local needs_core_agent=0
  local needs_core_finetune=0
  local needs_core_community=0
  local needs_core_scripts=0
  local needs_agent_api=0
  local needs_agent_ui=0
  local needs_admin=0
  local needs_app=0

  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    saw_any=1
    case "$file" in
      tsconfig*.json|package.json|package-lock.json|scripts/run-typecheck.sh|scripts/run-lint.sh)
        needs_all=1
        ;;
      lib/i18n.ts)
        needs_core_i18n=1
        needs_agent_api=1
        needs_agent_ui=1
        needs_admin=1
        needs_app=1
        ;;
      lib/mock-data.ts)
        needs_core_demo_data=1
        needs_agent_api=1
        needs_agent_ui=1
        needs_admin=1
        needs_app=1
        ;;
      lib/types.ts)
        needs_core_shared=1
        needs_agent_api=1
        needs_agent_ui=1
        needs_admin=1
        needs_app=1
        ;;
      lib/agent/*|lib/agent/**/*)
        needs_core_agent=1
        needs_agent_api=1
        needs_agent_ui=1
        needs_admin=1
        ;;
      lib/finetune/*|lib/finetune/**/*)
        needs_core_finetune=1
        needs_admin=1
        ;;
      lib/community/*|lib/community/**/*)
        needs_core_community=1
        needs_admin=1
        ;;
      lib/*.ts|lib/*.tsx)
        needs_core_shared=1
        needs_agent_api=1
        needs_agent_ui=1
        needs_admin=1
        needs_app=1
        ;;
      scripts/*|scripts/**/*|tailwind.config.ts)
        needs_core_scripts=1
        ;;
      app/api/agent/*|app/api/agent/**/*|app/agent/*|app/agent/**/*|components/agent/*|components/agent/**/*)
        case "$file" in
          app/api/agent/*|app/api/agent/**/*) needs_agent_api=1 ;;
          *) needs_agent_ui=1 ;;
        esac
        ;;
      app/api/admin/*|app/api/admin/**/*|app/admin/*|app/admin/**/*|components/admin/*|components/admin/**/*)
        needs_admin=1
        ;;
      components/layout/*|components/layout/**/*)
        needs_agent_ui=1
        needs_admin=1
        needs_app=1
        ;;
      app/*|app/**/*|components/*|components/**/*|pages/*|pages/**/*|next.config.mjs)
        needs_app=1
        ;;
      *)
        ;;
    esac
  done < <(changed_files)

  if [[ "$saw_any" -eq 0 ]]; then
    return
  fi

  if [[ "$needs_all" -eq 1 ]]; then
    emit_all_partitions
    return
  fi

  [[ "$needs_core_shared" -eq 1 ]] && echo "core-shared"
  [[ "$needs_core_i18n" -eq 1 ]] && echo "core-i18n"
  [[ "$needs_core_demo_data" -eq 1 ]] && echo "core-demo-data"
  [[ "$needs_core_agent" -eq 1 ]] && echo "core-agent"
  [[ "$needs_core_finetune" -eq 1 ]] && echo "core-finetune"
  [[ "$needs_core_community" -eq 1 ]] && echo "core-community"
  [[ "$needs_core_scripts" -eq 1 ]] && echo "core-scripts"
  [[ "$needs_agent_api" -eq 1 ]] && echo "agent-api"
  [[ "$needs_agent_ui" -eq 1 ]] && echo "agent-ui"
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
  local tsc_args=(--noEmit --pretty false -p "$project")
  if [[ "${TYPECHECK_EXTENDED_DIAGNOSTICS:-0}" == "1" ]]; then
    tsc_args+=(--extendedDiagnostics)
  fi
  printf '[typecheck] %s -> %s\n' "$partition" "$project"
  if [[ "${TYPECHECK_DRY_RUN:-0}" == "1" ]]; then
    printf '[typecheck] dry-run: skipped %s\n' "$partition"
    return 0
  fi
  run_with_heartbeat "$partition" "$NODE_BIN" node_modules/typescript/bin/tsc "${tsc_args[@]}"
  local ended
  ended="$(date +%s)"
  printf '[typecheck] %s completed in %ss\n' "$partition" "$((ended - started))"
}

run_partition_or_group() {
  local partition="$1"
  case "$partition" in
    core)
      local core_partition
      for core_partition in "${core_partitions[@]}"; do
        run_partition "$core_partition"
      done
      ;;
    agent)
      local agent_partition
      for agent_partition in "${agent_partitions[@]}"; do
        run_partition "$agent_partition"
      done
      ;;
    *)
      run_partition "$partition"
      ;;
  esac
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
  printf '[typecheck] validate %-14s -> %-42s %s files\n' "$partition" "$project" "$file_count"
}

printf '[typecheck] using %s at %s\n' "$("$NODE_BIN" -v)" "$NODE_BIN"

case "$MODE" in
  full|admin|app|agent-full)
    run_partition "$MODE"
    ;;
  core)
    run_partition_or_group core
    ;;
  agent)
    run_partition_or_group agent
    ;;
  core-shared|core-i18n|core-demo-data|core-agent|core-finetune|core-community|core-scripts)
    run_partition "$MODE"
    ;;
  agent-api|agent-ui)
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
    done < <(partitions_for_changed_files | awk 'NF')
    if [[ "${#selected[@]}" -eq 0 ]]; then
      echo "[typecheck] No TypeScript-relevant changes detected."
      exit 0
    fi
    printf '[typecheck] changed partitions: %s\n' "${selected[*]}"
    for partition in "${selected[@]}"; do
      run_partition "$partition"
    done
    ;;
  profile)
    target="${TARGET:-core}"
    export TYPECHECK_EXTENDED_DIAGNOSTICS=1
    run_partition_or_group "$target"
    ;;
  *)
    echo "Usage: $0 [full|partitions|changed|validate|core|core-shared|core-i18n|core-demo-data|core-agent|core-finetune|core-community|core-scripts|agent|agent-api|agent-ui|agent-full|admin|app|profile [partition]]" >&2
    exit 2
    ;;
esac

printf '[typecheck] completed.\n'
