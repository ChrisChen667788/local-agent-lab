# Local Agent Lab

![Local Agent Lab cover](./public/oss-cover.svg)

Local Agent Lab is a local-first coding agent workbench for Apple Silicon. It combines:

- local MLX models
- remote LLM targets through compatible APIs
- a benchmark and runtime-ops dashboard
- repo-aware tools, replay, trace review, and knowledge import workflows

It is built for people who want one place to compare local and remote models, debug agent behavior, and validate changes with repeatable benchmark runs.

## Why this exists

Most tools do one part well:

- IDE agents focus on editing loops
- chat apps focus on conversation
- local model tools focus on inference
- benchmark tools focus on metrics

Local Agent Lab tries to keep those pieces in one workbench:

- `/agent` for interactive agent work
- `/admin` for runtime ops, benchmark execution, history, and diagnostics

## Highlights

- Local MLX runtime for Apple Silicon
- Switchable local and remote targets in one UI
- Built-in repo tools:
  - `list_files`
  - `read_file`
  - `execute_command`
  - `write_file`
  - `apply_patch`
- Approval flow for sensitive tool actions
- Benchmark suites with history, baseline, progress, and failure diagnostics
- Replay, trace review, and file-level diff inspection
- Knowledge import for docs, code, and workspace material
- Local runtime controls:
  - prewarm
  - release model
  - restart gateway
  - gateway log inspection

## Screenshots

![Landing page](./docs/assets/landing-page.png)
![Agent workbench](./docs/assets/agent-workbench.png)
![Admin dashboard](./docs/assets/admin-dashboard.png)

## Current targets

### Local

- `Local Qwen3 0.6B`
- `Local Qwen3.5 4B 4-bit`
- `Local Qwen3 4B 4-bit`

### Remote

- `OpenAI Codex`
- `OpenAI GPT-5.4`
- `Claude API`
- `Kimi API`
- `GLM API`
- `Qwen API`

## Local benchmark defaults

The current benchmark-default context request is `32K` for all three local targets.

The project has validated:

- all-local `32K` formal benchmark
- all-local `32K` full benchmark
- mixed local + remote `32K` compare runs with aligned context settings

## Quick start

### Requirements

- macOS on Apple Silicon
- Node `22.x`
- Python `3.12`
- MLX-compatible environment for local models

### Install

```bash
nvm install 22
nvm use 22
npm install
cp .env.example .env.local
```

### Start the app

```bash
npm run dev
```

Default UI:

- [http://localhost:3011/agent](http://localhost:3011/agent)
- [http://localhost:3011/admin](http://localhost:3011/admin)

### Start the local model gateway

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install mlx mlx-lm fastapi uvicorn
python scripts/local_model_gateway_supervisor.py
```

Gateway health endpoint:

- [http://127.0.0.1:4000/health](http://127.0.0.1:4000/health)

## Configuration

Copy `.env.example` to `.env.local` and fill only the providers you want to use.

Important notes:

- `.env.local` is ignored by git.
- Remote targets are optional.
- Some providers use OpenAI-compatible endpoints.
- Public repository defaults are sanitized; replace placeholders with your own endpoints.

## Repository structure

```text
app/                      Next.js app routes
components/               Agent and admin UI
lib/agent/                Agent runtime, providers, benchmark, gateway helpers
scripts/                  Local gateway and dev scripts
docs/                     Release notes, roadmap, project docs
public/                   Public assets, social cover
```

## Security and privacy

- Sensitive local actions require confirmation
- Local secrets are expected in `.env.local`
- The public repository excludes personal keys and local-only configuration
- See [SECURITY.md](./SECURITY.md)

## Contributing

Issues and PRs are welcome.

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

## Release notes

- Current version: [`VERSION`](./VERSION)
- Releases: [`docs/releases`](./docs/releases)
- Release process: [`docs/release-process.md`](./docs/release-process.md)

## License

[MIT](./LICENSE)
