#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRIMARY_NODE="/opt/homebrew/opt/node@22/bin/node"
FALLBACK_NODE="/Users/chenhaorui/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node"
NODE22="${NODE22_BIN:-}"
if [[ -z "$NODE22" ]]; then
  if [[ -x "$PRIMARY_NODE" ]]; then
    NODE22="$PRIMARY_NODE"
  else
    NODE22="$FALLBACK_NODE"
  fi
fi
PORT="${PORT:-3011}"
LOGFILE="${LOGFILE:-/tmp/local-agent-lab-dev.log}"
PIDFILE="${PIDFILE:-/tmp/local-agent-lab-dev.pid}"
MODE="${MODE:-prod}"

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
    nohup bash -lc "cd \"$ROOT\" && $start_cmd" >>"$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    for _ in $(seq 1 45); do
      if pid="$(listener_pid)"; [[ -n "${pid:-}" ]]; then
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
