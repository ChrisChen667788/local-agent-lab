# Agent Lab Development Roadmap

Last updated: 2026-03-23

## Version snapshot

当前版本已经具备下面这些主能力：

- 本地/远端统一 Agent 工作台
- 本地 Qwen 0.6B / 4B 4-bit 切换
- 流式聊天
- 编码工具链与安全确认流
- 本地网关 supervisor / 自动拉起基础设施
- 运行时预热、释放模型、重启网关、日志查看
- 多语言 UI
- 后台监控、Benchmark 执行、Benchmark 历史趋势
- Benchmark Markdown / JSON 导出
- `p50 / p95 / p99` 分位数指标
- 会话持久化与历史恢复
- 会话重命名 / 删除 / 固定
- 会话搜索 / 按目标分组 / 批量清理
- 会话按 target 过滤 / 批量导出
- Benchmark 导出过滤（时间窗口 / 成功样本 / 失败样本 / 历史级成功失败过滤）
- 远端 provider 分层配置（极速 / 平衡 / 工具优先）
- 远端 thinking 模式（env 驱动满血模型 + 自动放大预算）
- Benchmark 已支持远端 target、providerProfile 和 thinkingMode
- 主界面已显示 thinking model 当前实际解析结果
- 主界面已显示每次请求实际采用的 providerProfile
- 主界面已显示每次请求实际采用的 thinkingMode，并标记 Thinking 模型回退原因
- 远端短问答默认自动降到 speed，并继续走流式路径
- 后台延时拆分图（上游首字 / 应用总耗时 / 应用层额外耗时）
- 后台已支持 benchmark 的 thinkingMode 筛选与 providerProfile 趋势对比
- 远端 benchmark 已支持 `speed / balanced / tool-first / thinking` 批量对照跑法
- 后台已支持 benchmark 的 providerProfile × thinkingMode 交叉热力图
- benchmark 已支持保存 baseline，并显示“对比上次结果”差值
- benchmark 已支持 baseline 与当前结果的 delta 视图
- benchmark heatmap 已支持按 首字 / 总耗时 / 吞吐 / 成功率 切换指标
- benchmark 已支持固定 prompt 集的批量回归模式
- benchmark 已支持 Dataset 模式和正式评测集模式
- benchmark 已内置公开基准的 starter subsets，并带来源标签和评分规则
- benchmark Prompt 集已扩展为覆盖性能、指令、中文、grounded QA、工具、代码检索与 Agent 流程的固定回归集
- benchmark 已支持固定 prompt 集 × target × profile 的回归基线面板
- benchmark baseline 已支持重命名 / 删除 / 设为默认
- heatmap 已支持独立时间窗口和“仅固定 Prompt 集”过滤
- heatmap 已支持成功样本 / 失败样本过滤
- 基线面板已支持指定某条 baseline 作为当前对比对象
- prompt 集已支持新增 / 编辑 / 删除
- benchmark 已支持导出 Markdown 回归报告
- benchmark 已支持正式里程碑评测集，并可输出更接近正式评测口径的回归报告
- benchmark 已区分 `milestone-formal` 与 `milestone-full`
- benchmark 已支持运行进度、预计剩余时间与 runId 级进度查询
- 远端 profile 批量 benchmark 已支持“对比子集”模式
- 文件型知识库、结构化 chunking 与词法检索底座已落地
- `/admin` 已支持知识文档 CRUD、chunk 观察与检索验证
- `/agent` 已支持检索增强开关，并在 grounded 模式下注入证据与返回 citation 命中摘要
- grounded generation 已补 citation enforcement / 低置信度保守回退 / answer verification 启发式校验
- 检索链路已补 query-focused retrieval compression
- 远端链路已补 prompt cache / semantic cache
- 会话链路已补 planner + session memory 注入 MVP
- provider 调用已补单次自动恢复策略
- `/agent` 与 `/admin` 已改成动态加载重型 client 模块，首屏不再被大 bundle 阻塞
- 已新增 `scripts/dev-server.sh`，并改用 `screen` 稳定托管本地前端服务

## Current focus

当前主目标不是继续盲目加功能，而是把这三件事做实：

1. 本地网关稳定性
2. Benchmark 指标可信度
3. 会话与运维历史可追溯性

## Completed in the current line

1. 本地 MLX 网关从阻塞启动改成懒加载 `mlx_lm`
2. 本地原始流和应用层流都补了 `<think>` 清洗
3. 首页支持上下文体量配置
4. 首页支持单模型 / 全部模型预热
5. 后台支持首字延时 / 总耗时 / Token 吞吐图
6. 后台支持 `provider / model / contextWindow` 筛选
7. Benchmark API + UI + 历史落盘已完成
8. 本地网关 supervisor / 自动拉起基础设施已接入主链路
9. 主界面支持复制、Enter 发送、文本框缩放、会话导出
10. Aipro/Claude 自检、日志导出、健康徽标已完成
11. 本地运行时支持释放模型 / 重启网关 / 查看日志
12. Benchmark 历史已升级为趋势对比视图
13. heatmap 已补成功/失败样本过滤
14. prompt 集已补 CRUD 管理
15. benchmark 已补回归报告导出
16. `/admin` 已补本地运行时运维面板
17. 本地网关 supervisor 已记录重启次数 / 启停时间 / 退出码 / 最近事件
18. 本地 runtime / prewarm / benchmark 已补本地网关重启重试与清场恢复逻辑
19. 已补文件型知识库存储、Markdown/段落切分与 chunk 生成
20. 已补知识库管理 API、检索查询 API 和 grounded system prompt 注入
21. `/agent` 和 `/admin` 都能看到 retrieval hit / citation / 低置信度状态
22. 前端服务访问恢复，`/agent` 与 `/admin` 已验证返回 `200`

## Main gaps

1. 本地网关长期稳定性仍需继续验证
   重点场景：长时间空闲后恢复、连续模型切换、批量 benchmark。

2. 指标统计仍需继续增强
   当前 `p50 / p95 / p99` 已补齐，并已下沉到对比表格、模型分布、上下文体量分布；延时拆分图、providerProfile 过滤、remote benchmark 趋势线、heatmap 指标切换、baseline delta 视图和固定 prompt 集回归已补齐，下一步是补失败样本分布和成功率趋势。

3. Benchmark 体系已进入“正式报告”阶段，但还需继续做深
   当前已经具备：
   - 自定义 Prompt
   - 固定 Prompt 集
   - Dataset 模式
   - 正式评测集（suite）模式
   - baseline / regression report / heatmap / prompt-set CRUD
   下一步应继续补：
   - dataset / suite 的趋势对照
   - 正式评测报告模板收敛
   - 数据集自动扩展与人工复核闭环

4. benchmark 和会话历史还需更强管理
   当前 benchmark 已支持 Markdown / JSON 导出、样本过滤、历史级成功/失败过滤、providerProfile / thinkingMode 过滤；会话已支持恢复、重命名、删除、固定、搜索、按 target 分组、按 target 过滤、批量清理、批量导出（当前筛选项 / 仅固定项），但还没有服务端持久化。

5. 产品结构仍有旧页面残留
   导航已收敛到 `/agent` 和 `/admin`，但仓库里还保留历史演示页面文件。

6. RAG / 检索增强仍处于第一阶段
   当前已经有文件型知识库、chunking、词法检索和 grounded prompt 注入，但还没有向量数据库、embedding、rerank、hybrid retrieval、answer verification、citation enforcement、低置信度 fallback 这一整套检索闭环。

7. Agent 能力仍偏“工具型工作台”
   当前已有 tool loop、profile、thinking、benchmark、baseline，但还没有 Planner、Memory System、状态持久化工作流、错误恢复策略、检索增强编排这些更接近生产级 Agent 的能力。

8. 成本优化仍偏请求级策略
   当前已有上下文裁剪、短问答自动降档、按 profile 压 `max_tokens`，但还没有 prompt caching、semantic cache、任务级 token budget controller、route-to-small-model、retrieval compression、response compression、speculative decoding 等系统级降本能力。

## New backlog from the latest review

下面这些来自最近一次架构复盘，已经纳入正式后续任务，但需要按工程优先级推进，不会与当前已验证链路混为一谈。

### 1. Grounded / anti-hallucination

- 基于检索证据的 grounded generation
- answer verification
- citation enforcement
- self-consistency
- model-as-judge
- retrieval confidence 低时的 fallback answer

### 2. Cost / latency control

- prompt caching
- semantic cache
- retrieval compression
- response compression
- route-to-small-model
- speculative decoding
- 任务级 token budget controller

### 3. Agent capability uplift

- Planner
- Memory System
- 状态持久化
- Tool orchestration policy
- 错误恢复策略
- 检索增强

### 4. Original backlog stays active

- 本地网关稳定性
- benchmark / baseline / heatmap / 运维面板
- prompt 集管理
- 历史可追溯性
- 遗留页面与结构清理
- 端到端 smoke tests

## Next 20 rounds

1. Admin backlog 收口
   Status: completed
   Scope: 已完成指定 baseline 作为当前对比对象、heatmap 成功/失败样本过滤、prompt 集新增/编辑/删除，dashboard 与 benchmark 链路已打通。

2. Benchmark 回归报告
   Status: completed
   Scope: 已支持自动生成 Markdown 回归报告，包含基线差值、热力图摘要、异常项摘要、最近一次与 baseline 的 delta。

3. 运行时运维面板 + 本地网关稳定性强化
   Status: completed
   Scope: 已在 `/admin` 直接查看并操作 `prewarm / release / restart / log tail`，并补充 supervisor 状态摘要、冷启动重试、拉起超时原因细分、子进程退出码记录、批量 benchmark / prewarm 期间的恢复链路。

4. 检索底座与文档切分
   Status: completed
   Scope: 已引入最小可用检索底座，补齐文档 ingest、Markdown/段落 chunking、metadata 结构、文件型知识库存储、检索验证 API，并接到 `/agent` 的 grounded system prompt 注入链路。

5. Grounded generation 与证据约束
   Status: completed
   Scope: 已补 grounded system prompt 注入、citation hit 回传、citation enforcement、低置信度 fallback、answer verification 启发式校验，并将 verification 结果接入会话显示与聊天日志。

6. 检索质量优化
   Status: completed
   Scope: 已补 retrieval compression、answer verification 结果复用和 grounded 检索摘要；下一步再补 hybrid retrieval / rerank 与系统化检索评测。

7. 成本与时延控制
   Status: completed
   Scope: 已接入 prompt cache、semantic cache 和现有 token budget 控制；下一步再补 route-to-small-model 与更严格的任务级预算控制。

8. Agent 核心能力升级
   Status: completed
   Scope: 已补 Planner / Session memory 注入 MVP，并沿用现有会话持久化；下一步再补更完整的状态持久化和 tool orchestration policy。

9. 错误恢复与评判闭环
   Status: completed
   Scope: 已补 provider 单次自动恢复和 grounded verification judge 启发式；下一步再补 self-consistency 与 model-as-judge。

10. 清理与验收
   Status: completed
   Scope: 已稳定 `/agent` 与 `/admin` 的重型页面加载，前端开发服务改为 `screen` 托管，并完成页面与 API smoke checks；下一步再继续收口历史页面和目录结构。

11. Grounded citation enforcement
    Status: planned
    Scope: 在 grounded 对话链路中强制引用 retrieval 命中块，回答缺引用时标记 warning，并把 citation 缺失纳入 benchmark。

12. Low-confidence fallback answers
    Status: planned
    Scope: 当 retrieval confidence 低或 hitCount 太少时，自动切换为保守回答模板，明确提示证据不足，避免硬编。

13. Answer verification / model-as-judge
    Status: planned
    Scope: 为 grounded QA 和正式评测集引入二次验证与 judge 结果，输出 verification verdict、争议样本列表和人工复核入口。

14. Hybrid retrieval scaffold
    Status: planned
    Scope: 在现有词法检索上预留 embedding / rerank / hybrid retrieval 接口，先完成本地可插拔检索层。

15. Retrieval quality evaluation
    Status: planned
    Scope: 增加命中率、citation precision、fallback rate、verification pass rate 等检索质量指标，并接入 `/admin`。

16. Prompt / semantic cache
    Status: planned
    Scope: 引入 prompt caching 与 semantic cache，优先覆盖短问答、固定 prompt 集和 grounded QA 场景。

17. Route-to-small-model / token budget controller
    Status: planned
    Scope: 根据问题长度、工具意图、retrieval 命中与 thinking 模式，自动在 `0.6B / 4B / remote` 之间路由，并做任务级 token 预算控制。

18. Planner & stateful task execution
    Status: planned
    Scope: 加入 Planner、可恢复任务状态和多步计划摘要，让 Agent 不再只是一轮工具循环。

19. Memory System & state persistence
    Status: planned
    Scope: 将短期工作记忆、长期检索记忆和会话状态从前端 localStorage 逐步迁移到服务端可检索存储。

20. Release hardening
    Status: planned
    Scope: 完成 smoke test、benchmark regression gate、runtime self-heal 验证、文档收口和正式报告模板定稿。

## Batch rule

每一轮开发都遵守这四条：

1. 先修影响可信度的问题，再做新能力。
2. 改动尽量收敛在最少文件。
3. TypeScript 和 Python 语法检查必须通过。
4. `/agent` 与 `/admin` 都要留下可观测结果，而不是只停留在代码层。
