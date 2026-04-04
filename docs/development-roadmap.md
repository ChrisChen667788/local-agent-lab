# Agent Lab Development Roadmap

Last updated: 2026-03-28

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
10. Claude 兼容网关自检、日志导出、健康徽标已完成
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

下面这二十轮按“先还原界面与工作流，再收口稳定性，最后再补能力”的顺序排。目的不是继续把项目做散，而是尽量回到你最初定义的那条主线。

1. Agent 第一屏还原收口
   Status: completed
   Scope: 继续压缩主标题区、顶部状态胶囊、右侧信息面板和左侧目标列表，让 `/agent` 第一屏尽量贴近 3 月 26 日前的截图结构。

2. Admin 第一屏还原收口
   Status: completed
   Scope: 继续调整 `/admin` 的 Benchmark 配置、进度、基线、历史和结果卡顺序，让第一屏优先服务 Benchmark 主工作流。

3. Agent 右侧信息面板定型
   Status: completed
   Scope: 把“已解析接口 / 自检 / 模型摘要 / 系统提示词 / 启动提示 / 本地运行时”顺序彻底固定，并统一成信息面板风格。

4. Agent 左侧目标列表定型
   Status: completed
   Scope: 继续把目标模型列表做成高密度连续列表，弱化厚重卡片感，并统一本地/远端/健康状态徽标样式。

5. 本地运行时状态可视化
   Status: completed
   Scope: 让用户在主界面直接看到“网关在线 / 模型加载中 / 已加载别名 / 队列 / 活跃请求”等状态，减少现在的报错不透明感。

6. 本地简单问答路由优化
   Status: completed
   Scope: 默认把简单短问答优先路由到已预热的 `Local Qwen3 0.6B`，降低本地 4B 冷加载把主流程拖慢的概率。

7. 本地 4B 冷态降级机制
   Status: completed
   Scope: 当 `Local Qwen3 4B 4-bit` 未就绪或长时间加载时，自动降级到 `0.6B` 并给出可见提示，而不是直接报错。

8. 本地网关恢复链路加强
   Status: completed
   Scope: 继续收口 gateway “加载中 / 导入慢 / 冲突模型等待 / 失败重启”的恢复逻辑，避免卡死和无限等待。

9. Agent 本地报错文案收口
   Status: completed
   Scope: 把 `Load failed`、空响应、检索低置信度等错误提示改成更明确的业务态文案，减少用户感知上的“坏掉”。

10. Benchmark 本地/远端口径拆分
    Status: completed
    Scope: 把 local benchmark 和 remote benchmark 的配置语义、执行策略和结果说明明确拆开，避免口径混用。

11. local full-suite 稳定性专项
    Status: completed
    Scope: 专门收口 `Local Qwen3 0.6B / 4B 4-bit` 的 formal/full suite，加入分组 warm、局部 early-stop、断点恢复和失败分段重跑。

12. Benchmark 进度与中断恢复
    Status: completed
    Scope: 支持长跑 benchmark 的继续执行、断点恢复和更明确的剩余时间预估，避免页面看起来“一直卡住”。

13. Benchmark 历史与基线定型
    Status: completed
    Scope: 统一历史、基线、delta、结果汇总的长卡片阅读方式，减少现在不同区块之间的视觉割裂。

14. 本地运行时运维页定型
    Status: completed
    Scope: 继续把本地运行时运维从“按钮集合”收成“状态优先、操作次级”的信息布局，并与早期截图统一风格。

15. 检索增强体验收口
    Status: completed
    Scope: 当没有外挂知识库或低置信度命中时，允许常见问题正常回答；检索增强不再轻易把普通问答误伤成保守拒答。

16. grounded/citation 结果轻量展示
    Status: completed
    Scope: 保留 grounded generation 能力，但把 citation / verification 结果改成更轻量的展示，避免污染主对话阅读体验。

17. 会话与导出工作流收口
    Status: completed
    Scope: 继续优化会话恢复、固定、导出和批量清理的入口层级，让这些功能有但不抢主链路。

18. 顶部导航与多语言条定型
    Status: completed
    Scope: 按早期截图继续压缩 `Agent / 后台 / 语言` 顶部导航视觉重量，统一两页第一屏的“产品态”。

19. 稳定版本发布节奏
    Status: completed
    Scope: 在现有本地 Git 版本化基础上，每个稳定节点生成版本号、release note、页面截图和 benchmark 摘要，避免后续再出现“改得太散又难回看”。

20. 最终还原验收
    Status: completed
    Scope: 对照你保存的历史截图、历史对话需求和当前主流程，逐页做“界面、功能、工作流”验收清单，确认哪些已还原、哪些保留、哪些明确放弃。

## Final acceptance

这轮主线验收按“界面、功能、工作流、稳定性”四条做了最终自检，结论如下：

### 已验收通过

- `/agent` 第一屏已经回到“左侧目标模型列表 + 中间主工作区 + 右侧信息面板”的主结构。
- `/agent` 的右侧面板顺序已经固定为：已解析接口、自检、模型摘要、系统提示词、启动提示、本地运行时。
- `/admin` 第一屏已经收敛为 Benchmark 优先：配置、进度、基线、结果、历史都放在主工作流前段。
- Benchmark 结果汇总、历史、baseline、delta、percentiles 已统一成长卡片阅读方式。
- Benchmark 已明确区分本地与远端口径，远端目标已展示当前实际对接模型版本。
- 长跑 benchmark 已支持基于最新未完成记录的恢复监控；运行中刷新页面可继续看到真实进度。
- `Local Qwen3 0.6B` 的正式里程碑评测已验证恢复正常，不再出现空结果。
- 本地运行时运维已经收成“状态优先、操作次级”的布局，不再以操作按钮为中心。
- 会话导出链路已经统一复用筛选逻辑，并在界面上明确显示当前导出范围。
- 顶部导航与语言条已经收回到更接近早期截图的轻量产品态。
- 版本化流程已落地：`VERSION`、release note、发布脚本和发布流程文档已建立。

### 当前保留项

- 仓库里仍保留部分历史 rescue 页面与旧结构文件，但主导航工作流已经收敛到 `/agent` 和 `/admin`。
- 本地 MLX 冷启动仍然受机器环境影响，虽然恢复链路和降级策略已补上，但第一次冷态加载仍会慢于远端常驻模型。
- 知识库、遥测等次级模块仍保留在后台页较后位置，没有从项目中移除，只是降低了对第一屏主工作流的干扰。

### 最终验收结论

- 这 20 轮主线任务已经按当前版本收口完成。
- 当前版本的重点已经从“继续大改结构”转成“稳定运行、版本留档、按需小步优化”。
- 当前推荐验收入口：
  - `/agent`
  - `/admin`

## Batch rule

每一轮开发都遵守这四条：

1. 先修影响可信度的问题，再做新能力。
2. 改动尽量收敛在最少文件。
3. TypeScript 和 Python 语法检查必须通过。
4. `/agent` 与 `/admin` 都要留下可观测结果，而不是只停留在代码层。

## Post-v0.2.1 Next 20 rounds

下面这二十轮从 `v0.2.1` 稳定节点继续往下排，主线收敛为“版本可见性、Benchmark 可信度、运行稳定性、知识库可用性、发布纪律”，尽量少发散。

1. 版本可见性与稳定节点标识
   Status: completed
   Scope: 在页面顶栏直接显示当前 `VERSION`，让 `/agent` 与 `/admin` 一眼可见当前稳定节点，减少“到底跑的是哪个版本”的不确定性。

2. Agent 第一屏最终间距审计
   Status: completed
   Scope: 逐块检查 `/agent` 第一屏的上下留白、卡片密度、标签权重，继续向验收截图靠拢，但不再改大结构。

3. Admin 第一屏最终间距审计
   Status: completed
   Scope: 逐块检查 `/admin` 第一屏 Benchmark 配置、进度、结果、趋势区的边距与层级，确保“先看主工作流，再看分析区”。

4. 远端目标版本展示补齐
   Status: completed
   Scope: 把远端目标的当前实际模型版本补齐到更多结果面板和 hover 细节里，避免历史结果里只看见 target 名不见版本。

5. Benchmark 失败热点 drilldown
   Status: completed
   Scope: 在失败分布基础上补更细的 drilldown，让 `target / profile / workload / reason` 的热点可一跳定位。

6. Benchmark 运行中止与继续策略
   Status: completed
   Scope: 明确支持“停止当前 run / 继续未完成 run / 放弃旧 run”三种动作，减少长跑时的模糊状态。

7. Benchmark 执行队列可视化
   Status: completed
   Scope: 把当前 active groups、待执行 groups、最近完成 groups 做成更清晰的队列视图。

8. Benchmark 远端链路稳态继续压测
   Status: completed
   Scope: 针对 `tool-first` 与 `thinking` 组合继续压测，确认 `terminated` 不会在不同时间窗内反弹。

9. 本地 benchmark 稳态回归
   Status: completed
   Scope: 重新做一轮本地 `milestone-formal / milestone-full` 的回归基线，确保本地链路不被远端修复掩盖。

10. 本地运行时阶段态展示
    Status: completed
    Scope: 把 `导入中 / 预热中 / 已加载 / 切换中 / 降级中` 等运行阶段以更清楚的阶段态显示在主界面。

11. 网关日志筛选与摘要
    Status: completed
    Scope: 运维页支持按 target、时间段和关键词快速筛日志，并自动生成最近异常摘要。

12. 会话持久化下一阶段
    Status: completed
    Scope: 评估并补强服务端会话持久化方案，让重要会话不只依赖浏览器本地存储。

13. 导出包一致性收口
    Status: completed
    Scope: 统一 Markdown / JSON / Benchmark report 的字段命名和头部元信息，减少导出格式间的不一致。

14. 知识库导入体验优化
    Status: completed
    Scope: 在现有 CRUD 基础上补“从文件/目录导入”的工作流，降低知识库维护成本。

15. citation 点击回看能力
    Status: completed
    Scope: 让引用标签可以直接回看命中的 chunk 与上下文，不只停留在轻量 badge。

16. grounded 结果解释性增强
    Status: completed
    Scope: 保持轻量展示前提下，让用户更容易区分“命中证据回答”与“普通常识直答”。

17. smoke test 自动化脚本
    Status: completed
    Scope: 把 Agent、Admin、local runtime、remote benchmark 的最小 smoke path 固成脚本，发版前一键跑。

18. release note 生成收口
    Status: completed
    Scope: 基于现有发布流程，把 benchmark 对比、运行状态和页面入口自动填进 release note 模板。

19. v0.2.x 小修节奏
    Status: completed
    Scope: 在 `0.2.x` 线内保持小步修整，不再大改结构，把剩余优化都压成可回溯小节点。

20. v0.3.0 规划预研
    Status: completed
    Scope: 当 `0.2.x` 线稳定后，再统一评估服务端持久化、检索增强第二阶段和更系统的 Agent 能力，决定是否进入 `v0.3.0`。

### Post-v0.2.1 validation notes

- `smoke-test.sh` 已验证通过，覆盖 `/agent`、`/admin`、dashboard 摘要、最新 benchmark 进度与本地 runtime 基础链路。
- 远端 full-suite 稳态压测已完成：
  - 旧 run `7cda7c5e-b783-4a0c-be86-5b8fd43905c2`
    - `failed = 37`
    - `terminated = 33`
  - 新 run `ff0fa2b1-b735-4453-ba30-a5f8b7049a51`
    - `failed = 1`
    - `terminated = 0`
    - 剩余唯一失败为单个 `502 Bad Gateway`
- 本地 formal 回归已于 `2026-03-28` 再跑一轮：
  - run `93911b58-58eb-4165-b39a-41ef8224542e`
  - `Local Qwen3 0.6B`: `58/58`
  - `Local Qwen3 4B 4-bit`: `58/58`
  - 整体 `116/116`，`0 failed`
