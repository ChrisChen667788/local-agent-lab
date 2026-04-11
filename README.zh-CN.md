# First LLM Studio

[English](./README.md) | [简体中文](./README.zh-CN.md)

![Release](https://img.shields.io/github/v/release/ChrisChen667788/local-agent-lab?label=release)
![License](https://img.shields.io/github/license/ChrisChen667788/local-agent-lab)
![Apple Silicon](https://img.shields.io/badge/platform-Apple%20Silicon-0f172a)
![MLX](https://img.shields.io/badge/local%20runtime-MLX-06b6d4)

![First LLM Studio cover](./docs/assets/github-hero.svg)

First LLM Studio 是一个面向 Apple Silicon 的本地优先 LLM 工作台。它把本地 MLX 运行时、远端 API 目标、benchmark 运维、Compare 对比、replay、trace review、runtime recovery 和模型观测统一到一个操作界面里。

## 这个项目为什么值得关注

很多团队现在仍然把工作流拆在太多工具里：

- 用本地模型 playground 做推理
- 用聊天工具试 prompt
- 用脚本或表格做 benchmark
- 用 shell 脚本做本地网关恢复和排障
- 本地模型和远端 API 还分属不同面板

First LLM Studio 的目标，就是把这些环节重新收回同一个工作台，让我们比较的是“行为差异”，而不只是最后一句答案。

## 对哪些用户有价值

### 1. Apple Silicon 本地 AI 开发者

- 在统一上下文预算下，对比 MLX 本地模型和托管 API
- 直接查看 prewarm、release、restart、恢复动作和硬件开销
- 判断哪个本地模型真的适合日常 coding workflow

### 2. Agent / 工具链团队

- 在一个工作台里验证 tool calling、repo grounding、replay 和 patch 流程
- 直接把 compare 结果送入 benchmark，不必切换产品
- 把失败来源拆清楚：是模型质量、provider 行为，还是 runtime 不稳

### 3. 评测和平台工程团队

- 跑 formal、full 和 provider-focused benchmark 套件
- 在 `/admin` 里查看 baseline、delta、run note 和失败分类
- 让本地与远端 target 落在同一个可比较的 target catalog 里

## 核心价值

- 本地 / 远端统一 target catalog
- 内置 Compare Lab，支持模型对模型审阅
- formal / focused benchmark 运维与历史基线
- replay、trace review、patch inspection，以及可分享的审阅导出
- prewarm、release、restart、日志排查与 telemetry
- 一键扫描新本地模型和已接入远端 API

## 当前支持的 target

### 本地

- `Local Qwen3 0.6B`
- `Local Qwen3 4B 4-bit`
- `Local Qwen3.5 4B 4-bit`
- `Local Gemma 3 4B It Qat 4-bit`

### 远端

- `OpenAI Codex`
- `OpenAI GPT-5.4`
- `Claude API`
- `DeepSeek API`
- `Kimi API`
- `GLM API`
- `Qwen API`

## 产品界面

### `/agent`

- 运行带工具循环的 LLM 会话
- 在统一 prompt 和锁定控制项下对比多个 target
- 查看 prompt frame、runtime 状态、replay 和可分享的 review 输出
- 一键扫描新发现的本地模型和已配置远端 API

### `/admin`

- 启动 formal、full 和 provider-focused benchmark 套件
- 查看 benchmark 进度、恢复动作、失败原因和 run note
- 监控本地网关 CPU、内存、GPU、共享显存、能耗信号和存储压力
- 对每个本地 target 执行 prewarm、release、restart 和日志检查

## 它和普通 LLM 应用有什么不同

First LLM Studio 不是另一个聊天壳。

它更适合那些需要下面这些能力的人：

- 真的要交付或评估本地优先 LLM 工作流
- 需要在公平约束下对比本地和远端模型
- 需要 debug 工具行为和 runtime 回归
- 想把实验、benchmark 和运维收在一个面板里

## 截图

![Landing page](./docs/assets/landing-page.png)
![Agent workbench](./docs/assets/agent-workbench.png)
![Admin dashboard](./docs/assets/admin-dashboard.png)

## 快速开始

### 环境要求

- Apple Silicon macOS
- Node `22.x`
- Python `3.12`
- 可运行 MLX 的本地环境

### 安装

```bash
nvm install 22
nvm use 22
npm install
cp .env.example .env.local
```

### 启动 Web 应用

```bash
npm run dev
```

默认入口：

- [http://localhost:3011/agent](http://localhost:3011/agent)
- [http://localhost:3011/admin](http://localhost:3011/admin)

### 启动本地模型网关

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install mlx mlx-lm
python scripts/local_model_gateway_supervisor.py
```

网关健康检查：

- [http://127.0.0.1:4000/health](http://127.0.0.1:4000/health)

## 配置说明

把 `.env.example` 复制成 `.env.local`，只填写你要启用的 provider 即可。

需要注意：

- `.env.local` 已被 git 忽略
- 远端 provider 是可选的
- 部分 target 走 OpenAI-compatible / Claude-compatible endpoint
- 本仓库公开版本已经做过脱敏，占位值需要替换成你自己的 endpoint

## 仓库结构

```text
app/                      Next.js app routes
components/               Agent 和 Admin UI
lib/agent/                Agent runtime、providers、benchmark、gateway helpers
scripts/                  本地网关、runtime、dev 脚本
docs/                     release notes、launch notes、roadmap、项目文档
public/                   对外资源和社媒封面图
```

## 宣发素材

仓库里已经附带一套可以直接复用的宣发包：

- [docs/open-source-launch-kit.md](./docs/open-source-launch-kit.md)
- [docs/open-source-growth-copy.md](./docs/open-source-growth-copy.md)
- [docs/open-source-backlog.md](./docs/open-source-backlog.md)
- [public/oss-cover.svg](./public/oss-cover.svg)
- [public/oss-cover.png](./public/oss-cover.png)
- [public/oss-social-square.svg](./public/oss-social-square.svg)
- [public/oss-social-square.png](./public/oss-social-square.png)

## 安全和隐私

- 敏感本地操作默认需要确认
- Secret 应保存在 `.env.local`
- 公开仓库默认配置已经做过脱敏
- 公开发布前，git 历史作者信息已经统一改成 GitHub noreply 地址
- 见 [SECURITY.md](./SECURITY.md)

## 贡献

欢迎 issue 和 PR。

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [docs/open-source-backlog.md](./docs/open-source-backlog.md)

## 发布说明

- 当前版本：[`VERSION`](./VERSION)
- Release notes：[`docs/releases`](./docs/releases)
- 发布流程：[`docs/release-process.md`](./docs/release-process.md)
- 最新版本说明：[v0.3.0](./docs/releases/v0.3.0_2026-04-11.md)
