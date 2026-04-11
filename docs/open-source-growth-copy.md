# Open Source Growth Copy Kit

This file is the practical copy pack for sharing First LLM Studio after the repository has already gone public.

It complements:

- `docs/open-source-launch-kit.md`
- `docs/open-source-backlog.md`

## Repository short description

### English

Local-first coding agent workbench with MLX local runtimes, benchmark ops, and remote model comparisons.

### 中文

面向 Apple Silicon 的本地优先 coding agent 工作台，集成 MLX 本地模型、benchmark 运维与远端模型对比。

## GitHub pinned repo blurb

### English

First LLM Studio is the workbench we wanted for running MLX local models, benchmarking remote APIs under aligned context budgets, and inspecting replay, trace, patch review, and runtime recovery in one place.

### 中文

First LLM Studio 是一个把 MLX 本地模型、远端 API benchmark 对比、replay、trace、patch review 和 runtime recovery 收到同一工作流里的 agent 工作台。

## GitHub profile bio options

Keep these short enough for a GitHub profile bio.

### English option 1

Building local-first AI tools for Apple Silicon, benchmark ops, and coding agent workflows.

### English option 2

Open-sourcing local-first coding agent and benchmark tooling for Apple Silicon.

### 中文 option 1

在做面向 Apple Silicon 的本地优先 AI 工具、benchmark 运维和 coding agent 工作流。

### 中文 option 2

持续开源本地优先 coding agent、benchmark 和 Apple Silicon AI 工具链。

## Personal homepage / portfolio project intro

### English short

First LLM Studio is an open-source local-first coding agent workbench for Apple Silicon, built around MLX local runtimes, remote model comparisons, replay, trace review, and benchmark operations.

### English medium

First LLM Studio is the project I use to bring local MLX models, remote coding APIs, benchmark execution, replay, patch inspection, and runtime recovery into one operating surface. The goal is not just to get answers from models, but to compare behavior and debug the full workflow.

### 中文短版

First LLM Studio 是一个面向 Apple Silicon 的开源本地优先 coding agent 工作台，围绕 MLX 本地模型、远端模型对比、replay、trace review 和 benchmark 运维构建。

### 中文中版

First LLM Studio 想解决的是“本地模型推理、远端模型对比、benchmark、trace、runtime 排障被分散在不同工具里”的问题。它把 MLX 本地运行、远端 API 对比、benchmark 执行、replay、patch 检查和 runtime recovery 收进了一个统一工作流。

## X / Twitter launch post

### English

Open sourced First LLM Studio today.

It is a local-first coding agent workbench for Apple Silicon with:

- MLX local runtimes
- local vs remote benchmark compare
- replay + trace review
- patch inspection
- runtime recovery and prewarm visibility

Validated in v0.2.3:

- all-local 32K formal
- all-local 32K full: 426 / 426 ok
- mixed local + remote 32K compare: 0 failed

Repo: https://github.com/ChrisChen667788/local-agent-lab

### 中文

把 First LLM Studio 开源了。

这是一个面向 Apple Silicon 的本地优先 coding agent 工作台，核心是把这些环节放回同一个界面里：

- MLX 本地模型运行
- 本地 / 远端 benchmark 对比
- replay + trace review
- patch 检查
- runtime recovery 和 prewarm 可见性

当前 v0.2.3 已验证：

- all-local 32K formal
- all-local 32K full: 426 / 426 ok
- mixed local + remote 32K compare: 0 failed

Repo: https://github.com/ChrisChen667788/local-agent-lab

## LinkedIn launch post

### English

I just open sourced First LLM Studio.

The project started from a frustration with switching between separate tools for local model inference, benchmark spreadsheets, runtime shell scripts, and coding-agent debugging. First LLM Studio is my attempt to keep those loops in one Apple Silicon workbench:

- local MLX models and remote APIs in one UI
- benchmark runs, history, baseline deltas, and compare mode
- replay, trace review, patch inspection, and repo-grounded debugging
- local runtime operations including prewarm, restart, and recovery visibility

The current release validates all-local and mixed local+remote 32K benchmark workflows.

Repository: https://github.com/ChrisChen667788/local-agent-lab

### 中文

我把 First LLM Studio 开源了。

这个项目的出发点很简单：本地模型推理、远端 API 对比、benchmark、runtime shell 脚本和 agent 调试，通常都被拆在不同工具里。First LLM Studio 想做的是把这些环节重新收回同一个 Apple Silicon 工作台：

- MLX 本地模型和远端 API 放在同一套 UI 里
- benchmark 执行、历史、baseline delta 和 compare 模式放在一起
- replay、trace review、patch inspection、repo-grounded 排障统一查看
- 本地 runtime 的 prewarm、restart、recovery 也变成产品内能力

当前版本已经验证 all-local 32K 和 mixed local + remote 32K benchmark 工作流。

Repository: https://github.com/ChrisChen667788/local-agent-lab

## Hacker News launch draft

### Title ideas

- Show HN: First LLM Studio, a local-first coding agent workbench for Apple Silicon
- Show HN: Benchmark local MLX models and remote coding APIs in one workbench

### Intro paragraph

I built this because I wanted one place to run local MLX models, compare them against hosted coding APIs, inspect replay and patch review, and debug benchmark/runtime failures without juggling separate tools. The current open-source release validates all-local 32K and mixed local+remote 32K benchmark runs.

## Reddit launch draft

### English

I open sourced First LLM Studio, a local-first coding agent workbench for Apple Silicon. It combines MLX local runtimes, remote model comparisons, replay, trace review, and benchmark operations in one app.

### 中文

开源了一个面向 Apple Silicon 的本地优先 coding agent 工作台：First LLM Studio。它把 MLX 本地模型、远端模型对比、replay、trace review 和 benchmark 运维放到了同一套工作流里。

## Reply templates

### “Why not just use Cursor / an IDE agent?”

Because the project is less about replacing an editor and more about making local-vs-remote behavior visible: benchmark ops, runtime recovery, replay, and trace review are first-class surfaces here.

### “Why local-first?”

Because local models let us test latency, privacy, fallback behavior, and runtime reliability directly on-device. The point is not only cheaper inference, but better control and better observability.

### “What is the best local model in the repo right now?”

Right now the default local 4B lane is `Qwen3.5 4B 4-bit`, with `Qwen3 4B` kept as a comparison target and `Qwen3 0.6B` as the lightweight lane.

## Asset guidance

Recommended usage:

- GitHub social preview: `public/oss-cover.png`
- square social card: `public/oss-social-square.png`
- announcement thread / Notion / blog feature strip: `public/oss-feature-strip.svg`
