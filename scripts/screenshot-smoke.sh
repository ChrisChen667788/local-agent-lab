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
PRIMARY_NODE="/opt/homebrew/opt/node@22/bin/node"
NODE_BIN="${NODE22_BIN:-${NODE_BINARY:-}}"

mkdir -p "$OUT_DIR"

if [[ "$DRIVER" == "auto" ]]; then
  if [[ -x "$ROOT/node_modules/.bin/playwright" ]]; then
    DRIVER="playwright"
  elif [[ "$(uname -s)" == "Darwin" ]] && command -v screencapture >/dev/null 2>&1; then
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

node_major_version() {
  local binary="$1"
  [[ -x "$binary" ]] || return 1
  "$binary" -p 'process.versions.node.split(".")[0]' 2>/dev/null
}

if [[ "$DRIVER" == "playwright" && -z "$NODE_BIN" ]]; then
  if [[ -x "$PRIMARY_NODE" ]]; then
    NODE_BIN="$PRIMARY_NODE"
  elif [[ "$(node_major_version "$(command -v node || true)")" == "22" ]]; then
    NODE_BIN="$(command -v node)"
  else
    printf '[screenshot-smoke] Node 22 binary not found. Install node@22 or set NODE22_BIN.\n' >&2
    exit 1
  fi
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
  local capture_script="$OUT_DIR/.capture-${label}.mjs"

  printf '[screenshot-smoke] capturing %s -> %s\n' "$route" "$file"
  rm -f "$file"
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
    cat >"$capture_script" <<'NODE'
const { chromium } = await import("playwright");

let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
} catch (systemChromeError) {
  try {
    browser = await chromium.launch({ headless: true });
  } catch (bundledChromiumError) {
    throw new Error(
      [
        "Unable to launch a screenshot browser.",
        "Install Google Chrome or run: ./node_modules/.bin/playwright install chromium",
        `System Chrome error: ${systemChromeError.message}`,
        `Bundled Chromium error: ${bundledChromiumError.message}`,
      ].join("\n"),
    );
  }
}
const page = await browser.newPage({
  viewport: { width: 1728, height: 1117 },
  deviceScaleFactor: 1,
});

await page.goto(process.env.PLAYWRIGHT_URL, {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});
await page.locator("body").waitFor({ timeout: 15000 });
await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
await page.addStyleTag({
  content: `
    *,
    *::before,
    *::after {
      animation-duration: 0.001s !important;
      animation-iteration-count: 1 !important;
      scroll-behavior: auto !important;
      transition-duration: 0s !important;
    }
  `,
}).catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({
  path: process.env.PLAYWRIGHT_FILE,
  fullPage: false,
});
await browser.close();
NODE
    PLAYWRIGHT_URL="$url" PLAYWRIGHT_FILE="$file" run_with_timeout "$label screenshot" "$NODE_BIN" "$capture_script"
    rm -f "$capture_script"
  fi

  if [[ ! -s "$file" ]]; then
    printf '[screenshot-smoke] %s did not produce a screenshot file.\n' "$label" >&2
    exit 1
  fi
}

check_route "agent" "/agent"
check_route "admin" "/admin"

capture_route "agent" "/agent"
capture_route "admin" "/admin"

printf '[screenshot-smoke] completed: %s\n' "$OUT_DIR"
