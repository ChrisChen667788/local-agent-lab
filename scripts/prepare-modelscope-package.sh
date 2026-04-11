#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist/modelscope-first-llm-studio"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

cp "$ROOT_DIR/modelscope/README.md" "$OUT_DIR/README.md"
cp "$ROOT_DIR/modelscope/configuration.json" "$OUT_DIR/configuration.json"
cp "$ROOT_DIR/LICENSE" "$OUT_DIR/LICENSE"
mkdir -p "$OUT_DIR/assets"
cp "$ROOT_DIR/public/oss-cover.svg" "$OUT_DIR/assets/oss-cover.svg" || true
cp "$ROOT_DIR/public/oss-social-square.svg" "$OUT_DIR/assets/oss-social-square.svg" || true
cp "$ROOT_DIR/docs/modelscope-launch-kit.md" "$OUT_DIR/LAUNCH.md"

echo "Prepared ModelScope package: $OUT_DIR"
