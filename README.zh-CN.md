# Local Agent Lab

[English](./README.md) | [简体中文](./README.zh-CN.md)

![Release](https://img.shields.io/github/v/release/ChrisChen667788/local-agent-lab?label=release)
![License](https://img.shields.io/github/license/ChrisChen667788/local-agent-lab)
![Apple Silicon](https://img.shields.io/badge/platform-Apple%20Silicon-0f172a)
![MLX](https://img.shields.io/badge/local%20runtime-MLX-06b6d4)

![Local Agent Lab cover](./public/oss-cover.svg)

Local Agent Lab 是一个面向 Apple Silicon 的本地优先 coding agent 工作台。它把下面这些通常分散在不同工具里的环节收在了一起：

- 本地 MLX 模型运行
- 远端 API 模型对比
- benchmark 执行、历史、基线和进度恢复
- replay、trace review、patch inspection
- 本地网关 prewarm、release、restart 和日志排障

如果大多数工具只把“编辑”“聊天”“推理”“评测”里的某一个部分做好，这个项目的目标就是把这些环节放回同一个工作流。

## 这个项目解决什么问题

很多时候我们真正想回答的是：

- 哪个本地模型已经够用，能承担 repo-aware coding？
- 一次 benchmark 回归，到底是质量退了，还是 runtime 链路不稳？
- 模型真的答得更好，还是工具链偷偷降级了？
- 本地和远端对比时，上下文预算到底是不是同一口径？

Local Agent Lab 的设计就是围绕这些问题展开的：

- `/agent` 用来交互式运行 agent
- `/admin` 用来做 benchmark、runtime ops、历史回看和故障诊断

## 核心亮点

- 面向 Apple Silicon 的 MLX 本地运行时
- 本地 / 远端统一 target catalog
- 内置 repo 工具链：
  - `list_files`
  - `read_file`
  - `execute_command`
  - `write_file`
  - `apply_patch`
- replay、trace review、文件级 diff 检查
- benchmark 历史、baseline delta、heatmap、进度恢复、失败分类
- 知识库路径导入、扫描预览、最近路径快捷回填
- 本地运行时操作面板：
  - prewarm
  - release model
  - restart gateway
  - gateway log inspection

## 目前已经验证过的结果

当前已经验证通过：

- all-local `32K` formal benchmark
- all-local `32K` milestone-full benchmark：`426 / 426 ok`
- mixed local + remote `32K` compare：`426 / 426 ok`
- benchmark progress 已能显示显式 prewarm 阶段与恢复动作

当前本地 4B 默认策略：

- `Local Qwen3.5 4B 4-bit` 是默认本地 4B 档
- `Local Qwen3 4B 4-bit` 保留为对比项
- `Local Qwen3 0.6B` 作为轻量本地档位

## 截图

![Landing page](./docs/assets/landing-page.png)
![Agent workbench](./docs/assets/agent-workbench.png)
![Admin dashboard](./docs/assets/admin-dashboard.png)

## 主要界面

### Agent workbench

- 切换本地与远端模型
- 运行带工具调用的 agent 对话
- 查看 replay trace 和 patch review 卡片
- 对比结构化输出

### Admin dashboard

- 启动 formal / full benchmark
- 观察进度、恢复动作、失败类型
- 查看本地 runtime 状态和 gateway 行为
- 回看 benchmark 历史、baseline、delta 和 mixed compare 结果

## 当前支持的 target

### 本地

- `Local Qwen3 0.6B`
- `Local Qwen3.5 4B 4-bit`
- `Local Qwen3 4B 4-bit`

### 远端

- `OpenAI Codex`
- `OpenAI GPT-5.4`
- `Claude API`
- `Kimi API`
- `GLM API`
- `Qwen API`

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
pip install mlx mlx-lm fastapi uvicorn
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

## 开源宣发素材包

仓库里已经附带一套可以直接拿去发帖和补 GitHub 首页的素材：

- [docs/open-source-launch-kit.md](./docs/open-source-launch-kit.md)
- [docs/open-source-growth-copy.md](./docs/open-source-growth-copy.md)
- [docs/open-source-backlog.md](./docs/open-source-backlog.md)
- [public/oss-cover.svg](./public/oss-cover.svg)
- [public/oss-cover.png](./public/oss-cover.png)
- [public/oss-social-square.svg](./public/oss-social-square.svg)
- [public/oss-social-square.png](./public/oss-social-square.png)
- [public/oss-feature-strip.svg](./public/oss-feature-strip.svg)

里面包括：

- GitHub About 文案
- 仓库置顶和个人主页简介文案
- release 宣发摘要
- X / LinkedIn / Hacker News 发帖草稿
- 中英文社媒发布帖合集
- 建议使用的截图顺序
- social preview 素材说明
- 面向贡献者的 backlog 入口

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
- 最新 release：[v0.2.3](https://github.com/ChrisChen667788/local-agent-lab/releases/tag/v0.2.3)

## License

[MIT](./LICENSE)
