# First LLM Studio Final Launch Posts

This file is the ready-to-paste final post set for GitHub, ModelScope, and Chinese communities.

## 1. GitHub release / discussion

### English

Open-sourced **First LLM Studio v0.3.0**.

It is a local-first LLM workbench for Apple Silicon that keeps:

- MLX local runtimes
- remote API comparison
- Compare Lab
- benchmark ops
- replay / trace review
- runtime telemetry

inside one operating surface.

If you care about how local and remote models actually behave, not just how they answer, this project is built for that loop.

Repo: https://github.com/ChrisChen667788/local-agent-lab  
Release: https://github.com/ChrisChen667788/local-agent-lab/releases/tag/v0.3.0

### 中文

刚开源 **First LLM Studio v0.3.0**。

这是一个面向 Apple Silicon 的本地优先 LLM 工作台，把：

- MLX 本地运行时
- 远端 API 对比
- Compare Lab
- benchmark 运维
- replay / trace 审阅
- runtime 实时监控

收进同一个操作面。

如果你关心的不是“模型答了什么”，而是“本地和远端模型到底怎么表现、怎么退化、怎么恢复”，这个项目就是为这条链路做的。

Repo: https://github.com/ChrisChen667788/local-agent-lab  
Release: https://github.com/ChrisChen667788/local-agent-lab/releases/tag/v0.3.0

## 2. ModelScope short launch

### English

**First LLM Studio** is now on ModelScope.

Built for local-first LLM workflows on Apple Silicon:

- run MLX local models
- compare them with remote APIs
- review benchmark regressions
- inspect replay / trace evidence
- watch runtime cost in one place

ModelScope: https://www.modelscope.cn/models/haozi667788/first-llm-studio

### 中文

**First LLM Studio** 已经同步到魔搭社区。

它面向 Apple Silicon 的本地优先 LLM 工作流：

- 跑 MLX 本地模型
- 对比远端 API
- 审阅 benchmark 回归
- 查看 replay / trace 证据
- 在同一个工作台里观察 runtime 开销

魔搭地址：https://www.modelscope.cn/models/haozi667788/first-llm-studio

## 3. Chinese community short post

### 中文

开源了一个我自己很想长期用下去的项目：**First LLM Studio**。

它把本地 MLX、远端 API 对比、Compare Lab、benchmark 运维和 runtime 实时监控收进同一个工作台里。

如果你也在做本地优先 LLM 工作流，欢迎看一眼：

GitHub: https://github.com/ChrisChen667788/local-agent-lab  
魔搭: https://www.modelscope.cn/models/haozi667788/first-llm-studio

## 4. Chinese community long post

### 中文

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
魔搭: https://www.modelscope.cn/models/haozi667788/first-llm-studio
