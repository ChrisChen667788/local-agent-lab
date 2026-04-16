#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist/modelscope-first-llm-studio"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/assets"

cp "$ROOT_DIR/modelscope/README.md" "$OUT_DIR/README.md"
cp "$ROOT_DIR/modelscope/configuration.json" "$OUT_DIR/configuration.json"
cp "$ROOT_DIR/LICENSE" "$OUT_DIR/LICENSE"
cp "$ROOT_DIR/docs/modelscope-launch-kit.md" "$OUT_DIR/LAUNCH.md"

cp "$ROOT_DIR/public/oss-cover.svg" "$OUT_DIR/assets/oss-cover.svg" || true
cp "$ROOT_DIR/public/oss-cover.png" "$OUT_DIR/assets/oss-cover.png" || true
cp "$ROOT_DIR/public/oss-social-square.svg" "$OUT_DIR/assets/oss-social-square.svg" || true
cp "$ROOT_DIR/public/oss-social-square.png" "$OUT_DIR/assets/oss-social-square.png" || true
cp "$ROOT_DIR/docs/assets/landing-page.png" "$OUT_DIR/assets/landing-page.png" || true
cp "$ROOT_DIR/docs/assets/agent-workbench.png" "$OUT_DIR/assets/agent-workbench.png" || true
cp "$ROOT_DIR/docs/assets/admin-dashboard.png" "$OUT_DIR/assets/admin-dashboard.png" || true
cp "$ROOT_DIR/docs/assets/benchmark-percentiles.png" "$OUT_DIR/assets/benchmark-percentiles.png" || true
cp "$ROOT_DIR/docs/assets/formal-regression-summary.png" "$OUT_DIR/assets/formal-regression-summary.png" || true
cp "$ROOT_DIR/docs/assets/runtime-telemetry-cards.png" "$OUT_DIR/assets/runtime-telemetry-cards.png" || true

echo "Prepared ModelScope package: $OUT_DIR"
