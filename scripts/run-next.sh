#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRIMARY_NODE="/opt/homebrew/opt/node@22/bin/node"
FALLBACK_NODE="/Users/chenhaorui/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node"
NODE_BIN="${NODE22_BIN:-}"

if [[ -z "$NODE_BIN" ]]; then
  if [[ -x "$PRIMARY_NODE" ]]; then
    NODE_BIN="$PRIMARY_NODE"
  elif [[ -x "$FALLBACK_NODE" ]]; then
    NODE_BIN="$FALLBACK_NODE"
  else
    echo "Node 22 binary not found. Install node@22 or set NODE22_BIN." >&2
    exit 1
  fi
fi

COMMAND="${1:-dev}"
PORT="${2:-3011}"

cd "$ROOT"

case "$COMMAND" in
  dev)
    exec "$NODE_BIN" node_modules/next/dist/bin/next dev -p "$PORT"
    ;;
  build)
    exec "$NODE_BIN" node_modules/next/dist/bin/next build
    ;;
  start)
    exec "$NODE_BIN" node_modules/next/dist/bin/next start -p "$PORT"
    ;;
  *)
    echo "usage: $0 {dev|build|start} [port]" >&2
    exit 2
    ;;
esac
