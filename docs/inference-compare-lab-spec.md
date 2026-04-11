# Inference Compare Lab Spec

Last updated: 2026-04-08
Status: draft for `v0.3.0`

## 1. Goal

Inference Compare Lab 的目标不是再做一个 Benchmark 页面，而是补出一条更贴近日常实验的工作流：

- 同一条 prompt 下，比较多个模型的真实输出
- 同一模型下，比较不同采样参数、prompt template、schema、上下文预算
- 微调前后，用统一口径做 before/after 输出差异分析
- 把“实验可复现”作为第一优先级，而不是把所有参数都堆出来

这条线和当前 `/admin` benchmark 的关系是：

- `/admin` benchmark：偏批量、偏回归、偏正式评测
- `Inference Compare Lab`：偏交互、偏单任务、偏实验和解释

## 1.5 Scope guardrails

这一份规格默认服从原项目边界：

- Compare Lab 是 `AgentWorkbench` 的增强模式，不是新项目。
- v1 不新增新的顶级产品导航，只在现有 `/agent` 里扩展。
- Compare Lab 复用现有 target catalog、runtime recovery、chat/provider 链路、replay 思路。
- UI 必须延续当前 `/agent` 的布局语言，不做完全脱离现有工作台的新设计系统。

## 2. Why now

当前仓库已经具备几块直接可复用的基础：

- 统一 target catalog
  - [catalog.ts](/Users/chenhaorui/Documents/New%20project/lib/agent/catalog.ts)
- chat / stream 主链路
  - [route.ts](/Users/chenhaorui/Documents/New%20project/app/api/agent/chat/route.ts)
  - [route.ts](/Users/chenhaorui/Documents/New%20project/app/api/agent/chat/stream/route.ts)
- replay compare 基础
  - [AgentWorkbench.tsx](/Users/chenhaorui/Documents/New%20project/components/agent/AgentWorkbench.tsx)
- benchmark progress / persisted run 思路
  - [benchmark-progress-store.ts](/Users/chenhaorui/Documents/New%20project/lib/agent/benchmark-progress-store.ts)
- runtime / prewarm / local recovery 基础
  - [runtime/route.ts](/Users/chenhaorui/Documents/New%20project/app/api/agent/runtime/route.ts)
  - [local-gateway.ts](/Users/chenhaorui/Documents/New%20project/lib/agent/local-gateway.ts)

所以这不是一条从零开始的新产品线，而是在现有 Agent 工作台里补出一条更完整的实验工作流。

## 3. Non-goals for v1

v1 不做这些：

- 不替代 `/admin` benchmark 的正式回归能力
- 不做通用 dataset evaluator
- 不做复杂多人协作评审流
- 不做完整 prompt hub / public sharing marketplace
- 不做自动 judge 最终打分结论

v1 的重点是：

- 单次实验易发起
- 结果可对比
- 参数可追溯
- 结果可复现

## 4. Primary jobs to be done

### Job A. 模型横向比较

用户想回答：

- 同一个问题下，本地 0.6B / 4B / 远端 GPT-5.4 的差异是什么？
- 差异来自模型，还是上下文、模板、采样不一致？

### Job B. 同模型参数对比

用户想回答：

- 这个模型在 `temperature=0.1` 和 `temperature=0.7` 下差多少？
- 开启 structured output 后，质量是否下降但格式更稳？

### Job C. 微调前后对比

用户想回答：

- LoRA 之后到底变好了哪里？
- 是格式更稳了，还是回答更对了？

### Job D. 长上下文/模板差异对比

用户想回答：

- 32K 相比 8K/16K 实际有什么收益？
- 是模板变了，还是模型真的理解更好了？

## 5. Product placement

### v1 placement recommendation

**先不新增独立顶级页面。**

v1 推荐直接挂进 `/agent`，作为工作模式切换：

- `Chat`
- `Compare`

原因：

- Compare Lab 和当前 Agent prompt / target / replay 心智连续
- 能复用当前 `/agent` 的目标列表、系统提示词、runtime 卡片
- 减少“第三个工作面”带来的产品分裂

### v2 option

如果 v1 使用密度高，再升级成实验子路由：

- `/agent/compare`

但这仍然属于现有 Agent 工作台的延展，不是新的独立产品面。

## 6. Page sketch

### 6.1 Desktop layout

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Agent / Compare Mode                                                      │
├──────────────┬──────────────────────────────────────┬──────────────────────┤
│ Target Lane  │ Compare Composer                     │ Result Review         │
│              │                                      │                      │
│ - local      │ Prompt                               │ Run summary          │
│ - remote     │ System prompt / template             │ - fairness badge     │
│ - presets    │ Output schema                        │ - seed / context     │
│ - per-target │ Compare mode                         │ - stop reason        │
│   defaults   │ - model compare                      │                      │
│              │ - preset compare                     │ Column diffs         │
│              │ - before/after                       │ - output cards       │
│              │                                      │ - schema pass/fail   │
│              │ Locked params                        │ - token/latency      │
│              │ - context                            │ - warnings           │
│              │ - max tokens                         │                      │
│              │ - seed                               │ Structured compare   │
│              │ - temperature/top-k/...              │ - key coverage       │
│              │                                      │ - missing fields     │
│              │ Actions                              │                      │
│              │ - Run compare                        │ Replay / export      │
│              │ - Save preset                        │ - rerun one lane     │
│              │ - Export run                         │ - send to benchmark  │
└──────────────┴──────────────────────────────────────┴──────────────────────┘
```

### 6.2 Mobile / narrow layout

```text
[Compare]
  ├─ Step 1: Targets
  ├─ Step 2: Prompt + Template + Schema
  ├─ Step 3: Locked Parameters
  ├─ Step 4: Run
  └─ Step 5: Review
```

## 7. Information architecture

### Left rail: Target Lane

#### Sections

1. `Compare targets`
- checkbox multi-select
- local / remote section split
- per-target defaults badge
- loaded / loading / remote badge

2. `Compare shape`
- `model-vs-model`
- `preset-vs-preset`
- `template-vs-template`
- `before-vs-after`

3. `Fairness guardrails`
- lock context
- lock max tokens
- lock seed
- lock sampling preset
- lock prompt template
- lock structured schema

### Center: Compare Composer

#### Sections

1. Prompt
- main input
- optional long context attachment / inserted text block

2. System / template
- system prompt textarea
- prompt template selector
- chat template override selector

3. Output mode
- free text
- structured JSON
- strict schema mode

4. Inference controls
- `basic`:
  - contextWindow
  - maxTokens
  - seed
  - temperature
- `advanced`:
  - topK
  - topP
  - minP
  - repetitionPenalty
  - stop strings
  - overflow policy

5. Actions
- run compare
- duplicate config
- save preset
- export preset JSON

### Right rail: Result Review

#### Sections

1. Run summary
- run id
- created at
- compare mode
- fairness fingerprint
- warnings

2. Lane cards
- target label
- resolved model
- prompt template id
- schema result
- latency
- tokens
- output text / structured preview

3. Diff review
- exact text diff
- paragraph diff
- schema diff
- field coverage diff
- stop reason diff

4. Follow-up actions
- rerun selected lane
- rerun all with same seed
- send one lane to replay
- promote to benchmark prompt set

## 8. Core interaction model

### 8.1 Compare modes

#### `model-vs-model`
Same prompt, same params, different targets.

#### `preset-vs-preset`
Same target, same prompt, different inference presets.

#### `template-vs-template`
Same target, same prompt, different prompt/chat templates.

#### `before-vs-after`
Same prompt, same params, base model vs adapter / finetuned target.

### 8.2 Fairness fingerprint

每次 compare run 都生成一份 fingerprint，作为“这次实验是不是公平”的最小凭证。

字段建议：

- compareMode
- promptHash
- systemPromptHash
- templateId
- schemaId
- contextWindow
- maxTokens
- seed
- temperature
- topK
- topP
- minP
- repetitionPenalty
- stopStringsHash

如果其中任何一项在 lane 间不一致，UI 必须显式标红，而不是默认算“可比较”。

## 9. State model

建议新增 compare 专用状态，而不是把现有 chat turn 硬拼起来。

### 9.1 Front-end state

```ts
CompareComposerState = {
  mode: "model-vs-model" | "preset-vs-preset" | "template-vs-template" | "before-vs-after";
  targetIds: string[];
  presetIds: string[];
  templateIds: string[];
  schemaId?: string;
  input: string;
  insertedContext?: string;
  systemPrompt: string;
  lockedParams: {
    contextWindow: number;
    maxTokens: number;
    seed?: number;
    temperature?: number;
    topK?: number;
    topP?: number;
    minP?: number;
    repetitionPenalty?: number;
    stopStrings?: string[];
    overflowPolicy?: "truncate-middle" | "truncate-oldest" | "fail";
  };
  guardrails: {
    lockTemplate: boolean;
    lockSchema: boolean;
    lockSampling: boolean;
    lockContext: boolean;
  };
};
```

### 9.2 Run state

```ts
CompareRun = {
  runId: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  createdAt: string;
  updatedAt: string;
  compareMode: CompareMode;
  fairnessFingerprint: string;
  laneCount: number;
  completedLanes: number;
  failedLanes: number;
  warnings: string[];
  lanes: CompareLaneResult[];
};
```

### 9.3 Lane result state

```ts
CompareLaneResult = {
  laneId: string;
  targetId: string;
  targetLabel: string;
  resolvedModel: string;
  providerProfile?: AgentProviderProfile;
  thinkingMode?: AgentThinkingMode;
  templateId?: string;
  schemaId?: string;
  contextWindow: number;
  maxTokens: number;
  seed?: number;
  sampling: {
    temperature?: number;
    topK?: number;
    topP?: number;
    minP?: number;
    repetitionPenalty?: number;
    stopStrings?: string[];
  };
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  latencyMs?: number;
  firstTokenLatencyMs?: number | null;
  usage?: AgentUsage;
  stopReason?: string;
  warning?: string;
  content?: string;
  structuredOutput?: Record<string, unknown> | null;
  schemaCheck?: {
    passed: boolean;
    missingKeys: string[];
    extraKeys: string[];
    parseError?: string;
  };
};
```

### 9.4 Persistence suggestion

建议新增：

- `lib/agent/compare-store.ts`
- 落盘目录：`data-dir/compare-runs/`

原因：

- compare run 可能跨多个本地目标和远端目标
- 长本地加载不能完全靠前端状态撑住
- 需要导出和复现

## 10. API design

### 10.1 Start compare run

**POST** `/api/agent/compare`

Request:

```json
{
  "mode": "model-vs-model",
  "targetIds": ["local-qwen35-4b-4bit", "openai-gpt54", "anthropic-claude"],
  "input": "Summarize the following design doc and return strict JSON.",
  "systemPrompt": "You are a careful reviewer.",
  "schema": {
    "type": "object",
    "properties": {
      "summary": { "type": "string" },
      "risks": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["summary", "risks"]
  },
  "lockedParams": {
    "contextWindow": 32768,
    "maxTokens": 512,
    "seed": 7,
    "temperature": 0.1,
    "topK": 40,
    "repetitionPenalty": 1.05,
    "stopStrings": []
  },
  "guardrails": {
    "lockTemplate": true,
    "lockSchema": true,
    "lockSampling": true,
    "lockContext": true
  }
}
```

Response:

```json
{
  "ok": true,
  "runId": "cmp_...",
  "status": "pending"
}
```

### 10.2 Read compare run

**GET** `/api/agent/compare?runId=cmp_...`

Response:
- current run state
- lane progress
- fairness fingerprint
- partial results if available

### 10.3 Stream compare progress

**GET** `/api/agent/compare/stream?runId=cmp_...`

SSE events:
- `meta`
- `lane_started`
- `lane_delta` (optional, only if later需要流式展示)
- `lane_completed`
- `lane_failed`
- `run_completed`

### 10.4 Save preset

**POST** `/api/agent/compare/presets`

用途：
- 保存 compare 配置
- 用于之后复现

### 10.5 List presets

**GET** `/api/agent/compare/presets`

### 10.6 Export compare run

**GET** `/api/agent/compare/export?runId=...&format=md|json`

导出内容建议包含：
- prompt 摘要
- fairness fingerprint
- lane summary table
- structured output diff summary
- warnings

## 11. Back-end execution strategy

### v1 recommendation

Compare run 不直接走纯前端 fan-out，而是走服务端编排。

原因：

- 本地目标涉及 prewarm / loading / recovery
- 需要统一记录 fairness fingerprint
- 需要导出和持久化
- 需要比现有 benchmark 更轻，但比普通 chat 更稳

### Reuse strategy

- 复用现有 chat/provider 解析逻辑
- 复用现有 runtime ensure / local gateway recovery
- 复用 benchmark progress 的持久化思路
- 复用 replay compare 的 diff 摘要思路

### Suggested server modules

- `lib/agent/compare-store.ts`
- `lib/agent/compare-diff.ts`
- `lib/agent/compare-schema.ts`
- `app/api/agent/compare/route.ts`
- `app/api/agent/compare/stream/route.ts`
- `app/api/agent/compare/export/route.ts`

## 12. Schema and structured output support

这是 Compare Lab 必须首批支持的重点能力。

### v1 capabilities

- free text compare
- JSON object compare
- JSON schema pass/fail
- missing keys / extra keys / parse error

### UI expectations

每个 lane 必须展示：

- raw output
- parsed structured output
- schema verdict
- missing keys
- extra keys
- parse failure reason

## 13. Integration with future fine-tune flows

Compare Lab 和未来 fine-tune 工作流应天然打通。

### expected hooks

- 数据集准备后，抽样 prompt 可直接送进 Compare Lab
- 训练完成的 adapter 可直接作为新 target 进入 Compare Lab
- Compare Lab run 可直接生成 before/after report
- 对比通过后再送入 `/admin` benchmark 做批量回归

## 14. Implementation phases

### Phase 1

- compare run store
- compare composer state
- server-side multi-lane orchestration
- result cards
- JSON/schema compare
- markdown/json export

### Phase 2

- SSE live progress
- prompt template compare
- preset compare
- one-click send to benchmark prompt set

### Phase 3

- before/after adapter compare
- reasoning parsing compare
- richer diff lenses
- public shareable compare report

## 15. File touch forecast

Most likely files for v1:

- [AgentWorkbench.tsx](/Users/chenhaorui/Documents/New%20project/components/agent/AgentWorkbench.tsx)
- [types.ts](/Users/chenhaorui/Documents/New%20project/lib/agent/types.ts)
- [providers.ts](/Users/chenhaorui/Documents/New%20project/lib/agent/providers.ts)
- [runtime/route.ts](/Users/chenhaorui/Documents/New%20project/app/api/agent/runtime/route.ts)
- [runtime/actions/route.ts](/Users/chenhaorui/Documents/New%20project/app/api/agent/runtime/actions/route.ts)
- new compare store / routes under `app/api/agent/compare`

## 16. Acceptance bar for v1

Inference Compare Lab v1 算完成，需要满足：

1. 能在同一个 prompt 下稳定比较至少 2-4 个 targets
2. compare run 可持久化，不因页面刷新丢失
3. 能清晰显示参数是否锁一致
4. 能显示 structured output 的 pass/fail
5. 能导出 markdown/json
6. 本地模型加载和恢复失败时，错误能解释清楚
7. 能把一次 compare 结果复用到后续 benchmark 或 fine-tune 验证流里
