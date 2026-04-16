# First LLM Studio

> English | [简体中文](#简体中文)

A local-first LLM studio for Apple Silicon that brings MLX local runtimes, remote API comparison, benchmark operations, Compare Lab, replay, trace review, runtime recovery, and model telemetry into one workspace.

![First LLM Studio cover](./assets/oss-cover.png)

## What it is

First LLM Studio is designed for developers who need to run local and remote LLM workflows side by side and inspect how those systems actually behave in production-like conditions.

It is not only a chat shell. It is a working surface for:

- local model experimentation on Apple Silicon
- remote API comparison under aligned context budgets
- benchmark operations and regression review
- runtime recovery, telemetry, and observability
- replay, trace review, and tool-call inspection

## Who it helps

### Local AI builders

- evaluate which local MLX models are really usable for daily coding and analysis
- compare local and remote outputs under fair constraints
- keep hardware cost and runtime state visible while iterating

### Agent and tooling teams

- validate tool loops, repo-grounded behavior, and output contracts
- turn compare runs into repeatable benchmark review
- debug quality versus provider versus runtime regressions

### Evaluation and platform engineers

- launch formal and focused benchmark suites
- inspect failure causes, run notes, and baseline drift
- operate local runtime prewarm, release, restart, and health checks from the same product

## Core value

- Unified local + remote target catalog
- Compare Lab for model-vs-model output review
- Built-in benchmark operations and run history
- Replay, trace review, patch inspection, and exportable review notes
- Runtime telemetry: CPU, memory, GPU, shared GPU memory, energy signal, storage pressure
- Dynamic scanning for newly discovered local models and configured remote APIs

## Visual overview

### Landing page

![Landing page](./assets/landing-page.png)

### Agent workbench

![Agent workbench](./assets/agent-workbench.png)

### Admin dashboard

![Admin dashboard](./assets/admin-dashboard.png)

## Benchmark and telemetry proof

### Benchmark percentile board

![Benchmark percentile board](./assets/benchmark-percentiles.png)

### Formal regression summary

![Formal regression summary](./assets/formal-regression-summary.png)

### Local runtime telemetry

![Local runtime telemetry](./assets/runtime-telemetry-cards.png)

## Why it is attractive for the community

Many open-source tools do one slice well. First LLM Studio tries to keep the full workflow together:

- experiment
- compare
- benchmark
- diagnose
- recover

That makes it useful for people who are shipping local-first LLM systems, not only demoing them.

## Repository

- GitHub: [https://github.com/ChrisChen667788/local-agent-lab](https://github.com/ChrisChen667788/local-agent-lab)
- Release note: [v0.3.0](https://github.com/ChrisChen667788/local-agent-lab/blob/main/docs/releases/v0.3.0_2026-04-11.md)

---

# 简体中文

First LLM Studio 是一个面向 Apple Silicon 的本地优先 LLM 工作台，把 MLX 本地运行时、远端 API 对比、benchmark 运维、Compare Lab、replay、trace review、runtime recovery 和模型遥测统一到同一个界面里。

![First LLM Studio 封面](./assets/oss-cover.png)

## 这是什么项目

它不是单纯的聊天壳，而是面向真实工作流的操作台，适合：

- 本地模型实验
- 本地 / 远端公平对比
- benchmark 回归审阅
- runtime 排障与恢复
- tool call、replay、trace 检查

## 对哪些用户有价值

### 本地 AI 开发者

- 判断哪些 MLX 本地模型真的适合日常 coding / analysis
- 在统一约束下对比本地与远端模型
- 一边调模型，一边看硬件开销和 runtime 状态

### Agent / 工具链团队

- 验证工具循环、repo grounding 和输出契约
- 把 compare 结果转成可复现 benchmark
- 区分问题到底来自模型质量、provider 行为还是 runtime 不稳

### 评测 / 平台工程团队

- 启动 formal 和 focused benchmark 套件
- 查看失败原因、run note、baseline 漂移
- 在一个产品里完成 prewarm、release、restart 和健康检查

## 核心价值

- 本地 / 远端统一 target catalog
- Compare Lab 支持模型对模型审阅
- benchmark 运维和历史回看内建
- replay、trace review、patch inspection 与审阅导出
- CPU、内存、GPU、共享显存、能耗信号、存储压力等 telemetry
- 支持扫描新本地模型和已配置远端 API

## 页面预览

### 首页

![首页截图](./assets/landing-page.png)

### Agent 工作台

![Agent 工作台截图](./assets/agent-workbench.png)

### Admin 后台

![Admin 后台截图](./assets/admin-dashboard.png)

## Benchmark 与监控证明

### Benchmark 百分位看板

![Benchmark 百分位看板](./assets/benchmark-percentiles.png)

### 正式回归汇总

![正式回归汇总](./assets/formal-regression-summary.png)

### 本地 runtime 实时监控

![本地 runtime 实时监控](./assets/runtime-telemetry-cards.png)

## 为什么值得社区关注

很多开源工具都只把一个切面做得很好。First LLM Studio 更想把完整工作流收在一起：

- 实验
- 对比
- benchmark
- 排障
- 恢复

所以它更适合那些真的在交付本地优先 LLM 系统的人，而不只是做 demo 的人。

## 仓库地址

- GitHub: [https://github.com/ChrisChen667788/local-agent-lab](https://github.com/ChrisChen667788/local-agent-lab)
- 版本说明: [v0.3.0](https://github.com/ChrisChen667788/local-agent-lab/blob/main/docs/releases/v0.3.0_2026-04-11.md)
