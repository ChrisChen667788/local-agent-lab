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
- Agent URL: [http://localhost:3011/agent](http://localhost:3011/agent)
- Admin URL: [http://localhost:3011/admin](http://localhost:3011/admin)
- Benchmark summary: pending

## Screenshots

- Agent:
- Admin:

## Notes

- Add rollback notes, known limits, or follow-up actions here.
EOF

echo "Created release note: $RELEASE_FILE"
