# First LLM Studio · Product Gap Audit

This is the current gap audit after the `v0.3.0` launch packaging pass.

The goal is not to list every possible idea.
The goal is to identify what is:

- already strong
- partially built but still rough
- clearly still missing

## Already strong

These are real strengths and should stay central in future messaging:

1. Unified local + remote target catalog
2. Compare Lab inside the main workbench instead of a separate toy page
3. Formal / focused benchmark operations in `/admin`
4. Runtime operations:
   - prewarm
   - release
   - restart
   - logs
   - telemetry
5. Dynamic local model discovery
6. DeepSeek / OpenAI / Claude-style remote target integration
7. Replay / trace / patch review surfaces

## Partially built and worth polishing next

These are usable, but still feel like the next round of improvement will pay off quickly.

### 1. Compare result review

Current state:

- much better than before
- still dense when multiple lanes produce long outputs

What to improve:

- stronger “base lane first” reading flow
- lane pinning
- better per-lane collapse defaults
- more compact diff summary chips

### 2. Runtime telemetry interpretation

Current state:

- data is there
- richer than most local tools

What to improve:

- clearer explanation of what each metric means
- calibration / confidence labels for GPU, energy, and storage estimates
- anomaly markers when a model is clearly underperforming expected local behavior

### 3. Model scan UX

Current state:

- one-click scan works
- local model discovery and remote health refresh are real

What to improve:

- better scan result summary
- “what changed since last scan”
- stronger remote API status reasons for skipped / unhealthy targets

### 4. Benchmark interpretation

Current state:

- formal / subset / focused suites exist
- percentile boards and regression summaries are strong proof assets

What to improve:

- clearer explanation of quality score methodology
- better failure grouping
- stronger benchmark-to-issue export flow

## Clearly missing or not finished yet

These are the biggest product gaps if we look beyond launch polish.

### P0. Server-side persistence

Still missing:

- durable session storage beyond browser-local state
- stronger server-side history / multi-device continuity

Why it matters:

- today the workbench feels powerful for one machine
- persistence is what makes it feel more like a serious long-lived studio

### P0. Fine-tune workflow

Still missing:

- actual local LoRA / QLoRA job management UI
- dataset import / validation flow
- checkpoint registry and deploy-back-to-runtime flow

Why it matters:

- this is one of the most compelling future expansions of the “LLM Studio” positioning

### P1. Retrieval stage two

Still missing:

- richer chunk navigation
- hybrid retrieval / rerank
- stronger grounded answer verification
- better repo-grounded line-level evidence

Why it matters:

- this would make the workbench stronger for serious agent / knowledge workflows

### P1. Agent workflow uplift

Still missing:

- stronger planner state
- clearer tool orchestration summaries
- deeper long-running task recovery
- more durable memory behavior

Why it matters:

- right now the project already looks like a serious agent workbench
- this is how it becomes harder to replace with generic chat apps

### P1. CI and release proof automation

Still missing:

- screenshot smoke checks in CI
- repeatable GIF / demo capture pipeline
- stronger public docs route for release notes and launch notes

Why it matters:

- the project now has a real public face
- release quality needs to be repeatable, not handcrafted every time

## Best next priorities after launch

If we pick the highest-leverage sequence, it should be:

1. Server-side persistence
2. Retrieval stage two
3. Fine-tune workflow planning into first executable slice
4. Compare review density polish
5. CI / demo automation

## Open GitHub issues that still matter

These public issues are still worth keeping in the active queue:

- `#1` Add context recommendation helper text beside benchmark target badges
- `#2` Expose last recovery action more consistently across runtime cards
- `#3` Add line-level file evidence snippets for repo-grounded answers
- `#4` Add screenshot smoke checks to GitHub Actions CI
- `#7` Add benchmark issue-summary export preset for triage workflows
- `#8` Add a public docs route for launch notes and release notes
- `#9` Create a repeatable demo capture pipeline for release assets
- `#11` Publish a demo GIF workflow for README and release pages
- `#13` Add a comparison matrix for local and remote benchmark lanes
- `#14` Add a public roadmap section for benchmark and runtime milestones

## Summary

First LLM Studio is already strong enough to launch because it has a clear wedge:

- local-first
- compare + benchmark + runtime in one surface
- more operational than a generic chat app

The biggest unfinished work is no longer “basic functionality”.
The biggest unfinished work is turning this into a more durable, explainable, and collaborative studio:

- persistence
- stronger retrieval
- fine-tune workflow
- better proof automation
