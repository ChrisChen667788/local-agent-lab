#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$ROOT_DIR/VERSION"
RELEASES_DIR="$ROOT_DIR/docs/releases"

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "VERSION file not found: $VERSION_FILE" >&2
  exit 1
fi

VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
if [[ -z "$VERSION" ]]; then
  echo "VERSION file is empty." >&2
  exit 1
fi

DATE_STAMP="$(date +%F)"
RELEASE_FILE="$RELEASES_DIR/v${VERSION}_${DATE_STAMP}.md"
GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
BENCHMARK_SUMMARY="$(node - <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const file = path.join(os.homedir(), 'Library', 'Application Support', 'local-agent-lab', 'observability', 'benchmark-history.jsonl');
try {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1] || '{}');
  if (!last || !Array.isArray(last.results)) throw new Error('no benchmark');
  const workload = last.suiteLabel || last.datasetLabel || last.promptSetLabel || last.prompt || 'latest workload';
  const summary = last.results
    .map((result) => `${result.targetLabel}: ${result.okRuns}/${result.runs}`)
    .join(' · ');
  process.stdout.write(`${workload} · ${summary}`);
} catch {
  process.stdout.write('pending');
}
NODE
)"

mkdir -p "$RELEASES_DIR"

if [[ -f "$RELEASE_FILE" ]]; then
  echo "Release note already exists: $RELEASE_FILE"
  exit 0
fi

cat > "$RELEASE_FILE" <<EOF
# v${VERSION} · ${DATE_STAMP}

## Scope

- Fill in the scope of this stable node.

## Included

- UI / workflow updates:
- Runtime / benchmark updates:
- Retrieval / grounding updates:

## Verification

- Commit: \`${GIT_SHA}\`
- TypeScript: pending
- Nav version: \`v${VERSION}\`
- Agent URL: [http://localhost:3011/agent](http://localhost:3011/agent)
- Admin URL: [http://localhost:3011/admin](http://localhost:3011/admin)
- Benchmark summary: ${BENCHMARK_SUMMARY}

## Screenshots

- Agent:
- Admin:

## Notes

- Add rollback notes, known limits, or follow-up actions here.
EOF

echo "Created release note: $RELEASE_FILE"
