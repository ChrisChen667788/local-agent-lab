#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${BASE_URL:-http://127.0.0.1:3011}"
OUT_DIR="${SCREENSHOT_SMOKE_OUT_DIR:-$ROOT/output/smoke-screenshots}"
PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION:-1.54.1}"
CAPTURE_TIMEOUT_SECONDS="${SCREENSHOT_SMOKE_TIMEOUT_SECONDS:-75}"
DRIVER="${SCREENSHOT_SMOKE_DRIVER:-auto}"
BROWSER_APP="${SCREENSHOT_SMOKE_BROWSER_APP:-Google Chrome}"
MACOS_CAPTURE_REGION="${SCREENSHOT_SMOKE_REGION:-80,80,1600,1040}"

mkdir -p "$OUT_DIR"

if [[ "$DRIVER" == "auto" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]] && command -v screencapture >/dev/null 2>&1; then
    DRIVER="macos"
  else
    DRIVER="playwright"
  fi
fi

if [[ "$DRIVER" == "playwright" && ! -x "$ROOT/node_modules/.bin/playwright" ]]; then
  cat >&2 <<EOF
[screenshot-smoke] local Playwright CLI was not found.
[screenshot-smoke] install it once with:
[screenshot-smoke]   npm install --save-dev playwright@${PLAYWRIGHT_VERSION}
[screenshot-smoke]   ./node_modules/.bin/playwright install chromium
[screenshot-smoke] then rerun:
[screenshot-smoke]   npm run smoke:screenshots
EOF
  exit 1
fi

if [[ "$DRIVER" == "macos" ]] && ! open -Ra "$BROWSER_APP" >/dev/null 2>&1; then
  if open -Ra "Safari" >/dev/null 2>&1; then
    BROWSER_APP="Safari"
  else
    printf '[screenshot-smoke] no supported macOS browser found. Set SCREENSHOT_SMOKE_BROWSER_APP or use SCREENSHOT_SMOKE_DRIVER=playwright.\n' >&2
    exit 1
  fi
fi

run_with_timeout() {
  local label="$1"
  shift
  "$@" &
  local pid=$!
  local elapsed=0

  while kill -0 "$pid" 2>/dev/null; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [[ "$elapsed" -ge "$CAPTURE_TIMEOUT_SECONDS" ]]; then
      printf '[screenshot-smoke] %s exceeded %ss, stopping it.\n' "$label" "$CAPTURE_TIMEOUT_SECONDS" >&2
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 124
    fi
  done

  wait "$pid"
}

check_route() {
  local label="$1"
  local route="$2"
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}${route}" || true)"
  if [[ "$code" != "200" ]]; then
    printf '[screenshot-smoke] %s returned HTTP %s\n' "$label" "$code" >&2
    exit 1
  fi
}

capture_route() {
  local label="$1"
  local route="$2"
  local url="${BASE_URL}${route}"
  local file="$OUT_DIR/${label}.png"

  printf '[screenshot-smoke] capturing %s -> %s\n' "$route" "$file"
  if [[ "$DRIVER" == "macos" ]]; then
    if [[ "$BROWSER_APP" == "Google Chrome" ]]; then
      osascript >/dev/null <<OSA
tell application "Google Chrome"
  activate
  set smokeWindow to make new window
  set URL of active tab of smokeWindow to "$url"
  set bounds of smokeWindow to {80, 80, 1680, 1120}
end tell
delay 3
OSA
    else
      osascript >/dev/null <<OSA
tell application "$BROWSER_APP"
  activate
  open location "$url"
end tell
delay 3
OSA
    fi
    if ! screencapture -x -R "$MACOS_CAPTURE_REGION" "$file"; then
      printf '[screenshot-smoke] region capture failed, falling back to full-screen capture for %s\n' "$label" >&2
      screencapture -x "$file"
    fi
    if [[ "$BROWSER_APP" == "Google Chrome" ]]; then
      osascript >/dev/null <<OSA
tell application "Google Chrome"
  if (count of windows) > 0 then close front window
end tell
OSA
    fi
  else
    run_with_timeout "$label screenshot" "$ROOT/node_modules/.bin/playwright" screenshot \
      --device="Desktop Chrome" \
      --full-page \
      "$url" \
      "$file"
  fi
}

check_route "agent" "/agent"
check_route "admin" "/admin"

capture_route "agent" "/agent"
capture_route "admin" "/admin"

printf '[screenshot-smoke] completed: %s\n' "$OUT_DIR"
