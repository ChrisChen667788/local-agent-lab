#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${LOCAL_AGENT_DATA_DIR:-$HOME/Library/Application Support/local-agent-lab/observability}"
PIDFILE="$DATA_DIR/local-gateway.pid"
LOGFILE="$DATA_DIR/local-gateway.log"
VENV_PYTHON="$ROOT/.venv/bin/python"
SCREEN_NAME="${LOCAL_AGENT_GATEWAY_SCREEN_NAME:-local-agent-gateway}"
AUTO_PREWARM_MODEL="${LOCAL_AGENT_AUTO_PREWARM_MODEL:-local-qwen3-0.6b}"

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "${line#\#}" != "$line" ]] && continue
    [[ "$line" == *=* ]] || continue
    local key="${line%%=*}"
    local value="${line#*=}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    export "$key=$value"
  done <"$file"
}

mkdir -p "$DATA_DIR"
cd "$ROOT"
load_env_file "$ROOT/.env.local"
load_env_file "$ROOT/.env"

PYTHON_BIN="${LOCAL_AGENT_PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  if [[ -x "$VENV_PYTHON" ]]; then
    PYTHON_BIN="$VENV_PYTHON"
  else
    PYTHON_BIN="python3.12"
  fi
fi

existing_pid=""
if [[ -f "$PIDFILE" ]]; then
  existing_pid="$(cat "$PIDFILE" 2>/dev/null || true)"
fi
if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
  echo "$existing_pid"
  exit 0
fi
screen -S "$SCREEN_NAME" -X quit >/dev/null 2>&1 || true

BASE_PATH="$(dirname "$PYTHON_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ENV_VARS=(
  "HOME=$HOME"
  "PATH=$BASE_PATH"
  "SHELL=${SHELL:-/bin/zsh}"
  "TMPDIR=${TMPDIR:-/tmp}"
  "LANG=${LANG:-en_US.UTF-8}"
  "LC_ALL=${LC_ALL:-en_US.UTF-8}"
  "PYTHONUNBUFFERED=1"
  "LOCAL_AGENT_DATA_DIR=$DATA_DIR"
)

append_prefixed_env() {
  local prefix="$1"
  while IFS='=' read -r key value; do
    [[ -n "$key" ]] || continue
    ENV_VARS+=("$key=$value")
  done < <(env | LC_ALL=C sort | awk -F= -v p="$prefix" '$1 ~ ("^" p) { print }')
}

append_prefixed_env "LOCAL_"
append_prefixed_env "HF_"
append_prefixed_env "HUGGINGFACE_"
append_prefixed_env "MLX_"
append_prefixed_env "SSL_"
append_prefixed_env "REQUESTS_"

CMD=(env -i "${ENV_VARS[@]}" "$PYTHON_BIN" -u "$ROOT/scripts/local_model_gateway.py")
CMD_ESCAPED="$(printf '%q ' "${CMD[@]}")"
: >"$LOGFILE"
screen -dmS "$SCREEN_NAME" bash -lc "cd \"$ROOT\" && exec $CMD_ESCAPED >>\"$LOGFILE\" 2>&1"

for _ in $(seq 1 120); do
  pid="$(pgrep -f "$ROOT/scripts/local_model_gateway.py" | head -n 1 || true)"
  if [[ -n "$pid" ]]; then
    echo "$pid" >"$PIDFILE"
    if [[ -n "$AUTO_PREWARM_MODEL" && "$AUTO_PREWARM_MODEL" != "0" && "$AUTO_PREWARM_MODEL" != "false" ]]; then
      (
        for _ in $(seq 1 180); do
          if curl -fsS http://127.0.0.1:4000/health >/dev/null 2>&1; then
            curl -fsS -X POST http://127.0.0.1:4000/v1/models/prewarm \
              -H "Content-Type: application/json" \
              --data "{\"model\":\"$AUTO_PREWARM_MODEL\"}" >>"$LOGFILE" 2>&1 || true
            break
          fi
          sleep 2
        done
      ) >/dev/null 2>&1 &
    fi
    echo "$pid"
    exit 0
  fi
  sleep 1
done

echo "failed-to-start" >&2
exit 1
