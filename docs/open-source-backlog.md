# Open Source Backlog

This file is the contributor-friendly backlog for the public repository. It focuses on issues that are:

- easy to understand from code and UI context
- scoped small enough for outside contributors
- useful for benchmark ops, runtime UX, or onboarding

## Good first issue

### 1. Add context recommendation helper text beside benchmark target badges

- Area: benchmark UI
- Labels: `good first issue`, `enhancement`, `benchmark`
- Why it matters:
  - We now validate `32K` runs broadly, but the UI still expects contributors to infer which target defaults are “recommended” versus simply “allowed”.
- Likely files:
  - `components/admin/AdminDashboard.tsx`
- Expected outcome:
  - Each local target card shows a short “recommended context” or “validated at” helper line in compare mode and benchmark selection mode.

### 2. Add copy buttons for launch kit snippets

- Area: docs / launch workflow
- Labels: `good first issue`, `documentation`
- Why it matters:
  - The launch kit already contains reusable copy, but a simple “copy snippet” interaction in the docs site or a generated markdown helper would make reuse faster.
- Likely files:
  - `docs/open-source-launch-kit.md`
  - optional doc rendering surface if we later expose docs inside the app
- Expected outcome:
  - Clear copy-friendly sections or helper buttons for launch text blocks.

### 3. Show “last recovery action” in more runtime and benchmark surfaces

- Area: runtime ops / benchmark progress
- Labels: `good first issue`, `enhancement`, `runtime`
- Why it matters:
  - Recovery visibility now exists in benchmark progress, but not every runtime card reflects the same level of clarity.
- Likely files:
  - `components/admin/AdminDashboard.tsx`
  - `lib/agent/types.ts`
- Expected outcome:
  - Recovery action text becomes consistent across runtime cards and benchmark progress cards.

## Help wanted

### 4. Add benchmark result export presets for GitHub issue triage

- Area: benchmark ops
- Labels: `help wanted`, `benchmark`
- Why it matters:
  - When regressions happen, we often want a compact export that can be pasted directly into an issue or PR thread.
- Likely files:
  - `app/api/admin/benchmark/export`
  - `components/admin/AdminDashboard.tsx`
- Expected outcome:
  - “Issue summary” export mode with key metrics, failed sample reasons, and run metadata.

### 5. Improve repo-grounding evidence cards with line-level snippets

- Area: agent trace / repo grounding
- Labels: `help wanted`, `agent`, `enhancement`
- Why it matters:
  - The app can already show file-level evidence summaries; the next useful step is tighter line-level excerpts for repository questions.
- Likely files:
  - `lib/agent/workspace-scout.ts`
  - `lib/agent/session-intelligence.ts`
  - `components/agent/AgentWorkbench.tsx`
- Expected outcome:
  - Repository answers cite short file snippets with line references where possible.

### 6. Add screenshot smoke checks to CI

- Area: CI / release quality
- Labels: `help wanted`, `ci`
- Why it matters:
  - Build and lint are covered, but public landing quality would benefit from lightweight screenshot or route health checks.
- Likely files:
  - `.github/workflows/ci.yml`
  - `scripts/`
- Expected outcome:
  - CI verifies the landing page and at least one app route render without obvious failures.

## Medium scope roadmap items

### 7. Public docs site or docs route

- Area: documentation / discoverability
- Labels: `documentation`, `enhancement`
- Why it matters:
  - Important release notes and launch material exist in markdown, but they are not yet turned into a polished public docs surface.

### 8. Contributor demo capture pipeline

- Area: OSS packaging
- Labels: `documentation`, `tooling`
- Why it matters:
  - The repository would benefit from a repeatable way to capture fresh demo PNGs or short recordings for releases.

## Triage notes

When opening public issues, keep them:

- scoped to one user-visible outcome
- grounded in a concrete file or route when possible
- explicit about verification steps
- honest about whether the change is docs-only, runtime, benchmark, or CI

## Live GitHub issues

Current public issue queue:

- [#1 Add context recommendation helper text beside benchmark target badges](https://github.com/ChrisChen667788/local-agent-lab/issues/1)
- [#2 Expose last recovery action more consistently across runtime cards](https://github.com/ChrisChen667788/local-agent-lab/issues/2)
- [#3 Add line-level file evidence snippets for repo-grounded answers](https://github.com/ChrisChen667788/local-agent-lab/issues/3)
- [#4 Add screenshot smoke checks to GitHub Actions CI](https://github.com/ChrisChen667788/local-agent-lab/issues/4)
- [#6 Add copy-friendly launch kit sections for social and release snippets](https://github.com/ChrisChen667788/local-agent-lab/issues/6)
- [#7 Add benchmark issue-summary export preset for triage workflows](https://github.com/ChrisChen667788/local-agent-lab/issues/7)
- [#8 Add a public docs route for launch notes and release notes](https://github.com/ChrisChen667788/local-agent-lab/issues/8)
- [#9 Create a repeatable demo capture pipeline for release assets](https://github.com/ChrisChen667788/local-agent-lab/issues/9)
- [#10 Add a Chinese contributor quickstart for local setup and release checks](https://github.com/ChrisChen667788/local-agent-lab/issues/10)
- [#11 Publish a demo GIF workflow for README and release pages](https://github.com/ChrisChen667788/local-agent-lab/issues/11)
- [#12 Add GitHub repo setup checklist for social preview and pinned repo copy](https://github.com/ChrisChen667788/local-agent-lab/issues/12)
- [#13 Add a comparison matrix for local and remote benchmark lanes](https://github.com/ChrisChen667788/local-agent-lab/issues/13)
- [#14 Add a public roadmap section for benchmark and runtime milestones](https://github.com/ChrisChen667788/local-agent-lab/issues/14)
