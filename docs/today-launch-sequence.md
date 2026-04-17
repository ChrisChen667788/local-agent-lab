# First LLM Studio · Today Launch Sequence

This is the recommended same-day release order for **GitHub + ModelScope + Chinese communities**.

The goal is simple:

1. land the most developer-native proof first
2. follow with the most discoverable China-facing hub
3. then fan out to short-form Chinese community posts while the repo and screenshots are still fresh

## 1. GitHub first

### Why this comes first

- GitHub is the canonical source of truth
- developers can immediately inspect code, release notes, screenshots, and issues
- the release page gives the cleanest “what shipped” anchor for every later post

### Recommended order inside GitHub

1. Publish / pin the `v0.3.0` release
2. Post the GitHub discussion launch note
3. Share the repo link plus release link externally

### Recommended image stack

1. `docs/assets/landing-page.png`
2. `docs/assets/agent-workbench.png`
3. `docs/assets/runtime-telemetry-cards.png`

### Why this image order works

- start with product identity
- then show the workbench
- then show proof that the runtime side is real, not just decorative UI

## 2. ModelScope second

### Why this comes second

- ModelScope makes the project easier to discover for Chinese AI builders
- it gives the project a stronger “AI infra / workflow tool” positioning in a familiar community hub
- it is better after GitHub, because the GitHub release already acts as the technical home

### Recommended image stack

1. `docs/assets/landing-page.png`
2. `docs/assets/benchmark-percentiles.png`
3. `docs/assets/formal-regression-summary.png`
4. `docs/assets/runtime-telemetry-cards.png`

### Messaging angle

Do not pitch this as “another chat UI”.

Pitch it as:

- a local-first LLM studio for Apple Silicon
- a unified workbench for local MLX + remote API comparison
- a place where compare, benchmark, replay, and runtime telemetry stay connected

## 3. Chinese communities third

### Why this comes third

- after GitHub and ModelScope are fully populated, every community click has somewhere solid to land
- you can tailor the same message into different densities without changing the core claim

### Suggested order

1. 即刻 / 朋友圈 / 小红书风格短帖
2. V2EX / 掘金 / 知乎想法中短帖
3. 知乎文章 / 公众号 / 长文复盘

### Recommended image stack

#### Short post

1. `docs/assets/landing-page.png`
2. `docs/assets/agent-workbench.png`

#### Mid-length post

1. `docs/assets/agent-workbench.png`
2. `docs/assets/runtime-telemetry-cards.png`
3. `docs/assets/formal-regression-summary.png`

#### Long post

1. `docs/assets/landing-page.png`
2. `docs/assets/agent-workbench.png`
3. `docs/assets/benchmark-percentiles.png`
4. `docs/assets/formal-regression-summary.png`
5. `docs/assets/runtime-telemetry-cards.png`

## What to emphasize in every post

Keep repeating the same three ideas:

1. **This is local-first**
   - Apple Silicon
   - MLX local runtime
   - local runtime cost is visible

2. **This is not just a chat shell**
   - Compare Lab
   - benchmark ops
   - replay / trace review
   - runtime recovery

3. **This is for serious workflow users**
   - local AI builders
   - agent / tooling teams
   - eval / platform engineers

## Suggested same-day cadence

### Slot 1

- GitHub release
- GitHub discussion

### Slot 2

- ModelScope repo page / feed post

### Slot 3

- Chinese short-form community post

### Slot 4

- Chinese mid-length or long-form follow-up with benchmark screenshots

## Copy sources

Use these files directly:

- `docs/launch-posts-final.md`
- `docs/open-source-growth-copy.md`
- `docs/modelscope-launch-kit.md`
