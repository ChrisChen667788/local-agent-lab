"use client";

import { useMemo } from "react";
import type {
  AgentBenchmarkResponse,
  AgentCompareIntent,
  AgentCompareOutputShape,
  AgentCompareResponse,
  AgentProviderProfile,
  AgentTarget,
  AgentThinkingMode
} from "@/lib/agent/types";

type AgentCompareLabProps = {
  locale: string;
  targets: AgentTarget[];
  selectedTargetId: string;
  compareTargetIds: string[];
  compareIntent: AgentCompareIntent;
  compareOutputShape: AgentCompareOutputShape;
  input: string;
  systemPrompt: string;
  enableTools: boolean;
  enableRetrieval: boolean;
  contextWindow: number;
  providerProfile: AgentProviderProfile;
  thinkingMode: AgentThinkingMode;
  pending: boolean;
  comparePending: boolean;
  compareError: string;
  compareResult: AgentCompareResponse | null;
  compareBaseTargetId: string;
  benchmarkPending: boolean;
  benchmarkError: string;
  benchmarkResult: AgentBenchmarkResponse | null;
  contextWindowOptions: number[];
  providerProfileOptions: AgentProviderProfile[];
  thinkingModeOptions: AgentThinkingMode[];
  onToggleCompareTarget: (targetId: string) => void;
  onCompareIntentChange: (value: AgentCompareIntent) => void;
  onCompareOutputShapeChange: (value: AgentCompareOutputShape) => void;
  onInputChange: (value: string) => void;
  onSystemPromptChange: (value: string) => void;
  onEnableToolsChange: (value: boolean) => void;
  onEnableRetrievalChange: (value: boolean) => void;
  onContextWindowChange: (value: number) => void;
  onProviderProfileChange: (value: AgentProviderProfile) => void;
  onThinkingModeChange: (value: AgentThinkingMode) => void;
  onRunCompare: () => void;
  onRerunLane: (targetId: string) => void;
  onSetBaseLane: (targetId: string) => void;
  onSendToBenchmark: () => void;
  onExportMarkdown: () => void;
  onCopy: (text: string, key: string) => void;
  copyState: string;
};

const MAX_COMPARE_LANES = 4;

const COMPARE_INTENT_META: Record<
  AgentCompareIntent,
  {
    zh: { label: string; description: string };
    en: { label: string; description: string };
  }
> = {
  "model-vs-model": {
    zh: {
      label: "模型对模型",
      description: "同一提示词、同一推理预算下比较多个目标的行为差异。"
    },
    en: {
      label: "Model vs model",
      description: "Compare multiple targets under the same prompt and inference budget."
    }
  },
  "preset-vs-preset": {
    zh: {
      label: "配置对配置",
      description: "保持目标一致，只比较 provider profile、thinking 或 sampling 预设。"
    },
    en: {
      label: "Preset vs preset",
      description: "Hold the target steady and compare profile, thinking, or sampling presets."
    }
  },
  "template-vs-template": {
    zh: {
      label: "模板对模板",
      description: "比较不同 system prompt / prompt frame 对输出的影响。"
    },
    en: {
      label: "Template vs template",
      description: "Inspect how different system frames reshape the same task output."
    }
  },
  "before-vs-after": {
    zh: {
      label: "变更前后",
      description: "为后续微调、提示词修订或 checkpoint 前后对比预留入口。"
    },
    en: {
      label: "Before / after",
      description: "Reserve a clean lane for checkpoint, prompt, or fine-tune deltas."
    }
  }
};

const OUTPUT_SHAPE_META: Record<
  AgentCompareOutputShape,
  {
    zh: { label: string; description: string };
    en: { label: string; description: string };
  }
> = {
  freeform: {
    zh: { label: "自由输出", description: "保留模型自然回答，适合整体手感和长文风格比较。" },
    en: { label: "Freeform", description: "Keep the model natural and compare overall tone and reasoning." }
  },
  "bullet-list": {
    zh: { label: "要点列表", description: "压成同结构要点，适合快速横向审阅。" },
    en: { label: "Bullet list", description: "Force a concise outline so lanes stay easy to review." }
  },
  "strict-json": {
    zh: { label: "严格 JSON", description: "为结构化输出、抽取和微调回归验证准备。" },
    en: { label: "Strict JSON", description: "Use a stable schema for extraction and regression checks." }
  }
};

function formatContextWindowLabel(value: number) {
  return value >= 1024 ? `${Math.round(value / 1024)}K` : `${value}`;
}

function formatThinkingMode(locale: string, value: AgentThinkingMode) {
  if (value === "thinking") {
    return locale.startsWith("en") ? "Thinking" : "思考模式";
  }
  return locale.startsWith("en") ? "Standard" : "标准模式";
}

function formatProviderProfile(locale: string, value: AgentProviderProfile) {
  if (value === "tool-first") {
    return locale.startsWith("en") ? "Tool-first" : "工具优先";
  }
  if (value === "balanced") {
    return locale.startsWith("en") ? "Balanced" : "平衡";
  }
  return locale.startsWith("en") ? "Speed" : "速度优先";
}

function createTokenSet(content: string) {
  return new Set(
    content
      .toLowerCase()
      .split(/[^a-z0-9_\u4e00-\u9fff]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function computeTokenOverlap(base: string, candidate: string) {
  const baseSet = createTokenSet(base);
  const candidateSet = createTokenSet(candidate);
  if (!baseSet.size && !candidateSet.size) return 1;
  const union = new Set([...baseSet, ...candidateSet]);
  let intersection = 0;
  union.forEach((token) => {
    if (baseSet.has(token) && candidateSet.has(token)) {
      intersection += 1;
    }
  });
  return union.size ? intersection / union.size : 0;
}

function extractJsonKeys(content: string) {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return Object.keys(parsed).sort();
  } catch {
    return null;
  }
}

export function AgentCompareLab({
  locale,
  targets,
  selectedTargetId,
  compareTargetIds,
  compareIntent,
  compareOutputShape,
  input,
  systemPrompt,
  enableTools,
  enableRetrieval,
  contextWindow,
  providerProfile,
  thinkingMode,
  pending,
  comparePending,
  compareError,
  compareResult,
  compareBaseTargetId,
  benchmarkPending,
  benchmarkError,
  benchmarkResult,
  contextWindowOptions,
  providerProfileOptions,
  thinkingModeOptions,
  onToggleCompareTarget,
  onCompareIntentChange,
  onCompareOutputShapeChange,
  onInputChange,
  onSystemPromptChange,
  onEnableToolsChange,
  onEnableRetrievalChange,
  onContextWindowChange,
  onProviderProfileChange,
  onThinkingModeChange,
  onRunCompare,
  onRerunLane,
  onSetBaseLane,
  onSendToBenchmark,
  onExportMarkdown,
  onCopy,
  copyState
}: AgentCompareLabProps) {
  const copy = locale.startsWith("en")
    ? {
        title: "Compare Lab",
        subtitle:
          "Compare model behavior inside the current /agent workbench, with the same runtime guardrails and target catalog you already use for chat and replay.",
        targets: "Compare targets",
        targetsHint: `Keep the current target pinned, then add up to ${MAX_COMPARE_LANES - 1} more lanes for a fair side-by-side.`,
        recipe: "Compare recipe",
        outputShape: "Output shape",
        lockedControls: "Locked controls",
        lockedControlsHint:
          "These settings stay aligned across every lane, so we compare behavior instead of accidental parameter drift.",
        promptFrame: "Prompt frame",
        promptInput: "Task prompt",
        systemFrame: "System frame",
        lanePreview: "Lane preview",
        lanePreviewHint: "This compares real outputs while keeping the current /agent workbench frame intact.",
        fairnessFingerprint: "Fairness fingerprint",
        currentTarget: "Current target",
        local: "Local",
        remote: "Remote",
        recommendedContext: "Recommended context",
        runCompare: "Run compare",
        runningCompare: "Running compare...",
        benchmarkAction: "Send to benchmark",
        benchmarkPending: "Sending to benchmark...",
        benchmarkHint: "Reuse the current compare setup as a prompt benchmark run in /admin.",
        benchmarkSuccess: "Benchmark handoff ready",
        benchmarkOpen: "Open /admin and track this run",
        exportMarkdown: "Export markdown",
        rerunLane: "Rerun lane",
        setBaseLane: "Set as base",
        baseLaneTag: "Base lane",
        needMoreTargets: "Add at least one more lane to make the comparison meaningful.",
        laneReady: "Lane ready",
        lanePending: "Waiting",
        tools: "Tool loop",
        retrieval: "Retrieval",
        on: "On",
        off: "Off",
        resultReview: "Result review",
        resultReviewHint: "Review response shape, output length, warning state, and overlap against the base lane.",
        latestRun: "Latest run",
        baseLane: "Base lane",
        overlap: "Overlap",
        lengthDelta: "Length delta",
        schema: "Schema",
        warning: "Warning",
        copyOutput: "Copy output",
        copied: "Copied",
        noResults: "Run compare to inspect side-by-side outputs and review notes.",
        laneFailed: "Lane failed",
        laneOk: "Lane ok",
        actualContext: "Actual context",
        usage: "Usage",
        promptTokens: "Prompt",
        completionTokens: "Completion",
        totalTokens: "Total",
        partialRun: "Compare completed with one or more failed lanes.",
        compareWarning: "Compare note",
        schemaMatch: "Matched keys",
        schemaMismatch: "Different keys",
        schemaUnavailable: "Not JSON"
      }
    : {
        title: "Compare Lab",
        subtitle:
          "在当前 /agent 工作台里直接做输出对比，继续复用你已经有的 target catalog、runtime guardrails 和回放链路，不另起产品面。",
        targets: "对比目标",
        targetsHint: `固定当前目标，再额外加入最多 ${MAX_COMPARE_LANES - 1} 条 lane，方便做公平对比。`,
        recipe: "对比方案",
        outputShape: "输出形态",
        lockedControls: "锁定控制项",
        lockedControlsHint: "这些参数会在每条 lane 上保持一致，避免把采样漂移误判成模型能力差异。",
        promptFrame: "提示词框架",
        promptInput: "任务提示词",
        systemFrame: "系统提示词",
        lanePreview: "对比 lane 预览",
        lanePreviewHint: "在现有 /agent 工作台里直接跑真实 compare，同时保持现有框架和交互骨架不变。",
        fairnessFingerprint: "公平性指纹",
        currentTarget: "当前目标",
        local: "本地",
        remote: "远端",
        recommendedContext: "推荐上下文",
        runCompare: "运行对比",
        runningCompare: "对比运行中...",
        benchmarkAction: "送入 benchmark",
        benchmarkPending: "正在送入 benchmark...",
        benchmarkHint: "沿用当前 compare 配置，直接转成 /admin 里的 prompt benchmark。",
        benchmarkSuccess: "benchmark 已接收",
        benchmarkOpen: "去 /admin 跟踪这轮运行",
        exportMarkdown: "导出 Markdown",
        rerunLane: "重跑此 lane",
        setBaseLane: "设为基准",
        baseLaneTag: "基准 lane",
        needMoreTargets: "至少再加一条 lane，才能形成有意义的对比。",
        laneReady: "已就绪",
        lanePending: "待补齐",
        tools: "工具循环",
        retrieval: "检索增强",
        on: "开启",
        off: "关闭",
        resultReview: "结果审阅",
        resultReviewHint: "现在可以看输出形态、长度、warning，以及相对基准 lane 的重合度和结构差异。",
        latestRun: "最近一次运行",
        baseLane: "基准 lane",
        overlap: "重合度",
        lengthDelta: "长度差",
        schema: "结构",
        warning: "告警",
        copyOutput: "复制输出",
        copied: "已复制",
        noResults: "运行 compare 后，这里会出现并排输出和基础审阅结论。",
        laneFailed: "lane 失败",
        laneOk: "lane 正常",
        actualContext: "实际上下文",
        usage: "用量",
        promptTokens: "提示",
        completionTokens: "生成",
        totalTokens: "总计",
        partialRun: "这轮 compare 已完成，但有一个或多个 lane 失败。",
        compareWarning: "对比说明",
        schemaMatch: "键一致",
        schemaMismatch: "键不同",
        schemaUnavailable: "非 JSON"
      };

  const compareTargets = useMemo(
    () => targets.filter((target) => compareTargetIds.includes(target.id)),
    [compareTargetIds, targets]
  );

  const fairnessFingerprint = useMemo(
    () =>
      [
        formatContextWindowLabel(contextWindow),
        formatProviderProfile(locale, providerProfile),
        formatThinkingMode(locale, thinkingMode),
        `${copy.tools} ${enableTools ? copy.on : copy.off}`,
        `${copy.retrieval} ${enableRetrieval ? copy.on : copy.off}`,
        OUTPUT_SHAPE_META[compareOutputShape][locale.startsWith("en") ? "en" : "zh"].label
      ].join(" · "),
    [
      compareOutputShape,
      contextWindow,
      copy.off,
      copy.on,
      copy.retrieval,
      copy.tools,
      enableRetrieval,
      enableTools,
      locale,
      providerProfile,
      thinkingMode
    ]
  );

  const hasEnoughTargets = compareTargets.length >= 2;
  const baseResult = useMemo(
    () => compareResult?.results.find((lane) => lane.targetId === compareBaseTargetId) || compareResult?.results[0] || null,
    [compareBaseTargetId, compareResult?.results]
  );
  const reviewRows = useMemo(() => {
    if (!compareResult?.results.length || !baseResult) return [];
    const baseJsonKeys = extractJsonKeys(baseResult.content);
    return compareResult.results.map((lane) => {
      const overlap = computeTokenOverlap(baseResult.content, lane.content);
      const candidateJsonKeys = extractJsonKeys(lane.content);
      const schemaStatus =
        !baseJsonKeys || !candidateJsonKeys
          ? copy.schemaUnavailable
          : JSON.stringify(baseJsonKeys) === JSON.stringify(candidateJsonKeys)
            ? copy.schemaMatch
            : copy.schemaMismatch;
      return {
        lane,
        overlap,
        lengthDelta: lane.content.length - baseResult.content.length,
        schemaStatus,
        isBase: lane.targetId === baseResult.targetId
      };
    });
  }, [baseResult, compareResult?.results, copy.schemaMatch, copy.schemaMismatch, copy.schemaUnavailable]);

  return (
    <div className="h-[52vh] min-h-[360px] max-h-[72vh] overflow-y-auto bg-[linear-gradient(180deg,rgba(15,23,42,0.18),rgba(2,6,23,0.12))] sm:h-[58vh]">
      <div className="space-y-5 px-5 py-5">
        <section className="rounded-[28px] border border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_36%),linear-gradient(135deg,rgba(15,23,42,0.85),rgba(2,6,23,0.92))] p-5 shadow-[0_30px_70px_rgba(2,6,23,0.35)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-200/80">/agent · compare</p>
              <h3 className="mt-3 text-2xl font-semibold text-white">{copy.title}</h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">{copy.subtitle}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">{copy.fairnessFingerprint}</p>
              <p className="mt-2 text-sm font-medium text-white">{fairnessFingerprint}</p>
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(300px,0.82fr)]">
          <div className="space-y-5">
            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{copy.targets}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{copy.targetsHint}</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-slate-200">
                  {compareTargets.length}/{MAX_COMPARE_LANES}
                </span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {targets.map((target) => {
                  const checked = compareTargetIds.includes(target.id);
                  const pinned = target.id === selectedTargetId;
                  return (
                    <label
                      key={target.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-3 py-3 transition ${
                        checked
                          ? "border-cyan-400/25 bg-cyan-400/10"
                          : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.05]"
                      } ${pinned ? "ring-1 ring-cyan-300/20" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={pinned}
                        onChange={() => onToggleCompareTarget(target.id)}
                        className="mt-1 rounded border-white/20 bg-slate-950 disabled:cursor-not-allowed"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-white">{target.label}</p>
                          <span
                            className={`rounded-full px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] ${
                              target.execution === "local"
                                ? "bg-emerald-400/10 text-emerald-200"
                                : "bg-violet-400/10 text-violet-200"
                            }`}
                          >
                            {target.execution === "local" ? copy.local : copy.remote}
                          </span>
                          {pinned ? (
                            <span className="rounded-full bg-cyan-400/10 px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] text-cyan-100">
                              {copy.currentTarget}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-xs leading-6 text-slate-400">{target.description}</p>
                        <p className="mt-2 text-[11px] text-slate-500">
                          {copy.recommendedContext}: {target.recommendedContext}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{copy.recipe}</p>
                <div className="mt-4 space-y-3">
                  {Object.entries(COMPARE_INTENT_META).map(([intent, meta]) => {
                    const selected = compareIntent === intent;
                    const labelSet = meta[locale.startsWith("en") ? "en" : "zh"];
                    return (
                      <button
                        key={intent}
                        type="button"
                        onClick={() => onCompareIntentChange(intent as AgentCompareIntent)}
                        className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                          selected
                            ? "border-cyan-400/25 bg-cyan-400/10"
                            : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.05]"
                        }`}
                      >
                        <p className="text-sm font-medium text-white">{labelSet.label}</p>
                        <p className="mt-1 text-xs leading-6 text-slate-400">{labelSet.description}</p>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{copy.outputShape}</p>
                <div className="mt-4 space-y-3">
                  {Object.entries(OUTPUT_SHAPE_META).map(([shape, meta]) => {
                    const selected = compareOutputShape === shape;
                    const labelSet = meta[locale.startsWith("en") ? "en" : "zh"];
                    return (
                      <button
                        key={shape}
                        type="button"
                        onClick={() => onCompareOutputShapeChange(shape as AgentCompareOutputShape)}
                        className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                          selected
                            ? "border-violet-400/25 bg-violet-400/10"
                            : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.05]"
                        }`}
                      >
                        <p className="text-sm font-medium text-white">{labelSet.label}</p>
                        <p className="mt-1 text-xs leading-6 text-slate-400">{labelSet.description}</p>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{copy.promptFrame}</p>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="text-xs uppercase tracking-[0.18em] text-slate-500">{copy.promptInput}</label>
                  <textarea
                    value={input}
                    onChange={(event) => onInputChange(event.target.value)}
                    rows={7}
                    className="mt-2 min-h-[160px] w-full resize-y rounded-3xl border border-white/10 bg-black/25 px-4 py-4 font-mono text-sm leading-7 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/40 focus:bg-black/35"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.18em] text-slate-500">{copy.systemFrame}</label>
                  <textarea
                    value={systemPrompt}
                    onChange={(event) => onSystemPromptChange(event.target.value)}
                    rows={10}
                    className="mt-2 w-full rounded-3xl border border-white/10 bg-slate-950/80 px-4 py-4 font-mono text-xs leading-6 text-slate-200 outline-none transition focus:border-cyan-400/40"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{copy.lockedControls}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">{copy.lockedControlsHint}</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {locale.startsWith("en") ? "Context window" : "上下文长度"}
                  </span>
                  <select
                    value={contextWindow}
                    onChange={(event) => onContextWindowChange(Number(event.target.value))}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    {contextWindowOptions.map((value) => (
                      <option key={value} value={value}>
                        {formatContextWindowLabel(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {locale.startsWith("en") ? "Provider profile" : "Provider 配置"}
                  </span>
                  <select
                    value={providerProfile}
                    onChange={(event) => onProviderProfileChange(event.target.value as AgentProviderProfile)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    {providerProfileOptions.map((value) => (
                      <option key={value} value={value}>
                        {formatProviderProfile(locale, value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {locale.startsWith("en") ? "Thinking mode" : "思考模式"}
                  </span>
                  <select
                    value={thinkingMode}
                    onChange={(event) => onThinkingModeChange(event.target.value as AgentThinkingMode)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    {thinkingModeOptions.map((value) => (
                      <option key={value} value={value}>
                        {formatThinkingMode(locale, value)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-5 text-sm text-slate-300">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enableTools}
                    onChange={(event) => onEnableToolsChange(event.target.checked)}
                    className="rounded border-white/20 bg-slate-950"
                  />
                  {copy.tools}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enableRetrieval}
                    onChange={(event) => onEnableRetrievalChange(event.target.checked)}
                    className="rounded border-white/20 bg-slate-950"
                  />
                  {copy.retrieval}
                </label>
              </div>
            </section>
          </div>

          <div className="space-y-5">
            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{copy.lanePreview}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">{copy.lanePreviewHint}</p>
              {!hasEnoughTargets ? (
                <div className="mt-4 rounded-2xl border border-dashed border-amber-300/20 bg-amber-300/10 px-4 py-4 text-sm leading-6 text-amber-100">
                  {copy.needMoreTargets}
                </div>
              ) : null}
              <div className="mt-4 space-y-3">
                {compareTargets.map((target) => (
                  <div key={target.id} className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-white">{target.label}</p>
                          <span
                            className={`rounded-full px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] ${
                              target.execution === "local"
                                ? "bg-emerald-400/10 text-emerald-200"
                                : "bg-violet-400/10 text-violet-200"
                            }`}
                          >
                            {target.execution === "local" ? copy.local : copy.remote}
                          </span>
                          {target.id === selectedTargetId ? (
                            <span className="rounded-full bg-cyan-400/10 px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] text-cyan-100">
                              {copy.currentTarget}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-xs leading-6 text-slate-400">{target.providerLabel}</p>
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                        {hasEnoughTargets ? copy.laneReady : copy.lanePending}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs leading-6 text-slate-300">
                      <p>{copy.recommendedContext}: {target.recommendedContext}</p>
                      <p>{target.notes[0] || target.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                {locale.startsWith("en") ? "Execution handoff" : "执行交接"}
              </p>
              <div className="mt-4 space-y-3">
                <button
                  type="button"
                  disabled={!hasEnoughTargets || comparePending || pending}
                  onClick={onRunCompare}
                  className="w-full rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-left text-sm text-cyan-100 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="block font-medium">{comparePending ? copy.runningCompare : copy.runCompare}</span>
                  <span className="mt-1 block text-xs leading-6 text-cyan-100/80">
                    {hasEnoughTargets ? copy.fairnessFingerprint : copy.needMoreTargets}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!compareResult || benchmarkPending || comparePending}
                  onClick={onSendToBenchmark}
                  className="w-full rounded-2xl border border-violet-400/20 bg-violet-400/10 px-4 py-3 text-left text-sm text-violet-100 transition hover:bg-violet-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="block font-medium">{benchmarkPending ? copy.benchmarkPending : copy.benchmarkAction}</span>
                  <span className="mt-1 block text-xs leading-6 text-violet-100/80">{copy.benchmarkHint}</span>
                </button>
                <button
                  type="button"
                  disabled={!compareResult}
                  onClick={onExportMarkdown}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm text-slate-200 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="block font-medium">{copy.exportMarkdown}</span>
                  <span className="mt-1 block text-xs leading-6 text-slate-400">{compareResult ? copy.resultReviewHint : copy.noResults}</span>
                </button>
                {pending ? (
                  <p className="text-xs leading-6 text-cyan-200">
                    {locale.startsWith("en")
                      ? "A chat run is already in flight. Compare execution will reuse the same runtime guardrails."
                      : "当前已有聊天请求进行中。compare 会继续复用同一套运行时保护逻辑。"}
                  </p>
                ) : null}
                {compareError ? (
                  <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm leading-6 text-rose-100">
                    {compareError}
                  </div>
                ) : null}
                {benchmarkError ? (
                  <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm leading-6 text-rose-100">
                    {benchmarkError}
                  </div>
                ) : null}
                {compareResult?.warning ? (
                  <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-amber-50/80">{copy.compareWarning}</p>
                    <p className="mt-2">{compareResult.warning}</p>
                  </div>
                ) : null}
                {compareResult?.results.some((lane) => !lane.ok) ? (
                  <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
                    {copy.partialRun}
                  </div>
                ) : null}
                {benchmarkResult?.runId ? (
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm leading-6 text-emerald-100">
                    <p className="font-medium">{copy.benchmarkSuccess}</p>
                    <p className="mt-1 text-xs text-emerald-100/90">runId: {benchmarkResult.runId}</p>
                    <a href="/admin" className="mt-2 inline-flex text-xs font-semibold text-emerald-50 underline underline-offset-4">
                      {copy.benchmarkOpen}
                    </a>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{copy.resultReview}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{copy.resultReviewHint}</p>
                </div>
                {compareResult ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-right">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{copy.latestRun}</p>
                    <p className="mt-1 text-xs text-white">{new Date(compareResult.generatedAt).toLocaleString()}</p>
                  </div>
                ) : null}
              </div>

              {!compareResult ? (
                <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-4 text-sm leading-6 text-slate-400">
                  {copy.noResults}
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  {baseResult ? (
                    <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{copy.baseLane}</p>
                      <p className="mt-2 text-sm font-medium text-white">
                        {baseResult.targetLabel} · {baseResult.resolvedModel}
                      </p>
                      <p className="mt-1 text-xs leading-6 text-slate-400">{compareResult.fairnessFingerprint}</p>
                    </div>
                  ) : null}

                  {reviewRows.map(({ lane, overlap, lengthDelta, schemaStatus, isBase }) => (
                    <article key={`${compareResult.runId}:${lane.targetId}`} className="rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-white">{lane.targetLabel}</p>
                            <span className={`rounded-full px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] ${
                              lane.ok ? "bg-emerald-400/10 text-emerald-200" : "bg-rose-400/10 text-rose-200"
                            }`}>
                              {lane.ok ? copy.laneOk : copy.laneFailed}
                            </span>
                            {isBase ? (
                              <span className="rounded-full bg-cyan-400/10 px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] text-cyan-100">
                                {copy.baseLaneTag}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 text-xs leading-6 text-slate-400">
                            {lane.providerLabel} · {lane.resolvedModel}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onRerunLane(lane.targetId)}
                            disabled={comparePending}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {copy.rerunLane}
                          </button>
                          <button
                            type="button"
                            onClick={() => onSetBaseLane(lane.targetId)}
                            disabled={isBase}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {copy.setBaseLane}
                          </button>
                          <button
                            type="button"
                            onClick={() => onCopy(lane.content || lane.warning || "", `compare:${lane.targetId}`)}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                          >
                            {copyState === `compare:${lane.targetId}` ? copy.copied : copy.copyOutput}
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 text-xs leading-6 text-slate-300 sm:grid-cols-2">
                        <p>{copy.actualContext}: {formatContextWindowLabel(lane.contextWindow)}</p>
                        <p>{copy.overlap}: {(overlap * 100).toFixed(0)}%</p>
                        <p>{copy.lengthDelta}: {lengthDelta >= 0 ? `+${lengthDelta}` : `${lengthDelta}`}</p>
                        <p>{copy.schema}: {schemaStatus}</p>
                      </div>

                      {lane.warning ? (
                        <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-3 text-xs leading-6 text-amber-100">
                          <span className="font-semibold">{copy.warning}: </span>
                          {lane.warning}
                        </div>
                      ) : null}

                      {lane.usage ? (
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                            {copy.usage}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                            {copy.promptTokens} {lane.usage.promptTokens}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                            {copy.completionTokens} {lane.usage.completionTokens}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                            {copy.totalTokens} {lane.usage.totalTokens}
                          </span>
                        </div>
                      ) : null}

                      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs leading-6 text-slate-200">
                        {lane.content || lane.warning || "—"}
                      </pre>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
