# Open Source Launch Kit

For pinned repo copy, profile wording, homepage descriptions, and bilingual launch-post variants, also see:

- `docs/open-source-growth-copy.md`

## One-line pitch

Local Agent Lab is a local-first coding agent workbench for Apple Silicon that combines MLX local runtimes, remote model comparisons, benchmark ops, replay, trace review, and runtime recovery in one interface.

## GitHub About

### Description

Local-first coding agent workbench with MLX local runtimes, benchmark ops, and remote model comparisons.

### Topics

- `llm`
- `mlx`
- `qwen`
- `nextjs`
- `benchmark`
- `apple-silicon`
- `coding-agent`

## Short launch summary

Local Agent Lab is now open source. The project packages together an agent workbench, local MLX runtimes, benchmark operations, replay and trace review, and local gateway recovery tooling so we can compare local and remote coding agents under the same workflow.

## Release callout for v0.2.3

Highlights:

- all-local `32K` formal benchmark validated
- all-local `32K` milestone-full benchmark validated: `426 / 426 ok`
- mixed local + remote `32K` compare validated with aligned context settings
- local benchmark progress now exposes explicit prewarm phases and recovery actions
- default local 4B lane is `Qwen3.5 4B 4-bit`

## X / Twitter post

Open sourced Local Agent Lab today.

It is a local-first coding agent workbench for Apple Silicon with:

- MLX local runtimes
- local vs remote benchmark compare
- replay + trace review
- patch inspection
- local gateway ops and recovery

v0.2.3 validates:
- all-local 32K formal
- all-local 32K full: 426 / 426 ok
- mixed local + remote 32K compare: 0 failed

Repo: https://github.com/ChrisChen667788/local-agent-lab

## LinkedIn post

I just open sourced Local Agent Lab.

The goal was to stop splitting the workflow across separate tools for local inference, benchmark spreadsheets, runtime shell scripts, and agent debugging. The project brings those loops together into one Apple Silicon workbench:

- MLX local models and remote model targets in one UI
- benchmark history, baseline deltas, and mixed compare runs
- replay, trace review, and file-level patch inspection
- local runtime operations including prewarm, gateway recovery, and logs

The latest release validates all-local 32K benchmark runs and mixed local + remote 32K compare runs under aligned context settings.

Repository: https://github.com/ChrisChen667788/local-agent-lab

## Hacker News title ideas

- Show HN: Local Agent Lab, a local-first coding agent workbench for Apple Silicon
- Show HN: Compare local MLX models and remote coding agents in one benchmark workbench
- Show HN: An open-source workbench for local MLX agents, replay, and benchmark ops

## Reddit title ideas

- Open source: Local Agent Lab for Apple Silicon, with MLX local runtimes and benchmark ops
- I built a local-first coding agent workbench with replay, trace review, and mixed local/remote compare
- Local Agent Lab is now open source: benchmark local MLX models against remote APIs in one UI

## Screenshot order for README and social posts

1. `docs/assets/landing-page.png`
2. `docs/assets/agent-workbench.png`
3. `docs/assets/admin-dashboard.png`

## Social assets

- `public/oss-cover.svg`: primary wide hero cover
- `public/oss-cover.png`: wide PNG ready for GitHub social preview upload
- `public/oss-social-square.svg`: square social card
- `public/oss-social-square.png`: square PNG ready for social posting
- `public/oss-feature-strip.svg`: feature strip for launch threads and announcement posts

## Manual GitHub social preview suggestion

Upload either:

- a PNG export of `public/oss-cover.svg`
- or a PNG export of `public/oss-social-square.svg`

Recommended alt text:

Local Agent Lab, an open-source local-first coding agent workbench for Apple Silicon with MLX runtimes, benchmark ops, replay, trace review, and mixed local-versus-remote comparisons.
