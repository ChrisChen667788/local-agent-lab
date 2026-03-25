export type BenchmarkPromptSetDefinition = {
  id: string;
  label: string;
  description: string;
  prompts: string[];
};

function dedupePrompts(prompts: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const prompt of prompts.map((entry) => entry.trim()).filter(Boolean)) {
    const key = prompt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(prompt);
  }
  return next;
}

function buildPromptSet(input: BenchmarkPromptSetDefinition): BenchmarkPromptSetDefinition {
  return {
    ...input,
    prompts: dedupePrompts(input.prompts)
  };
}

export const defaultBenchmarkPromptSets: BenchmarkPromptSetDefinition[] = [
  buildPromptSet({
    id: "latency-smoke",
    label: "短答延时回归集",
    description: "短答烟测，适合持续观察首字延时、总耗时与吞吐。",
    prompts: [
      "请用一句中文解释本地编码 Agent 的价值。",
      "请用一句中文说明为什么流式输出能改善首字体验。",
      "请用一句中文总结 speed 和 tool-first 两种档位的差异。",
      "请用一句中文解释为什么 benchmark 需要看 p50 和 p90。"
    ]
  }),
  buildPromptSet({
    id: "instruction-following-lite",
    label: "指令遵循轻量集",
    description: "参考 IFEval 风格，验证格式约束、字数约束和结构遵循。",
    prompts: [
      "请严格输出 3 条 bullet，每条都必须包含“延时”两个字。",
      "请输出一个 JSON 对象，只包含 status 和 reason 两个键，不要输出其他内容。",
      "请用两句话回答这个问题，第二句话必须包含“benchmark”。",
      "请只输出一行，且必须以 DONE 结尾。"
    ]
  }),
  buildPromptSet({
    id: "chinese-knowledge-lite",
    label: "中文能力轻量集",
    description: "参考 C-Eval 与 CMMLU，观察中文表达、知识与推理基础。",
    prompts: [
      "请用简洁中文解释 TCP 三次握手的目的。",
      "请比较向量检索和关键词检索的差异，并给出各自适用场景。",
      "请解释为什么 p95 比平均值更适合观察尾延迟。",
      "请说明 grounded generation 和普通生成式问答的工程差异。"
    ]
  }),
  buildPromptSet({
    id: "grounded-kb-qa",
    label: "Grounded 知识问答集",
    description: "适合在启用检索增强时验证 grounded generation、引用和低置信度处理。",
    prompts: [
      "基于知识库回答：grounded generation 的核心目标是什么？回答中必须带引用标签。",
      "基于知识库回答：citation enforcement 对减少幻觉有什么作用？回答中必须带引用标签。",
      "如果知识库证据不足，请明确说明置信度不足，而不是直接下结论。",
      "请根据知识库解释 retrieval confidence low 时应该如何 fallback。"
    ]
  }),
  buildPromptSet({
    id: "tool-use-design",
    label: "工具策略设计集",
    description: "偏 tool orchestration 与安全策略，适合比较策略表达和结构化回答质量。",
    prompts: [
      "请用三条要点说明 execute_command 为什么需要分级白名单。",
      "请说明 confirmation_required 在 coding agent 中的作用。",
      "请解释为什么 apply_patch 比直接覆盖文件更安全。",
      "请说明工具失败后为什么需要错误恢复和重试策略。"
    ]
  }),
  buildPromptSet({
    id: "code-rag-repo-qa",
    label: "代码检索与仓库问答集",
    description: "参考 Code RAG Bench 的仓库理解任务，观察跨文件理解和代码口径。",
    prompts: [
      "请说明 coding agent 为什么需要先检索仓库上下文，再决定是否改代码。",
      "请解释 repository QA 和普通文档问答在 chunking 策略上的差异。",
      "请说明代码检索增强里 parent-child chunking 的作用。",
      "请说明为什么代码问答里 citation 不应只给文件名，还要给 section 或函数上下文。"
    ]
  }),
  buildPromptSet({
    id: "agent-flow-lite",
    label: "Agent 全链路轻量集",
    description: "针对 Planner、Memory、状态持久化、错误恢复的工程问答回归。",
    prompts: [
      "请说明一个可用的 Agent 为什么至少需要 Planner、Memory、State 和 Error Recovery 四层。",
      "请解释为什么多步任务里只靠 prompt 拼接容易失败。",
      "请说明 Tool orchestration policy 和 task planner 的职责边界。",
      "请说明状态持久化对 Resume Agent 有什么作用。"
    ]
  }),
  buildPromptSet({
    id: "long-context-lite",
    label: "长上下文轻量集",
    description: "用于观察长上下文 budget、chunking 和上下文裁剪策略。",
    prompts: [
      "请说明长上下文场景里为什么要先做 retrieval compression 再塞给模型。",
      "请解释 parent-child chunking 和 fixed-size chunking 的差异。",
      "请说明为什么上下文窗口越大，不代表检索问答效果一定越好。",
      "请说明长上下文 Benchmark 为什么要区分 warm run 和 cold run。"
    ]
  }),
  buildPromptSet({
    id: "coding-brief",
    label: "编码说明回归集",
    description: "偏工程表达与取舍，适合比较回答质量与吞吐。",
    prompts: [
      "请用两句话说明 benchmark 中为什么要区分首字延时和总耗时。",
      "请用两句话说明本地 4bit 4B 与远端 API 的核心取舍。",
      "请用两句话说明 route-to-small-model 的价值。",
      "请用两句话说明为什么 coding agent 需要 baseline 回归。"
    ]
  }),
  buildPromptSet({
    id: "ops-summary",
    label: "运维摘要回归集",
    description: "偏监控与运维口径，适合验证后台图表、基线和状态总结输出。",
    prompts: [
      "请用三条简短 bullet 总结模型延时异常时应该先看哪些指标。",
      "请用三条简短 bullet 总结本地网关掉线时的排查顺序。",
      "请用三条简短 bullet 总结 baseline 对回归测试的价值。",
      "请用三条简短 bullet 总结 benchmark 报告里必须出现哪些指标。"
    ]
  })
];

export function getDefaultBenchmarkPromptSet(id?: string | null) {
  if (!id) return null;
  return defaultBenchmarkPromptSets.find((entry) => entry.id === id) || null;
}

export const benchmarkPromptSets = defaultBenchmarkPromptSets;
export const getBenchmarkPromptSet = getDefaultBenchmarkPromptSet;
