# Release Process

## Goal

Keep each stable node easy to compare, roll back, and explain.

## Steps

1. Update [`/Users/chenhaorui/Documents/New project/VERSION`](/Users/chenhaorui/Documents/New%20project/VERSION)
   - Use `SemVer`, for example `0.1.1`.

2. Generate the release note skeleton
   - Run:

```bash
cd "/Users/chenhaorui/Documents/New project"
./scripts/prepare-release.sh
```

3. Fill the generated release note
   - File pattern:
     - `docs/releases/vX.Y.Z_YYYY-MM-DD.md`
   - Required sections:
     - `Scope`
     - `Included`
     - `Verification`
     - `Screenshots`
     - `Notes`

4. Run the minimum verification set
   - `./node_modules/.bin/tsc --noEmit`
   - `./scripts/smoke-test.sh`
   - verify [http://localhost:3011/agent](http://localhost:3011/agent)
   - verify [http://localhost:3011/admin](http://localhost:3011/admin)
   - record one benchmark summary if the release touches runtime or benchmark behavior

5. Capture the stable node
   - Git commit message:
     - `release: vX.Y.Z`
   - Git tag:
     - `vX.Y.Z`

## Stable node checklist

- UI order and density match the current roadmap direction
- Local runtime can report status without crashing the page
- Benchmark can at least run one local and one remote smoke path
- Release note contains a real verification summary, not placeholders

## Notes

- Keep release notes short and factual.
- If a release is UI-only, benchmark can be a smoke summary rather than a full formal suite.
- `v0.2.x` cadence guidance: [v0.2.x-cadence.md](/Users/chenhaorui/Documents/New%20project/docs/v0.2.x-cadence.md)
- `v0.3.0` preread: [v0.3.0-preread.md](/Users/chenhaorui/Documents/New%20project/docs/v0.3.0-preread.md)
