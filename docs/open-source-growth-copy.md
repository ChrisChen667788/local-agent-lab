# First LLM Studio Launch Copy Kit

This file is the final launch copy pack for GitHub, ModelScope, and Chinese communities.

The messaging strategy follows the same patterns that usually让开源项目更容易被记住:

- start with a sharp one-line hook
- say exactly who it is for
- show what pain it removes
- back the claim with concrete screenshots or benchmark evidence
- end with one clear next action

## Core hook

### English

First LLM Studio is a local-first LLM studio for Apple Silicon that keeps local MLX runtimes, remote API comparison, benchmark ops, Compare Lab, replay, and runtime telemetry inside one workbench.

### 中文

First LLM Studio 是一个面向 Apple Silicon 的本地优先 LLM Studio，把本地 MLX、远端 API 对比、benchmark 运维、Compare Lab、replay 和 runtime 实时监控收进同一个工作台。

## Who should care

### English

- Local AI builders on Apple Silicon
- Agent / tooling teams that need model-vs-runtime evidence
- Evaluation and platform engineers who are tired of stitching five tools together

### 中文

- 在 Apple Silicon 上折腾本地模型的开发者
- 需要看清模型、工具循环和 runtime 行为的 Agent / 工具链团队
- 不想再把 benchmark、对比、排障拆在五个工具里的评测 / 平台工程师

## Bright spots to amplify

### English

- local and remote models live in the same target catalog
- Compare Lab stays inside the main workbench instead of becoming a separate toy page
- benchmark review, replay, trace, patch inspection, and runtime recovery stay connected
- local runtime cost is visible with CPU, memory, GPU, shared GPU memory, energy signal, and storage pressure
- new local models and configured remote APIs can be scanned in one click

### 中文

- 本地模型和远端 API 在同一套 target catalog 里统一管理
- Compare Lab 直接长在主工作台里，不是另一个“演示页面”
- benchmark 审阅、replay、trace、patch inspection、runtime recovery 是连着的
- 本地运行代价可见：CPU、内存、GPU、共享显存、能耗信号、存储压力都能看
- 新本地模型和已配置远端 API 可以一键扫描纳入工作台

## Recommended screenshot order

Use this order in launch posts or repo discussions:

1. `docs/assets/landing-page.png`
2. `docs/assets/agent-workbench.png`
3. `docs/assets/runtime-telemetry-cards.png`
4. `docs/assets/benchmark-percentiles.png`
5. `docs/assets/formal-regression-summary.png`

## GitHub launch

### GitHub release / discussion title ideas

- First LLM Studio v0.3.0: local-first LLM workbench for Apple Silicon
- First LLM Studio: compare local MLX models and remote APIs in one workbench
- First LLM Studio v0.3.0: Compare Lab, benchmark ops, and runtime telemetry in one place

### GitHub discussion post

#### English

I just shipped **First LLM Studio v0.3.0**.

This project comes from a very specific frustration: local inference, remote API comparison, benchmark review, runtime recovery, replay, and trace inspection are usually split across too many different tools.

So I built a local-first LLM workbench for Apple Silicon that keeps those loops together.

What stands out in this release:

- MLX local models and remote APIs share one target catalog
- Compare Lab stays inside the main workbench instead of becoming a separate demo page
- benchmark review, replay, trace, and patch inspection stay connected
- local runtime telemetry shows CPU, memory, GPU, shared GPU memory, energy signal, and storage pressure
- newly discovered local models and configured remote APIs can be scanned in one click

This is most useful for:

- local AI builders on Apple Silicon
- agent / tooling teams
- evaluation and platform engineers

Repo: https://github.com/ChrisChen667788/local-agent-lab
Release: https://github.com/ChrisChen667788/local-agent-lab/releases/tag/v0.3.0

#### 中文

我发布了 **First LLM Studio v0.3.0**。

这个项目解决的是一个很具体的问题：本地推理、远端 API 对比、benchmark 回归、runtime 排障、replay 和 trace 审阅，通常被拆在很多不同的工具里。

所以我做了一个面向 Apple Silicon 的本地优先 LLM 工作台，把这些环节重新收回一个工作流里。

这次版本最值得看的点：

- MLX 本地模型和远端 API 共用一套 target catalog
- Compare Lab 直接长在主工作台里，不是一个独立 demo 页面
- benchmark 审阅、replay、trace 和 patch inspection 是连着的
- 本地 runtime 有完整硬件遥测：CPU、内存、GPU、共享显存、能耗信号、存储压力
- 新本地模型和远端 API 可以一键扫描纳入工作台

如果你属于下面这些人，这个项目会比较有价值：

- Apple Silicon 本地 AI 开发者
- Agent / 工具链团队
- 评测 / 平台工程师

Repo: https://github.com/ChrisChen667788/local-agent-lab
Release: https://github.com/ChrisChen667788/local-agent-lab/releases/tag/v0.3.0

## ModelScope launch

### Short description

#### English

A local-first LLM studio for Apple Silicon with MLX runtimes, remote API comparison, Compare Lab, benchmark ops, replay, and runtime telemetry.

#### 中文

面向 Apple Silicon 的本地优先 LLM Studio，集成 MLX 本地运行时、远端 API 对比、Compare Lab、benchmark 运维、replay 和 runtime 实时监控。

### Long-form intro for ModelScope

#### English

First LLM Studio is built for people who are not satisfied with “just another chat shell”.

It is for teams who need to run local MLX models, compare them against remote APIs, review benchmark regressions, inspect replay and trace evidence, and understand the real hardware cost of local runtime decisions.

The core value is not only local inference. The core value is keeping **experiment, compare, benchmark, and recovery** in one operating surface.

#### 中文

First LLM Studio 不是“又一个聊天壳”。

它面向的是那些真的在交付本地优先 LLM 工作流的人：他们需要跑 MLX 本地模型、对比远端 API、审阅 benchmark 回归、查看 replay 和 trace 证据，还要看清本地 runtime 的真实硬件开销。

它最核心的价值，不只是本地推理，而是把 **实验、对比、benchmark、排障与恢复** 放进同一个操作面里。

## Chinese community launch

### Short post

#### 中文

刚把 **First LLM Studio** 开源了。

这是一个面向 Apple Silicon 的本地优先 LLM 工作台，把：

- MLX 本地模型
- 远端 API 对比
- Compare Lab
- benchmark 运维
- replay / trace review
- runtime 实时监控与恢复

收在同一个工作流里。

如果你也在折腾“本地模型怎么和远端 API 公平对比、怎么把 benchmark 和 runtime 排障收在一起”，这个项目可能会刚好对口。

GitHub: https://github.com/ChrisChen667788/local-agent-lab
ModelScope: https://www.modelscope.cn/models/haozi667788/first-llm-studio

### Long post

#### 中文

最近把自己一直在用的一套本地优先 LLM 工作台整理出来并开源了，名字叫 **First LLM Studio**。

它最初想解决的问题其实很朴素：

- 本地模型推理在一个工具里
- 远端 API 对比在另一个工具里
- benchmark 在脚本或表格里
- runtime 排障又靠 shell 和日志
- replay、trace、patch review 再散在别的地方

最后导致一条完整工作流被拆得很碎。

First LLM Studio 想做的是把这些重新收回来：

- 本地 MLX 和远端 API 共用一套 target catalog
- Compare Lab 直接在主工作台里做输出对比
- benchmark、回归审阅、baseline 漂移在 /admin 里闭环
- replay、trace、patch inspection 用来做证据链审阅
- 本地 runtime 的 CPU、内存、GPU、共享显存、能耗信号、存储压力实时可见
- 新本地模型和远端 API 可以一键扫描纳入工作台

我觉得这个项目最适合三类人：

1. Apple Silicon 本地 AI 开发者
2. Agent / 工具链团队
3. 评测 / 平台工程师

它不只是让你“问模型一个问题”，而是让你看清一个 LLM 工作流到底是怎么运转、怎么退化、怎么恢复的。

GitHub: https://github.com/ChrisChen667788/local-agent-lab
ModelScope: https://www.modelscope.cn/models/haozi667788/first-llm-studio

## Reply templates

### “What makes this different from Cursor or a generic chat app?”

Because the goal is not only to chat with a model. The goal is to compare local and remote behavior, inspect benchmark evidence, and keep runtime recovery visible in the same workflow.

### “Why Apple Silicon only?”

Because the project currently leans hard into MLX local runtimes. That focus makes the local-first workflow stronger instead of pretending to support every environment equally well from day one.

### “What should I look at first?”

Start with the Agent workbench, then Compare Lab, then the `/admin` benchmark and runtime telemetry surfaces.
