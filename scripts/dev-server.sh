#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRIMARY_NODE="/opt/homebrew/opt/node@22/bin/node"
NODE22="${NODE22_BIN:-}"
CURRENT_NODE="$(command -v node || true)"

node_major_version() {
  local binary="$1"
  [[ -x "$binary" ]] || return 1
  "$binary" -p 'process.versions.node.split(".")[0]' 2>/dev/null
}

if [[ -z "$NODE22" ]]; then
  if [[ -x "$PRIMARY_NODE" ]]; then
    NODE22="$PRIMARY_NODE"
  elif [[ -n "$CURRENT_NODE" ]] && [[ "$(node_major_version "$CURRENT_NODE")" == "22" ]]; then
    NODE22="$CURRENT_NODE"
  else
    echo "Node 22 binary not found. Install node@22 or set NODE22_BIN." >&2
    exit 1
  fi
fi
PORT="${PORT:-3011}"
LOGFILE="${LOGFILE:-/tmp/local-agent-lab-dev.log}"
PIDFILE="${PIDFILE:-/tmp/local-agent-lab-dev.pid}"
MODE="${MODE:-prod}"
SCREEN_NAME="${SCREEN_NAME:-local-agent-lab-$PORT}"
AUTO_START_LOCAL_GATEWAY="${AUTO_START_LOCAL_GATEWAY:-1}"

if [[ "$MODE" == "dev" ]]; then
  pattern="node_modules/next/dist/bin/next dev -p $PORT"
  start_cmd="exec \"$ROOT/scripts/run-next.sh\" dev \"$PORT\""
else
  pattern="node_modules/next/dist/bin/next start -p $PORT"
  start_cmd="exec \"$ROOT/scripts/run-next.sh\" start \"$PORT\""
fi

listener_pid() {
  lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1
}

read_pidfile() {
  if [[ -f "$PIDFILE" ]]; then
    cat "$PIDFILE"
  fi
}

cleanup_pidfile() {
  local pid
  pid="$(read_pidfile || true)"
  if [[ -n "${pid:-}" ]] && ! kill -0 "$pid" >/dev/null 2>&1; then
    rm -f "$PIDFILE"
  fi
}

stop_processes() {
  local pids pidfile_pid
  cleanup_pidfile
  pidfile_pid="$(read_pidfile || true)"
  if [[ -n "${pidfile_pid:-}" ]]; then
    kill "$pidfile_pid" >/dev/null 2>&1 || true
    sleep 1
    kill -9 "$pidfile_pid" >/dev/null 2>&1 || true
  fi
  screen -S "$SCREEN_NAME" -X quit >/dev/null 2>&1 || true
  pids="$(pgrep -f "$pattern" || true)"
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs kill >/dev/null 2>&1 || true
    sleep 1
    pids="$(pgrep -f "$pattern" || true)"
    if [[ -n "$pids" ]]; then
      echo "$pids" | xargs kill -9 >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$PIDFILE"
}

case "${1:-start}" in
  start)
    if pid="$(listener_pid)"; [[ -n "${pid:-}" ]]; then
      echo "already-running $pid"
      exit 0
    fi
    stop_processes
    : > "$LOGFILE"
    if [[ "$MODE" != "dev" ]]; then
      echo "[build] starting production build..." >>"$LOGFILE"
      if ! bash -lc "cd \"$ROOT\" && exec \"$ROOT/scripts/run-next.sh\" build" >>"$LOGFILE" 2>&1; then
        echo "build-failed"
        exit 1
      fi
    fi
    screen -S "$SCREEN_NAME" -X quit >/dev/null 2>&1 || true
    screen -dmS "$SCREEN_NAME" bash -lc "cd \"$ROOT\" && $start_cmd >>\"$LOGFILE\" 2>&1"
    for _ in $(seq 1 45); do
      if pid="$(listener_pid)"; [[ -n "${pid:-}" ]]; then
        echo "$pid" > "$PIDFILE"
        if [[ "$AUTO_START_LOCAL_GATEWAY" == "1" && -x "$ROOT/scripts/start-local-gateway.sh" ]]; then
          bash -lc "cd \"$ROOT\" && \"$ROOT/scripts/start-local-gateway.sh\"" >>"$LOGFILE" 2>&1 || true
        fi
        curl --max-time 20 -sS "http://127.0.0.1:$PORT/agent" >/dev/null 2>&1 || true
        curl --max-time 20 -sS "http://127.0.0.1:$PORT/admin" >/dev/null 2>&1 || true
        echo "started $pid"
        exit 0
      fi
      sleep 1
    done
    echo "failed-to-start"
    exit 1
    ;;
  stop)
    if pid="$(listener_pid)"; [[ -n "${pid:-}" ]]; then
      stop_processes
      echo "stopped"
    else
      echo "not-running"
    fi
    rm -f "$PIDFILE"
    ;;
  status)
    cleanup_pidfile
    if pid="$(listener_pid)"; [[ -n "${pid:-}" ]]; then
      echo "running $pid"
    else
      echo "not-running"
      exit 1
    fi
    ;;
  log)
    tail -n 120 "$LOGFILE"
    ;;
  *)
    echo "usage: $0 {start|stop|status|log}  (MODE=prod|dev)" >&2
    exit 2
    ;;
esac
