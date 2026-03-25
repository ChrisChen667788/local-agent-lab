import type {
  AgentBenchmarkDataset,
  AgentBenchmarkDatasetItem,
  AgentBenchmarkSuite
} from "@/lib/agent/types";

function dataset(
  input: Omit<AgentBenchmarkDataset, "sampleCount"> & {
    items: AgentBenchmarkDatasetItem[];
  }
): AgentBenchmarkDataset {
  return {
    ...input,
    sampleCount: input.items.length
  };
}

export const benchmarkDatasets: AgentBenchmarkDataset[] = [
  dataset({
    id: "ifeval-starter",
    label: "google/IFEval（starter subset）",
    description: "面向格式遵循与可验证约束的轻量子集，适合测试小模型的指令执行纪律。",
    sourceLabel: "Hugging Face · google/IFEval",
    sourceUrl: "https://huggingface.co/datasets/google/IFEval",
    taskCategory: "Instruction following",
    scoringLabel: "规则校验（line-rules / json-keys）",
    items: [
      {
        id: "ifeval-json-1",
        prompt: "请只输出一个 JSON 对象，并且只能包含 status 与 reason 两个键。status 必须是 ok。",
        evaluator: { kind: "json-keys", keys: ["status", "reason"], exactKeys: true },
        expectedAnswerPreview: '{"status":"ok","reason":"..."}',
        sourceSplit: "train"
      },
      {
        id: "ifeval-bullets-1",
        prompt: "请严格输出 3 条 bullet，每条都必须包含“延时”两个字。",
        evaluator: { kind: "line-rules", bulletCount: 3, keywords: ["延时"] },
        expectedAnswerPreview: "3 bullets, each contains 延时",
        sourceSplit: "train"
      },
      {
        id: "ifeval-lines-1",
        prompt: "请只输出一行，且必须以 DONE 结尾。",
        evaluator: { kind: "line-rules", lineCount: 1, keywords: ["DONE"] },
        expectedAnswerPreview: "single line ending with DONE",
        sourceSplit: "train"
      },
      {
        id: "ifeval-sentences-1",
        prompt: "请用两句话回答，第二句话必须包含 benchmark 这个词。",
        evaluator: { kind: "keyword-match", keywords: ["benchmark"], threshold: 1 },
        expectedAnswerPreview: "2 sentences, sentence 2 includes benchmark",
        sourceSplit: "train"
      }
    ]
  }),
  dataset({
    id: "ceval-cs-starter",
    label: "C-Eval（starter subset）",
    description: "参考 C-Eval 计算机/网络类选择题的轻量子集，适合观察中文基础知识准确率。",
    sourceLabel: "Hugging Face · ceval/ceval-exam",
    sourceUrl: "https://huggingface.co/datasets/ceval/ceval-exam",
    taskCategory: "Chinese multiple-choice",
    scoringLabel: "选择题精确匹配",
    items: [
      {
        id: "ceval-net-1",
        prompt: "选择题：在 TCP/IP 体系中，IP 协议主要工作在哪一层？\nA. 物理层\nB. 网络层\nC. 会话层\nD. 表示层\n请只输出选项字母。",
        evaluator: { kind: "choice-exact", answer: "B" },
        expectedAnswerPreview: "B",
        sourceSplit: "test",
        sourceSubset: "computer_network"
      },
      {
        id: "ceval-os-1",
        prompt: "选择题：操作系统中用于避免多个进程同时修改共享资源的机制通常是？\nA. 互斥\nB. 路由\nC. 编码\nD. 解码\n请只输出选项字母。",
        evaluator: { kind: "choice-exact", answer: "A" },
        expectedAnswerPreview: "A",
        sourceSplit: "test",
        sourceSubset: "operating_system"
      },
      {
        id: "ceval-db-1",
        prompt: "选择题：数据库中用于唯一标识一条记录的字段通常称为？\nA. 外键\nB. 主键\nC. 索引页\nD. 事务日志\n请只输出选项字母。",
        evaluator: { kind: "choice-exact", answer: "B" },
        expectedAnswerPreview: "B",
        sourceSplit: "test",
        sourceSubset: "database"
      },
      {
        id: "ceval-cn-2",
        prompt: "选择题：HTTP 协议默认使用的传输层协议是？\nA. UDP\nB. ICMP\nC. TCP\nD. ARP\n请只输出选项字母。",
        evaluator: { kind: "choice-exact", answer: "C" },
        expectedAnswerPreview: "C",
        sourceSplit: "test",
        sourceSubset: "computer_network"
      }
    ]
  }),
  dataset({
    id: "cmmlu-cs-starter",
    label: "CMMLU（starter subset）",
    description: "参考 CMMLU 中文专业知识问答，偏计算机与软件工程口径。",
    sourceLabel: "Hugging Face · lmlmcat/cmmlu",
    sourceUrl: "https://huggingface.co/datasets/lmlmcat/cmmlu",
    taskCategory: "Chinese multiple-choice",
    scoringLabel: "选择题精确匹配",
    items: [
      {
        id: "cmmlu-se-1",
        prompt: "选择题：Git 中用于把当前分支变更整合到目标分支的常见命令是？\nA. git merge\nB. git status\nC. git clean\nD. git stash drop\n请只输出选项字母。",
        evaluator: { kind: "choice-exact", answer: "A" },
        expectedAnswerPreview: "A",
        sourceSplit: "test",
        sourceSubset: "computer_science"
      },
      {
        id: "cmmlu-se-2",
        prompt: "选择题：在软件测试中，回归测试的主要目标是？\nA. 发现新增功能全部需求\nB. 验证旧功能未被新改动破坏\nC. 提高硬件性能\nD. 减少日志量\n请只输出选项字母。",
        evaluator: { kind: "choice-exact", answer: "B" },
        expectedAnswerPreview: "B",
        sourceSplit: "test",
        sourceSubset: "computer_science"
      },
      {
        id: "cmmlu-se-3",
        prompt: "选择题：向量检索通常依赖哪类表示？\nA. 哈希桶\nB. 稀疏位图\nC. Embedding 向量\nD. 二叉树索引\n请只输出选项字母。",
        evaluator: { kind: "choice-exact", answer: "C" },
        expectedAnswerPreview: "C",
        sourceSplit: "test",
        sourceSubset: "computer_science"
      },
      {
        id: "cmmlu-se-4",
        prompt: "选择题：在分布式系统中，用于描述最终一致性的是？\nA. 所有节点任意时刻都严格一致\nB. 经过一段时间后系统会收敛到一致状态\nC. 数据永远不一致\nD. 只允许单机部署\n请只输出选项字母。",
        evaluator: { kind: "choice-exact", answer: "B" },
        expectedAnswerPreview: "B",
        sourceSplit: "test",
        sourceSubset: "computer_science"
      }
    ]
  }),
  dataset({
    id: "bfcl-starter",
    label: "BFCL（starter subset）",
    description: "函数/工具调用格式能力的 starter subset，用于测试 tool schema 遵循。",
    sourceLabel: "Hugging Face · bengaliAI/BFCL",
    sourceUrl: "https://huggingface.co/datasets/bengaliAI/BFCL",
    taskCategory: "Function calling",
    scoringLabel: "JSON 工具调用校验",
    items: [
      {
        id: "bfcl-1",
        prompt: "你可以调用函数 weather.get_current(city, unit)。请根据用户请求“查询上海当前天气，单位为摄氏度”只输出 JSON 工具调用，不要解释。",
        evaluator: { kind: "json-tool-call", functionName: "weather.get_current", requiredArgs: ["city", "unit"] },
        expectedAnswerPreview: '{"name":"weather.get_current","arguments":{"city":"上海","unit":"celsius"}}',
        sourceSplit: "test"
      },
      {
        id: "bfcl-2",
        prompt: "你可以调用函数 repo.read_file(path)。请根据请求“读取 app/api/admin/benchmark/route.ts”只输出 JSON 工具调用，不要解释。",
        evaluator: { kind: "json-tool-call", functionName: "repo.read_file", requiredArgs: ["path"] },
        expectedAnswerPreview: '{"name":"repo.read_file","arguments":{"path":"app/api/admin/benchmark/route.ts"}}',
        sourceSplit: "test"
      },
      {
        id: "bfcl-3",
        prompt: "你可以调用函数 task.schedule(name, due_at)。请根据请求“创建一个名为 benchmark 的任务，截止时间是今天 18:00”只输出 JSON 工具调用，不要解释。",
        evaluator: { kind: "json-tool-call", functionName: "task.schedule", requiredArgs: ["name", "due_at"] },
        expectedAnswerPreview: '{"name":"task.schedule","arguments":{"name":"benchmark","due_at":"今天 18:00"}}',
        sourceSplit: "test"
      }
    ]
  }),
  dataset({
    id: "longbench-starter",
    label: "LongBench（starter subset）",
    description: "长上下文与带材料问答的 starter subset，适合观察长文定位与 grounded summarization。",
    sourceLabel: "Hugging Face · zai-org/LongBench",
    sourceUrl: "https://huggingface.co/datasets/zai-org/LongBench",
    taskCategory: "Long context QA",
    scoringLabel: "关键词匹配",
    items: [
      {
        id: "longbench-1",
        prompt: "阅读材料：\n1. Retrieval compression 可以先压缩证据，再交给模型。\n2. Citation enforcement 要求答案引用具体证据。\n3. 当 retrieval confidence low 时，系统应收缩结论并提示证据不足。\n\n问题：请概括在 grounded generation 中最重要的三个机制。",
        evaluator: { kind: "keyword-match", keywords: ["retrieval compression", "citation", "证据不足"], threshold: 0.66 },
        expectedAnswerPreview: "应覆盖 retrieval compression / citation enforcement / 低置信度 fallback",
        sourceSplit: "test"
      },
      {
        id: "longbench-2",
        prompt: "阅读材料：\n- p50 表示中位数。\n- p90 表示 90% 请求不超过该值。\n- 尾延迟越高，用户越容易感知到偶发卡顿。\n\n问题：为什么 benchmark 报告里不能只看平均值？",
        evaluator: { kind: "keyword-match", keywords: ["p50", "p90", "尾延迟"], threshold: 0.66 },
        expectedAnswerPreview: "应说明平均值掩盖尾延迟，并点名 p50 / p90",
        sourceSplit: "test"
      },
      {
        id: "longbench-3",
        prompt: "阅读材料：\nA. Planner 负责分解任务。\nB. Memory System 负责持久化工作记忆和长期知识。\nC. Tool Orchestration 负责选择和编排工具调用。\nD. Error Recovery 负责失败后的重试和补救。\n\n问题：如果一个 Agent 只能调用工具，但没有 Planner 和 Memory，会出现什么问题？",
        evaluator: { kind: "keyword-match", keywords: ["任务分解", "记忆", "状态", "容易中断"], threshold: 0.5 },
        expectedAnswerPreview: "应说明缺少任务分解、状态和记忆导致多步任务中断",
        sourceSplit: "test"
      }
    ]
  }),
  dataset({
    id: "humaneval-starter",
    label: "HumanEval（starter subset）",
    description: "代码生成的 starter subset。当前版本只做性能与输出留档，正确性需要人工复核。",
    sourceLabel: "Hugging Face · openai/openai_humaneval",
    sourceUrl: "https://huggingface.co/datasets/openai/openai_humaneval",
    taskCategory: "Code generation",
    scoringLabel: "人工复核",
    items: [
      {
        id: "humaneval-1",
        prompt: "请编写 Python 函数 reverse_words(s: str) -> str，要求把句子中的单词顺序反转，并保留单词内部字符顺序。",
        evaluator: { kind: "manual-review", note: "Use Python execution or EvalPlus later for pass@1." },
        expectedAnswerPreview: "def reverse_words(s: str) -> str: ...",
        sourceSplit: "test"
      },
      {
        id: "humaneval-2",
        prompt: "请编写 Python 函数 is_palindrome_number(n: int) -> bool，要求不用把整数转成字符串。",
        evaluator: { kind: "manual-review", note: "Use Python execution or EvalPlus later for pass@1." },
        expectedAnswerPreview: "def is_palindrome_number(n: int) -> bool: ...",
        sourceSplit: "test"
      }
    ]
  }),
  dataset({
    id: "mbppplus-starter",
    label: "MBPP+（starter subset）",
    description: "代码生成的 starter subset。当前版本只做性能与输出留档，正确性需要人工复核。",
    sourceLabel: "Hugging Face · evalplus/mbppplus",
    sourceUrl: "https://huggingface.co/datasets/evalplus/mbppplus",
    taskCategory: "Code generation",
    scoringLabel: "人工复核",
    items: [
      {
        id: "mbpp-1",
        prompt: "请编写 Python 函数 unique_sorted(nums: list[int]) -> list[int]，返回去重后从小到大排序的结果。",
        evaluator: { kind: "manual-review", note: "Use EvalPlus-compatible execution later." },
        expectedAnswerPreview: "def unique_sorted(nums: list[int]) -> list[int]: ...",
        sourceSplit: "test"
      },
      {
        id: "mbpp-2",
        prompt: "请编写 Python 函数 chunk_list(items: list[int], size: int) -> list[list[int]]，把列表按 size 切块。",
        evaluator: { kind: "manual-review", note: "Use EvalPlus-compatible execution later." },
        expectedAnswerPreview: "def chunk_list(items: list[int], size: int) -> list[list[int]]: ...",
        sourceSplit: "test"
      }
    ]
  })
];

export function getBenchmarkDataset(id?: string | null) {
  if (!id) return null;
  return benchmarkDatasets.find((entry) => entry.id === id) || null;
}

export const benchmarkMilestoneSuites: AgentBenchmarkSuite[] = [
  {
    id: "daily-regression",
    label: "日常回归集",
    description: "面向日常迭代的轻量回归组合，优先覆盖延时、指令遵循和 grounded QA。",
    reportTier: "daily",
    workloads: [
      { kind: "prompt-set", promptSetId: "latency-smoke", runs: 3 },
      { kind: "prompt-set", promptSetId: "grounded-kb-qa", runs: 2 },
      { kind: "dataset", datasetId: "ifeval-starter", runs: 2, sampleLimit: 4 }
    ]
  },
  {
    id: "weekly-regression",
    label: "周级回归集",
    description: "面向每周版本对比，覆盖中文知识、工具格式、长上下文和 Agent 规划口径。",
    reportTier: "weekly",
    workloads: [
      { kind: "prompt-set", promptSetId: "instruction-following-lite", runs: 2 },
      { kind: "prompt-set", promptSetId: "agent-flow-lite", runs: 2 },
      { kind: "dataset", datasetId: "ceval-cs-starter", runs: 2, sampleLimit: 4 },
      { kind: "dataset", datasetId: "bfcl-starter", runs: 2, sampleLimit: 3 },
      { kind: "dataset", datasetId: "longbench-starter", runs: 2, sampleLimit: 3 }
    ]
  },
  {
    id: "milestone-formal",
    label: "正式里程碑评测集",
    description: "用于正式 benchmark 报告的里程碑套件，整合性能、指令、中文、工具、检索和 Agent 能力。",
    reportTier: "milestone",
    workloads: [
      { kind: "prompt-set", promptSetId: "latency-smoke", runs: 5 },
      { kind: "prompt-set", promptSetId: "instruction-following-lite", runs: 1 },
      { kind: "prompt-set", promptSetId: "grounded-kb-qa", runs: 1 },
      { kind: "prompt-set", promptSetId: "code-rag-repo-qa", runs: 1 },
      { kind: "prompt-set", promptSetId: "agent-flow-lite", runs: 1 },
      { kind: "dataset", datasetId: "ifeval-starter", runs: 1, sampleLimit: 4 },
      { kind: "dataset", datasetId: "ceval-cs-starter", runs: 1, sampleLimit: 4 },
      { kind: "dataset", datasetId: "cmmlu-cs-starter", runs: 1, sampleLimit: 4 },
      { kind: "dataset", datasetId: "bfcl-starter", runs: 1, sampleLimit: 3 },
      { kind: "dataset", datasetId: "longbench-starter", runs: 1, sampleLimit: 3 },
      { kind: "dataset", datasetId: "humaneval-starter", runs: 1, sampleLimit: 2 },
      { kind: "dataset", datasetId: "mbppplus-starter", runs: 1, sampleLimit: 2 }
    ]
  },
  {
    id: "milestone-full",
    label: "正式里程碑评测集（full）",
    description: "用于全量正式报告和跨版本深度对比的重型套件，会保留更多重复采样与更长执行时间。",
    reportTier: "full",
    workloads: [
      { kind: "prompt-set", promptSetId: "latency-smoke", runs: 8 },
      { kind: "prompt-set", promptSetId: "instruction-following-lite", runs: 3 },
      { kind: "prompt-set", promptSetId: "grounded-kb-qa", runs: 3 },
      { kind: "prompt-set", promptSetId: "code-rag-repo-qa", runs: 3 },
      { kind: "prompt-set", promptSetId: "agent-flow-lite", runs: 3 },
      { kind: "dataset", datasetId: "ifeval-starter", runs: 3, sampleLimit: 4 },
      { kind: "dataset", datasetId: "ceval-cs-starter", runs: 3, sampleLimit: 4 },
      { kind: "dataset", datasetId: "cmmlu-cs-starter", runs: 3, sampleLimit: 4 },
      { kind: "dataset", datasetId: "bfcl-starter", runs: 3, sampleLimit: 3 },
      { kind: "dataset", datasetId: "longbench-starter", runs: 3, sampleLimit: 3 },
      { kind: "dataset", datasetId: "humaneval-starter", runs: 2, sampleLimit: 2 },
      { kind: "dataset", datasetId: "mbppplus-starter", runs: 2, sampleLimit: 2 }
    ]
  }
];

export function getBenchmarkMilestoneSuite(id?: string | null) {
  if (!id) return null;
  return benchmarkMilestoneSuites.find((entry) => entry.id === id) || null;
}
