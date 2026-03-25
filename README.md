# Local Agent Lab

本项目是一套面向 Apple Silicon 的本地优先编码 Agent 工作台。

主入口：

- `/agent`：本地/远端统一 Agent 工作台
- `/admin`：调用、性能、Benchmark、本机资源观测后台

路线图：

- [`/Users/chenhaorui/Documents/New project/docs/development-roadmap.md`](/Users/chenhaorui/Documents/New%20project/docs/development-roadmap.md)

## 当前能力

- 本地模型：
  - `Local Qwen3 0.6B`
  - `Local Qwen3 4B 4-bit`
- 远端目标：
  - `OpenAI / Codex`
  - `Claude (Aipro OpenAI-compatible)`
  - `Kimi`
  - `GLM`
  - `DashScope / Qwen API`
- 编码 Agent 工具：
  - `list_files`
  - `read_file`
  - `execute_command`
  - `write_file`
  - `apply_patch`
- 安全机制：
  - `confirmation_required`
  - `Approve / Reject / Resume Agent`
  - 命令分级与受保护路径确认
- 运行时能力：
  - 本地流式输出
  - 单模型 / 全部模型预热
  - 释放已加载模型
  - 重启本地网关
  - 查看本地网关日志
- 后台能力：
  - 请求 / Token / 并发 / 失败率
  - 首字延时 / 总耗时 / Token 吞吐
  - `provider / model / contextWindow` 筛选
  - 本地 Benchmark 执行与历史趋势
  - 本机内存 / 存储 / 电池 / GPU 代理 / 能耗代理

## 本地架构

1. [`/Users/chenhaorui/Documents/New project/scripts/local_model_gateway.py`](/Users/chenhaorui/Documents/New%20project/scripts/local_model_gateway.py)
   暴露本地 MLX 模型、流式输出、工具循环和运行时控制端点。
2. [`/Users/chenhaorui/Documents/New project/scripts/local_model_gateway_supervisor.py`](/Users/chenhaorui/Documents/New%20project/scripts/local_model_gateway_supervisor.py)
   守护本地网关进程，负责自动拉起和重启。
3. [`/Users/chenhaorui/Documents/New project/lib/agent/providers.ts`](/Users/chenhaorui/Documents/New%20project/lib/agent/providers.ts)
   统一本地和远端 provider 的调用适配。
4. [`/Users/chenhaorui/Documents/New project/components/agent/AgentWorkbench.tsx`](/Users/chenhaorui/Documents/New%20project/components/agent/AgentWorkbench.tsx)
   统一工作台 UI。
5. [`/Users/chenhaorui/Documents/New project/components/admin/AdminDashboard.tsx`](/Users/chenhaorui/Documents/New%20project/components/admin/AdminDashboard.tsx)
   统一后台监控与 benchmark 视图。

## 快速启动

### 1. 启动前端

```bash
nvm use || nvm install
npm install
cp .env.example .env.local
npm run dev
```

说明：

- 前端当前固定使用 `Node 22 LTS` 运行。
- 如果本机默认是 `Node 25` 之类的非 LTS 版本，直接跑 `next dev` 可能会在首个请求阶段崩掉。
- 现在 `npm run dev / build / start` 已经统一自动走 `Node 22`。

默认地址：

- [http://localhost:3011/agent](http://localhost:3011/agent)
- [http://localhost:3011/admin](http://localhost:3011/admin)

当前调试期稳定入口：

- [http://localhost:3012/agent](http://localhost:3012/agent)
- [http://localhost:3012/admin](http://localhost:3012/admin)

如果你希望把开发服务挂到后台长期运行，使用：

```bash
./scripts/dev-server.sh start
./scripts/dev-server.sh status
./scripts/dev-server.sh log
./scripts/dev-server.sh stop
```

说明：

- `scripts/dev-server.sh` 会固定使用 `Node 22` 启动 `Next.js`。
- 这条脚本默认走生产链路；调试时可通过 `MODE=dev` 启动。

## Git 与版本约定

- 主分支：`main`
- 版本号规则：`SemVer`，例如 `v0.1.0`
- 当前版本文件：[`/Users/chenhaorui/Documents/New project/VERSION`](/Users/chenhaorui/Documents/New%20project/VERSION)
- 发布记录目录：[`/Users/chenhaorui/Documents/New project/docs/releases`](/Users/chenhaorui/Documents/New%20project/docs/releases)
- 推荐命名：
  - Git tag：`v0.1.0`
  - 发布记录：`v0.1.0_2026-03-26.md`

### 2. 启动本地网关 Supervisor

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install mlx mlx-lm fastapi uvicorn
python scripts/local_model_gateway_supervisor.py
```

默认本地网关：

- `http://127.0.0.1:4000`

### 3. 可选配置远端 API

在 `.env.local` 中填入需要的 key：

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `KIMI_API_KEY`
- `GLM_API_KEY`
- `DASHSCOPE_API_KEY`

Claude/Aipro 当前走的是 `OpenAI-compatible` 路径，不走 `Anthropic Messages tool use`。

## 关键日志目录

- [`/Users/chenhaorui/Documents/New project/data/agent-observability`](/Users/chenhaorui/Documents/New%20project/data/agent-observability)

包含：

- `chat-history.jsonl`
- `connection-checks.jsonl`
- `telemetry.jsonl`
- `benchmark-history.jsonl`
- `local-gateway.log`

## 当前重点限制

- 本地 MLX 网关已经有 supervisor，但长时间驻留和高频模型切换下的稳定性还需要继续压实。
- 检索增强当前是文件型知识库 + 词法召回 + grounded 校验，还没有向量数据库 / rerank / hybrid retrieval。
- Planner / Memory / prompt cache / semantic cache 已接入 MVP，但还没进入严格的生产级状态管理与失效策略。
- 本地小模型链路仍然依赖 `4000` 网关运行状态；如果只测远端目标，前端可单独使用。
