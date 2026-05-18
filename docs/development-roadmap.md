# Agent Lab Development Roadmap

Last updated: 2026-05-17

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
- 服务端 workbench snapshot 持久化（preferences + active session + sessions）
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
- benchmark 回归报告导出已支持 `exact runId / recent window / full history fallback`
- benchmark 已支持正式里程碑评测集，并可输出更接近正式评测口径的回归报告
- benchmark 已区分 `milestone-formal` 与 `milestone-full`
- benchmark 已支持运行进度、预计剩余时间与 runId 级进度查询
- 远端 profile 批量 benchmark 已支持“对比子集”模式
- 文件型知识库、结构化 chunking 与词法检索底座已落地
- `/admin` 已支持知识文档 CRUD、chunk 观察与检索验证
- `/agent` 已支持检索增强开关，并在 grounded 模式下注入证据与返回 citation 命中摘要
- grounded generation 已补 citation enforcement / 低置信度保守回退 / answer verification 启发式校验
- 检索链路已补 query-focused retrieval compression
- 检索链路已补二阶段 `hybrid-rerank`、evidence spans、matched terms 和检索阶段摘要
- 远端链路已补 prompt cache / semantic cache
- 会话链路已补 planner + session memory 注入 MVP
- provider 调用已补单次自动恢复策略
- `/admin` 已补 Fine-tune workflow 第一批可执行切片：dataset validation、recipe persistence、staged job bundle
- `/admin` 已补社区模型发现面板，可扫描 Hugging Face / GitHub / ModelScope 的近期模型候选
- 社区模型发现已补硬件适配建议、推荐/有风险/不推荐 安装提示、来源页/说明页/论文链接
- 社区模型发现已补一键安装队列，默认下到共享本地模型库，并在完成后自动尝试重扫本地 target
- 社区模型安装已补安装预检、失败回滚、安装后校验与 target 暴露验证状态
- Fine-tune 已升级到真实本地 MLX worker，可直接启动训练、回看日志与 loss 曲线
- Fine-tune recipe 已扩到真实可生效的 MLX 参数：LoRA/DoRA、optimizer、numLayers、grad accumulation、saveEvery、seed
- Fine-tune dataset 已支持上游社区数据集检查、刷新周期和最近候选快照
- Fine-tune dataset 已补新手默认 384 条 starter、社区数据集 bootstrap slices，以及 preset 一键校验/保存/生成推荐配方的 quick start
- Fine-tune dataset 候选源已补“导入计划”复制能力，明确上游仓库需要抽样、格式转换、去重、许可证复核和本地校验后才能进入训练
- Fine-tune dataset 已补 960 条长轮次内置 starter，作为新手默认 800-1,000 step 本地微调路径，避免依赖外部社区下载和格式转换
- `/agent` 已补服务端会话冲突提示，可加载服务端快照或用本地状态强制覆盖
- `/admin` 已补 session / compare / benchmark / finetune 的统一 timeline 面板
- 检索底座已补本地持久化 vector index，正式进入 lexical + vector 的 hybrid recall
- `/agent` 与 `/admin` 已改成动态加载重型 client 模块，首屏不再被大 bundle 阻塞
- 已新增 `scripts/dev-server.sh`，并改用 `screen` 稳定托管本地前端服务
- Compare 中段已改成更接近 studio/workbench 的矩阵布局，`Compare targets` 与 `lane preview` 不再是长卡堆叠

## Latest planning additions

2026-04-08 新增了一条更明确的后续产品线，用来在**现有项目框架内**把“benchmark + runtime ops”继续推进到更完整的本地模型实验能力。

新规划文档：

- [`docs/v0.3.0-local-model-lab-plan.md`](./v0.3.0-local-model-lab-plan.md)

这条线新增了四个明确方向：

1. 每模型默认推理参数（Per-target defaults）
2. 本地模型空闲定时卸载 / retention policy
3. Inference Compare Lab（面向结构化输出、采样参数和 prompt 模板的可重复对比）
4. 面向 Apple Silicon 的本地 LoRA / QLoRA 微调工作流规划

2026-04-17 又补了一轮来自 Google AI Studio 与 LM Studio 的产品对比结论，新增了几条更偏“工作台产品感”的方向：

5. `Studio Recipe Gallery`（比 Prompt Gallery 更进一步的可执行实验配方）
6. `Get Code / Reproduce Request`（把当前 chat / compare / benchmark 配置导出成可运行 SDK snippet）
7. `Capability Chips / Run Settings Chips`（把工具、检索、结构化输出、thinking 变成高层能力模块）
8. `Provider Usage Ledger / API Health Desk`（把远端 provider 也纳入可运营视角）
9. `Prompt-to-Workflow Drafts`（用自然语言生成 compare / benchmark / schema draft）

这些能力默认进入 `v0.3.x` 讨论范围，不回塞到 `v0.2.x` 的小步稳定节奏里，也不意味着另起一个新项目。

## LLaMA-Factory parity audit · 2026-05-17

这次对照 LLaMA-Factory WebUI 与当前 First LLM Studio 后，结论不是把项目改成另一个训练控制台，而是补齐它在“微调实验闭环”上已经成熟、而我们仍偏弱的部分。

Current overlap:

- 两者都已经覆盖本地模型、数据集、LoRA 类微调、训练日志、loss 曲线、训练后验证与导出思路。
- First LLM Studio 的差异化仍然是本地/远端统一 Agent、Compare、Benchmark、Provider Health、Runtime Guardrail 与发布证据链。
- LLaMA-Factory 更强的是训练控制台的完整性：`Train -> Evaluate & Predict -> Chat -> Export` 是连续产品线，参数面板、命令预览、配置保存、训练进度和导出路径更标准。

Next-version parity gaps:

1. Fine-tune page structure
   - 把当前 Fine-tune 从单页三列继续升级成 tabbed studio：
     - `Train`
     - `Evaluate & Predict`
     - `Chat Adapter`
     - `Export`
   - `Train` 继续保留新手 quick start，但高级参数放进可折叠面板，避免新手一进来就被字段淹没。
   - `Evaluate & Predict` 作为训练后第一站，而不是直接跳 Compare / Benchmark。
   - `Chat Adapter` 用来对比 base model 与 adapter 的即时回答。
   - `Export` 用来处理 adapter bundle、merged weights、quantized artifact 与发布元信息。

2. Training method and parameter depth
   - 新增 training stage selector：
     - `Supervised fine-tuning`
     - `Continued pretraining`
     - `Preference / DPO style tuning`
     - `Distillation dataset generation`
   - LoRA 参数面板补齐：
     - rank
     - alpha
     - dropout
     - target modules
     - use DoRA
     - use rsLoRA
     - PiSSA init
     - adapter name / output dir
   - QLoRA / quantization 面板补齐：
     - quantization level
     - compute dtype
     - load-in-4bit / load-in-8bit equivalent strategy
     - hardware risk badge
   - Optimizer / memory 面板补齐：
     - optimizer
     - learning rate
     - scheduler
     - warmup ratio
     - gradient accumulation
     - batch size
     - max samples
     - cutoff length
     - save / eval interval
   - 每个字段都必须显示：
     - 参数名
     - 简短用途
     - 新手建议值
     - 对显存/内存/训练时间的影响

3. Train operation controls
   - 增加 `Preview command` 与 `Generated YAML` 预览。
   - 增加 `Save training args` / `Load training args`。
   - 增加正式 `Start` / `Stop` / `Resume from checkpoint`。
   - 训练中显示：
     - progress
     - current step / total step
     - elapsed time
     - estimated remaining time
     - train loss
     - validation loss
     - tokens/sec or samples/sec
     - current checkpoint
   - 日志区域改成 terminal-like stream，并支持 keyword filter、copy tail、download log。

4. Evaluate & Predict closure
   - 新增 eval dataset selector 与 checkpoint selector。
   - 支持离线 predict run，输出：
     - prediction JSONL
     - reference / prediction diff
     - exact match / pass rate
     - BLEU / ROUGE-L starter metrics
     - latency / tokens/sec
   - 支持 base model vs adapter 的 side-by-side evaluation。
   - 支持把 eval run 直接 handoff 到 Compare / Benchmark。

5. Chat Adapter sandbox
   - 训练后提供一个轻量聊天测试台。
   - 支持：
     - base / adapter 切换
     - system prompt
     - generation params
     - skip special tokens
     - thinking tag handling
     - HTML / markdown escaping
     - clear history
   - 目标是让用户在导出前先快速确认 adapter 是否真的学到了目标行为。

6. Export and publish flow
   - 新增 adapter export wizard：
     - adapter-only bundle
     - merged model artifact
     - quantized export plan
     - model card draft
     - training config snapshot
     - dataset manifest
     - metric summary
   - 增加 Hub / ModelScope 发布前 checklist：
     - license
     - dataset attribution
     - secret scan
     - sample prompts
     - known limitations
   - `full bundle download` 应包含：
     - adapter manifest
     - config
     - metrics
     - logs
     - report markdown
     - eval predictions
     - source dataset manifest

7. Distillation workflow
   - 新增 `Teacher -> synthetic dataset -> student adapter` 的轻量蒸馏路径。
   - 支持用强远端模型或强本地模型生成训练样本。
   - 样本进入训练前必须经过：
     - quality scoring
     - duplicate filter
     - PII / secret scan
     - license / source note
   - 这条线必须与现有 Dataset Pipeline、Compare、Benchmark 串起来，避免生成数据变成黑盒。

Recommended sequencing:

- `v0.3.3`：先补 `Train` 的参数解释、命令/YAML 预览、正式 Start/Stop/Resume、日志与进度条，以及 Fine-tune report bundle。
- `v0.4.0`：补 `Evaluate & Predict`、dataset preview/split、eval metrics 和 prediction export。
- `v0.4.1`：补 `Chat Adapter`、base vs adapter 对话对比、Compare/Benchmark handoff。
- `v0.5.0`：补 `Export` wizard、adapter merge/quantization/publish checklist。
- `v0.5.1`：补 distillation workflow 和 teacher data generation。

Implementation checkpoint:

- `Train` 已补第一版 LLaMA-Factory 风格控制台：
  - training stage selector
  - command preview
  - generated YAML preview
  - save / load training args
  - estimated steps / effective batch / train samples
  - distillation teacher data builder 的可复制命令与 YAML
- `Evaluate & Predict` 已补第一版配置台：
  - eval dataset selector
  - adapter / checkpoint selector
  - generation budget
  - starter metrics
  - prediction export toggle
  - command / YAML preview
- `Chat Adapter` 已补第一版沙盒配置：
  - adapter selector
  - role / system prompt / test prompt
  - generation controls
  - special-token 与 HTML 输出清理开关
  - command preview
- `Export` 已补第一版向导：
  - adapter selector
  - adapter-bundle / merged-mlx / gguf export intent
  - q8 / q4 quantization intent
  - shard size / output dir / optional Hub ID
  - dataset card inclusion
  - command preview

## Current focus

当前路线图不再按“缺什么补什么”的零散方式推进，而是围绕 4 条产品主线持续收口：

1. **体验收口**
   - `/agent`、`/admin`、Compare、Fine-tune 的信息密度继续压实。
   - 高字段、高日志、高 lane 数场景仍保持精品级可读性。
2. **实验闭环**
   - Fine-tune、Compare、Benchmark、Export 之间形成更自然的一条链。
   - 用户能从“训练一个 adapter”一路走到“验证、复盘、发布”。
3. **数据与可解释性**
   - Dataset pipeline、retrieval evidence、provider health 都要从“能看”升级到“能判断”。
4. **产品化与公开发布**
   - 构建、CI、docs、demo capture、launch asset 形成长期可维护机制。

## Executable roadmap from 2026-05-13

下面是后续正式采用的版本路线图。每个版本都按：

- `任务`
- `子任务`
- `验收标准`

三层拆分，方便直接进入研发排期和 sprint 追踪。

### `v0.3.2-2026-05` Stability and UI closure

目标：把当前已成型的工作台，从“功能强”推进到“稳定、顺滑、看起来像成熟产品”。

#### Task 1. 全局 UI 精品化

Subtasks:

- 清理所有 badge、按钮、标题、状态文案的异常换行与竖排。
- Compare 中央区固定为：
  - 主编辑器
  - 次级配置面板
  - 次级结果 / review drawer
- Fine-tune 后台重新梳理为：
  - 数据集
  - 配方
  - 作业
  - 日志
  - 曲线
  - 报告
- Admin 面板统一卡片边距、标题层级，弱化重复装饰，提升密度与秩序感。
- 小屏与窄窗下继续收紧 runtime rail、lane preview、job 列表的布局策略。

Acceptance:

- `/agent` 与 `/admin` 在主流桌面宽度下无明显大面积空白、断行失衡、文字被迫竖排。
- Compare recipe gallery、lane preview、runtime rail 不再互相挤压。
- Fine-tune 表单与日志在字段较多时仍具备清晰分区。

#### Task 2. 前端构建与开发链路稳定化

Subtasks:

- 修复 `npm run lint` 长时间无输出的问题，必要时拆分 lint target 或增加进度可见性。
- 固化 `dev` 与 `build` 的产物隔离策略，避免构建覆盖开发缓存导致 CSS / 页面异常。
- 补最小 route smoke：
  - `/agent`
  - `/admin`
  - fine-tune report preview
  - benchmark report preview
- 增加 screenshot smoke 或 route render smoke 进入 CI。

Acceptance:

- `npm run lint`、`npm run build`、关键 route smoke 具备稳定复现性。
- 本地前端重新拉起后，不再出现“页面裸奔 / CSS 丢失 / 资源不一致”的偶发问题。

#### Task 3. 当前可见痛点补齐

Subtasks:

- provider health desk 增加更紧凑的异常摘要。
- benchmark issue / PR 摘要导出能力进一步产品化。
- runtime recovery action 文案统一到更多状态卡片。

Acceptance:

- 用户遇到 provider、runtime、benchmark 异常时，能第一时间看懂“发生了什么、下一步该做什么”。

### `v0.3.3-2026-05` Fine-tune closure

目标：把 Fine-tune 做成“新手能顺手用，老手能复盘”的完整实验闭环。

#### Task 1. Fine-tune 报告升级

Subtasks:

- 报告新增“多 run 对比摘要”：
  - final train loss
  - final validation loss
  - 耗时
  - optimizer step 数
  - adapter 路径
  - 与上一轮的变化
- 报告中追加 compare / benchmark / export evidence 汇总。
- Adapter card 与 report bundle 信息口径统一。

Acceptance:

- 单个 adapter 的多次训练结果可以在报告中快速横向比较。
- 用户无需翻日志，就能判断“这次训练是否真的更好”。

#### Task 2. Fine-tune 作业体验升级

Subtasks:

- 训练完成后自动建议：
  - attach runtime
  - send to compare
  - send to benchmark
  - export report
- failed job 支持：
  - 按最新数据策略重跑
  - 保留 recipe、仅替换 dataset
  - 失败原因摘要与推荐修复路径
- adapter 生命周期继续收口：
  - attach
  - detach
  - remount
  - history 可见性

Acceptance:

- 一个用户从 preset 加载到 adapter 验证，全流程不依赖额外文档。
- failed job 不再只是报错，而是可继续推进的状态。

#### Task 3. Fine-tune 曲线进入正式分析视图

Subtasks:

- 保留 `Full run` 全量视图，默认覆盖 `step 0 -> latest step`。
- X 轴继续采用每 `100 step` 的主刻度逻辑。
- 补充：
  - hover tooltip
  - selected range zoom
  - train / validation loss 同图审阅
  - 同 adapter 多 run overlay 的图例与摘要
- 支持导出当前图表数据到 metrics CSV / JSONL。

Acceptance:

- 用户可以一眼看清完整训练阶段，而不是只看到局部趋势。
- 多 run 对比时，曲线既可读，也能对应到具体数值。

#### Task 4. LLaMA-Factory parity slice: Train controls

Subtasks:

- Fine-tune 顶层增加 `Train / Evaluate & Predict / Chat Adapter / Export` 的产品结构占位，其中 `Train` 先进入可用状态。
- `Train` 增加 `Preview command` 与 `Generated YAML`，让用户明确当前 UI 配置最终会变成什么训练命令。
- `Train` 增加 `Save training args` / `Load training args`。
- 训练参数按分组展示：
  - dataset
  - base model
  - method
  - LoRA
  - QLoRA / quantization
  - optimizer
  - runtime and checkpoint
- 每个关键字段补：
  - 参数名
  - 小字用途说明
  - 新手建议值
  - 显存/时间影响提示
- 训练操作按钮统一为：
  - Preview command
  - Save args
  - Load args
  - Start
  - Stop
  - Resume from checkpoint

Acceptance:

- 新手仍可以用 quick start 一键走完。
- 进阶用户可以清楚看到训练命令/YAML、参数分组、checkpoint 与恢复路径。
- 页面不再出现大量裸数字字段或含义不明的选择框。

### `v0.4.0-2026-06` Dataset Pipeline v2

目标：把“社区数据很乱、导入很麻烦”这件事尽量由产品替用户消化掉。

#### Task 1. 多社区数据源解析

Subtasks:

- 支持 Hugging Face、GitHub、ModelScope 的非直链页面解析。
- 自动识别：
  - 数据仓
  - README / card
  - 下载入口
  - license
  - 基础 schema
- 对来源页、原厂说明、论文链接继续保留跳转入口。

Acceptance:

- 用户粘贴社区页面，而不是手找下载文件，也能得到可处理的数据候选。

#### Task 2. 自动转换与质量评估

Subtasks:

- 自动执行：
  - 抽样
  - schema 转换
  - 去重
  - 空值过滤
  - 基础 PII / secret 风险识别
  - license 风险提示
- 给出：
  - 数据质量分
  - 适合训练轮次
  - 适合模型规模
  - 推荐 / 谨慎 / 不建议

Acceptance:

- 社区数据导入后，用户不需要自己判断“这份数据到底适不适合拿来跑 1,000 step”。

#### Task 3. 新手默认数据组合

Subtasks:

- 提供直接可跑的推荐组合：
  - 通用助手
  - 中文助手
  - coding assistant
  - retrieval / grounded QA
  - tool-use
- 每个组合标注：
  - 推荐模型规模
  - 推荐轮次
  - 风险提示
  - 预期收益

Acceptance:

- 新手第一次本地微调，可以从“选一个默认组合”开始，而不是先研究半天数据清洗。

#### Task 4. Evaluate & Predict v1

Subtasks:

- Fine-tune 中新增真正可执行的 `Evaluate & Predict` 区域。
- 支持选择：
  - adapter / checkpoint
  - eval dataset
  - max samples
  - max new tokens
  - temperature
  - top-p
- 输出：
  - prediction JSONL
  - reference / prediction sample table
  - exact match / pass rate
  - BLEU / ROUGE-L starter metrics
  - latency / tokens/sec
- 支持 base model vs adapter 的离线对比。
- 支持把 eval result handoff 到 Compare 与 Benchmark。

Acceptance:

- 训练完成后，用户可以先跑一次离线评估，再决定是否进入 chat、compare 或 export。
- 评估产物可以进入报告 bundle。

### `v0.4.1-2026-06` Experiment Studio expansion

目标：进一步巩固 First LLM Studio 与普通聊天产品之间的差异化。

#### Task 1. Compare 工作流最终定型

Subtasks:

- 主布局固定为：
  - primary editor
  - lane matrix
  - review drawer
- base lane 固定阅读流。
- lane pinning。
- 多 lane 长输出时的二级导航。
- diff drawer 默认折叠逻辑更激进，避免长内容先把页面撑爆。

Acceptance:

- Compare 在 2 lane、4 lane、长输出、小屏窗口下都仍然可读。

#### Task 2. Recipe Gallery v2

Subtasks:

- 把 recipe 从“模板集合”升级成“可执行实验配置”：
  - prompt
  - system
  - tools
  - retrieval
  - schema
  - benchmark suite
  - compare lanes
- recipe 支持：
  - share
  - import
  - versioning
  - benchmark history

Acceptance:

- recipe 能成为团队复用的实验资产，而不是单次页面状态。

#### Task 3. Structured Output Lab

Subtasks:

- 新增 schema playground。
- 可测试：
  - JSON schema
  - repair policy
  - validation failure
  - provider-specific output contract
- 结果可直接送入 Compare 与 Benchmark。

Acceptance:

- 用户能围绕“结构化输出稳定性”做系统实验，而不只是凭肉眼看回答。

#### Task 4. Get Code / Reproduce Request 扩面

Subtasks:

- 覆盖：
  - chat
  - compare
  - benchmark
  - fine-tune recipe
  - adapter test
  - retrieval config
- 输出 curl / SDK snippet / minimal runnable request。

Acceptance:

- 页面实验可以快速迁移到脚本、CI、文档或团队协作里。

#### Task 5. Chat Adapter sandbox

Subtasks:

- Fine-tune 中新增 `Chat Adapter` 测试区。
- 支持：
  - base / adapter 切换
  - system prompt
  - max tokens
  - temperature
  - top-p
  - skip special tokens
  - thinking tag handling
  - clear history
- 支持 base vs adapter 回答对照。
- 支持把当前对话保存为 fine-tune evidence。

Acceptance:

- 用户不用离开 Fine-tune 页面，就能确认 adapter 的实际对话效果。
- Chat evidence 可以进入最终 report 与 release note。

### `v0.5.0-2026-07` Admin operations v2

目标：把远端 provider 和长期实验历史做成真正的运营层能力。

#### Task 1. Provider Health Desk v2

Subtasks:

- 提供按 provider / model / profile 维度的：
  - timeout 趋势
  - 429 趋势
  - auth failure 趋势
  - first-token latency 变化
  - rough cost 变化
- 增加“上次异常后发生了什么变化”的摘要。

Acceptance:

- 远端 API 不再只是“通不通”，而是具备持续运营与排障视角。

#### Task 2. Retry / Timeout 策略可视化

Subtasks:

- 将 provider-specific policy 暴露到 UI：
  - first-token timeout
  - total timeout
  - idle stream timeout
  - retry cadence
  - fallback profile
- 支持策略模板与建议值。

Acceptance:

- 新增 provider 时，维护成本不再依赖手改代码或隐性经验。

#### Task 3. Benchmark history 与 release evidence 深化

Subtasks:

- release evidence 分组与注释。
- benchmark -> release note 自动摘要。
- benchmark -> GitHub issue / PR triage 摘要。
- 报告 drawer 继续压缩，适合高频复盘。

Acceptance:

- benchmark 结果可以自然进入发布、复盘、协作三个场景。

#### Task 4. Adapter Export wizard

Subtasks:

- Fine-tune `Export` 区域支持：
  - adapter-only bundle
  - merged model export plan
  - quantized export plan
  - model card draft
  - dataset manifest
  - training config snapshot
  - metric summary
- 发布前增加：
  - license checklist
  - dataset attribution checklist
  - secret scan status
  - sample prompt list
  - known limitations
- 支持导出完整 bundle 与 report preview。

Acceptance:

- 一个 adapter 从训练、评估到导出，有完整可复查的产物链。
- 公开发布前能清楚看到数据、许可证和敏感信息风险。

### `v0.5.1-2026-07` Public release system

目标：让项目公开增长不再依赖手工拼装。

#### Task 1. 公共文档产品化

Subtasks:

- docs route。
- 中英文 quickstart。
- benchmark 解释页。
- fine-tune 入门页。
- community model / dataset 安装说明。

Acceptance:

- 新访客不用读完整 README，也能快速知道项目做什么、怎么开始。

#### Task 2. Demo capture 与 release asset 自动化

Subtasks:

- demo screenshot pipeline。
- GIF / short recording 产出流程。
- release evidence 自动归档。
- README、GitHub social preview、launch post 的素材联动。

Acceptance:

- 发新版时，宣传物料更新成本显著下降。

#### Task 3. OSS 协作体验

Subtasks:

- contributor quickstart。
- copy-friendly launch snippets。
- public roadmap route。
- open-source issue checklist。

Acceptance:

- 外部贡献者可以更快理解项目结构和“怎么参与”。

#### Task 4. Distillation workflow v1

Subtasks:

- 新增 `Teacher -> synthetic dataset -> student adapter` 的实验入口。
- 支持从强远端 provider 或强本地模型生成教学样本。
- 生成样本进入 Dataset Pipeline 统一处理：
  - quality scoring
  - duplicate filter
  - PII / secret scan
  - license / source note
- 支持把 distillation dataset 直接送入 Fine-tune recipe。

Acceptance:

- 用户可以用强模型生成小模型训练样本，但每一步都有质量、来源和风险提示。
- Distillation 不绕过现有 dataset / compare / benchmark / report 证据链。

## Two-week sprint breakdown

下面默认以 **2 周一个 sprint** 推进；如果中途遇到 provider 稳定性或大规模 UI 回归，再插入 hotfix，不打乱大方向。

### Sprint 1 · 2026-05-13 to 2026-05-26

Focus:

- `v0.3.2` UI 精品化
- lint / build / route smoke 稳定化

Deliverables:

- Compare 与 Fine-tune 后台布局第一轮收口
- 全局异常换行修复
- `npm run lint` 阻塞问题定位并解决
- route smoke + screenshot smoke 方案落地

Definition of done:

- `/agent`、`/admin` 宽屏和常见窄窗下都可稳定审阅
- lint/build/dev smoke 全部可复现

### Sprint 2 · 2026-05-27 to 2026-06-09

Focus:

- `v0.3.3` Fine-tune 报告与作业闭环

Deliverables:

- 多 run 对比摘要
- failed job 重跑闭环
- post-train action recommendation
- full-range / zoom / tooltip 曲线体验补齐
- LLaMA-Factory parity slice: `Train` tab、参数说明、命令/YAML 预览、Start/Stop/Resume

Definition of done:

- 新手从 preset 到 export report 全流程可独立完成
- 进阶用户能看到清晰训练命令、配置文件、checkpoint 和恢复路径

### Sprint 3 · 2026-06-10 to 2026-06-23

Focus:

- `v0.4.0` Dataset Pipeline v2 第一段

Deliverables:

- 多社区页面解析
- schema 转换
- license / PII / duplicate / quality score
- 初版推荐训练轮次与模型规模提示
- Fine-tune `Evaluate & Predict` v1：eval dataset、prediction export、base vs adapter 评估

Definition of done:

- 社区数据从“候选”到“可训练材料”的路径明显缩短
- adapter 训练完成后可先离线评估，再进入 chat / compare / benchmark

### Sprint 4 · 2026-06-24 to 2026-07-07

Focus:

- `v0.4.0` Dataset preset 与新手模式完成
- `v0.4.1` Compare 最终布局启动

Deliverables:

- 推荐数据组合
- Compare `primary editor + lane matrix + drawer`
- base lane / pinning / 折叠策略第一版
- Fine-tune `Chat Adapter` sandbox：base vs adapter 即时对话对照

Definition of done:

- 数据、compare 与 adapter chat 三条主线都进入“产品可展示”的成熟区间

### Sprint 5 · 2026-07-08 to 2026-07-21

Focus:

- `v0.4.1` Experiment Studio
- `v0.5.0` Admin Ops v2 第一段

Deliverables:

- Recipe Gallery v2
- Structured Output Lab
- Get Code 扩面
- provider health 历史趋势初版
- Adapter Export wizard：adapter bundle、merged / quantized export plan、model card draft

Definition of done:

- 项目“实验台”心智更加明确
- 训练产物具备进入公开发布前检查的完整证据链

### Sprint 6 · 2026-07-22 to 2026-08-04

Focus:

- `v0.5.0` Admin ops 完整化
- `v0.5.1` public release system

Deliverables:

- retry / timeout policy UI
- benchmark -> release / issue 摘要
- docs route
- demo capture pipeline
- public roadmap / contributor flow
- Distillation workflow v1：teacher data generation、quality gate、student adapter recipe

Definition of done:

- 项目不仅能用，而且能稳定迭代、稳定发布、稳定增长
- 蒸馏生成数据不会绕过现有质量、来源、风险与证据链检查

## Prioritization matrix

### P0

- UI 收口与构建稳定性
- Fine-tune 闭环体验
- Dataset Pipeline v2

### P1

- Compare Studio 终局形态
- Provider Ops v2
- Benchmark -> release / issue 工作流

### P2

- 公共 docs route
- demo capture pipeline
- contributor onboarding 与 public roadmap

## Versioning rule

后续版本号继续采用：

- `v0.3.x`：围绕现有功能收口、稳定、体验补齐
- `v0.4.x`：新增更完整的数据与实验能力
- `v0.5.x`：运营化、公开发布系统与团队协作能力

日期统一附在 release note 文件名与版本说明中，例如：

- `v0.3.2-2026-05-xx`
- `v0.4.0-2026-06-xx`
- `v0.5.0-2026-07-xx`

## Batch rule

后续默认遵守下面的提交节奏：

- 每个 sprint 至少形成一次主题明确的 commit。
- 若某个 sprint 中存在明显可拆批次，则按：
  - UI / UX
  - Runtime / Backend
  - Docs / Release
  三类分别提交。
- 每次提交前至少完成：
  - `git diff --check`
  - 最小 lint / typecheck
  - 与该批次相关的 route 或 API smoke
