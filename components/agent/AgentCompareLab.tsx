"use client";

import { useMemo } from "react";
import { buildCompareBenchmarkPrompt, buildCompareBenchmarkPromptDiff } from "@/lib/agent/compare-share";
import type {
  AgentBenchmarkResponse,
  AgentCompareIntent,
  AgentCompareLaneProgress,
  AgentCompareLaneTimelineEntry,
  AgentCompareOutputShape,
  AgentCompareReviewSummaryDetail,
  AgentCompareReviewSummaryTone,
  AgentCompareResponse,
  AgentProviderProfile,
  AgentRuntimeStatus,
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
  compareReviewSummaryTone: AgentCompareReviewSummaryTone;
  compareReviewSummaryDetail: AgentCompareReviewSummaryDetail;
  compareRuntimeByTargetId: Record<string, AgentRuntimeStatus>;
  compareProgressByTargetId: Record<string, AgentCompareLaneProgress>;
  compareBenchmarkUseOutputContract: boolean;
  compareBenchmarkPreviewDiffOnly: boolean;
  compareRecoveryPendingTargetId: string;
  compareRecoveryConfirmTargetId: string;
  compareRecoveryCooldownByTargetId: Record<string, number>;
  compareRecoveryNotice: { tone: "info" | "success" | "warning"; message: string } | null;
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
  onCompareReviewSummaryToneChange: (value: AgentCompareReviewSummaryTone) => void;
  onCompareReviewSummaryDetailChange: (value: AgentCompareReviewSummaryDetail) => void;
  onSendToBenchmark: () => void;
  onExportMarkdown: () => void;
  onCompareBenchmarkUseOutputContractChange: (value: boolean) => void;
  onCompareBenchmarkPreviewDiffOnlyChange: (value: boolean) => void;
  onRetryLocalRecovery: (targetId: string) => void;
  onExportLaneMarkdown: (targetId: string) => void;
  onCopyMarkdown: () => void;
  onCopyLaneMarkdown: (targetId: string) => void;
  onCopyLaneReviewSummary: (targetId: string) => void;
  onPreviewLaneMarkdown: (targetId: string) => void;
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

function formatTimelineTime(locale: string, value: string) {
  try {
    return new Date(value).toLocaleTimeString(locale.startsWith("en") ? "en-US" : "zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return value;
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
  compareReviewSummaryTone,
  compareReviewSummaryDetail,
  compareRuntimeByTargetId,
  compareProgressByTargetId,
  compareBenchmarkUseOutputContract,
  compareBenchmarkPreviewDiffOnly,
  compareRecoveryPendingTargetId,
  compareRecoveryConfirmTargetId,
  compareRecoveryCooldownByTargetId,
  compareRecoveryNotice,
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
  onCompareReviewSummaryToneChange,
  onCompareReviewSummaryDetailChange,
  onSendToBenchmark,
  onExportMarkdown,
  onCompareBenchmarkUseOutputContractChange,
  onCompareBenchmarkPreviewDiffOnlyChange,
  onRetryLocalRecovery,
  onExportLaneMarkdown,
  onCopyMarkdown,
  onCopyLaneMarkdown,
  onCopyLaneReviewSummary,
  onPreviewLaneMarkdown,
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
        benchmarkContractToggle: "Preserve compare output contract in handoff",
        benchmarkContractHint: "Carry over bullet-list or strict JSON instructions when you convert this compare run into a prompt benchmark.",
        benchmarkPromptPreview: "Benchmark prompt preview",
        benchmarkPromptPreviewHint: "This read-only prompt is the exact payload that compare handoff will send to /api/admin/benchmark.",
        benchmarkPromptDiffOnly: "Show diff only",
        benchmarkPromptCopy: "Copy preview",
        benchmarkSuccess: "Benchmark handoff ready",
        benchmarkOpen: "Open /admin and track this run",
        benchmarkRunNoteAttached: "Compare compact markdown was attached to this benchmark run as a run note.",
        exportMarkdown: "Export markdown",
        copyMarkdown: "Copy issue / PR markdown",
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
        reviewSummaryTone: "Comment tone",
        reviewSummaryToneHint: "Choose the voice you want when copying a short review summary.",
        reviewSummaryToneIssue: "Issue",
        reviewSummaryTonePr: "PR",
        reviewSummaryToneChat: "Chat",
        reviewSummaryDetail: "Summary depth",
        reviewSummaryDetailHint: "Use longer templates when you want a stricter review note or a friendlier status update.",
        reviewSummaryDetailCompact: "Compact",
        reviewSummaryDetailStrict: "Strict review",
        reviewSummaryDetailFriendly: "Friendly report",
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
        schemaUnavailable: "Not JSON",
        compareRuntimePhase: "Compare runtime",
        compareLoadingFor: "Loading for",
        compareRecoveryBudget: "Recovery budget",
        compareLatestRecovery: "Latest recovery",
        compareAwaitingRecovery: "Compare will trigger one local recovery if this lane stays stalled.",
        compareRecoveryTimeline: "Recovery timeline",
        compareNoTimeline: "Timeline entries will appear here once compare records loading or recovery milestones.",
        compareManualRecovery: "Retry local recovery",
        compareManualRecoveryPending: "Retrying local recovery...",
        compareManualRecoveryConfirm: "Click again to confirm",
        compareManualRecoveryConfirmHint: "Click once more within 5 seconds to restart the local gateway from Compare.",
        compareManualRecoveryCooldown: "Recovery cooldown",
        compareManualRecoveryCooldownHint: "A short cooldown is active so we do not spam local restarts.",
        exportLane: "Export lane",
        copyLaneMarkdown: "Copy markdown",
        copyLaneReviewSummary: "Copy review summary",
        previewLane: "Open preview"
      }
    : {
        title: "Compare Lab",
        subtitle: "",
        targets: "对比目标",
        targetsHint: `固定当前目标，再额外加入最多 ${MAX_COMPARE_LANES - 1} 条 lane。`,
        recipe: "对比方案",
        outputShape: "输出形态",
        lockedControls: "锁定控制项",
        lockedControlsHint: "",
        promptFrame: "提示词框架",
        promptInput: "任务提示词",
        systemFrame: "系统提示词",
        lanePreview: "对比 lane 预览",
        lanePreviewHint: "",
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
        benchmarkContractToggle: "handoff 时沿用 compare 输出契约",
        benchmarkContractHint: "把 bullet-list 或 strict JSON 的输出约束一并带到 prompt benchmark 里。",
        benchmarkPromptPreview: "benchmark prompt 预览",
        benchmarkPromptPreviewHint: "这里展示的只读 prompt，就是 compare handoff 真正会送到 /api/admin/benchmark 的内容。",
        benchmarkPromptDiffOnly: "只看差异",
        benchmarkPromptCopy: "复制预览",
        benchmarkSuccess: "benchmark 已接收",
        benchmarkOpen: "去 /admin 跟踪这轮运行",
        benchmarkRunNoteAttached: "这轮 benchmark 已自动附带 compare 的紧凑 Markdown run note。",
        exportMarkdown: "导出 Markdown",
        copyMarkdown: "复制 issue / PR Markdown",
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
        reviewSummaryTone: "评论语气",
        reviewSummaryToneHint: "复制评论摘要前，先选 issue / PR / chat 的表达方式。",
        reviewSummaryToneIssue: "Issue",
        reviewSummaryTonePr: "PR",
        reviewSummaryToneChat: "Chat",
        reviewSummaryDetail: "摘要长度",
        reviewSummaryDetailHint: "需要更正式的评审或更柔和的汇报时，可以切换到更长的模板。",
        reviewSummaryDetailCompact: "紧凑",
        reviewSummaryDetailStrict: "严格审阅",
        reviewSummaryDetailFriendly: "友好汇报",
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
        schemaUnavailable: "非 JSON",
        compareRuntimePhase: "Compare 运行态",
        compareLoadingFor: "加载时长",
        compareRecoveryBudget: "恢复预算",
        compareLatestRecovery: "最近恢复动作",
        compareAwaitingRecovery: "如果这条 lane 继续卡住，compare 会触发一次本地恢复。",
        compareRecoveryTimeline: "恢复动作时间线",
        compareNoTimeline: "当 compare 记录到加载、恢复或完成节点后，这里会显示可读历史。",
        compareManualRecovery: "手动重试本地恢复",
        compareManualRecoveryPending: "正在手动重试本地恢复...",
        compareManualRecoveryConfirm: "再次点击确认",
        compareManualRecoveryConfirmHint: "请在 5 秒内再次点击，Compare 才会真正重启本地网关。",
        compareManualRecoveryCooldown: "恢复冷却中",
        compareManualRecoveryCooldownHint: "为了避免连续误触，本地恢复会有一个很短的冷却时间。",
        exportLane: "导出此 lane",
        copyLaneMarkdown: "复制 Markdown",
        copyLaneReviewSummary: "复制评论摘要",
        previewLane: "新标签页预览"
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

  const compareBenchmarkPromptPreview = useMemo(
    () =>
      buildCompareBenchmarkPrompt({
        input,
        systemPrompt,
        compareOutputShape,
        compareBenchmarkUseOutputContract
      }),
    [compareBenchmarkUseOutputContract, compareOutputShape, input, systemPrompt]
  );

  const compareBenchmarkPromptDiffPreview = useMemo(
    () =>
      buildCompareBenchmarkPromptDiff({
        input,
        systemPrompt,
        compareOutputShape,
        compareBenchmarkUseOutputContract
      }),
    [compareBenchmarkUseOutputContract, compareOutputShape, input, systemPrompt]
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
  const primaryReviewRow = reviewRows.find((row) => row.isBase) || reviewRows[0] || null;
  const secondaryReviewRows = reviewRows.filter((row) => !row.isBase);
  const reviewLayoutCopy = locale.startsWith("en")
    ? {
        primaryResult: "Primary result",
        secondaryDiffs: "Secondary diff drawers",
        secondaryDiffsHint: "Keep the base lane in full view, then open only the diffs you want to inspect.",
        openDrawer: "Open diff drawer",
        drawerNotes: "Expanded diff"
      }
    : {
        primaryResult: "主结果",
        secondaryDiffs: "次级 diff 抽屉",
        secondaryDiffsHint: "让基准 lane 保持完整可读，只按需展开其它 lane 的差异细节。",
        openDrawer: "展开 diff 抽屉",
        drawerNotes: "展开后细节"
      };

  return (
    <div className="h-[58vh] min-h-[420px] max-h-[76vh] overflow-y-auto bg-[linear-gradient(180deg,rgba(15,23,42,0.18),rgba(2,6,23,0.12))] sm:h-[62vh]">
      <div className="space-y-5 px-5 py-5">
        <section className="rounded-[28px] border border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_36%),linear-gradient(135deg,rgba(15,23,42,0.85),rgba(2,6,23,0.92))] p-5 shadow-[0_30px_70px_rgba(2,6,23,0.35)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-200/80">/agent · compare</p>
              <h3 className="mt-3 text-2xl font-semibold text-white">{copy.title}</h3>
              {copy.subtitle ? (
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">{copy.subtitle}</p>
              ) : null}
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">{copy.fairnessFingerprint}</p>
              <p className="mt-2 text-sm font-medium text-white">{fairnessFingerprint}</p>
            </div>
          </div>
          {compareRecoveryNotice ? (
            <div
              className={`mt-4 rounded-2xl border px-4 py-3 text-sm leading-6 ${
                compareRecoveryNotice.tone === "success"
                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                  : compareRecoveryNotice.tone === "warning"
                    ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
                    : "border-cyan-400/20 bg-cyan-400/10 text-cyan-100"
              }`}
            >
              {compareRecoveryNotice.message}
            </div>
          ) : null}
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(360px,0.82fr)] 2xl:grid-cols-[minmax(0,1.34fr)_minmax(420px,0.8fr)]">
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
              <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
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

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                    {locale.startsWith("en") ? "Compare composer" : "对比编排"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-slate-200">
                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5">
                    {Object.entries(COMPARE_INTENT_META).find(([intent]) => intent === compareIntent)?.[1][locale.startsWith("en") ? "en" : "zh"].label}
                  </span>
                  <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1.5">
                    {Object.entries(OUTPUT_SHAPE_META).find(([shape]) => shape === compareOutputShape)?.[1][locale.startsWith("en") ? "en" : "zh"].label}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    {formatContextWindowLabel(contextWindow)}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    {formatProviderProfile(locale, providerProfile)}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    {formatThinkingMode(locale, thinkingMode)}
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
                  <div className="space-y-4">
                    <section className="rounded-3xl border border-white/10 bg-black/20 p-4">
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
                                  : "border-white/10 bg-slate-950/70 hover:border-white/20 hover:bg-white/[0.05]"
                              }`}
                            >
                              <p className="text-sm font-medium text-white">{labelSet.label}</p>
                              <p className="mt-1 text-xs leading-6 text-slate-400">{labelSet.description}</p>
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    <section className="rounded-3xl border border-white/10 bg-black/20 p-4">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{copy.outputShape}</p>
                      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
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
                                  : "border-white/10 bg-slate-950/70 hover:border-white/20 hover:bg-white/[0.05]"
                              } h-full`}
                            >
                              <p className="text-sm font-medium text-white">{labelSet.label}</p>
                              <p className="mt-1 text-xs leading-6 text-slate-400">{labelSet.description}</p>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  </div>

                  <section className="rounded-3xl border border-white/10 bg-black/20 p-4">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{copy.promptFrame}</p>
                    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
                      <div className="min-w-0">
                        <label className="text-xs uppercase tracking-[0.18em] text-slate-500">{copy.promptInput}</label>
                        <textarea
                          value={input}
                          onChange={(event) => onInputChange(event.target.value)}
                          rows={8}
                          className="mt-2 min-h-[180px] w-full resize-y rounded-3xl border border-white/10 bg-black/25 px-4 py-4 font-mono text-sm leading-7 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/40 focus:bg-black/35"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="text-xs uppercase tracking-[0.18em] text-slate-500">{copy.systemFrame}</label>
                        <textarea
                          value={systemPrompt}
                          onChange={(event) => onSystemPromptChange(event.target.value)}
                          rows={11}
                          className="mt-2 w-full rounded-3xl border border-white/10 bg-slate-950/80 px-4 py-4 font-mono text-xs leading-6 text-slate-200 outline-none transition focus:border-cyan-400/40"
                        />
                      </div>
                    </div>
                  </section>
                </div>

                <section className="rounded-3xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{copy.lockedControls}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onEnableToolsChange(!enableTools)}
                        className={`rounded-full border px-3 py-1.5 text-[11px] transition ${
                          enableTools ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.04] text-slate-300"
                        }`}
                      >
                        {copy.tools}: {enableTools ? copy.on : copy.off}
                      </button>
                      <button
                        type="button"
                        onClick={() => onEnableRetrievalChange(!enableRetrieval)}
                        className={`rounded-full border px-3 py-1.5 text-[11px] transition ${
                          enableRetrieval ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/[0.04] text-slate-300"
                        }`}
                      >
                        {copy.retrieval}: {enableRetrieval ? copy.on : copy.off}
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <label className="space-y-2 rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3">
                      <span className="text-[11px] font-medium text-slate-400">
                        {locale.startsWith("en") ? "Context" : "上下文"}
                      </span>
                      <select
                        value={contextWindow}
                        onChange={(event) => onContextWindowChange(Number(event.target.value))}
                        className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none"
                      >
                        {contextWindowOptions.map((value) => (
                          <option key={value} value={value}>
                            {formatContextWindowLabel(value)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2 rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3">
                      <span className="text-[11px] font-medium text-slate-400">
                        {locale.startsWith("en") ? "Profile" : "档位"}
                      </span>
                      <select
                        value={providerProfile}
                        onChange={(event) => onProviderProfileChange(event.target.value as AgentProviderProfile)}
                        className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none"
                      >
                        {providerProfileOptions.map((value) => (
                          <option key={value} value={value}>
                            {formatProviderProfile(locale, value)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2 rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3">
                      <span className="text-[11px] font-medium text-slate-400">
                        {locale.startsWith("en") ? "Thinking" : "思考"}
                      </span>
                      <select
                        value={thinkingMode}
                        onChange={(event) => onThinkingModeChange(event.target.value as AgentThinkingMode)}
                        className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none"
                      >
                        {thinkingModeOptions.map((value) => (
                          <option key={value} value={value}>
                            {formatThinkingMode(locale, value)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>
              </div>
            </section>
          </div>

          <div className="space-y-5">
            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{copy.lanePreview}</p>
              {copy.lanePreviewHint ? (
                <p className="mt-2 text-sm leading-6 text-slate-400">{copy.lanePreviewHint}</p>
              ) : null}
              {!hasEnoughTargets ? (
                <div className="mt-4 rounded-2xl border border-dashed border-amber-300/20 bg-amber-300/10 px-4 py-4 text-sm leading-6 text-amber-100">
                  {copy.needMoreTargets}
                </div>
              ) : null}
              <div className="mt-4 grid gap-3 2xl:grid-cols-2">
                {compareTargets.map((target) => {
                  const runtime = compareRuntimeByTargetId[target.id];
                  const compareProgress = compareProgressByTargetId[target.id];
                  const compareTimeline = compareProgress?.timeline || [];
                  const loadingSeconds =
                    typeof runtime?.loadingElapsedMs === "number"
                      ? Math.round(runtime.loadingElapsedMs / 1000)
                      : null;
                  const compareLoadingSeconds =
                    typeof compareProgress?.loadingElapsedMs === "number"
                      ? Math.max(1, Math.round(compareProgress.loadingElapsedMs / 1000))
                      : null;
                  const compareRecoveryBudgetSeconds =
                    typeof compareProgress?.recoveryThresholdMs === "number"
                      ? Math.max(1, Math.round(compareProgress.recoveryThresholdMs / 1000))
                      : null;
                  const recoveryConfirmPending = compareRecoveryConfirmTargetId === target.id;
                  const recoveryCoolingDown = (compareRecoveryCooldownByTargetId[target.id] || 0) > Date.now();
                  return (
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
                      {runtime ? (
                        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs leading-6 text-slate-300">
                          <p className="font-medium text-slate-100">
                            {runtime.phaseDetail || runtime.phase || "runtime"}
                          </p>
                          {loadingSeconds !== null ? (
                            <p className="text-slate-400">
                              {locale.startsWith("en") ? "Loading for" : "加载中"} {loadingSeconds}s
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {compareProgress ? (
                        <div className="mt-3 rounded-xl border border-cyan-400/15 bg-cyan-400/5 px-3 py-3 text-xs leading-6 text-cyan-50">
                          <p className="font-medium text-cyan-100">{copy.compareRuntimePhase}</p>
                          <p className="mt-1 text-cyan-50/90">{compareProgress.detail}</p>
                          <div className="mt-2 grid gap-1 text-cyan-100/80">
                            {compareLoadingSeconds !== null ? (
                              <p>
                                {copy.compareLoadingFor}: {compareLoadingSeconds}s
                              </p>
                            ) : null}
                            {compareRecoveryBudgetSeconds !== null ? (
                              <p>
                                {copy.compareRecoveryBudget}: {compareRecoveryBudgetSeconds}s
                              </p>
                            ) : null}
                            {compareProgress.recoveryAction ? (
                              <p>
                                {copy.compareLatestRecovery}: {compareProgress.recoveryAction}
                              </p>
                            ) : compareProgress.phase === "loading" ? (
                              <p>{copy.compareAwaitingRecovery}</p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {target.execution === "local" ? (
                        <div className="mt-3 space-y-2">
                          <button
                            type="button"
                            onClick={() => onRetryLocalRecovery(target.id)}
                            disabled={compareRecoveryPendingTargetId === target.id || benchmarkPending || recoveryCoolingDown}
                            className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                              recoveryConfirmPending
                                ? "border-amber-300/30 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15"
                                : "border-cyan-400/20 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15"
                            }`}
                          >
                            {compareRecoveryPendingTargetId === target.id
                              ? copy.compareManualRecoveryPending
                              : recoveryCoolingDown
                                ? copy.compareManualRecoveryCooldown
                                : recoveryConfirmPending
                                  ? copy.compareManualRecoveryConfirm
                                  : copy.compareManualRecovery}
                          </button>
                          {recoveryConfirmPending ? (
                            <p className="text-[11px] leading-5 text-amber-100/80">{copy.compareManualRecoveryConfirmHint}</p>
                          ) : null}
                          {recoveryCoolingDown ? (
                            <p className="text-[11px] leading-5 text-slate-400">{copy.compareManualRecoveryCooldownHint}</p>
                          ) : null}
                        </div>
                      ) : null}
                      <details
                        className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs leading-6 text-slate-300"
                        open={Boolean(compareTimeline.length && compareProgress?.phase !== "completed")}
                      >
                        <summary className="cursor-pointer list-none font-medium text-slate-100">
                          <span className="inline-flex items-center gap-2">
                            <span>{copy.compareRecoveryTimeline}</span>
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-[2px] text-[10px] text-slate-400">
                              {compareTimeline.length}
                            </span>
                          </span>
                        </summary>
                        {compareTimeline.length ? (
                          <div className="mt-2 max-h-40 space-y-2 overflow-auto pr-1">
                            {compareTimeline.map((entry: AgentCompareLaneTimelineEntry, index) => (
                              <div key={`${target.id}:${entry.at}:${index}`} className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                                  {formatTimelineTime(locale, entry.at)} · {entry.phase}
                                </p>
                                <p className="mt-1 text-slate-200">{entry.detail}</p>
                                {typeof entry.recoveryTriggerElapsedMs === "number" ? (
                                  <p className="mt-1 text-slate-400">
                                    {copy.compareLoadingFor}: {Math.max(1, Math.round(entry.recoveryTriggerElapsedMs / 1000))}s
                                  </p>
                                ) : null}
                                {entry.recoveryAction ? (
                                  <p className="mt-1 text-slate-400">{entry.recoveryAction}</p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-slate-400">{copy.compareNoTimeline}</p>
                        )}
                      </details>
                      <details className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs leading-6 text-slate-300">
                        <summary className="cursor-pointer list-none font-medium text-slate-100">
                          {locale.startsWith("en") ? "Lane notes" : "Lane 备注"}
                        </summary>
                        <div className="mt-2 grid gap-2">
                          <p>{copy.recommendedContext}: {target.recommendedContext}</p>
                          <p>{target.notes[0] || target.description}</p>
                        </div>
                      </details>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                {locale.startsWith("en") ? "Execution handoff" : "执行交接"}
              </p>
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
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
                </div>
                <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={compareBenchmarkUseOutputContract}
                    onChange={(event) => onCompareBenchmarkUseOutputContractChange(event.target.checked)}
                    className="mt-1 rounded border-white/20 bg-slate-950"
                  />
                  <span>
                    <span className="block font-medium">{copy.benchmarkContractToggle}</span>
                    <span className="mt-1 block text-xs leading-6 text-slate-400">{copy.benchmarkContractHint}</span>
                  </span>
                </label>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{copy.benchmarkPromptPreview}</p>
                      <p className="mt-2 text-xs leading-6 text-slate-400">{copy.benchmarkPromptPreviewHint}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-slate-200">
                        <input
                          type="checkbox"
                          checked={compareBenchmarkPreviewDiffOnly}
                          onChange={(event) => onCompareBenchmarkPreviewDiffOnlyChange(event.target.checked)}
                          className="rounded border-white/20 bg-slate-950"
                        />
                        {copy.benchmarkPromptDiffOnly}
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          onCopy(
                            compareBenchmarkPreviewDiffOnly
                              ? compareBenchmarkPromptDiffPreview
                              : compareBenchmarkPromptPreview,
                            "compare:benchmark-prompt"
                          )
                        }
                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                      >
                        {copyState === "compare:benchmark-prompt" ? copy.copied : copy.benchmarkPromptCopy}
                      </button>
                    </div>
                  </div>
                  <textarea
                    readOnly
                    value={compareBenchmarkPreviewDiffOnly ? compareBenchmarkPromptDiffPreview : compareBenchmarkPromptPreview}
                    rows={7}
                    className="mt-3 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/90 px-4 py-3 font-mono text-xs leading-6 text-slate-200 outline-none"
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    disabled={!compareResult}
                    onClick={onExportMarkdown}
                    className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm text-slate-200 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="block font-medium">{copy.exportMarkdown}</span>
                    <span className="mt-1 block text-xs leading-6 text-slate-400">{compareResult ? copy.resultReviewHint : copy.noResults}</span>
                  </button>
                  <button
                    type="button"
                    disabled={!compareResult}
                    onClick={onCopyMarkdown}
                    className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm text-slate-200 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="block font-medium">{copyState === "compare:markdown" ? copy.copied : copy.copyMarkdown}</span>
                    <span className="mt-1 block text-xs leading-6 text-slate-400">{compareResult ? copy.resultReviewHint : copy.noResults}</span>
                  </button>
                </div>
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
                    {benchmarkResult.runNote ? (
                      <p className="mt-2 text-xs leading-6 text-emerald-100/85">{copy.benchmarkRunNoteAttached}</p>
                    ) : null}
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
                <div className="flex flex-wrap items-start gap-3">
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{copy.reviewSummaryTone}</p>
                    <p className="mt-1 text-[11px] leading-5 text-slate-400">{copy.reviewSummaryToneHint}</p>
                    <div className="mt-2 inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
                      {([
                        ["issue", copy.reviewSummaryToneIssue],
                        ["pr", copy.reviewSummaryTonePr],
                        ["chat", copy.reviewSummaryToneChat]
                      ] as Array<[AgentCompareReviewSummaryTone, string]>).map(([tone, label]) => (
                        <button
                          key={tone}
                          type="button"
                          onClick={() => onCompareReviewSummaryToneChange(tone)}
                          className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                            compareReviewSummaryTone === tone
                              ? "bg-cyan-400/15 text-cyan-50"
                              : "text-slate-300 hover:bg-white/[0.06]"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{copy.reviewSummaryDetail}</p>
                    <p className="mt-1 text-[11px] leading-5 text-slate-400">{copy.reviewSummaryDetailHint}</p>
                    <div className="mt-2 inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
                      {([
                        ["compact", copy.reviewSummaryDetailCompact],
                        ["strict-review", copy.reviewSummaryDetailStrict],
                        ["friendly-report", copy.reviewSummaryDetailFriendly]
                      ] as Array<[AgentCompareReviewSummaryDetail, string]>).map(([detail, label]) => (
                        <button
                          key={detail}
                          type="button"
                          onClick={() => onCompareReviewSummaryDetailChange(detail)}
                          className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                            compareReviewSummaryDetail === detail
                              ? "bg-violet-400/15 text-violet-50"
                              : "text-slate-300 hover:bg-white/[0.06]"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {compareResult ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-right">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{copy.latestRun}</p>
                      <p className="mt-1 text-xs text-white">{new Date(compareResult.generatedAt).toLocaleString()}</p>
                    </div>
                  ) : null}
                </div>
              </div>

              {!compareResult ? (
                <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-4 text-sm leading-6 text-slate-400">
                  {copy.noResults}
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  {primaryReviewRow ? (
                    <article className="rounded-[26px] border border-cyan-400/15 bg-[linear-gradient(135deg,rgba(15,23,42,0.92),rgba(2,6,23,0.88))] px-4 py-4 shadow-[0_24px_70px_rgba(2,6,23,0.35)]">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">{reviewLayoutCopy.primaryResult}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-white">{primaryReviewRow.lane.targetLabel}</p>
                            <span className="rounded-full bg-cyan-400/10 px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] text-cyan-100">
                              {copy.baseLaneTag}
                            </span>
                            <span className={`rounded-full px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] ${
                              primaryReviewRow.lane.ok ? "bg-emerald-400/10 text-emerald-200" : "bg-rose-400/10 text-rose-200"
                            }`}>
                              {primaryReviewRow.lane.ok ? copy.laneOk : copy.laneFailed}
                            </span>
                          </div>
                          <p className="mt-2 text-xs leading-6 text-slate-400">
                            {primaryReviewRow.lane.providerLabel} · {primaryReviewRow.lane.resolvedModel}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onRerunLane(primaryReviewRow.lane.targetId)}
                            disabled={comparePending}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {copy.rerunLane}
                          </button>
                          <button
                            type="button"
                            onClick={() => onCopy(primaryReviewRow.lane.content || primaryReviewRow.lane.warning || "", `compare:${primaryReviewRow.lane.targetId}`)}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                          >
                            {copyState === `compare:${primaryReviewRow.lane.targetId}` ? copy.copied : copy.copyOutput}
                          </button>
                          <button
                            type="button"
                            onClick={() => onExportLaneMarkdown(primaryReviewRow.lane.targetId)}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                          >
                            {copy.exportLane}
                          </button>
                          <button
                            type="button"
                            onClick={() => onPreviewLaneMarkdown(primaryReviewRow.lane.targetId)}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                          >
                            {copy.previewLane}
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                        <pre className="min-h-[220px] max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-xs leading-6 text-slate-100">
                          {primaryReviewRow.lane.content || primaryReviewRow.lane.warning || "—"}
                        </pre>
                        <div className="space-y-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
                              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{copy.actualContext}</p>
                              <p className="mt-2 text-sm font-semibold text-white">{formatContextWindowLabel(primaryReviewRow.lane.contextWindow)}</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
                              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{locale.startsWith("en") ? "Latency" : "耗时"}</p>
                              <p className="mt-2 text-sm font-semibold text-white">{primaryReviewRow.lane.latencyMs.toFixed(1)} ms</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
                              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{copy.overlap}</p>
                              <p className="mt-2 text-sm font-semibold text-white">{(primaryReviewRow.overlap * 100).toFixed(0)}%</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
                              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{copy.schema}</p>
                              <p className="mt-2 text-sm font-semibold text-white">{primaryReviewRow.schemaStatus}</p>
                            </div>
                          </div>
                          {primaryReviewRow.lane.usage ? (
                            <div className="flex flex-wrap gap-2 text-[11px] text-slate-300">
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{copy.usage}</span>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                                {copy.promptTokens} {primaryReviewRow.lane.usage.promptTokens}
                              </span>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                                {copy.completionTokens} {primaryReviewRow.lane.usage.completionTokens}
                              </span>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                                {copy.totalTokens} {primaryReviewRow.lane.usage.totalTokens}
                              </span>
                            </div>
                          ) : null}
                          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{copy.fairnessFingerprint}</p>
                            <p className="mt-2 text-xs leading-6 text-slate-300">{compareResult.fairnessFingerprint}</p>
                          </div>
                          {primaryReviewRow.lane.warning ? (
                            <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-3 text-xs leading-6 text-amber-100">
                              <span className="font-semibold">{copy.warning}: </span>
                              {primaryReviewRow.lane.warning}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ) : null}

                  {secondaryReviewRows.length ? (
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{reviewLayoutCopy.secondaryDiffs}</p>
                          <p className="mt-2 text-sm leading-6 text-slate-400">{reviewLayoutCopy.secondaryDiffsHint}</p>
                        </div>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-slate-300">
                          {secondaryReviewRows.length}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-3 xl:grid-cols-2">
                        {secondaryReviewRows.map(({ lane, overlap, lengthDelta, schemaStatus }) => (
                          <details
                            key={`${compareResult.runId}:${lane.targetId}`}
                            className="rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-4"
                          >
                            <summary className="cursor-pointer list-none">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-medium text-white">{lane.targetLabel}</p>
                                    <span className={`rounded-full px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] ${
                                      lane.ok ? "bg-emerald-400/10 text-emerald-200" : "bg-rose-400/10 text-rose-200"
                                    }`}>
                                      {lane.ok ? copy.laneOk : copy.laneFailed}
                                    </span>
                                  </div>
                                  <p className="mt-2 text-xs leading-6 text-slate-400">
                                    {lane.providerLabel} · {lane.resolvedModel}
                                  </p>
                                </div>
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-slate-200">
                                  {reviewLayoutCopy.openDrawer}
                                </span>
                              </div>
                              <div className="mt-4 grid gap-2 text-xs leading-6 text-slate-300 sm:grid-cols-2">
                                <p>{copy.overlap}: {(overlap * 100).toFixed(0)}%</p>
                                <p>{copy.lengthDelta}: {lengthDelta >= 0 ? `+${lengthDelta}` : `${lengthDelta}`}</p>
                                <p>{copy.schema}: {schemaStatus}</p>
                                <p>{locale.startsWith("en") ? "Latency" : "耗时"}: {lane.latencyMs.toFixed(1)} ms</p>
                              </div>
                            </summary>

                            <div className="mt-4 border-t border-white/10 pt-4">
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
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
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
                                <button
                                  type="button"
                                  onClick={() => onExportLaneMarkdown(lane.targetId)}
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                                >
                                  {copy.exportLane}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onPreviewLaneMarkdown(lane.targetId)}
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                                >
                                  {copy.previewLane}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onCopyLaneMarkdown(lane.targetId)}
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                                >
                                  {copyState === `compare:lane-markdown:${lane.targetId}` ? copy.copied : copy.copyLaneMarkdown}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onCopyLaneReviewSummary(lane.targetId)}
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                                >
                                  {copyState === `compare:lane-summary:${lane.targetId}` ? copy.copied : copy.copyLaneReviewSummary}
                                </button>
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

                              <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">{reviewLayoutCopy.drawerNotes}</p>
                              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs leading-6 text-slate-200">
                                {lane.content || lane.warning || "—"}
                              </pre>
                            </div>
                          </details>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
