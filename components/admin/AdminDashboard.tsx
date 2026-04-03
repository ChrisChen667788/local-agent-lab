"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { agentTargets } from "@/lib/agent/catalog";
import {
  benchmarkDatasets,
  benchmarkMilestoneSuites
} from "@/lib/agent/benchmark-datasets";
import { useLocale } from "@/components/layout/LocaleProvider";
import type {
  AgentBenchmarkProgress,
  AgentBenchmarkPromptSet,
  AgentBenchmarkResponse,
  AgentKnowledgeDocument,
  AgentRetrievalSummary,
  AgentMetricPercentiles,
  AgentRuntimeActionResponse,
  AgentRuntimeLogSummary,
  AgentRuntimePrewarmAllResponse,
  AgentRuntimePrewarmResponse,
  AgentRuntimeStatus,
  AgentTarget
} from "@/lib/agent/types";

type MetricPercentiles = AgentMetricPercentiles;
type BenchmarkHeatmapMetricKey = "first-token" | "total-latency" | "throughput" | "success-rate";
type BenchmarkBatchScope = "full-suite" | "comparison-subset";
const KNOWLEDGE_IMPORT_HISTORY_KEY = "admin-knowledge-import-history-v1";
const RUNTIME_SWITCH_HISTORY_STORAGE_KEY = "local-agent-runtime-switch-history-v1";

type RuntimeSwitchHistoryEntry = {
  loadMs: number | null;
  switchedAt: string | null;
};

function formatTargetModelVersion(modelDefault: string, thinkingModelDefault?: string) {
  if (thinkingModelDefault && thinkingModelDefault !== modelDefault) {
    return `${modelDefault} · Thinking ${thinkingModelDefault}`;
  }
  return modelDefault;
}

function getDefaultBenchmarkTargetIds(targetIds: string[]) {
  const preferred = ["local-qwen3-0.6b", "local-qwen35-4b-4bit"].filter((id) => targetIds.includes(id));
  return preferred.length ? preferred : targetIds;
}

function splitRowsByExecution<T extends { execution?: "local" | "remote" }>(rows: T[]) {
  const local = rows.filter((row) => row.execution === "local");
  const remote = rows.filter((row) => row.execution !== "local");
  return { local, remote };
}

function buildExecutionSections<T extends { execution?: "local" | "remote" }>(
  rows: T[],
  labels: { local: string; remote: string }
) {
  const { local, remote } = splitRowsByExecution(rows);
  const sections: Array<{ execution: "local" | "remote"; label: string; rows: T[] }> = [];
  if (local.length) {
    sections.push({ execution: "local", label: labels.local, rows: local });
  }
  if (remote.length) {
    sections.push({ execution: "remote", label: labels.remote, rows: remote });
  }
  return sections;
}

type DashboardResponse = {
  generatedAt: string;
  target: {
    id: string;
    label: string;
    providerLabel: string;
    execution: "local" | "remote";
  };
  filters: {
    provider: string;
    providerProfile: string;
    benchmarkThinkingMode: string;
    benchmarkHeatmapPromptScope: string;
    benchmarkHeatmapSampleStatus: string;
    benchmarkHeatmapWindowMinutes: string;
    model: string;
    contextWindow: string;
  };
  availableModels: string[];
  availableProviders: string[];
  availableProviderProfiles: string[];
  availableBenchmarkThinkingModes: string[];
  availableContextWindows: number[];
  benchmarkTargetVersions: Array<{
    targetId: string;
    targetLabel: string;
    execution: "local" | "remote";
    standardResolvedModel: string;
    thinkingResolvedModel?: string | null;
  }>;
  benchmarkHistory: Array<{
    id: string;
    generatedAt: string;
    prompt: string;
    benchmarkMode?: "prompt" | "dataset" | "suite";
    profileBatchScope?: "full-suite" | "comparison-subset";
    promptSetId?: string;
    promptSetLabel?: string;
    promptSetPromptCount?: number;
    datasetId?: string;
    datasetLabel?: string;
    datasetSourceLabel?: string;
    datasetSourceUrl?: string;
    datasetSampleCount?: number;
    suiteId?: string;
    suiteLabel?: string;
    suiteWorkloadCount?: number;
    contextWindow: number;
    runs: number;
    providerProfile?: string;
    thinkingMode?: string;
    results: Array<{
      targetId: string;
      targetLabel: string;
      providerLabel?: string;
      execution?: "local" | "remote";
      resolvedModel: string;
      providerProfile?: string;
      thinkingMode?: string;
      avgFirstTokenLatencyMs: number;
      avgLatencyMs: number;
      avgTokenThroughputTps: number;
      avgScore?: number | null;
      passRate?: number | null;
      okRuns: number;
      runs: number;
      samples: Array<{
        firstTokenLatencyMs: number | null;
        latencyMs: number;
        completionTokens: number;
        tokenThroughputTps: number | null;
        ok: boolean;
        warning?: string | null;
        workloadId?: string | null;
        itemId?: string | null;
      }>;
    }>;
  }>;
  benchmarkTrends: Array<{
    targetId: string;
    targetLabel: string;
    providerProfile: string;
    thinkingMode: string;
    resolvedModel?: string;
    points: Array<{
      timestamp: string;
      contextWindow: number;
      avgFirstTokenLatencyMs: number;
      avgLatencyMs: number;
      avgTokenThroughputTps: number;
      successRate: number;
    }>;
  }>;
  benchmarkHeatmap: Array<{
    providerProfile: string;
    cells: Array<{
      thinkingMode: string;
      sampleCount: number;
      avgFirstTokenLatencyMs: number;
      avgLatencyMs: number;
      avgTokenThroughputTps: number;
      avgSuccessRate: number;
    }>;
  }>;
  comparison: Array<{
    targetId: string;
    targetLabel: string;
    providerLabel: string;
    execution: "local" | "remote";
    totalRequests: number;
    totalTokens: number;
    failedRequests: number;
    activeForTarget: number;
    latestCheckOk: boolean | null;
    avgLatencyMs: number;
    avgFirstTokenLatencyMs: number;
    avgTokenThroughputTps: number;
    firstTokenLatencyPercentiles: MetricPercentiles;
    totalLatencyPercentiles: MetricPercentiles;
    tokenThroughputPercentiles: MetricPercentiles;
  }>;
  windowMinutes: number;
  summary: {
    totalRequests: number;
    okRequests: number;
    failedRequests: number;
    activeRequests: number;
    activeForTarget: number;
    totalTokens: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    latestCheckOk: boolean | null;
    telemetryAvailable: boolean;
    avgLatencyMs: number;
    avgFirstTokenLatencyMs: number;
    avgTokenThroughputTps: number;
    latencyPercentiles: MetricPercentiles;
    firstTokenLatencyPercentiles: MetricPercentiles;
    tokenThroughputPercentiles: MetricPercentiles;
  };
  series: {
    requests: Array<{ timestamp: string; value: number }>;
    totalTokens: Array<{ timestamp: string; value: number }>;
    promptTokens: Array<{ timestamp: string; value: number }>;
    completionTokens: Array<{ timestamp: string; value: number }>;
    firstTokenLatency: Array<{ timestamp: string; value: number }>;
    totalLatency: Array<{ timestamp: string; value: number }>;
    appOverhead: Array<{ timestamp: string; value: number }>;
    tokenThroughput: Array<{ timestamp: string; value: number }>;
    checks: Array<{ timestamp: string; value: number }>;
    telemetry: Array<{
      timestamp: string;
      activeRequests: number;
      activeForTarget: number;
      queueDepth: number;
      memoryUsedPct: number | null;
      diskUsedPct: number | null;
      batteryPercent: number | null;
      gpuProxyPct: number | null;
      energyProxyPct: number | null;
    }>;
  };
  modelBreakdown: Array<{
    model: string;
    requests: number;
    totalTokens: number;
    errors: number;
    avgLatencyMs: number;
    avgFirstTokenLatencyMs: number;
    avgTokenThroughputTps: number;
    latencyPercentiles: MetricPercentiles;
    firstTokenLatencyPercentiles: MetricPercentiles;
    tokenThroughputPercentiles: MetricPercentiles;
  }>;
  contextWindowBreakdown: Array<{
    contextWindow: number | null;
    requests: number;
    totalTokens: number;
    avgLatencyMs: number;
    avgFirstTokenLatencyMs: number;
    avgTokenThroughputTps: number;
    latencyPercentiles: MetricPercentiles;
    firstTokenLatencyPercentiles: MetricPercentiles;
    tokenThroughputPercentiles: MetricPercentiles;
  }>;
  recentChats: Array<{
    id: string;
    completedAt: string;
    targetLabel: string;
    resolvedModel: string;
    contextWindow?: number;
    latencyMs: number;
    ok: boolean;
    usage: { totalTokens: number };
    warning?: string;
  }>;
  recentChecks: Array<{
    id: string;
    checkedAt: string;
    targetLabel: string;
    ok: boolean;
    stages: Array<{ id: string; ok: boolean }>;
  }>;
  latestTelemetry: {
    memoryTotalBytes?: number;
    memoryUsedBytes?: number;
    diskAvailableBytes?: number;
    batteryPercent?: number | null;
    onAcPower?: boolean | null;
    gpuProxyPct?: number | null;
    queueDepth?: number;
    runtimeBusy?: boolean;
  } | null;
  paths: {
    dataDir: string;
    chatLogFile: string;
    connectionCheckFile: string;
    telemetryFile: string;
    benchmarkFile: string;
    benchmarkBaselineFile?: string;
    benchmarkPromptSetFile?: string;
  };
};

type PromptSetRecord = AgentBenchmarkPromptSet;

type PromptSetEditorState = {
  id?: string;
  label: string;
  description: string;
  promptsText: string;
};

type PromptSetResponse = {
  promptSets: PromptSetRecord[];
};

type KnowledgeBaseResponse = {
  documents: AgentKnowledgeDocument[];
  chunks: Array<{
    id: string;
    documentId: string;
    title: string;
    source?: string;
    sectionPath: string[];
    order: number;
    content: string;
    charCount: number;
    tokenEstimate: number;
  }>;
  stats: {
    documentCount: number;
    chunkCount: number;
    avgChunkChars: number;
    avgChunkTokens: number;
  };
  workspaceRoot?: string;
  recommendedImportPaths?: string[];
};

type KnowledgeImportPreview = {
  path: string;
  kind: "file" | "directory" | "other";
  recursive: boolean;
  totalFiles: number;
  importableCount: number;
  skippedCount: number;
  previewFiles: string[];
  supportedExtensions?: string[];
};

type KnowledgeRecentPathEntry = {
  path: string;
  pinned: boolean;
};

type KnowledgeEditorState = {
  id?: string;
  title: string;
  source: string;
  tagsText: string;
  content: string;
};

type RuntimeActionKind = "refresh" | "prewarm" | "release" | "restart" | "read_log";

type BenchmarkBaselineRecord = AgentBenchmarkResponse & {
  id: string;
  savedAt: string;
  label?: string;
  isDefault?: boolean;
};

type BenchmarkBaselineResponse = {
  baseline: BenchmarkBaselineRecord | null;
  baselines?: BenchmarkBaselineRecord[];
};

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatBytes(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return `${value.toFixed(1)}%`;
}

function formatDurationShort(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  if (value < 1000) return `${Math.round(value)} ms`;
  const totalSeconds = Math.round(value / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function buildPolyline(values: number[]) {
  if (!values.length) return "";
  const max = Math.max(...values, 1);
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 100 - (value / max) * 100;
      return `${x},${y}`;
    })
    .join(" ");
}

function MetricCard({
  label,
  value
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

function SeriesCard({
  title,
  values,
  tone = "cyan"
}: {
  title: string;
  values: number[];
  tone?: "cyan" | "amber" | "emerald" | "violet";
}) {
  const strokeMap = {
    cyan: "#22d3ee",
    amber: "#f59e0b",
    emerald: "#34d399",
    violet: "#a78bfa"
  };
  const latest = values.length ? values[values.length - 1] : 0;

  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-300">{title}</p>
        <span className="text-sm font-semibold text-white">{formatCompactNumber(latest)}</span>
      </div>
      <div className="mt-4 h-28 rounded-2xl border border-white/10 bg-black/20 p-3">
        {values.length ? (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
            <polyline
              fill="none"
              stroke={strokeMap[tone]}
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={buildPolyline(values)}
            />
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">--</div>
        )}
      </div>
    </div>
  );
}

function MultiSeriesCard({
  title,
  lines
}: {
  title: string;
  lines: Array<{ label: string; values: number[]; tone: "cyan" | "amber" | "emerald" | "violet" }>;
}) {
  const strokeMap = {
    cyan: "#22d3ee",
    amber: "#f59e0b",
    emerald: "#34d399",
    violet: "#a78bfa"
  };
  const allValues = lines.flatMap((line) => line.values);
  const max = Math.max(...allValues, 1);

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3.5">
      <p className="text-xs font-medium text-slate-400">{title}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {lines.map((line) => (
          <span key={line.label} className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: strokeMap[line.tone] }} />
            {line.label}
          </span>
        ))}
      </div>
      <div className="mt-3 h-28 rounded-2xl border border-white/10 bg-black/20 p-2.5">
        {allValues.length ? (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
            {lines.map((line) => {
              if (!line.values.length) return null;
              const points = line.values
                .map((value, index) => {
                  const x = (index / Math.max(line.values.length - 1, 1)) * 100;
                  const y = 100 - (value / max) * 100;
                  return `${x},${y}`;
                })
                .join(" ");
              return (
                <polyline
                  key={line.label}
                  fill="none"
                  stroke={strokeMap[line.tone]}
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={points}
                />
              );
            })}
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">--</div>
        )}
      </div>
    </div>
  );
}

function PercentileRow({
  label,
  metrics,
  unit,
  disabled = false
}: {
  label: string;
  metrics: MetricPercentiles;
  unit?: string;
  disabled?: boolean;
}) {
  const suffix = unit ? ` ${unit}` : "";
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm text-slate-200">
        <span>P50 {disabled ? "--" : `${metrics.p50.toFixed(2)}${suffix}`}</span>
        <span>P95 {disabled ? "--" : `${metrics.p95.toFixed(2)}${suffix}`}</span>
        <span>P99 {disabled ? "--" : `${metrics.p99.toFixed(2)}${suffix}`}</span>
      </div>
    </div>
  );
}

function hasSuccessfulBenchmarkMetrics(row: { okRuns: number }) {
  return row.okRuns > 0;
}

function formatBenchmarkMetric(value: number, success: boolean, digits: number, suffix = "") {
  return success ? `${value.toFixed(digits)}${suffix}` : "--";
}

function buildHeatmapCellClass(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || max <= min) {
    return "bg-white/5";
  }
  const ratio = Math.max(0, Math.min(1, (value - min) / Math.max(max - min, 1)));
  if (ratio >= 0.75) return "bg-rose-500/25";
  if (ratio >= 0.5) return "bg-amber-500/20";
  if (ratio >= 0.25) return "bg-cyan-500/15";
  return "bg-emerald-500/15";
}

function buildDirectionalHeatmapCellClass(value: number, min: number, max: number, higherIsBetter: boolean) {
  if (!Number.isFinite(value) || max <= min) {
    return "bg-white/5";
  }
  return buildHeatmapCellClass(higherIsBetter ? max - value + min : value, min, max);
}

function getHeatmapRecommendation(providerProfile: string, thinkingMode: string, hasSamples: boolean, locale: string) {
  if (!hasSamples) {
    return locale.startsWith("en") ? "No samples yet. Run this combination first." : "暂无样本，先跑一次该组合再比较。";
  }

  const key = `${providerProfile}:${thinkingMode}`;
  const zhMap: Record<string, string> = {
    "speed:standard": "推荐短答、低等待成本场景，优先看首字体验。",
    "speed:thinking": "推荐少量试验型深想任务，先观察样本再决定是否长期使用。",
    "balanced:standard": "推荐默认主工作流，适合日常稳定对比。",
    "balanced:thinking": "推荐复杂问答与较长推理，兼顾稳定与质量。",
    "tool-first:standard": "推荐工具调用、仓库问答、函数调用型任务。",
    "tool-first:thinking": "推荐复杂多步任务，适合工具 + 深度推理。"
  };
  const enMap: Record<string, string> = {
    "speed:standard": "Best for short replies and fast first-token checks.",
    "speed:thinking": "Use sparingly for exploratory deep-thinking runs.",
    "balanced:standard": "Best default for day-to-day stable workloads.",
    "balanced:thinking": "Best for more complex reasoning with stable quality.",
    "tool-first:standard": "Best for tool use, repo QA, and function calling.",
    "tool-first:thinking": "Best for multi-step tasks with tools and deep reasoning."
  };

  return (locale.startsWith("en") ? enMap : zhMap)[key] || (locale.startsWith("en") ? "General-purpose benchmark mode." : "通用 benchmark 策略组合。");
}

function classifyBenchmarkFailure(warning?: string) {
  const raw = (warning || "").trim();
  const normalized = raw.toLowerCase();
  if (!raw) {
    return {
      key: "unknown",
      label: "未知失败",
      detail: "没有记录到明确 warning。",
      operational: true
    };
  }
  if (normalized.includes("terminated")) {
    return {
      key: "terminated",
      label: "执行被终止",
      detail: "请求在执行过程中被终止，通常是长时间流式执行后连接被中断或超时。少量可接受，但如果这一类明显偏多，通常不算正常波动，说明执行链稳定性还需要继续加固。",
      operational: true
    };
  }
  if (normalized.includes("aborted")) {
    return {
      key: "aborted",
      label: "请求中止",
      detail: "请求被 AbortController 或上游连接中止，属于执行链中断型失败。少量出现通常算正常波动，但如果持续增长，说明 timeout 或中断策略需要复核。",
      operational: true
    };
  }
  if (normalized.includes("502 bad gateway")) {
    return {
      key: "bad-gateway",
      label: "上游网关 502",
      detail: "上游网关瞬时错误，属于远端服务或代理抖动。少量出现通常是正常远端波动，但连续增多说明上游或代理链路不稳定。",
      operational: true
    };
  }
  if (normalized.includes("fetch failed")) {
    return {
      key: "fetch-failed",
      label: "网络请求失败",
      detail: "网络或连接建立失败，通常不是模型能力问题。少量属于链路抖动，偏多则说明网络或代理环境需要排查。",
      operational: true
    };
  }
  return {
    key: raw,
    label: raw.length > 48 ? `${raw.slice(0, 48)}…` : raw,
    detail: raw,
    operational: false
  };
}

function summarizeBenchmarkFailures(
  results: Array<{
    targetLabel: string;
    providerProfile?: string | null;
    thinkingMode?: string | null;
    samples: Array<{
      ok: boolean;
      warning?: string | null;
      workloadId?: string | null;
      itemId?: string | null;
      latencyMs?: number | null;
    }>;
  }>,
  fallbackProfile?: string | null,
  fallbackThinkingMode?: string | null
) {
  const failedSamples = results.flatMap((result) =>
    result.samples
      .filter((sample) => !sample.ok)
      .map((sample) => ({
        targetLabel: result.targetLabel,
        providerProfile: result.providerProfile || fallbackProfile || "default",
        thinkingMode: result.thinkingMode || fallbackThinkingMode || "standard",
        workloadId: sample.workloadId || "--",
        itemId: sample.itemId || "--",
        latencyMs: sample.latencyMs,
        classified: classifyBenchmarkFailure(sample.warning || undefined)
      }))
  );
  if (!failedSamples.length) return null;
  const grouped = new Map<
    string,
    {
      label: string;
      detail: string;
      operational: boolean;
      count: number;
    }
  >();
  for (const sample of failedSamples) {
    const current = grouped.get(sample.classified.key) || {
      label: sample.classified.label,
      detail: sample.classified.detail,
      operational: sample.classified.operational,
      count: 0
    };
    current.count += 1;
    grouped.set(sample.classified.key, current);
  }
  const groups = [...grouped.values()].sort((a, b) => b.count - a.count);
  return {
    total: failedSamples.length,
    mostlyOperational:
      groups.filter((group) => group.operational).reduce((sum, group) => sum + group.count, 0) >= failedSamples.length * 0.7,
    groups,
    examples: failedSamples.slice(0, 6)
  };
}

function getFailureSummaryHeadline(
  summary: ReturnType<typeof summarizeBenchmarkFailures>,
  locale: string
) {
  if (!summary) return "";
  return locale.startsWith("en")
    ? `Failure summary · ${summary.total}`
    : `失败摘要 · ${summary.total}`;
}

function getFailureSummaryNarrative(
  summary: ReturnType<typeof summarizeBenchmarkFailures>,
  locale: string
) {
  if (!summary) return "";
  if (summary.mostlyOperational) {
    return locale.startsWith("en")
      ? "Current failed samples are mostly execution-chain or upstream fluctuations, and should not be read directly as model-quality regressions."
      : "当前 failed 主要属于执行链或上游波动，不应直接解读成模型质量退化。";
  }
  return locale.startsWith("en")
    ? "Current failed samples include execution-chain problems, and should be reviewed sample by sample before drawing model conclusions."
    : "当前 failed 混有执行链问题，得先逐样本复核，再判断是否真是模型退化。";
}

function summarizeBenchmarkFailureDistribution(
  results: Array<{
    targetLabel: string;
    providerProfile?: string | null;
    thinkingMode?: string | null;
    samples: Array<{
      ok: boolean;
      workloadId?: string | null;
      workloadLabel?: string | null;
      warning?: string | null;
    }>;
  }>,
  fallbackProfile?: string | null,
  fallbackThinkingMode?: string | null
) {
  const failedSamples = results.flatMap((result) =>
    result.samples
      .filter((sample) => !sample.ok)
      .map((sample) => ({
        targetLabel: result.targetLabel,
        profileLabel: `${result.providerProfile || fallbackProfile || "default"} · ${result.thinkingMode || fallbackThinkingMode || "standard"}`,
        workloadLabel: sample.workloadLabel || sample.workloadId || "--"
      }))
  );
  if (!failedSamples.length) return null;
  const summarize = (values: string[]) => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  };
  return {
    byTarget: summarize(failedSamples.map((sample) => sample.targetLabel)),
    byProfile: summarize(failedSamples.map((sample) => `${sample.targetLabel} · ${sample.profileLabel}`)),
    byWorkload: summarize(failedSamples.map((sample) => sample.workloadLabel)),
    byReason: summarize(
      results.flatMap((result) =>
        result.samples
          .filter((sample) => !sample.ok)
          .map((sample) => classifyBenchmarkFailure(sample.warning || undefined).label)
      )
    )
  };
}

function formatBenchmarkProgressStatus(status: AgentBenchmarkProgress["status"], locale: string) {
  switch (status) {
    case "pending":
      return locale.startsWith("en") ? "Pending" : "待执行";
    case "running":
      return locale.startsWith("en") ? "Running" : "执行中";
    case "completed":
      return locale.startsWith("en") ? "Completed" : "已完成";
    case "failed":
      return locale.startsWith("en") ? "Failed" : "失败";
    case "stopped":
      return locale.startsWith("en") ? "Stopped" : "已停止";
    case "abandoned":
      return locale.startsWith("en") ? "Abandoned" : "已放弃";
    default:
      return status;
  }
}

function formatBenchmarkQueueSectionTitle(
  kind: "active" | "pending" | "recent",
  locale: string
) {
  if (kind === "active") return locale.startsWith("en") ? "Active groups" : "当前执行队列";
  if (kind === "pending") return locale.startsWith("en") ? "Pending groups" : "待执行队列";
  return locale.startsWith("en") ? "Recently completed" : "最近完成";
}

function describeRuntimePhase(runtime: AgentRuntimeStatus | null, locale: string) {
  const phase = runtime?.phase || "offline";
  switch (phase) {
    case "remote":
      return {
        label: locale.startsWith("en") ? "Remote" : "远端",
        className: "border-violet-400/20 bg-violet-400/10 text-violet-100"
      };
    case "ready":
      return {
        label: locale.startsWith("en") ? "Ready" : "已就绪",
        className: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      };
    case "busy":
      return {
        label: locale.startsWith("en") ? "Busy" : "处理中",
        className: "border-amber-400/20 bg-amber-400/10 text-amber-100"
      };
    case "loading":
      return {
        label: locale.startsWith("en") ? "Loading" : "加载中",
        className: "border-amber-400/20 bg-amber-400/10 text-amber-100"
      };
    case "recovering":
      return {
        label: locale.startsWith("en") ? "Recovering" : "恢复中",
        className: "border-cyan-400/20 bg-cyan-400/10 text-cyan-100"
      };
    case "error":
      return {
        label: locale.startsWith("en") ? "Error" : "异常",
        className: "border-rose-400/20 bg-rose-400/10 text-rose-100"
      };
    default:
      return {
        label: locale.startsWith("en") ? "Offline" : "离线",
        className: "border-white/10 bg-white/5 text-slate-300"
      };
  }
}

function formatRuntimeDuration(ms: number | null | undefined) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function formatRuntimeTimestamp(timestamp: string | null | undefined, locale: string) {
  if (!timestamp) return "—";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(locale);
}

function describeRuntimeAlias(alias: string | null | undefined, targets: AgentTarget[]) {
  if (!alias) return "—";
  const matched = targets.find((target) => target.id === alias);
  return matched ? matched.label : alias;
}

function formatSignedNumber(value?: number | null, digits = 1, suffix = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  const fixed = value.toFixed(digits);
  return `${value > 0 ? "+" : ""}${fixed}${suffix}`;
}

function buildDeltaClass(value: number | null | undefined, preferLower: boolean) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "text-slate-400";
  if (Math.abs(value) < 0.01) return "text-slate-300";
  const improved = preferLower ? value < 0 : value > 0;
  return improved ? "text-emerald-300" : "text-rose-300";
}

export function AdminDashboard() {
  const { dictionary, locale } = useLocale();
  const benchmarkTargets = useMemo(() => agentTargets, []);
  const localTargets = useMemo(() => agentTargets.filter((target) => target.execution === "local"), []);
  const [promptSets, setPromptSets] = useState<PromptSetRecord[]>([]);
  const [promptSetsPending, setPromptSetsPending] = useState(false);
  const [promptSetMessage, setPromptSetMessage] = useState("");
  const [promptSetEditorMode, setPromptSetEditorMode] = useState<"create" | "edit">("create");
  const [promptSetEditor, setPromptSetEditor] = useState<PromptSetEditorState>({
    label: "",
    description: "",
    promptsText: ""
  });
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<AgentKnowledgeDocument[]>([]);
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeBaseResponse["stats"] | null>(null);
  const [knowledgeChunks, setKnowledgeChunks] = useState<KnowledgeBaseResponse["chunks"]>([]);
  const [knowledgePending, setKnowledgePending] = useState(false);
  const [knowledgeMessage, setKnowledgeMessage] = useState("");
  const [knowledgeMessageTone, setKnowledgeMessageTone] = useState<"success" | "error">("success");
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeQueryPending, setKnowledgeQueryPending] = useState(false);
  const [knowledgeResults, setKnowledgeResults] = useState<AgentRetrievalSummary | null>(null);
  const [knowledgeImportPath, setKnowledgeImportPath] = useState("");
  const [knowledgeImportRecursive, setKnowledgeImportRecursive] = useState(true);
  const [knowledgeImportTags, setKnowledgeImportTags] = useState("");
  const [knowledgeImportPreview, setKnowledgeImportPreview] = useState<KnowledgeImportPreview | null>(null);
  const [highlightedKnowledgeDocumentIds, setHighlightedKnowledgeDocumentIds] = useState<string[]>([]);
  const [knowledgeRecommendedPaths, setKnowledgeRecommendedPaths] = useState<string[]>([]);
  const [knowledgeRecentPaths, setKnowledgeRecentPaths] = useState<KnowledgeRecentPathEntry[]>([]);
  const [knowledgeWorkspaceRoot, setKnowledgeWorkspaceRoot] = useState("");
  const [knowledgeActionPending, setKnowledgeActionPending] = useState<"" | "probe" | "import" | "save">("");
  const [knowledgeEditor, setKnowledgeEditor] = useState<KnowledgeEditorState>({
    title: "",
    source: "",
    tagsText: "",
    content: ""
  });
  const [selectedTargetId, setSelectedTargetId] = useState("anthropic-claude");
  const [providerFilter, setProviderFilter] = useState("all");
  const [providerProfileFilter, setProviderProfileFilter] = useState("all");
  const [benchmarkThinkingModeFilter, setBenchmarkThinkingModeFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [contextWindowFilter, setContextWindowFilter] = useState("all");
  const [compareTargetIds, setCompareTargetIds] = useState<string[]>(["anthropic-claude"]);
  const [benchmarkTargetIds, setBenchmarkTargetIds] = useState<string[]>(
    getDefaultBenchmarkTargetIds(localTargets.map((target) => target.id))
  );
  const [benchmarkProviderProfile, setBenchmarkProviderProfile] = useState<"speed" | "balanced" | "tool-first">("balanced");
  const [benchmarkThinkingMode, setBenchmarkThinkingMode] = useState<"standard" | "thinking">("standard");
  const [benchmarkBatchProfiles, setBenchmarkBatchProfiles] = useState(false);
  const [benchmarkBatchScope, setBenchmarkBatchScope] = useState<BenchmarkBatchScope>("comparison-subset");
  const [benchmarkPromptMode, setBenchmarkPromptMode] = useState<"custom" | "prompt-set" | "dataset" | "suite">("custom");
  const [benchmarkPromptSetId, setBenchmarkPromptSetId] = useState("");
  const [benchmarkDatasetId, setBenchmarkDatasetId] = useState(benchmarkDatasets[0]?.id || "");
  const [benchmarkDatasetSampleLimit, setBenchmarkDatasetSampleLimit] = useState(benchmarkDatasets[0]?.sampleCount || 4);
  const [benchmarkSuiteId, setBenchmarkSuiteId] = useState(benchmarkMilestoneSuites.find((entry) => entry.reportTier === "milestone")?.id || benchmarkMilestoneSuites[0]?.id || "");
  const [benchmarkHeatmapMetric, setBenchmarkHeatmapMetric] = useState<BenchmarkHeatmapMetricKey>("total-latency");
  const [benchmarkHeatmapWindowMinutes, setBenchmarkHeatmapWindowMinutes] = useState(720);
  const [benchmarkHeatmapPromptScope, setBenchmarkHeatmapPromptScope] = useState<"all" | "fixed-only">("all");
  const [benchmarkHeatmapSampleStatus, setBenchmarkHeatmapSampleStatus] = useState<"all" | "success" | "failed">("all");
  const [benchmarkRuns, setBenchmarkRuns] = useState(3);
  const [benchmarkContextWindow, setBenchmarkContextWindow] = useState(32768);
  const [benchmarkExportWindowMinutes, setBenchmarkExportWindowMinutes] = useState(720);
  const [benchmarkExportSampleStatus, setBenchmarkExportSampleStatus] = useState("all");
  const [benchmarkExportHistoryStatus, setBenchmarkExportHistoryStatus] = useState("all");
  const [benchmarkPrompt, setBenchmarkPrompt] = useState("请用一段简短中文解释本地编码 Agent 的价值。");
  const [benchmarkPending, setBenchmarkPending] = useState(false);
  const [benchmarkRunId, setBenchmarkRunId] = useState("");
  const [benchmarkProgress, setBenchmarkProgress] = useState<AgentBenchmarkProgress | null>(null);
  const [benchmarkError, setBenchmarkError] = useState("");
  const [benchmarkResumeMessage, setBenchmarkResumeMessage] = useState("");
  const [benchmarkControlPending, setBenchmarkControlPending] = useState<"" | "stop" | "abandon" | "continue">("");
  const [benchmarkData, setBenchmarkData] = useState<AgentBenchmarkResponse | null>(null);
  const [benchmarkBaseline, setBenchmarkBaseline] = useState<BenchmarkBaselineResponse["baseline"]>(null);
  const [benchmarkBaselines, setBenchmarkBaselines] = useState<BenchmarkBaselineRecord[]>([]);
  const [selectedComparisonBaselineId, setSelectedComparisonBaselineId] = useState("");
  const [benchmarkBaselinePending, setBenchmarkBaselinePending] = useState(false);
  const [benchmarkBaselineMessage, setBenchmarkBaselineMessage] = useState("");
  const [runtimeStatuses, setRuntimeStatuses] = useState<Record<string, AgentRuntimeStatus | null>>({});
  const [runtimeActionPending, setRuntimeActionPending] = useState<Record<string, RuntimeActionKind | "">>({});
  const [runtimeLogExcerpts, setRuntimeLogExcerpts] = useState<Record<string, string>>({});
  const [runtimeLogSummaries, setRuntimeLogSummaries] = useState<Record<string, AgentRuntimeLogSummary | null>>({});
  const [runtimeLogQueries, setRuntimeLogQueries] = useState<Record<string, string>>({});
  const [runtimeLogLimits, setRuntimeLogLimits] = useState<Record<string, number>>({});
  const [runtimeMessages, setRuntimeMessages] = useState<Record<string, string>>({});
  const [runtimeLastSwitchMs, setRuntimeLastSwitchMs] = useState<Record<string, number | null>>({});
  const [runtimeLastSwitchAt, setRuntimeLastSwitchAt] = useState<Record<string, string | null>>({});
  const [prewarmAllPending, setPrewarmAllPending] = useState(false);
  const [prewarmAllMessage, setPrewarmAllMessage] = useState("");
  const knowledgeImportInputRef = useRef<HTMLInputElement | null>(null);
  const knowledgeHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const uiText = useMemo(() => {
    switch (locale) {
      case "zh-TW":
        return {
          concurrencyTrend: "並發趨勢",
          storageTrend: "儲存使用率",
          energyTrend: "能耗代理趨勢",
          latencyMs: "耗時 (ms)",
          tokens: "Token",
          status: "狀態",
          acPower: "交流電",
          batteryPower: "電池",
          provider: "提供方",
          providerProfile: "档位",
          modelFilter: "模型篩選",
          contextWindowFilter: "上下文體量",
          defaultContextWindow: "預設",
          contextWindowBreakdown: "上下文體量分布",
          benchmarkTitle: "模型 Benchmark",
          benchmarkPrompt: "基準提示詞",
          benchmarkPromptMode: "提示詞模式",
          benchmarkPromptModeCustom: "自訂提示詞",
          benchmarkPromptModeFixedSet: "固定 Prompt 集",
          benchmarkPromptModeDataset: "Dataset 模式",
          benchmarkPromptModeSuite: "正式評測集",
          benchmarkPromptModeOfficial: "官方口徑對照",
          benchmarkPromptSet: "Prompt 集",
          benchmarkDataset: "Dataset",
          benchmarkDatasetSampleLimit: "Dataset 取樣數",
          benchmarkDatasetSource: "Dataset 來源",
          benchmarkDatasetTaskCategory: "任務類型",
          benchmarkDatasetScoring: "評分方式",
          benchmarkSuite: "評測集",
          benchmarkComparisonObjective: "對照目標",
          benchmarkSuiteWorkloads: "評測工作負載",
          benchmarkSuiteTier: "評測層級",
          benchmarkFormalReport: "正式 Benchmark 報告工作負載",
          benchmarkPromptSetSummary: "固定 Prompt 集摘要",
          benchmarkPromptSetManage: "管理 Prompt 集",
          benchmarkPromptSetCreate: "新增 Prompt 集",
          benchmarkPromptSetUpdate: "更新 Prompt 集",
          benchmarkPromptSetEditCurrent: "编辑当前 Prompt 集",
          benchmarkPromptSetDeleteCurrent: "删除当前 Prompt 集",
          benchmarkPromptSetLabel: "Prompt 集名称",
          benchmarkPromptSetDescription: "说明",
          benchmarkPromptSetPrompts: "Prompt 列表（每行一条）",
          benchmarkPromptSetNoData: "当前没有 Prompt 集。",
          benchmarkPromptSetSaved: "Prompt 集已保存。",
          benchmarkPromptSetDeleted: "Prompt 集已删除。",
          benchmarkBaselinePanel: "回歸基線面板",
          benchmarkBaselineDefault: "預設基線",
          benchmarkBaselineSetDefault: "設為預設",
          benchmarkBaselineUseForComparison: "設為目前對比",
          benchmarkBaselineComparisonTarget: "目前對比基線",
          benchmarkBaselineRename: "重新命名",
          benchmarkBaselineDelete: "刪除",
          benchmarkBaselineNoData: "目前沒有符合條件的基線。",
          benchmarkHeatmapWindow: "熱力圖時間窗口",
          benchmarkHeatmapPromptScope: "熱力圖 Prompt 範圍",
          benchmarkHeatmapSampleStatus: "熱力圖樣本狀態",
          benchmarkHeatmapAllPrompts: "全部 Prompt",
          benchmarkHeatmapFixedPromptsOnly: "僅固定 Prompt 集",
          benchmarkRuns: "採樣次數",
          benchmarkTargets: "測試目標",
          benchmarkProviderProfile: "Benchmark 檔位",
          benchmarkThinkingMode: "Benchmark 思考模式",
          benchmarkThinkingModeFilter: "Benchmark 思考模式過濾",
          benchmarkBatchProfiles: "遠端批次對照",
          benchmarkBatchProfilesHint: "對遠端目標一次跑 speed / balanced / tool-first / thinking 四組對照。",
          benchmarkBatchScope: "批次範圍",
          benchmarkBatchScopeHint: "完整套件適合正式深度對比；對比子集更適合快速看不同 profile 的差異。",
          benchmarkBatchScopeFull: "完整套件",
          benchmarkBatchScopeSubset: "對比子集",
          benchmarkProgress: "Benchmark 進度",
          benchmarkProgressEta: "預計剩餘",
          benchmarkProgressElapsed: "已執行",
          benchmarkProgressCurrent: "最近完成",
          benchmarkProgressCompleted: "已完成樣本",
          benchmarkHeatmap: "Benchmark 交叉熱力圖",
          benchmarkHeatmapMetric: "熱力圖指標",
          saveBaseline: "儲存 Baseline",
          savingBaseline: "儲存中...",
          baselineSaved: "Baseline 已儲存。",
          latestBaseline: "最新 Baseline",
          benchmarkBaselineDelta: "Baseline 差值",
          benchmarkNoBaselineComparison: "目前沒有可比對的 Baseline 結果。",
          compareLastRun: "對比上次結果",
          benchmarkThinkingStandard: "標準",
          benchmarkThinkingThinking: "Thinking / 滿血版",
          benchmarkScore: "質量分數",
          benchmarkPassRate: "通過率",
          runBenchmark: "執行 Benchmark",
          benchmarking: "Benchmark 中...",
          benchmarkNoData: "尚未執行本地 Benchmark",
          benchmarkHistory: "Benchmark 歷史",
          benchmarkTrendTitle: "Benchmark 趨勢",
          benchmarkSuccessRate: "成功率",
          exportMarkdown: "導出 Markdown",
          exportJson: "導出 JSON",
          exportRegressionReport: "导出回归报告",
          percentiles: "分位數",
          exportWindow: "導出時間窗口",
          sampleFilter: "樣本篩選",
          allSamples: "全部樣本",
          successSamples: "成功樣本",
          failedSamples: "失敗樣本",
          historyFilter: "歷史記錄篩選",
          allHistory: "全部記錄",
          successHistory: "僅成功記錄",
          failedHistory: "僅失敗記錄",
          compareView: "對比視圖",
          compareTargets: "對比目標",
          firstTokenLatency: "首字延時",
          totalLatency: "總耗時",
          tokenThroughput: "Token 吞吐",
          tokensPerSecond: "Token/秒",
          latencySplit: "上游首字 vs 應用總耗時",
          appOverhead: "應用層額外耗時",
          knowledgeBaseTitle: "知識庫與檢索",
          knowledgeBaseHint: "管理可檢索文檔、觀察 chunk 統計，並直接驗證 grounded 檢索命中。",
          knowledgeDocCount: "文檔數",
          knowledgeChunkCount: "Chunk 數",
          knowledgeAvgChunkChars: "平均 Chunk 字元",
          knowledgeAvgChunkTokens: "平均 Chunk Token",
          knowledgeTitle: "文檔標題",
          knowledgeSource: "來源",
          knowledgeTags: "標籤",
          knowledgeContent: "內容",
          knowledgeSave: "保存文檔",
          knowledgeReset: "重置編輯器",
          knowledgeEdit: "編輯",
          knowledgeDelete: "刪除",
          knowledgeDeleteConfirm: "確定刪除此知識文檔？",
          knowledgeSearch: "檢索驗證",
          knowledgeSearchPlaceholder: "輸入查詢，查看 grounded 命中結果",
          knowledgeDocuments: "知識文檔",
          knowledgeResults: "命中結果",
          knowledgeNoResults: "當前沒有命中結果。",
          knowledgeSection: "章節路徑",
          runtimeOps: "本地執行時運維",
          runtimeOpsHint: "直接查看本地模型網關狀態，並執行預熱、釋放、重啟與日誌讀取。",
          runtimeRefresh: "刷新執行時",
          runtimeRefreshing: "刷新中...",
          runtimePrewarmAll: "全部預熱",
          runtimePrewarm: "預熱模型",
          runtimeRelease: "釋放模型",
          runtimeRestart: "重啟網關",
          runtimeReadLog: "查看日誌",
          loadedAlias: "已載入別名",
          runtimeCurrentLoaded: "當前已載入",
          runtimeSwitchingNow: "正在切模",
          runtimeLastSwitchLoad: "最近切換耗時",
          runtimeLastSwitchAt: "最近切模時間",
          queueLabel: "佇列",
          activeLabel: "活躍",
          runtimeSupervisor: "Supervisor",
          runtimeGateway: "Gateway",
          runtimeRestartCount: "重啟次數",
          runtimeLastStart: "上次啟動",
          runtimeLastExit: "上次退出",
          runtimeLastExitCode: "退出碼",
          runtimeLastEvent: "最新事件",
          runtimeEnsureReason: "最近啟動原因",
          runtimeLog: "網關日誌",
          runtimeNoLog: "目前沒有已載入的日誌內容。",
          runtimeLogPath: "日誌路徑"
        };
      case "ko":
        return {
          concurrencyTrend: "동시성 추세",
          storageTrend: "저장소 사용률",
          energyTrend: "에너지 프록시 추세",
          latencyMs: "지연 (ms)",
          tokens: "Token",
          status: "상태",
          acPower: "AC 전원",
          batteryPower: "배터리",
          provider: "제공자",
          providerProfile: "프로필",
          modelFilter: "모델 필터",
          contextWindowFilter: "컨텍스트 크기",
          defaultContextWindow: "기본값",
          contextWindowBreakdown: "컨텍스트 크기 분포",
          benchmarkTitle: "모델 Benchmark",
          benchmarkPrompt: "벤치마크 프롬프트",
          benchmarkPromptMode: "프롬프트 모드",
          benchmarkPromptModeCustom: "사용자 정의 프롬프트",
          benchmarkPromptModeFixedSet: "고정 프롬프트 세트",
          benchmarkPromptModeDataset: "Dataset 모드",
          benchmarkPromptModeSuite: "정식 평가 세트",
          benchmarkPromptModeOfficial: "공식 비교 모드",
          benchmarkPromptSet: "프롬프트 세트",
          benchmarkDataset: "Dataset",
          benchmarkDatasetSampleLimit: "Dataset 샘플 수",
          benchmarkDatasetSource: "Dataset 출처",
          benchmarkDatasetTaskCategory: "작업 유형",
          benchmarkDatasetScoring: "평가 방식",
          benchmarkSuite: "평가 세트",
          benchmarkComparisonObjective: "비교 목표",
          benchmarkSuiteWorkloads: "평가 워크로드",
          benchmarkSuiteTier: "평가 계층",
          benchmarkFormalReport: "정식 Benchmark 보고서 워크로드",
          benchmarkPromptSetSummary: "고정 프롬프트 세트 요약",
          benchmarkPromptSetManage: "프롬프트 세트 관리",
          benchmarkPromptSetCreate: "프롬프트 세트 추가",
          benchmarkPromptSetUpdate: "프롬프트 세트 업데이트",
          benchmarkPromptSetEditCurrent: "현재 프롬프트 세트 편집",
          benchmarkPromptSetDeleteCurrent: "현재 프롬프트 세트 삭제",
          benchmarkPromptSetLabel: "프롬프트 세트 이름",
          benchmarkPromptSetDescription: "설명",
          benchmarkPromptSetPrompts: "프롬프트 목록(한 줄에 하나씩)",
          benchmarkPromptSetNoData: "프롬프트 세트가 없습니다.",
          benchmarkPromptSetSaved: "프롬프트 세트를 저장했습니다.",
          benchmarkPromptSetDeleted: "프롬프트 세트를 삭제했습니다.",
          benchmarkBaselinePanel: "회귀 베이스라인 패널",
          benchmarkBaselineDefault: "기본 베이스라인",
          benchmarkBaselineSetDefault: "기본값으로 설정",
          benchmarkBaselineUseForComparison: "현재 비교 대상으로 사용",
          benchmarkBaselineComparisonTarget: "현재 비교 베이스라인",
          benchmarkBaselineRename: "이름 변경",
          benchmarkBaselineDelete: "삭제",
          benchmarkBaselineNoData: "조건에 맞는 베이스라인이 없습니다.",
          benchmarkHeatmapWindow: "히트맵 시간 창",
          benchmarkHeatmapPromptScope: "히트맵 프롬프트 범위",
          benchmarkHeatmapSampleStatus: "히트맵 샘플 상태",
          benchmarkHeatmapAllPrompts: "모든 프롬프트",
          benchmarkHeatmapFixedPromptsOnly: "고정 프롬프트 세트만",
          benchmarkRuns: "샘플 수",
          benchmarkTargets: "대상",
          benchmarkProviderProfile: "Benchmark 프로필",
          benchmarkThinkingMode: "Benchmark 사고 모드",
          benchmarkThinkingModeFilter: "Benchmark 사고 모드 필터",
          benchmarkBatchProfiles: "원격 일괄 비교",
          benchmarkBatchProfilesHint: "원격 대상에 대해 speed / balanced / tool-first / thinking 네 조합을 한 번에 실행합니다.",
          benchmarkBatchScope: "배치 범위",
          benchmarkBatchScopeHint: "전체 세트는 정식 심층 비교용, 비교 서브셋은 profile 차이를 빠르게 보는 용도입니다.",
          benchmarkBatchScopeFull: "전체 세트",
          benchmarkBatchScopeSubset: "비교 서브셋",
          benchmarkProgress: "Benchmark 진행률",
          benchmarkProgressEta: "예상 남은 시간",
          benchmarkProgressElapsed: "경과 시간",
          benchmarkProgressCurrent: "최근 완료",
          benchmarkProgressCompleted: "완료 샘플",
          benchmarkHeatmap: "Benchmark 교차 히트맵",
          benchmarkHeatmapMetric: "히트맵 지표",
          saveBaseline: "베이스라인 저장",
          savingBaseline: "저장 중...",
          baselineSaved: "베이스라인을 저장했습니다.",
          latestBaseline: "최신 베이스라인",
          benchmarkBaselineDelta: "Baseline 차이",
          benchmarkNoBaselineComparison: "비교 가능한 Baseline 결과가 없습니다.",
          compareLastRun: "직전 결과 비교",
          benchmarkThinkingStandard: "표준",
          benchmarkThinkingThinking: "Thinking / 풀 버전",
          benchmarkScore: "품질 점수",
          benchmarkPassRate: "통과율",
          runBenchmark: "Benchmark 실행",
          benchmarking: "Benchmark 실행 중...",
          benchmarkNoData: "아직 로컬 Benchmark 결과가 없습니다.",
          benchmarkHistory: "Benchmark 기록",
          benchmarkTrendTitle: "Benchmark 추세",
          benchmarkSuccessRate: "성공률",
          exportMarkdown: "Markdown 내보내기",
          exportJson: "JSON 내보내기",
          exportRegressionReport: "회귀 보고서 내보내기",
          percentiles: "분위수",
          exportWindow: "내보내기 시간 창",
          sampleFilter: "샘플 필터",
          allSamples: "전체 샘플",
          successSamples: "성공 샘플",
          failedSamples: "실패 샘플",
          historyFilter: "기록 필터",
          allHistory: "전체 기록",
          successHistory: "성공 기록만",
          failedHistory: "실패 기록만",
          compareView: "비교 보기",
          compareTargets: "비교 대상",
          firstTokenLatency: "첫 토큰 지연",
          totalLatency: "총 지연",
          tokenThroughput: "Token 처리량",
          tokensPerSecond: "Token/초",
          latencySplit: "업스트림 첫 토큰 vs 앱 총 지연",
          appOverhead: "앱 추가 지연",
          knowledgeBaseTitle: "지식 베이스와 검색",
          knowledgeBaseHint: "검색 가능한 문서를 관리하고 chunk 통계를 보며 grounded 검색 결과를 바로 검증합니다.",
          knowledgeDocCount: "문서 수",
          knowledgeChunkCount: "Chunk 수",
          knowledgeAvgChunkChars: "평균 Chunk 문자 수",
          knowledgeAvgChunkTokens: "평균 Chunk Token",
          knowledgeTitle: "문서 제목",
          knowledgeSource: "출처",
          knowledgeTags: "태그",
          knowledgeContent: "내용",
          knowledgeSave: "문서 저장",
          knowledgeReset: "편집기 초기화",
          knowledgeEdit: "편집",
          knowledgeDelete: "삭제",
          knowledgeDeleteConfirm: "이 지식 문서를 삭제할까요?",
          knowledgeSearch: "검색 검증",
          knowledgeSearchPlaceholder: "질문을 입력해 grounded 검색 결과를 확인하세요",
          knowledgeDocuments: "지식 문서",
          knowledgeResults: "검색 결과",
          knowledgeNoResults: "검색 결과가 없습니다.",
          knowledgeSection: "섹션 경로",
          runtimeOps: "로컬 런타임 운용",
          runtimeOpsHint: "로컬 모델 게이트웨이 상태를 보고 예열, 해제, 재시작, 로그 확인을 수행합니다.",
          runtimeRefresh: "런타임 새로고침",
          runtimeRefreshing: "새로고침 중...",
          runtimePrewarmAll: "전체 예열",
          runtimePrewarm: "모델 예열",
          runtimeRelease: "모델 해제",
          runtimeRestart: "게이트웨이 재시작",
          runtimeReadLog: "로그 보기",
          loadedAlias: "로드된 별칭",
          runtimeCurrentLoaded: "현재 로드됨",
          runtimeSwitchingNow: "전환 중",
          runtimeLastSwitchLoad: "최근 전환 시간",
          runtimeLastSwitchAt: "최근 전환 시각",
          queueLabel: "대기열",
          activeLabel: "활성",
          runtimeSupervisor: "Supervisor",
          runtimeGateway: "Gateway",
          runtimeRestartCount: "재시작 횟수",
          runtimeLastStart: "마지막 시작",
          runtimeLastExit: "마지막 종료",
          runtimeLastExitCode: "종료 코드",
          runtimeLastEvent: "최근 이벤트",
          runtimeEnsureReason: "최근 ensure 사유",
          runtimeLog: "게이트웨이 로그",
          runtimeNoLog: "불러온 로그가 없습니다.",
          runtimeLogPath: "로그 경로"
        };
      case "ja":
        return {
          concurrencyTrend: "同時実行推移",
          storageTrend: "ストレージ使用率",
          energyTrend: "エネルギー代理推移",
          latencyMs: "遅延 (ms)",
          tokens: "Token",
          status: "状態",
          acPower: "AC 電源",
          batteryPower: "バッテリー",
          provider: "提供元",
          providerProfile: "プロファイル",
          modelFilter: "モデル絞り込み",
          contextWindowFilter: "コンテキスト量",
          defaultContextWindow: "既定値",
          contextWindowBreakdown: "コンテキスト量分布",
          benchmarkTitle: "モデル Benchmark",
          benchmarkPrompt: "ベンチマーク用プロンプト",
          benchmarkPromptMode: "プロンプトモード",
          benchmarkPromptModeCustom: "カスタムプロンプト",
          benchmarkPromptModeFixedSet: "固定プロンプトセット",
          benchmarkPromptModeDataset: "Dataset モード",
          benchmarkPromptModeSuite: "正式評価セット",
          benchmarkPromptModeOfficial: "公式比較モード",
          benchmarkPromptSet: "プロンプトセット",
          benchmarkDataset: "Dataset",
          benchmarkDatasetSampleLimit: "Dataset サンプル数",
          benchmarkDatasetSource: "Dataset 出典",
          benchmarkDatasetTaskCategory: "タスク種別",
          benchmarkDatasetScoring: "評価方式",
          benchmarkSuite: "評価セット",
          benchmarkComparisonObjective: "比較目的",
          benchmarkSuiteWorkloads: "評価ワークロード",
          benchmarkSuiteTier: "評価階層",
          benchmarkFormalReport: "正式 Benchmark レポート負荷",
          benchmarkPromptSetSummary: "固定プロンプトセット概要",
          benchmarkPromptSetManage: "プロンプトセット管理",
          benchmarkPromptSetCreate: "プロンプトセットを追加",
          benchmarkPromptSetUpdate: "プロンプトセットを更新",
          benchmarkPromptSetEditCurrent: "現在のプロンプトセットを編集",
          benchmarkPromptSetDeleteCurrent: "現在のプロンプトセットを削除",
          benchmarkPromptSetLabel: "プロンプトセット名",
          benchmarkPromptSetDescription: "説明",
          benchmarkPromptSetPrompts: "プロンプト一覧（1行1件）",
          benchmarkPromptSetNoData: "プロンプトセットがありません。",
          benchmarkPromptSetSaved: "プロンプトセットを保存しました。",
          benchmarkPromptSetDeleted: "プロンプトセットを削除しました。",
          benchmarkBaselinePanel: "回帰ベースラインパネル",
          benchmarkBaselineDefault: "既定ベースライン",
          benchmarkBaselineSetDefault: "既定に設定",
          benchmarkBaselineUseForComparison: "現在の比較対象に設定",
          benchmarkBaselineComparisonTarget: "現在の比較ベースライン",
          benchmarkBaselineRename: "名前変更",
          benchmarkBaselineDelete: "削除",
          benchmarkBaselineNoData: "条件に一致するベースラインがありません。",
          benchmarkHeatmapWindow: "ヒートマップ時間窓",
          benchmarkHeatmapPromptScope: "ヒートマップ Prompt 範囲",
          benchmarkHeatmapSampleStatus: "ヒートマップのサンプル状態",
          benchmarkHeatmapAllPrompts: "すべての Prompt",
          benchmarkHeatmapFixedPromptsOnly: "固定 Prompt セットのみ",
          benchmarkRuns: "サンプル回数",
          benchmarkTargets: "対象",
          benchmarkProviderProfile: "Benchmark プロファイル",
          benchmarkThinkingMode: "Benchmark Thinking モード",
          benchmarkThinkingModeFilter: "Benchmark Thinking モードフィルター",
          benchmarkBatchProfiles: "リモート一括比較",
          benchmarkBatchProfilesHint: "リモート対象に対して speed / balanced / tool-first / thinking の4通りをまとめて実行します。",
          benchmarkBatchScope: "バッチ範囲",
          benchmarkBatchScopeHint: "完全セットは正式な深掘り比較用、比較サブセットは profile 差分の高速確認用です。",
          benchmarkBatchScopeFull: "完全セット",
          benchmarkBatchScopeSubset: "比較サブセット",
          benchmarkProgress: "Benchmark 進捗",
          benchmarkProgressEta: "残り見込み",
          benchmarkProgressElapsed: "経過時間",
          benchmarkProgressCurrent: "直近完了",
          benchmarkProgressCompleted: "完了サンプル",
          benchmarkHeatmap: "Benchmark 交差ヒートマップ",
          benchmarkHeatmapMetric: "ヒートマップ指標",
          saveBaseline: "Baseline を保存",
          savingBaseline: "保存中...",
          baselineSaved: "Baseline を保存しました。",
          latestBaseline: "最新 Baseline",
          benchmarkBaselineDelta: "Baseline 差分",
          benchmarkNoBaselineComparison: "比較可能な Baseline 結果がありません。",
          compareLastRun: "前回結果との差分",
          benchmarkThinkingStandard: "標準",
          benchmarkThinkingThinking: "Thinking / フル版",
          benchmarkScore: "品質スコア",
          benchmarkPassRate: "通過率",
          runBenchmark: "Benchmark 実行",
          benchmarking: "Benchmark 実行中...",
          benchmarkNoData: "ローカル Benchmark の結果はまだありません。",
          benchmarkHistory: "Benchmark 履歴",
          benchmarkTrendTitle: "Benchmark 推移",
          benchmarkSuccessRate: "成功率",
          exportMarkdown: "Markdown を出力",
          exportJson: "JSON を出力",
          exportRegressionReport: "回帰レポートを出力",
          percentiles: "パーセンタイル",
          exportWindow: "出力時間ウィンドウ",
          sampleFilter: "サンプルフィルター",
          allSamples: "全サンプル",
          successSamples: "成功サンプル",
          failedSamples: "失敗サンプル",
          historyFilter: "履歴フィルター",
          allHistory: "全履歴",
          successHistory: "成功履歴のみ",
          failedHistory: "失敗履歴のみ",
          compareView: "比較ビュー",
          compareTargets: "比較対象",
          firstTokenLatency: "初回トークン遅延",
          totalLatency: "総遅延",
          tokenThroughput: "Token スループット",
          tokensPerSecond: "Token/秒",
          latencySplit: "上流の初回トークン vs アプリ総遅延",
          appOverhead: "アプリ追加遅延",
          knowledgeBaseTitle: "ナレッジベースと検索",
          knowledgeBaseHint: "検索可能な文書を管理し、chunk 統計を見ながら grounded 検索結果を検証します。",
          knowledgeDocCount: "文書数",
          knowledgeChunkCount: "Chunk 数",
          knowledgeAvgChunkChars: "平均 Chunk 文字数",
          knowledgeAvgChunkTokens: "平均 Chunk Token",
          knowledgeTitle: "文書タイトル",
          knowledgeSource: "ソース",
          knowledgeTags: "タグ",
          knowledgeContent: "内容",
          knowledgeSave: "文書を保存",
          knowledgeReset: "編集をリセット",
          knowledgeEdit: "編集",
          knowledgeDelete: "削除",
          knowledgeDeleteConfirm: "このナレッジ文書を削除しますか？",
          knowledgeSearch: "検索検証",
          knowledgeSearchPlaceholder: "クエリを入力して grounded 検索結果を確認します",
          knowledgeDocuments: "ナレッジ文書",
          knowledgeResults: "検索結果",
          knowledgeNoResults: "検索結果がありません。",
          knowledgeSection: "セクションパス",
          runtimeOps: "ローカル実行環境運用",
          runtimeOpsHint: "ローカルモデルゲートウェイの状態を確認し、予熱・解放・再起動・ログ確認を行います。",
          runtimeRefresh: "実行環境を更新",
          runtimeRefreshing: "更新中...",
          runtimePrewarmAll: "すべて予熱",
          runtimePrewarm: "モデルを予熱",
          runtimeRelease: "モデルを解放",
          runtimeRestart: "ゲートウェイ再起動",
          runtimeReadLog: "ログを表示",
          loadedAlias: "読み込み済み別名",
          runtimeCurrentLoaded: "現在読み込み済み",
          runtimeSwitchingNow: "切り替え中",
          runtimeLastSwitchLoad: "直近切替時間",
          runtimeLastSwitchAt: "直近切替時刻",
          queueLabel: "キュー",
          activeLabel: "アクティブ",
          runtimeSupervisor: "Supervisor",
          runtimeGateway: "Gateway",
          runtimeRestartCount: "再起動回数",
          runtimeLastStart: "最終起動",
          runtimeLastExit: "最終終了",
          runtimeLastExitCode: "終了コード",
          runtimeLastEvent: "最新イベント",
          runtimeEnsureReason: "直近の起動理由",
          runtimeLog: "ゲートウェイログ",
          runtimeNoLog: "読み込まれたログはありません。",
          runtimeLogPath: "ログパス"
        };
      case "en":
        return {
          concurrencyTrend: "Concurrency trend",
          storageTrend: "Storage usage",
          energyTrend: "Energy proxy trend",
          latencyMs: "Latency (ms)",
          tokens: "Tokens",
          status: "Status",
          acPower: "AC Power",
          batteryPower: "Battery",
          provider: "Provider",
          providerProfile: "Profile",
          modelFilter: "Model filter",
          contextWindowFilter: "Context window",
          defaultContextWindow: "Default",
          contextWindowBreakdown: "Context window breakdown",
          benchmarkTitle: "Model benchmark",
          benchmarkPrompt: "Benchmark prompt",
          benchmarkPromptMode: "Prompt mode",
          benchmarkPromptModeCustom: "Custom prompt",
          benchmarkPromptModeFixedSet: "Fixed prompt set",
          benchmarkPromptModeDataset: "Dataset mode",
          benchmarkPromptModeSuite: "Formal suite",
          benchmarkPromptModeOfficial: "Official comparison mode",
          benchmarkPromptSet: "Prompt set",
          benchmarkDataset: "Dataset",
          benchmarkDatasetSampleLimit: "Dataset samples",
          benchmarkDatasetSource: "Dataset source",
          benchmarkDatasetTaskCategory: "Task category",
          benchmarkDatasetScoring: "Scoring",
          benchmarkSuite: "Evaluation suite",
          benchmarkComparisonObjective: "Comparison objective",
          benchmarkSuiteWorkloads: "Suite workloads",
          benchmarkSuiteTier: "Suite tier",
          benchmarkFormalReport: "Formal benchmark workload",
          benchmarkPromptSetSummary: "Fixed prompt set summary",
          benchmarkPromptSetManage: "Manage prompt sets",
          benchmarkPromptSetCreate: "Create prompt set",
          benchmarkPromptSetUpdate: "Update prompt set",
          benchmarkPromptSetEditCurrent: "Edit current prompt set",
          benchmarkPromptSetDeleteCurrent: "Delete current prompt set",
          benchmarkPromptSetLabel: "Prompt set label",
          benchmarkPromptSetDescription: "Description",
          benchmarkPromptSetPrompts: "Prompt list (one per line)",
          benchmarkPromptSetNoData: "No prompt sets yet.",
          benchmarkPromptSetSaved: "Prompt set saved.",
          benchmarkPromptSetDeleted: "Prompt set deleted.",
          benchmarkBaselinePanel: "Regression baseline panel",
          benchmarkBaselineDefault: "Default baseline",
          benchmarkBaselineSetDefault: "Set default",
          benchmarkBaselineUseForComparison: "Use for comparison",
          benchmarkBaselineComparisonTarget: "Current comparison baseline",
          benchmarkBaselineRename: "Rename",
          benchmarkBaselineDelete: "Delete",
          benchmarkBaselineNoData: "No matching baselines yet.",
          benchmarkHeatmapWindow: "Heatmap window",
          benchmarkHeatmapPromptScope: "Heatmap prompt scope",
          benchmarkHeatmapSampleStatus: "Heatmap sample status",
          benchmarkHeatmapAllPrompts: "All prompts",
          benchmarkHeatmapFixedPromptsOnly: "Fixed prompt sets only",
          benchmarkRuns: "Runs",
          benchmarkTargets: "Targets",
          benchmarkProviderProfile: "Benchmark profile",
          benchmarkThinkingMode: "Benchmark thinking mode",
          benchmarkThinkingModeFilter: "Benchmark thinking filter",
          benchmarkBatchProfiles: "Remote batch compare",
          benchmarkBatchProfilesHint: "Run speed / balanced / tool-first / thinking in one batch for remote targets.",
          benchmarkBatchScope: "Batch scope",
          benchmarkBatchScopeHint: "Use full suite for formal deep comparisons, or comparison subset to quickly contrast remote profiles.",
          benchmarkBatchScopeFull: "Full suite",
          benchmarkBatchScopeSubset: "Comparison subset",
          benchmarkProgress: "Benchmark progress",
          benchmarkProgressEta: "ETA",
          benchmarkProgressElapsed: "Elapsed",
          benchmarkProgressCurrent: "Last completed",
          benchmarkProgressCompleted: "Completed samples",
          benchmarkHeatmap: "Benchmark cross heatmap",
          benchmarkHeatmapMetric: "Heatmap metric",
          saveBaseline: "Save baseline",
          savingBaseline: "Saving...",
          baselineSaved: "Baseline saved.",
          latestBaseline: "Latest baseline",
          benchmarkBaselineDelta: "Baseline delta",
          benchmarkNoBaselineComparison: "No comparable baseline results yet.",
          compareLastRun: "Compare with previous run",
          benchmarkThinkingStandard: "Standard",
          benchmarkThinkingThinking: "Thinking / full model",
          benchmarkScore: "Quality score",
          benchmarkPassRate: "Pass rate",
          runBenchmark: "Run benchmark",
          benchmarking: "Benchmarking...",
          benchmarkNoData: "No local benchmark results yet.",
          benchmarkHistory: "Benchmark history",
          benchmarkTrendTitle: "Benchmark trends",
          benchmarkSuccessRate: "Success rate",
          exportMarkdown: "Export Markdown",
          exportJson: "Export JSON",
          exportRegressionReport: "Export regression report",
          percentiles: "Percentiles",
          exportWindow: "Export window",
          sampleFilter: "Sample filter",
          allSamples: "All samples",
          successSamples: "Successful samples",
          failedSamples: "Failed samples",
          historyFilter: "History filter",
          allHistory: "All history",
          successHistory: "Successful history only",
          failedHistory: "Failed history only",
          compareView: "Comparison view",
          compareTargets: "Comparison targets",
          firstTokenLatency: "First-token latency",
          totalLatency: "Total latency",
          tokenThroughput: "Token throughput",
          tokensPerSecond: "tokens/s",
          latencySplit: "Upstream first token vs app total latency",
          appOverhead: "App overhead",
          knowledgeBaseTitle: "Knowledge base and retrieval",
          knowledgeBaseHint: "Manage searchable documents, inspect chunk stats, and validate grounded hits directly.",
          knowledgeDocCount: "Documents",
          knowledgeChunkCount: "Chunks",
          knowledgeAvgChunkChars: "Avg chunk chars",
          knowledgeAvgChunkTokens: "Avg chunk tokens",
          knowledgeTitle: "Document title",
          knowledgeSource: "Source",
          knowledgeTags: "Tags",
          knowledgeContent: "Content",
          knowledgeSave: "Save document",
          knowledgeReset: "Reset editor",
          knowledgeEdit: "Edit",
          knowledgeDelete: "Delete",
          knowledgeDeleteConfirm: "Delete this knowledge document?",
          knowledgeSearch: "Retrieval probe",
          knowledgeSearchPlaceholder: "Enter a query to inspect grounded hits",
          knowledgeDocuments: "Knowledge documents",
          knowledgeResults: "Hits",
          knowledgeNoResults: "No retrieval hits yet.",
          knowledgeSection: "Section path",
          runtimeOps: "Local runtime ops",
          runtimeOpsHint: "Inspect the local gateway and run prewarm, release, restart, and log actions.",
          runtimeRefresh: "Refresh runtime",
          runtimeRefreshing: "Refreshing...",
          runtimePrewarmAll: "Prewarm all",
          runtimePrewarm: "Prewarm model",
          runtimeRelease: "Release model",
          runtimeRestart: "Restart gateway",
          runtimeReadLog: "View log",
          loadedAlias: "Loaded alias",
          runtimeCurrentLoaded: "Currently loaded",
          runtimeSwitchingNow: "Switching now",
          runtimeLastSwitchLoad: "Last switch time",
          runtimeLastSwitchAt: "Last switch at",
          queueLabel: "Queue",
          activeLabel: "Active",
          runtimeSupervisor: "Supervisor",
          runtimeGateway: "Gateway",
          runtimeRestartCount: "Restart count",
          runtimeLastStart: "Last start",
          runtimeLastExit: "Last exit",
          runtimeLastExitCode: "Exit code",
          runtimeLastEvent: "Latest event",
          runtimeEnsureReason: "Last ensure reason",
          runtimeLog: "Gateway log",
          runtimeNoLog: "No log excerpt loaded.",
          runtimeLogPath: "Log path"
        };
      case "zh-CN":
      default:
        return {
          concurrencyTrend: "并发趋势",
          storageTrend: "存储使用率",
          energyTrend: "能耗代理趋势",
          latencyMs: "耗时 (ms)",
          tokens: "Token",
          status: "状态",
          acPower: "交流电",
          batteryPower: "电池",
          provider: "提供方",
          providerProfile: "档位",
          modelFilter: "模型筛选",
          contextWindowFilter: "上下文体量",
          defaultContextWindow: "默认",
          contextWindowBreakdown: "上下文体量分布",
          benchmarkTitle: "模型 Benchmark",
          benchmarkPrompt: "基准提示词",
          benchmarkPromptMode: "提示词模式",
          benchmarkPromptModeCustom: "自定义提示词",
          benchmarkPromptModeFixedSet: "固定 Prompt 集",
          benchmarkPromptModeDataset: "Dataset 模式",
          benchmarkPromptModeSuite: "正式评测集",
          benchmarkPromptModeOfficial: "官方口径对照",
          benchmarkPromptSet: "Prompt 集",
          benchmarkDataset: "Dataset",
          benchmarkDatasetSampleLimit: "Dataset 采样数",
          benchmarkDatasetSource: "Dataset 来源",
          benchmarkDatasetTaskCategory: "任务类型",
          benchmarkDatasetScoring: "评分方式",
          benchmarkSuite: "评测集",
          benchmarkComparisonObjective: "对照目标",
          benchmarkSuiteWorkloads: "评测工作负载",
          benchmarkSuiteTier: "评测层级",
          benchmarkFormalReport: "正式 Benchmark 报告工作负载",
          benchmarkPromptSetSummary: "固定 Prompt 集摘要",
          benchmarkPromptSetManage: "管理 Prompt 集",
          benchmarkPromptSetCreate: "新增 Prompt 集",
          benchmarkPromptSetUpdate: "更新 Prompt 集",
          benchmarkPromptSetEditCurrent: "编辑当前 Prompt 集",
          benchmarkPromptSetDeleteCurrent: "删除当前 Prompt 集",
          benchmarkPromptSetLabel: "Prompt 集名称",
          benchmarkPromptSetDescription: "说明",
          benchmarkPromptSetPrompts: "Prompt 列表（每行一条）",
          benchmarkPromptSetNoData: "当前没有 Prompt 集。",
          benchmarkPromptSetSaved: "Prompt 集已保存。",
          benchmarkPromptSetDeleted: "Prompt 集已删除。",
          benchmarkBaselinePanel: "回归基线面板",
          benchmarkBaselineDefault: "默认基线",
          benchmarkBaselineSetDefault: "设为默认",
          benchmarkBaselineUseForComparison: "设为当前对比",
          benchmarkBaselineComparisonTarget: "当前对比基线",
          benchmarkBaselineRename: "重命名",
          benchmarkBaselineDelete: "删除",
          benchmarkBaselineNoData: "当前没有符合条件的基线。",
          benchmarkHeatmapWindow: "热力图时间窗口",
          benchmarkHeatmapPromptScope: "热力图 Prompt 范围",
          benchmarkHeatmapSampleStatus: "热力图样本状态",
          benchmarkHeatmapAllPrompts: "全部 Prompt",
          benchmarkHeatmapFixedPromptsOnly: "仅固定 Prompt 集",
          benchmarkRuns: "采样次数",
          benchmarkTargets: "测试目标",
          benchmarkProviderProfile: "Benchmark 档位",
          benchmarkThinkingMode: "Benchmark 思考模式",
          benchmarkThinkingModeFilter: "Benchmark 思考模式筛选",
          benchmarkBatchProfiles: "远端批量对照",
          benchmarkBatchProfilesHint: "对远端目标一次跑 speed / balanced / tool-first / thinking 四组对照。",
          benchmarkBatchScope: "批量范围",
          benchmarkBatchScopeHint: "完整套件适合正式深度对比；对比子集更适合快速看不同 profile 的差异。",
          benchmarkBatchScopeFull: "完整套件",
          benchmarkBatchScopeSubset: "对比子集",
          benchmarkProgress: "Benchmark 进度",
          benchmarkProgressEta: "预计剩余",
          benchmarkProgressElapsed: "已执行",
          benchmarkProgressCurrent: "最近完成",
          benchmarkProgressCompleted: "已完成样本",
          benchmarkHeatmap: "Benchmark 交叉热力图",
          benchmarkHeatmapMetric: "热力图指标",
          saveBaseline: "保存 Baseline",
          savingBaseline: "保存中...",
          baselineSaved: "Baseline 已保存。",
          latestBaseline: "最新 Baseline",
          benchmarkBaselineDelta: "Baseline 差值",
          benchmarkNoBaselineComparison: "当前没有可对比的 Baseline 结果。",
          compareLastRun: "对比上次结果",
          benchmarkThinkingStandard: "标准",
          benchmarkThinkingThinking: "Thinking / 满血版",
          benchmarkScore: "质量分数",
          benchmarkPassRate: "通过率",
          runBenchmark: "执行 Benchmark",
          benchmarking: "Benchmark 中...",
          benchmarkNoData: "还没有本地 Benchmark 结果",
          benchmarkHistory: "Benchmark 历史",
          benchmarkTrendTitle: "Benchmark 趋势",
          benchmarkSuccessRate: "成功率",
          exportMarkdown: "导出 Markdown",
          exportJson: "导出 JSON",
          exportRegressionReport: "导出回归报告",
          percentiles: "分位数",
          exportWindow: "导出时间窗口",
          sampleFilter: "样本筛选",
          allSamples: "全部样本",
          successSamples: "成功样本",
          failedSamples: "失败样本",
          historyFilter: "历史记录筛选",
          allHistory: "全部记录",
          successHistory: "仅成功记录",
          failedHistory: "仅失败记录",
          compareView: "对比视图",
          compareTargets: "对比目标",
          firstTokenLatency: "首字延时",
          totalLatency: "总耗时",
          tokenThroughput: "Token 吞吐",
          tokensPerSecond: "Token/秒",
          latencySplit: "上游首字 vs 应用总耗时",
          appOverhead: "应用层额外耗时",
          knowledgeBaseTitle: "知识库与检索",
          knowledgeBaseHint: "管理可检索文档、观察 chunk 统计，并直接验证 grounded 检索命中。",
          knowledgeDocCount: "文档数",
          knowledgeChunkCount: "Chunk 数",
          knowledgeAvgChunkChars: "平均 Chunk 字符数",
          knowledgeAvgChunkTokens: "平均 Chunk Token",
          knowledgeTitle: "文档标题",
          knowledgeSource: "来源",
          knowledgeTags: "标签",
          knowledgeContent: "内容",
          knowledgeSave: "保存文档",
          knowledgeReset: "重置编辑器",
          knowledgeEdit: "编辑",
          knowledgeDelete: "删除",
          knowledgeDeleteConfirm: "确定删除这条知识文档？",
          knowledgeSearch: "检索验证",
          knowledgeSearchPlaceholder: "输入查询，查看 grounded 命中结果",
          knowledgeDocuments: "知识文档",
          knowledgeResults: "命中结果",
          knowledgeNoResults: "当前没有命中结果。",
          knowledgeSection: "章节路径",
          runtimeOps: "本地运行时运维",
          runtimeOpsHint: "直接查看本地模型网关状态，并执行预热、释放、重启与日志读取。",
          runtimeRefresh: "刷新运行时",
          runtimeRefreshing: "刷新中...",
          runtimePrewarmAll: "全部预热",
          runtimePrewarm: "预热模型",
          runtimeRelease: "释放模型",
          runtimeRestart: "重启网关",
          runtimeReadLog: "查看日志",
          loadedAlias: "已加载别名",
          runtimeCurrentLoaded: "当前已加载",
          runtimeSwitchingNow: "正在切模",
          runtimeLastSwitchLoad: "最近切换耗时",
          runtimeLastSwitchAt: "最近切模时间",
          queueLabel: "队列",
          activeLabel: "活跃",
          runtimeSupervisor: "Supervisor",
          runtimeGateway: "Gateway",
          runtimeRestartCount: "重启次数",
          runtimeLastStart: "上次启动",
          runtimeLastExit: "上次退出",
          runtimeLastExitCode: "退出码",
          runtimeLastEvent: "最新事件",
          runtimeEnsureReason: "最近启动原因",
          runtimeLog: "网关日志",
          runtimeNoLog: "当前没有已加载的日志内容。",
          runtimeLogPath: "日志路径"
        };
    }
  }, [locale]);

  useEffect(() => {
    setCompareTargetIds((current) => (current.includes(selectedTargetId) ? current : [...current, selectedTargetId]));
  }, [selectedTargetId]);

  function buildPromptSetEditorState(promptSet?: PromptSetRecord | null): PromptSetEditorState {
    return {
      id: promptSet?.id,
      label: promptSet?.label || "",
      description: promptSet?.description || "",
      promptsText: promptSet?.prompts.join("\n") || ""
    };
  }

  async function loadPromptSets() {
    setPromptSetsPending(true);
    try {
      const response = await fetch("/api/admin/benchmark/prompt-sets", {
        cache: "no-store"
      });
      const payload = (await response.json()) as PromptSetResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load prompt sets.");
      }
      setPromptSets(payload.promptSets || []);
      setPromptSetMessage("");
    } catch (promptSetError) {
      setBenchmarkError((current) =>
        current || (promptSetError instanceof Error ? promptSetError.message : "Failed to load prompt sets.")
      );
    } finally {
      setPromptSetsPending(false);
    }
  }

  function openCreatePromptSetEditor() {
    setPromptSetEditorMode("create");
    setPromptSetEditor(buildPromptSetEditorState());
    setPromptSetMessage("");
  }

  function openEditPromptSetEditor(promptSet?: PromptSetRecord | null) {
    if (!promptSet) return;
    setPromptSetEditorMode("edit");
    setPromptSetEditor(buildPromptSetEditorState(promptSet));
    setPromptSetMessage("");
  }

  async function savePromptSet() {
    const prompts = promptSetEditor.promptsText
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!promptSetEditor.label.trim() || !prompts.length) {
      setBenchmarkError("Prompt set label and prompts are required.");
      return;
    }
    setPromptSetsPending(true);
    try {
      const response = await fetch("/api/admin/benchmark/prompt-sets", {
        method: promptSetEditorMode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: promptSetEditor.id,
          label: promptSetEditor.label,
          description: promptSetEditor.description,
          prompts
        })
      });
      const payload = (await response.json()) as { error?: string; promptSet?: PromptSetRecord };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save prompt set.");
      }
      await loadPromptSets();
      if (payload.promptSet?.id) {
        setBenchmarkPromptSetId(payload.promptSet.id);
      }
      setPromptSetMessage(uiText.benchmarkPromptSetSaved);
      setPromptSetEditorMode("edit");
      setPromptSetEditor(buildPromptSetEditorState(payload.promptSet || null));
    } catch (promptSetError) {
      setBenchmarkError(promptSetError instanceof Error ? promptSetError.message : "Failed to save prompt set.");
    } finally {
      setPromptSetsPending(false);
    }
  }

  async function deletePromptSet(promptSet?: PromptSetRecord | null) {
    if (!promptSet) return;
    if (!window.confirm(`${uiText.benchmarkPromptSetDeleteCurrent}: ${promptSet.label}?`)) return;
    setPromptSetsPending(true);
    try {
      const response = await fetch(`/api/admin/benchmark/prompt-sets?id=${encodeURIComponent(promptSet.id)}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to delete prompt set.");
      }
      await loadPromptSets();
      setPromptSetMessage(uiText.benchmarkPromptSetDeleted);
      setBenchmarkPromptSetId((current) => (current === promptSet.id ? "" : current));
      setPromptSetEditor(buildPromptSetEditorState());
      setPromptSetEditorMode("create");
    } catch (promptSetError) {
      setBenchmarkError(promptSetError instanceof Error ? promptSetError.message : "Failed to delete prompt set.");
    } finally {
      setPromptSetsPending(false);
    }
  }

  function resetKnowledgeEditor() {
    setKnowledgeEditor({
      title: "",
      source: "",
      tagsText: "",
      content: ""
    });
    setKnowledgeMessage("");
    setKnowledgeMessageTone("success");
  }

  async function loadKnowledgeBase(documentId?: string) {
    setKnowledgePending(true);
    try {
      const query = documentId ? `?documentId=${encodeURIComponent(documentId)}` : "";
      const response = await fetch(`/api/admin/knowledge-base${query}`, {
        cache: "no-store"
      });
      const payload = (await response.json()) as KnowledgeBaseResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load knowledge base.");
      }
      setKnowledgeDocuments(payload.documents || []);
      setKnowledgeStats(payload.stats || null);
      setKnowledgeChunks(payload.chunks || []);
      setKnowledgeRecommendedPaths(payload.recommendedImportPaths || []);
      setKnowledgeWorkspaceRoot(payload.workspaceRoot || "");
      setKnowledgeMessage("");
      setKnowledgeMessageTone("success");
    } catch (knowledgeError) {
      setBenchmarkError((current) =>
        current || (knowledgeError instanceof Error ? knowledgeError.message : "Failed to load knowledge base.")
      );
    } finally {
      setKnowledgePending(false);
    }
  }

  function highlightImportedKnowledgeDocuments(documentIds: string[]) {
    const nextIds = documentIds.filter(Boolean);
    if (!nextIds.length) return;
    if (knowledgeHighlightTimeoutRef.current) {
      clearTimeout(knowledgeHighlightTimeoutRef.current);
    }
    setHighlightedKnowledgeDocumentIds(nextIds);
    knowledgeHighlightTimeoutRef.current = setTimeout(() => {
      setHighlightedKnowledgeDocumentIds([]);
      knowledgeHighlightTimeoutRef.current = null;
    }, 12000);
  }

  async function saveKnowledgeDocument() {
    if (!knowledgeEditor.title.trim() || !knowledgeEditor.content.trim()) {
      setBenchmarkError("Knowledge title and content are required.");
      return;
    }
    setKnowledgePending(true);
    setKnowledgeActionPending("save");
    try {
      const response = await fetch("/api/admin/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: knowledgeEditor.id,
          title: knowledgeEditor.title,
          source: knowledgeEditor.source,
          tags: knowledgeEditor.tagsText,
          content: knowledgeEditor.content
        })
      });
      const payload = (await response.json()) as {
        error?: string;
        document?: AgentKnowledgeDocument;
        stats?: KnowledgeBaseResponse["stats"];
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save knowledge document.");
      }
      await loadKnowledgeBase(payload.document?.id);
      setKnowledgeMessage(uiText.knowledgeSave);
      setKnowledgeMessageTone("success");
      if (payload.document) {
        setKnowledgeEditor({
          id: payload.document.id,
          title: payload.document.title,
          source: payload.document.source || "",
          tagsText: payload.document.tags.join(", "),
          content: payload.document.content
        });
      }
    } catch (knowledgeError) {
      setBenchmarkError(
        knowledgeError instanceof Error ? knowledgeError.message : "Failed to save knowledge document."
      );
    } finally {
      setKnowledgePending(false);
      setKnowledgeActionPending("");
    }
  }

  async function probeKnowledgePath(nextPath?: string) {
    const normalizedPath = (nextPath ?? knowledgeImportPath).trim();
    if (!normalizedPath) {
      setKnowledgeMessage(
        locale.startsWith("en") ? "Please fill in an absolute local path before importing." : "请先填写本地绝对路径，再执行导入。"
      );
      setKnowledgeMessageTone("error");
      knowledgeImportInputRef.current?.focus();
      return;
    }
    if (nextPath) {
      setKnowledgeImportPath(normalizedPath);
    }
    setKnowledgePending(true);
    setKnowledgeActionPending("probe");
    setKnowledgeMessage("");
    try {
      const response = await fetch("/api/admin/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importMode: "path-probe",
          path: normalizedPath,
          recursive: knowledgeImportRecursive,
          tags: knowledgeImportTags
        })
      });
      const payload = (await response.json()) as {
        error?: string;
        inspection?: KnowledgeImportPreview;
        supportedExtensions?: string[];
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to inspect knowledge path.");
      }
      setKnowledgeImportPreview(
        payload.inspection
          ? {
              ...payload.inspection,
              supportedExtensions: payload.supportedExtensions || []
            }
          : null
      );
      rememberKnowledgeImportPath(normalizedPath);
      setKnowledgeMessage(
        locale.startsWith("en")
          ? `Path check complete. Found ${payload.inspection?.importableCount || 0} importable files.`
          : `路径检查完成，发现 ${payload.inspection?.importableCount || 0} 个可导入文件。`
      );
      setKnowledgeMessageTone("success");
    } catch (knowledgeError) {
      setKnowledgeMessage(
        knowledgeError instanceof Error ? knowledgeError.message : "Failed to inspect knowledge path."
      );
      setKnowledgeMessageTone("error");
    } finally {
      setKnowledgePending(false);
      setKnowledgeActionPending("");
    }
  }

  async function importKnowledgePath() {
    const normalizedPath = knowledgeImportPath.trim();
    if (!normalizedPath) {
      setKnowledgeMessage(
        locale.startsWith("en") ? "Please fill in an absolute local path before importing." : "请先填写本地绝对路径，再执行导入。"
      );
      setKnowledgeMessageTone("error");
      knowledgeImportInputRef.current?.focus();
      return;
    }
    setKnowledgePending(true);
    setKnowledgeActionPending("import");
    setKnowledgeMessage("");
    try {
      const response = await fetch("/api/admin/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importMode: "path",
          path: normalizedPath,
          recursive: knowledgeImportRecursive,
          tags: knowledgeImportTags
        })
      });
      const payload = (await response.json()) as {
        error?: string;
        importedCount?: number;
        importedDocuments?: AgentKnowledgeDocument[];
        inspection?: KnowledgeImportPreview;
        supportedExtensions?: string[];
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to import knowledge path.");
      }
      await loadKnowledgeBase();
      setKnowledgeImportPreview(
        payload.inspection
          ? {
              ...payload.inspection,
              supportedExtensions: payload.supportedExtensions || []
            }
          : null
      );
      rememberKnowledgeImportPath(normalizedPath);
      highlightImportedKnowledgeDocuments((payload.importedDocuments || []).map((document) => document.id));
      setKnowledgeMessage(
        locale.startsWith("en")
          ? `Imported ${payload.importedCount || 0} documents from path.`
          : `已从路径导入 ${payload.importedCount || 0} 个文档。`
      );
      setKnowledgeMessageTone("success");
    } catch (knowledgeError) {
      setKnowledgeMessage(
        knowledgeError instanceof Error ? knowledgeError.message : "Failed to import knowledge path."
      );
      setKnowledgeMessageTone("error");
    } finally {
      setKnowledgePending(false);
      setKnowledgeActionPending("");
    }
  }

  async function probeAndImportKnowledgePath(nextPath: string) {
    const normalizedPath = nextPath.trim();
    if (!normalizedPath) return;
    setKnowledgeImportPath(normalizedPath);
    setKnowledgeImportPreview(null);
    setKnowledgePending(true);
    setKnowledgeActionPending("probe");
    setKnowledgeMessage("");
    try {
      const probeResponse = await fetch("/api/admin/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importMode: "path-probe",
          path: normalizedPath,
          recursive: knowledgeImportRecursive,
          tags: knowledgeImportTags
        })
      });
      const probePayload = (await probeResponse.json()) as {
        error?: string;
        inspection?: KnowledgeImportPreview;
        supportedExtensions?: string[];
      };
      if (!probeResponse.ok) {
        throw new Error(probePayload.error || "Failed to inspect knowledge path.");
      }
      setKnowledgeImportPreview(
        probePayload.inspection
          ? {
              ...probePayload.inspection,
              supportedExtensions: probePayload.supportedExtensions || []
            }
          : null
      );
      setKnowledgeActionPending("import");
      const importResponse = await fetch("/api/admin/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importMode: "path",
          path: normalizedPath,
          recursive: knowledgeImportRecursive,
          tags: knowledgeImportTags
        })
      });
      const importPayload = (await importResponse.json()) as {
        error?: string;
        importedCount?: number;
        importedDocuments?: AgentKnowledgeDocument[];
        inspection?: KnowledgeImportPreview;
        supportedExtensions?: string[];
      };
      if (!importResponse.ok) {
        throw new Error(importPayload.error || "Failed to import knowledge path.");
      }
      await loadKnowledgeBase();
      setKnowledgeImportPreview(
        importPayload.inspection
          ? {
              ...importPayload.inspection,
              supportedExtensions: importPayload.supportedExtensions || []
            }
          : probePayload.inspection
            ? {
                ...probePayload.inspection,
                supportedExtensions: probePayload.supportedExtensions || []
              }
            : null
      );
      rememberKnowledgeImportPath(normalizedPath);
      highlightImportedKnowledgeDocuments((importPayload.importedDocuments || []).map((document) => document.id));
      setKnowledgeMessage(
        locale.startsWith("en")
          ? `Scanned and imported ${importPayload.importedCount || 0} documents.`
          : `已完成扫描并导入 ${importPayload.importedCount || 0} 个文档。`
      );
      setKnowledgeMessageTone("success");
    } catch (knowledgeError) {
      setKnowledgeMessage(
        knowledgeError instanceof Error ? knowledgeError.message : "Failed to scan and import knowledge path."
      );
      setKnowledgeMessageTone("error");
    } finally {
      setKnowledgePending(false);
      setKnowledgeActionPending("");
    }
  }

  function fillKnowledgeImportWorkspacePath() {
    const docsPath = knowledgeRecommendedPaths[0] || `${knowledgeWorkspaceRoot || "/Users/chenhaorui/Documents/New project"}/docs`;
    setKnowledgeImportPath(docsPath);
    setKnowledgeImportPreview(null);
    setKnowledgeMessage(
      locale.startsWith("en")
        ? "Filled with the current workspace docs path. You can still edit it before importing."
        : "已填入当前工作区 docs 路径，导入前仍可自行修改。"
    );
    setKnowledgeMessageTone("success");
    knowledgeImportInputRef.current?.focus();
  }

  function fillKnowledgeImportWorkspaceRootPath() {
    const rootPath = knowledgeRecommendedPaths[1] || knowledgeWorkspaceRoot || "/Users/chenhaorui/Documents/New project";
    setKnowledgeImportPath(rootPath);
    setKnowledgeImportPreview(null);
    setKnowledgeMessage(
      locale.startsWith("en")
        ? "Filled with the current workspace root path. Review the preview before importing."
        : "已填入当前工作区根目录，建议先检查预览再导入。"
    );
    setKnowledgeMessageTone("success");
    knowledgeImportInputRef.current?.focus();
  }

  function rememberKnowledgeImportPath(nextPath: string) {
    if (typeof window === "undefined" || !nextPath.trim()) return;
    const normalizedPath = nextPath.trim();
    setKnowledgeRecentPaths((current) => {
      const existing = current.find((entry) => entry.path === normalizedPath);
      const nextEntries = [
        { path: normalizedPath, pinned: existing?.pinned || false },
        ...current.filter((entry) => entry.path !== normalizedPath)
      ]
        .sort((left, right) => Number(right.pinned) - Number(left.pinned))
        .slice(0, 6);
      window.localStorage.setItem(KNOWLEDGE_IMPORT_HISTORY_KEY, JSON.stringify(nextEntries));
      return nextEntries;
    });
  }

  function fillKnowledgeImportRecentPath(nextPath: string) {
    setKnowledgeImportPath(nextPath);
    setKnowledgeImportPreview(null);
    setKnowledgeMessage("");
    knowledgeImportInputRef.current?.focus();
  }

  function toggleKnowledgeImportRecentPathPin(nextPath: string) {
    if (typeof window === "undefined") return;
    setKnowledgeRecentPaths((current) => {
      const nextEntries = current
        .map((entry) =>
          entry.path === nextPath
            ? { ...entry, pinned: !entry.pinned }
            : entry
        )
        .sort((left, right) => Number(right.pinned) - Number(left.pinned))
        .slice(0, 6);
      window.localStorage.setItem(KNOWLEDGE_IMPORT_HISTORY_KEY, JSON.stringify(nextEntries));
      return nextEntries;
    });
  }

  function removeKnowledgeImportRecentPath(nextPath: string) {
    if (typeof window === "undefined") return;
    setKnowledgeRecentPaths((current) => {
      const nextEntries = current.filter((entry) => entry.path !== nextPath);
      window.localStorage.setItem(KNOWLEDGE_IMPORT_HISTORY_KEY, JSON.stringify(nextEntries));
      return nextEntries;
    });
  }

  function editKnowledgeDocument(document: AgentKnowledgeDocument) {
    setKnowledgeEditor({
      id: document.id,
      title: document.title,
      source: document.source || "",
      tagsText: document.tags.join(", "),
      content: document.content
    });
    void loadKnowledgeBase(document.id);
  }

  async function deleteKnowledgeDocumentById(document: AgentKnowledgeDocument) {
    if (!window.confirm(uiText.knowledgeDeleteConfirm)) return;
    setKnowledgePending(true);
    try {
      const response = await fetch(`/api/admin/knowledge-base?id=${encodeURIComponent(document.id)}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to delete knowledge document.");
      }
      await loadKnowledgeBase();
      if (knowledgeEditor.id === document.id) {
        resetKnowledgeEditor();
      }
      setKnowledgeMessage(uiText.knowledgeDelete);
    } catch (knowledgeError) {
      setBenchmarkError(
        knowledgeError instanceof Error ? knowledgeError.message : "Failed to delete knowledge document."
      );
    } finally {
      setKnowledgePending(false);
    }
  }

  async function runKnowledgeQuery() {
    if (!knowledgeQuery.trim()) {
      setKnowledgeResults(null);
      return;
    }
    setKnowledgeQueryPending(true);
    try {
      const response = await fetch("/api/admin/knowledge-base/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: knowledgeQuery,
          topK: 6
        })
      });
      const payload = (await response.json()) as { error?: string; retrieval?: AgentRetrievalSummary };
      if (!response.ok) {
        throw new Error(payload.error || "Knowledge query failed.");
      }
      setKnowledgeResults(payload.retrieval || null);
    } catch (knowledgeError) {
      setBenchmarkError(knowledgeError instanceof Error ? knowledgeError.message : "Knowledge query failed.");
    } finally {
      setKnowledgeQueryPending(false);
    }
  }

  async function loadRuntimeStatus(targetId: string) {
    setRuntimeActionPending((current) => ({ ...current, [targetId]: "refresh" }));
    try {
      const response = await fetch(`/api/agent/runtime?targetId=${encodeURIComponent(targetId)}`, {
        cache: "no-store"
      });
      const payload = (await response.json()) as AgentRuntimeStatus & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load runtime status.");
      }
      setRuntimeStatuses((current) => ({
        ...current,
        [targetId]: payload
      }));
      if (payload.message) {
        setRuntimeMessages((current) => ({
          ...current,
          [targetId]: payload.message || ""
        }));
      }
    } finally {
      setRuntimeActionPending((current) => ({ ...current, [targetId]: "" }));
    }
  }

  async function loadAllRuntimeStatuses() {
    await Promise.all(
      localTargets.map(async (target) => {
        try {
          await loadRuntimeStatus(target.id);
        } catch (runtimeError) {
          setRuntimeStatuses((current) => ({
            ...current,
            [target.id]: {
              targetId: target.id,
              targetLabel: target.label,
              execution: "local",
              available: false,
              message: runtimeError instanceof Error ? runtimeError.message : "Failed to load runtime status."
            }
          }));
        }
      })
    );
  }

  async function handleRuntimePrewarm(targetId: string) {
    setRuntimeActionPending((current) => ({ ...current, [targetId]: "prewarm" }));
    try {
      const response = await fetch("/api/agent/runtime/prewarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId })
      });
      const payload = (await response.json()) as AgentRuntimePrewarmResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Prewarm failed.");
      }
      setRuntimeMessages((current) => ({
        ...current,
        [targetId]: payload.message
      }));
      if (payload.status === "ready" && typeof payload.loadMs === "number") {
        const switchedAt = new Date().toISOString();
        setRuntimeLastSwitchMs((current) => ({
          ...current,
          [targetId]: payload.loadMs ?? null
        }));
        setRuntimeLastSwitchAt((current) => ({
          ...current,
          [targetId]: switchedAt
        }));
      }
      await loadRuntimeStatus(targetId);
    } catch (runtimeError) {
      setRuntimeMessages((current) => ({
        ...current,
        [targetId]: runtimeError instanceof Error ? runtimeError.message : "Prewarm failed."
      }));
    } finally {
      setRuntimeActionPending((current) => ({ ...current, [targetId]: "" }));
    }
  }

  async function handleRuntimeAction(
    targetId: string,
    action: Exclude<RuntimeActionKind, "refresh" | "prewarm">,
    options?: { query?: string; limit?: number }
  ) {
    setRuntimeActionPending((current) => ({ ...current, [targetId]: action }));
    try {
      const response = await fetch("/api/agent/runtime/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId,
          action,
          query: options?.query,
          limit: options?.limit
        })
      });
      const payload = (await response.json()) as AgentRuntimeActionResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || payload.message || "Runtime action failed.");
      }
      if (payload.logExcerpt) {
        setRuntimeLogExcerpts((current) => ({
          ...current,
          [targetId]: payload.logExcerpt || ""
        }));
      }
      if (payload.logSummary) {
        setRuntimeLogSummaries((current) => ({
          ...current,
          [targetId]: payload.logSummary || null
        }));
      }
      if (payload.runtime) {
        setRuntimeStatuses((current) => ({
          ...current,
          [targetId]: payload.runtime || null
        }));
      }
      setRuntimeMessages((current) => ({
        ...current,
        [targetId]: payload.message
      }));
      await loadRuntimeStatus(targetId);
    } catch (runtimeError) {
      setRuntimeMessages((current) => ({
        ...current,
        [targetId]: runtimeError instanceof Error ? runtimeError.message : "Runtime action failed."
      }));
    } finally {
      setRuntimeActionPending((current) => ({ ...current, [targetId]: "" }));
    }
  }

  async function handlePrewarmAllRuntimes() {
    setPrewarmAllPending(true);
    try {
      const response = await fetch("/api/agent/runtime/prewarm-all", {
        method: "POST"
      });
      const payload = (await response.json()) as AgentRuntimePrewarmAllResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Prewarm-all failed.");
      }
      const detail = payload.results
        .map((entry) => {
          const statusLabel =
            entry.status === "loading"
              ? "loading"
              : entry.status === "queued"
                ? "queued"
                : entry.status === "failed"
                  ? "failed"
                  : "ready";
          return `${entry.targetLabel}: ${statusLabel}`;
        })
        .join(" · ");
      setPrewarmAllMessage(`${payload.message}${detail ? ` ${detail}` : ""}`);
      setRuntimeLastSwitchMs((current) => {
        const next = { ...current };
        payload.results.forEach((entry) => {
          if (entry.status === "ready" && typeof entry.loadMs === "number") {
            next[entry.targetId] = entry.loadMs;
          }
        });
        return next;
      });
      setRuntimeLastSwitchAt((current) => {
        const next = { ...current };
        payload.results.forEach((entry) => {
          if (entry.status === "ready" && typeof entry.loadMs === "number") {
            next[entry.targetId] = new Date().toISOString();
          }
        });
        return next;
      });
      await loadAllRuntimeStatuses();
    } catch (runtimeError) {
      setPrewarmAllMessage(runtimeError instanceof Error ? runtimeError.message : "Prewarm-all failed.");
    } finally {
      setPrewarmAllPending(false);
    }
  }

  async function handleRuntimeLogSearch(targetId: string) {
    await handleRuntimeAction(targetId, "read_log", {
      query: runtimeLogQueries[targetId] || "",
      limit: runtimeLogLimits[targetId] || 120
    });
  }

  async function loadDashboard() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/dashboard?targetId=${encodeURIComponent(selectedTargetId)}&windowMinutes=${windowMinutes}&provider=${encodeURIComponent(providerFilter)}&providerProfile=${encodeURIComponent(providerProfileFilter)}&benchmarkThinkingMode=${encodeURIComponent(benchmarkThinkingModeFilter)}&benchmarkHeatmapPromptScope=${encodeURIComponent(benchmarkHeatmapPromptScope)}&benchmarkHeatmapSampleStatus=${encodeURIComponent(benchmarkHeatmapSampleStatus)}&benchmarkHeatmapWindowMinutes=${benchmarkHeatmapWindowMinutes}&model=${encodeURIComponent(modelFilter)}&contextWindow=${encodeURIComponent(contextWindowFilter)}&compareTargetIds=${encodeURIComponent(compareTargetIds.join(","))}&benchmarkTargetIds=${encodeURIComponent(benchmarkTargetIds.join(","))}`,
        {
          cache: "no-store"
        }
      );
      const payload = (await response.json()) as DashboardResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Dashboard request failed.");
      }
      setData(payload);
    } catch (dashboardError) {
      setError(dashboardError instanceof Error ? dashboardError.message : "Dashboard request failed.");
    } finally {
      setPending(false);
    }
  }

  async function loadBenchmarkProgress(runId: string) {
    try {
      const response = await fetch(`/api/admin/benchmark/progress?runId=${encodeURIComponent(runId)}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        if (response.status === 404) return;
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Failed to load benchmark progress.");
      }
      const payload = (await response.json()) as AgentBenchmarkProgress;
      setBenchmarkProgress(payload);
      if (payload.status === "running" || payload.status === "pending") {
        setBenchmarkPending(true);
        setBenchmarkRunId(payload.runId);
      } else {
        setBenchmarkPending(false);
        setBenchmarkResumeMessage("");
        await Promise.all([loadDashboard(), loadBenchmarkBaseline()]);
      }
    } catch (progressError) {
      setBenchmarkError((current) =>
        current || (progressError instanceof Error ? progressError.message : "Failed to load benchmark progress.")
      );
    }
  }

  async function loadLatestBenchmarkProgress() {
    try {
      const response = await fetch("/api/admin/benchmark/progress?latest=1&unfinishedOnly=1", {
        cache: "no-store"
      });
      if (!response.ok) {
        if (response.status === 404) {
          setBenchmarkResumeMessage("");
          return;
        }
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Failed to load latest benchmark progress.");
      }
      const payload = (await response.json()) as AgentBenchmarkProgress;
      setBenchmarkProgress(payload);
      if (payload.status === "running" || payload.status === "pending") {
        setBenchmarkRunId(payload.runId);
        setBenchmarkPending(true);
        setBenchmarkResumeMessage(
          [
            locale === "en" ? "Recovered in-progress benchmark monitoring" : "已恢复进行中的 Benchmark 监控",
            payload.suiteLabel || payload.suiteId || payload.benchmarkMode || "--",
            payload.runId
          ].join(" · ")
        );
      }
    } catch (progressError) {
      setBenchmarkError((current) =>
        current || (progressError instanceof Error ? progressError.message : "Failed to load latest benchmark progress.")
      );
    }
  }

  async function continueLatestBenchmarkProgress() {
    setBenchmarkControlPending("continue");
    setBenchmarkError("");
    try {
      await loadLatestBenchmarkProgress();
    } finally {
      setBenchmarkControlPending("");
    }
  }

  async function handleBenchmarkProgressAction(action: "stop" | "abandon") {
    if (!benchmarkProgress?.runId) return;
    if (action === "abandon") {
      const confirmed = window.confirm(
        locale.startsWith("en")
          ? "Abandon this benchmark run? This will clear it from unfinished progress tracking."
          : "确认放弃这个 Benchmark run 吗？放弃后它将不再出现在未完成进度里。"
      );
      if (!confirmed) return;
    }

    setBenchmarkControlPending(action);
    setBenchmarkError("");
    try {
      const response = await fetch("/api/admin/benchmark/progress", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          runId: benchmarkProgress.runId,
          action
        })
      });
      const payload = (await response.json()) as AgentBenchmarkProgress & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update benchmark progress.");
      }
      setBenchmarkProgress(payload);
      if (payload.status === "running" || payload.status === "pending") {
        setBenchmarkPending(true);
      } else {
        setBenchmarkPending(false);
        await Promise.all([loadDashboard(), loadBenchmarkBaseline()]);
      }
    } catch (progressActionError) {
      setBenchmarkError(
        progressActionError instanceof Error ? progressActionError.message : "Failed to update benchmark progress."
      );
    } finally {
      setBenchmarkControlPending("");
    }
  }

  async function runBenchmark() {
    if (!benchmarkTargetIds.length || benchmarkPending) return;
    const runId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `benchmark-${Date.now()}`;
    setBenchmarkPending(true);
    setBenchmarkRunId(runId);
    setBenchmarkProgress(null);
    setBenchmarkError("");
    setBenchmarkBaselineMessage("");
    setBenchmarkResumeMessage("");
    try {
      const profileModes = benchmarkBatchProfiles
        ? [
            { providerProfile: "speed", thinkingMode: "standard" },
            { providerProfile: "balanced", thinkingMode: "standard" },
            { providerProfile: "tool-first", thinkingMode: "standard" },
            { providerProfile: "tool-first", thinkingMode: "thinking" }
          ]
        : undefined;
      const response = await fetch("/api/admin/benchmark", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          benchmarkMode:
            benchmarkPromptMode === "dataset"
              ? "dataset"
              : benchmarkPromptMode === "suite"
                ? "suite"
                : "prompt",
          targetIds: benchmarkTargetIds,
          runs: benchmarkRuns,
          contextWindow: benchmarkContextWindow,
          prompt: benchmarkPromptMode === "custom" ? benchmarkPrompt : undefined,
          promptSetId: benchmarkPromptMode === "prompt-set" ? benchmarkPromptSetId : undefined,
          datasetId: benchmarkPromptMode === "dataset" ? benchmarkDatasetId : undefined,
          datasetSampleLimit: benchmarkPromptMode === "dataset" ? benchmarkDatasetSampleLimit : undefined,
          suiteId: benchmarkPromptMode === "suite" ? benchmarkSuiteId : undefined,
          providerProfile: benchmarkProviderProfile,
          thinkingMode: benchmarkThinkingMode,
          profileModes,
          profileBatchScope: benchmarkBatchProfiles ? benchmarkBatchScope : undefined,
          runId
        })
      });
      const payload = (await response.json()) as AgentBenchmarkResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Benchmark request failed.");
      }
      setBenchmarkData(payload);
      if (payload.runId) {
        await loadBenchmarkProgress(payload.runId);
      }
    } catch (benchmarkRunError) {
      setBenchmarkError(benchmarkRunError instanceof Error ? benchmarkRunError.message : "Benchmark request failed.");
    } finally {
      setBenchmarkPending(false);
    }
  }

  async function loadBenchmarkBaseline() {
    try {
      const query = new URLSearchParams({
        benchmarkMode:
          benchmarkPromptMode === "dataset"
            ? "dataset"
            : benchmarkPromptMode === "suite"
              ? "suite"
              : "prompt",
        targetIds: benchmarkTargetIds.join(","),
        contextWindow: String(benchmarkContextWindow)
      });
      if (benchmarkPromptMode === "prompt-set" && benchmarkPromptSetId) {
        query.set("promptSetId", benchmarkPromptSetId);
      } else if (benchmarkPromptMode === "dataset" && benchmarkDatasetId) {
        query.set("datasetId", benchmarkDatasetId);
        query.set("datasetSampleCount", String(benchmarkDatasetSampleLimit));
      } else if (benchmarkPromptMode === "suite" && benchmarkSuiteId) {
        query.set("suiteId", benchmarkSuiteId);
      } else if (benchmarkPrompt.trim()) {
        query.set("prompt", benchmarkPrompt.trim());
      }
      if (benchmarkBatchProfiles) {
        query.set("profileBatchScope", benchmarkBatchScope);
      }
      const response = await fetch(`/api/admin/benchmark/baseline?${query.toString()}`, {
        cache: "no-store"
      });
      const payload = (await response.json()) as BenchmarkBaselineResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load benchmark baseline.");
      }
      setBenchmarkBaseline(payload.baseline);
      setBenchmarkBaselines(payload.baselines || []);
    } catch (baselineError) {
      setBenchmarkError((current) =>
        current || (baselineError instanceof Error ? baselineError.message : "Failed to load benchmark baseline.")
      );
    }
  }

  async function renameBenchmarkBaseline(baseline: BenchmarkBaselineRecord) {
    const nextLabel = window.prompt(uiText.benchmarkBaselineRename, baseline.label || "");
    if (nextLabel === null) return;
    setBenchmarkBaselinePending(true);
    setBenchmarkBaselineMessage("");
    try {
      const response = await fetch("/api/admin/benchmark/baseline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rename",
          id: baseline.id,
          label: nextLabel
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to rename benchmark baseline.");
      }
      await loadBenchmarkBaseline();
    } catch (baselineError) {
      setBenchmarkError(baselineError instanceof Error ? baselineError.message : "Failed to rename benchmark baseline.");
    } finally {
      setBenchmarkBaselinePending(false);
    }
  }

  async function deleteSelectedBenchmarkBaseline(baseline: BenchmarkBaselineRecord) {
    if (!window.confirm(`${uiText.benchmarkBaselineDelete}: ${baseline.label || baseline.savedAt}?`)) return;
    setBenchmarkBaselinePending(true);
    setBenchmarkBaselineMessage("");
    try {
      const response = await fetch(`/api/admin/benchmark/baseline?id=${encodeURIComponent(baseline.id)}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to delete benchmark baseline.");
      }
      await loadBenchmarkBaseline();
    } catch (baselineError) {
      setBenchmarkError(baselineError instanceof Error ? baselineError.message : "Failed to delete benchmark baseline.");
    } finally {
      setBenchmarkBaselinePending(false);
    }
  }

  async function setDefaultBenchmarkBaseline(baseline: BenchmarkBaselineRecord) {
    setBenchmarkBaselinePending(true);
    setBenchmarkBaselineMessage("");
    try {
      const response = await fetch("/api/admin/benchmark/baseline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_default",
          id: baseline.id
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to set benchmark baseline.");
      }
      await loadBenchmarkBaseline();
    } catch (baselineError) {
      setBenchmarkError(baselineError instanceof Error ? baselineError.message : "Failed to set benchmark baseline.");
    } finally {
      setBenchmarkBaselinePending(false);
    }
  }

  async function saveBenchmarkBaseline() {
    if (!benchmarkData || benchmarkBaselinePending) return;
    setBenchmarkBaselinePending(true);
    setBenchmarkBaselineMessage("");
    try {
      const response = await fetch("/api/admin/benchmark/baseline", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          benchmark: benchmarkData
        })
      });
      const payload = (await response.json()) as { error?: string; baseline?: BenchmarkBaselineResponse["baseline"] };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save benchmark baseline.");
      }
      setBenchmarkBaseline(payload.baseline || null);
      await loadBenchmarkBaseline();
      setBenchmarkBaselineMessage(uiText.baselineSaved);
    } catch (baselineError) {
      setBenchmarkError(baselineError instanceof Error ? baselineError.message : "Failed to save benchmark baseline.");
    } finally {
      setBenchmarkBaselinePending(false);
    }
  }

  function exportBenchmarkHistory(format: "markdown" | "json") {
    const query = new URLSearchParams({
      format,
      benchmarkMode:
        benchmarkPromptMode === "dataset"
          ? "dataset"
          : benchmarkPromptMode === "suite"
            ? "suite"
            : "prompt",
      targetIds: benchmarkTargetIds.join(","),
      windowMinutes: String(benchmarkExportWindowMinutes),
      sampleStatus: benchmarkExportSampleStatus,
      historyStatus: benchmarkExportHistoryStatus,
      providerProfile: benchmarkProviderProfile,
      thinkingMode: benchmarkThinkingMode
    });
    if (benchmarkPromptMode === "prompt-set" && benchmarkPromptSetId) {
      query.set("promptSetId", benchmarkPromptSetId);
    } else if (benchmarkPromptMode === "dataset" && benchmarkDatasetId) {
      query.set("datasetId", benchmarkDatasetId);
    } else if (benchmarkPromptMode === "suite" && benchmarkSuiteId) {
      query.set("suiteId", benchmarkSuiteId);
    } else if (benchmarkPrompt.trim()) {
      query.set("prompt", benchmarkPrompt.trim());
    }
    if (benchmarkBatchProfiles) {
      query.set("profileBatchScope", benchmarkBatchScope);
    }
    if (contextWindowFilter !== "all") {
      query.set("contextWindow", contextWindowFilter);
    }
    window.open(`/api/admin/benchmark/export?${query.toString()}`, "_blank");
  }

  function exportBenchmarkRegressionReport() {
    const query = new URLSearchParams({
      benchmarkMode:
        benchmarkPromptMode === "dataset"
          ? "dataset"
          : benchmarkPromptMode === "suite"
            ? "suite"
            : "prompt",
      targetIds: benchmarkTargetIds.join(","),
      windowMinutes: String(benchmarkExportWindowMinutes),
      providerProfile: benchmarkProviderProfile,
      thinkingMode: benchmarkThinkingMode
    });
    if (benchmarkPromptMode === "prompt-set" && benchmarkPromptSetId) {
      query.set("promptSetId", benchmarkPromptSetId);
    } else if (benchmarkPromptMode === "dataset" && benchmarkDatasetId) {
      query.set("datasetId", benchmarkDatasetId);
    } else if (benchmarkPromptMode === "suite" && benchmarkSuiteId) {
      query.set("suiteId", benchmarkSuiteId);
    } else if (benchmarkPrompt.trim()) {
      query.set("prompt", benchmarkPrompt.trim());
    }
    if (benchmarkBatchProfiles) {
      query.set("profileBatchScope", benchmarkBatchScope);
    }
    query.set("contextWindow", String(benchmarkContextWindow));
    window.open(`/api/admin/benchmark/report?${query.toString()}`, "_blank");
  }

  useEffect(() => {
    void loadPromptSets();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(KNOWLEDGE_IMPORT_HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const normalized = parsed.flatMap((entry) => {
        if (typeof entry === "string") {
          return [{ path: entry, pinned: false }];
        }
        if (
          entry &&
          typeof entry === "object" &&
          typeof entry.path === "string"
        ) {
          return [{ path: entry.path, pinned: Boolean(entry.pinned) }];
        }
        return [];
      });
      setKnowledgeRecentPaths(
        normalized
          .sort((left, right) => Number(right.pinned) - Number(left.pinned))
          .slice(0, 6)
      );
    } catch {
      // Ignore malformed local history and keep the current UI usable.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(RUNTIME_SWITCH_HISTORY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, { loadMs?: number | null; switchedAt?: string | null }>;
      if (!parsed || typeof parsed !== "object") return;
      const nextLoadMs: Record<string, number | null> = {};
      const nextSwitchedAt: Record<string, string | null> = {};
      for (const [targetId, entry] of Object.entries(parsed)) {
        nextLoadMs[targetId] =
          typeof entry?.loadMs === "number" && Number.isFinite(entry.loadMs) ? entry.loadMs : null;
        nextSwitchedAt[targetId] = typeof entry?.switchedAt === "string" ? entry.switchedAt : null;
      }
      setRuntimeLastSwitchMs(nextLoadMs);
      setRuntimeLastSwitchAt(nextSwitchedAt);
    } catch {
      // Ignore malformed local cache and keep runtime panels usable.
    }
  }, []);

  useEffect(() => {
    void loadKnowledgeBase();
  }, []);

  useEffect(() => {
    if (!highlightedKnowledgeDocumentIds.length) return;
    const firstId = highlightedKnowledgeDocumentIds[0];
    window.requestAnimationFrame(() => {
      document
        .getElementById(`knowledge-document:${firstId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [highlightedKnowledgeDocumentIds]);

  useEffect(() => {
    void loadAllRuntimeStatuses();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const targetIds = new Set([...Object.keys(runtimeLastSwitchMs), ...Object.keys(runtimeLastSwitchAt)]);
    const payload: Record<string, RuntimeSwitchHistoryEntry> = {};
    targetIds.forEach((targetId) => {
      payload[targetId] = {
        loadMs: runtimeLastSwitchMs[targetId] ?? null,
        switchedAt: runtimeLastSwitchAt[targetId] ?? null
      };
    });
    window.localStorage.setItem(RUNTIME_SWITCH_HISTORY_STORAGE_KEY, JSON.stringify(payload));
  }, [runtimeLastSwitchAt, runtimeLastSwitchMs]);

  useEffect(() => {
    void loadLatestBenchmarkProgress();
  }, []);

  useEffect(() => {
    if (!promptSets.length) return;
    setBenchmarkPromptSetId((current) => (current && promptSets.some((entry) => entry.id === current) ? current : promptSets[0].id));
  }, [promptSets]);

  useEffect(() => {
    if (!benchmarkDatasets.length) return;
    setBenchmarkDatasetId((current) =>
      current && benchmarkDatasets.some((entry) => entry.id === current) ? current : benchmarkDatasets[0].id
    );
  }, []);

  useEffect(() => {
    if (!benchmarkMilestoneSuites.length) return;
    setBenchmarkSuiteId((current) =>
      current && benchmarkMilestoneSuites.some((entry) => entry.id === current)
        ? current
        : benchmarkMilestoneSuites.find((entry) => entry.reportTier === "milestone")?.id || benchmarkMilestoneSuites[0].id
    );
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [selectedTargetId, windowMinutes, providerFilter, providerProfileFilter, benchmarkThinkingModeFilter, benchmarkHeatmapPromptScope, benchmarkHeatmapSampleStatus, benchmarkHeatmapWindowMinutes, modelFilter, contextWindowFilter, compareTargetIds.join(","), benchmarkTargetIds.join(",")]);

  useEffect(() => {
    void loadBenchmarkBaseline();
  }, [benchmarkTargetIds.join(","), benchmarkContextWindow, benchmarkPromptMode, benchmarkPromptSetId, benchmarkDatasetId, benchmarkSuiteId, benchmarkPrompt, benchmarkBatchProfiles, benchmarkBatchScope]);

  useEffect(() => {
    if (!benchmarkRunId) return;
    const shouldPoll =
      benchmarkPending ||
      benchmarkProgress?.status === "running" ||
      benchmarkProgress?.status === "pending";
    if (!shouldPoll) return;
    void loadBenchmarkProgress(benchmarkRunId);
    const timer = window.setInterval(() => {
      void loadBenchmarkProgress(benchmarkRunId);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [benchmarkPending, benchmarkProgress?.status, benchmarkRunId]);

  useEffect(() => {
    setSelectedComparisonBaselineId((current) =>
      current && benchmarkBaselines.some((entry) => entry.id === current)
        ? current
        : benchmarkBaseline?.id || benchmarkBaselines[0]?.id || ""
    );
  }, [benchmarkBaseline?.id, benchmarkBaselines]);

  useEffect(() => {
    if (!autoRefresh || benchmarkPending) return;
    const timer = window.setInterval(() => {
      void loadDashboard();
      void loadAllRuntimeStatuses();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, benchmarkPending, selectedTargetId, windowMinutes, providerFilter, providerProfileFilter, benchmarkThinkingModeFilter, benchmarkHeatmapPromptScope, benchmarkHeatmapSampleStatus, benchmarkHeatmapWindowMinutes, modelFilter, contextWindowFilter, compareTargetIds.join(","), benchmarkTargetIds.join(",")]);

  const latestTelemetry = data?.latestTelemetry;
  const selectedPromptSet = useMemo(
    () => promptSets.find((entry) => entry.id === benchmarkPromptSetId) || null,
    [benchmarkPromptSetId, promptSets]
  );
  const selectedBenchmarkDataset = useMemo(
    () => benchmarkDatasets.find((entry) => entry.id === benchmarkDatasetId) || null,
    [benchmarkDatasetId]
  );
  const selectedBenchmarkSuite = useMemo(
    () => benchmarkMilestoneSuites.find((entry) => entry.id === benchmarkSuiteId) || null,
    [benchmarkSuiteId]
  );
  useEffect(() => {
    if (!selectedBenchmarkDataset) return;
    setBenchmarkDatasetSampleLimit((current) =>
      current > 0 && current <= selectedBenchmarkDataset.sampleCount ? current : selectedBenchmarkDataset.sampleCount
    );
  }, [selectedBenchmarkDataset]);
  const comparisonBaseline = useMemo(
    () => benchmarkBaselines.find((entry) => entry.id === selectedComparisonBaselineId) || benchmarkBaseline || null,
    [benchmarkBaseline, benchmarkBaselines, selectedComparisonBaselineId]
  );
  const requestValues = useMemo(() => data?.series.requests.map((entry) => entry.value) || [], [data]);
  const tokenValues = useMemo(() => data?.series.totalTokens.map((entry) => entry.value) || [], [data]);
  const memoryValues = useMemo(
    () => data?.series.telemetry.map((entry) => entry.memoryUsedPct ?? 0) || [],
    [data]
  );
  const batteryValues = useMemo(
    () => data?.series.telemetry.map((entry) => entry.batteryPercent ?? 0) || [],
    [data]
  );
  const gpuValues = useMemo(
    () => data?.series.telemetry.map((entry) => entry.gpuProxyPct ?? 0) || [],
    [data]
  );
  const storageValues = useMemo(
    () => data?.series.telemetry.map((entry) => entry.diskUsedPct ?? 0) || [],
    [data]
  );
  const energyValues = useMemo(
    () => data?.series.telemetry.map((entry) => entry.energyProxyPct ?? 0) || [],
    [data]
  );
  const concurrencyValues = useMemo(
    () => data?.series.telemetry.map((entry) => entry.activeForTarget ?? 0) || [],
    [data]
  );
  const firstTokenLatencyValues = useMemo(
    () => data?.series.firstTokenLatency.map((entry) => entry.value) || [],
    [data]
  );
  const totalLatencyValues = useMemo(
    () => data?.series.totalLatency.map((entry) => entry.value) || [],
    [data]
  );
  const appOverheadValues = useMemo(
    () => data?.series.appOverhead.map((entry) => entry.value) || [],
    [data]
  );
  const tokenThroughputValues = useMemo(
    () => data?.series.tokenThroughput.map((entry) => entry.value) || [],
    [data]
  );
  const benchmarkTrendLines = useMemo(
    () =>
      (data?.benchmarkTrends || []).map((entry, index) => ({
        label:
          entry.providerProfile === "default" && entry.thinkingMode === "standard"
            ? `${entry.targetLabel}${entry.resolvedModel ? ` · ${entry.resolvedModel}` : ""}`
            : `${entry.targetLabel} · ${entry.providerProfile}${entry.thinkingMode === "thinking" ? " · thinking" : ""}${entry.resolvedModel ? ` · ${entry.resolvedModel}` : ""}`,
        tone: (["cyan", "emerald", "amber", "violet"] as const)[index % 4],
        firstTokenValues: entry.points.map((point) => point.avgFirstTokenLatencyMs),
        totalLatencyValues: entry.points.map((point) => point.avgLatencyMs),
        throughputValues: entry.points.map((point) => point.avgTokenThroughputTps),
        latestSuccessRate: entry.points.length ? entry.points[entry.points.length - 1].successRate : 0
      })),
    [data]
  );
  const localBenchmarkTargets = useMemo(
    () => benchmarkTargets.filter((target) => target.execution === "local"),
    [benchmarkTargets]
  );
  const remoteBenchmarkTargets = useMemo(
    () => benchmarkTargets.filter((target) => target.execution === "remote"),
    [benchmarkTargets]
  );
  const benchmarkBaselineDeltaRows = useMemo(() => {
    if (!benchmarkData?.results.length || !comparisonBaseline?.results.length) return [];
    const baselineMap = new Map(
      comparisonBaseline.results.map((result) => [
        `${result.targetId}:${result.providerProfile || comparisonBaseline.providerProfile || "default"}:${result.thinkingMode || comparisonBaseline.thinkingMode || "standard"}`,
        result
      ])
    );

    return benchmarkData.results.map((result) => {
      const signature = `${result.targetId}:${result.providerProfile || benchmarkData.providerProfile || "default"}:${result.thinkingMode || benchmarkData.thinkingMode || "standard"}`;
      const baselineResult = baselineMap.get(signature);
      const currentSuccessRate = result.runs > 0 ? Number(((result.okRuns / result.runs) * 100).toFixed(2)) : 0;
      const baselineSuccessRate =
        baselineResult && baselineResult.runs > 0
          ? Number(((baselineResult.okRuns / baselineResult.runs) * 100).toFixed(2))
          : null;

      return {
        targetId: result.targetId,
        targetLabel: result.targetLabel,
        providerProfile: result.providerProfile || benchmarkData.providerProfile || "default",
        thinkingMode: result.thinkingMode || benchmarkData.thinkingMode || "standard",
        execution: result.execution || agentTargets.find((target) => target.id === result.targetId)?.execution || "remote",
        currentModel: result.resolvedModel,
        baselineModel: baselineResult?.resolvedModel,
        baselineMatched: Boolean(baselineResult),
        deltaFirstTokenLatencyMs: baselineResult
          ? Number((result.avgFirstTokenLatencyMs - baselineResult.avgFirstTokenLatencyMs).toFixed(2))
          : null,
        deltaLatencyMs: baselineResult
          ? Number((result.avgLatencyMs - baselineResult.avgLatencyMs).toFixed(2))
          : null,
        deltaTokenThroughputTps: baselineResult
          ? Number((result.avgTokenThroughputTps - baselineResult.avgTokenThroughputTps).toFixed(2))
          : null,
        deltaSuccessRate:
          baselineSuccessRate === null ? null : Number((currentSuccessRate - baselineSuccessRate).toFixed(2)),
        deltaScore:
          typeof result.avgScore === "number" && typeof baselineResult?.avgScore === "number"
            ? Number((result.avgScore - baselineResult.avgScore).toFixed(2))
            : null,
        deltaPassRate:
          typeof result.passRate === "number" && typeof baselineResult?.passRate === "number"
            ? Number((result.passRate - baselineResult.passRate).toFixed(2))
            : null
      };
    });
  }, [comparisonBaseline, benchmarkData]);
  const benchmarkResultGroups = useMemo(() => {
    if (!benchmarkData?.results.length) return [];
    return buildExecutionSections(benchmarkData.results, {
      local: dictionary.common.local,
      remote: dictionary.common.remote
    });
  }, [benchmarkData, dictionary.common.local, dictionary.common.remote]);
  const benchmarkBaselineDeltaGroups = useMemo(() => {
    if (!benchmarkBaselineDeltaRows.length) return [];
    return buildExecutionSections(benchmarkBaselineDeltaRows, {
      local: dictionary.common.local,
      remote: dictionary.common.remote
    });
  }, [benchmarkBaselineDeltaRows, dictionary.common.local, dictionary.common.remote]);
  const benchmarkCompareLastGroups = useMemo(() => {
    if (!benchmarkData?.comparisonsToLast?.length) return [];
    const comparisonRows = benchmarkData.comparisonsToLast.map((row) => ({
      ...row,
      execution:
        row.execution || agentTargets.find((target) => target.id === row.targetId)?.execution || "remote"
    }));
    return buildExecutionSections(comparisonRows, {
      local: dictionary.common.local,
      remote: dictionary.common.remote
    });
  }, [benchmarkData, dictionary.common.local, dictionary.common.remote]);
  const benchmarkHeatmapMetricValues = useMemo(
    () =>
      (data?.benchmarkHeatmap || [])
        .flatMap((row) =>
          row.cells.map((cell) => {
            switch (benchmarkHeatmapMetric) {
              case "first-token":
                return cell.avgFirstTokenLatencyMs;
              case "throughput":
                return cell.avgTokenThroughputTps;
              case "success-rate":
                return cell.avgSuccessRate;
              case "total-latency":
              default:
                return cell.avgLatencyMs;
            }
          })
        )
        .filter((value) => Number.isFinite(value) && value >= 0),
    [benchmarkHeatmapMetric, data]
  );
  const benchmarkHeatmapMetricMin = benchmarkHeatmapMetricValues.length
    ? Math.min(...benchmarkHeatmapMetricValues)
    : 0;
  const benchmarkHeatmapMetricMax = benchmarkHeatmapMetricValues.length
    ? Math.max(...benchmarkHeatmapMetricValues)
    : 0;
  const benchmarkHeatmapHigherIsBetter =
    benchmarkHeatmapMetric === "throughput" || benchmarkHeatmapMetric === "success-rate";
  const selectedBenchmarkTargets = useMemo(
    () => benchmarkTargets.filter((target) => benchmarkTargetIds.includes(target.id)),
    [benchmarkTargets, benchmarkTargetIds]
  );
  const benchmarkTargetVersionMap = useMemo(
    () =>
      new Map(
        (data?.benchmarkTargetVersions || []).map((entry) => [
          entry.targetId,
          {
            standard: entry.standardResolvedModel,
            thinking: entry.thinkingResolvedModel
          }
        ])
      ),
    [data]
  );
  const benchmarkHeatmapScopeSummary = useMemo(() => {
    if (!selectedBenchmarkTargets.length) {
      return locale.startsWith("en") ? "No benchmark target selected." : "当前没有选中 benchmark 目标。";
    }
    if (selectedBenchmarkTargets.length === 1) {
      const target = selectedBenchmarkTargets[0];
      const version = benchmarkTargetVersionMap.get(target.id);
      const versionLabel = version
        ? formatTargetModelVersion(version.standard, version.thinking || undefined)
        : formatTargetModelVersion(target.modelDefault, target.thinkingModelDefault);
      return locale.startsWith("en")
        ? `Current target: ${target.label} · ${versionLabel}`
        : `当前评测对象：${target.label} · ${versionLabel}`;
    }
    const preview = selectedBenchmarkTargets.slice(0, 3).map((target) => target.label).join(" / ");
    const extra = selectedBenchmarkTargets.length > 3 ? ` +${selectedBenchmarkTargets.length - 3}` : "";
    return locale.startsWith("en")
      ? `Current scope: ${selectedBenchmarkTargets.length} targets aggregated · ${preview}${extra}`
      : `当前评测对象：${selectedBenchmarkTargets.length} 个 target 聚合 · ${preview}${extra}`;
  }, [benchmarkTargetVersionMap, locale, selectedBenchmarkTargets]);
  const benchmarkHeatmapScopeHint = useMemo(
    () =>
      locale.startsWith("en")
        ? "This heatmap compares strategy combinations for the selected benchmark targets, not a single-model leaderboard."
        : "这个热力图比较的是所选 benchmark 目标在不同策略组合下的表现，不是单一模型能力榜单。",
    [locale]
  );
  const benchmarkContextRecommendation = useMemo(() => {
    if (locale.startsWith("en")) {
      return "Default benchmark context is 32K for all three local models: Local Qwen3 0.6B, Local Qwen3 4B, and Local Qwen3.5 4B. In compare mode with both local and remote targets selected, remote APIs automatically follow the most conservative effective local context.";
    }
    if (locale === "zh-TW") {
      return "三個本地模型的 benchmark 預設上下文都已統一為 32K：Local Qwen3 0.6B、Local Qwen3 4B、Local Qwen3.5 4B。若對比模式同時選擇本地與遠端目標，遠端 API 會自動跟隨所選本地目標中最保守的有效上下文。";
    }
    return "三个本地模型的 benchmark 默认上下文都已统一为 32K：Local Qwen3 0.6B、Local Qwen3 4B、Local Qwen3.5 4B。若对比模式同时选择本地与远端目标，远端 API 会自动跟随所选本地目标里最保守的有效上下文。";
  }, [locale]);
  const currentBenchmarkFailureSummary = useMemo(
    () =>
      benchmarkData?.results?.length
        ? summarizeBenchmarkFailures(benchmarkData.results, benchmarkData.providerProfile, benchmarkData.thinkingMode)
        : null,
    [benchmarkData]
  );
  const currentBenchmarkFailureDistribution = useMemo(
    () =>
      benchmarkData?.results?.length
        ? summarizeBenchmarkFailureDistribution(
            benchmarkData.results,
            benchmarkData.providerProfile,
            benchmarkData.thinkingMode
          )
        : null,
    [benchmarkData]
  );
  const selectedBenchmarkVersionRows = useMemo(
    () =>
      selectedBenchmarkTargets.map((target) => {
        const version = benchmarkTargetVersionMap.get(target.id);
        return {
          id: target.id,
          label: target.label,
          execution: target.execution,
          standardModel: version?.standard || target.modelDefault,
          thinkingModel: version?.thinking || target.thinkingModelDefault || null
        };
      }),
    [benchmarkTargetVersionMap, selectedBenchmarkTargets]
  );
  const benchmarkQueueSections = useMemo(
    () =>
      benchmarkProgress
        ? [
            {
              key: "active" as const,
              label: formatBenchmarkQueueSectionTitle("active", locale),
              values: benchmarkProgress.activeGroups || []
            },
            {
              key: "pending" as const,
              label: formatBenchmarkQueueSectionTitle("pending", locale),
              values: benchmarkProgress.pendingGroups || []
            },
            {
              key: "recent" as const,
              label: formatBenchmarkQueueSectionTitle("recent", locale),
              values: benchmarkProgress.recentGroups || []
            }
          ].filter((section) => section.values.length > 0)
        : [],
    [benchmarkProgress, locale]
  );

  return (
    <section className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.14),_transparent_26%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] px-4 py-6 text-slate-100 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="order-20 rounded-2xl border border-white/10 bg-slate-950/75 px-5 py-4 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:gap-4">
              <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">{dictionary.nav.dashboard}</p>
              <h1 className="text-xl font-semibold text-white">{dictionary.admin.title}</h1>
              <p className="max-w-3xl text-xs leading-6 text-slate-500">{dictionary.admin.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={selectedTargetId}
                onChange={(event) => setSelectedTargetId(event.target.value)}
                className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none"
              >
                {agentTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label}
                  </option>
                ))}
              </select>
              <select
                value={windowMinutes}
                onChange={(event) => setWindowMinutes(Number(event.target.value))}
                className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none"
              >
                {[30, 60, 180, 720].map((value) => (
                  <option key={value} value={value}>
                    {dictionary.admin.window}: {value}m
                  </option>
                ))}
              </select>
              <select
                value={providerFilter}
                onChange={(event) => setProviderFilter(event.target.value)}
                className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none"
              >
                <option value="all">{uiText.provider}: all</option>
                {(data?.availableProviders || []).map((value) => (
                  <option key={value} value={value}>
                    {uiText.provider}: {value}
                  </option>
                ))}
              </select>
              <select
                value={providerProfileFilter}
                onChange={(event) => setProviderProfileFilter(event.target.value)}
                className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none"
              >
                <option value="all">{uiText.providerProfile}: all</option>
                {(data?.availableProviderProfiles || []).map((value) => (
                  <option key={value} value={value}>
                    {uiText.providerProfile}: {value}
                  </option>
                ))}
              </select>
              <select
                value={benchmarkThinkingModeFilter}
                onChange={(event) => setBenchmarkThinkingModeFilter(event.target.value)}
                className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none"
              >
                <option value="all">{uiText.benchmarkThinkingModeFilter}: all</option>
                {(data?.availableBenchmarkThinkingModes || []).map((value) => (
                  <option key={value} value={value}>
                    {uiText.benchmarkThinkingModeFilter}: {value}
                  </option>
                ))}
              </select>
              <select
                value={modelFilter}
                onChange={(event) => setModelFilter(event.target.value)}
                className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none"
              >
                <option value="all">{uiText.modelFilter}: all</option>
                {(data?.availableModels || []).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <select
                value={contextWindowFilter}
                onChange={(event) => setContextWindowFilter(event.target.value)}
                className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none"
              >
                <option value="all">{uiText.contextWindowFilter}: all</option>
                {(data?.availableContextWindows || []).map((value) => (
                  <option key={value} value={String(value)}>
                    {value >= 1024 ? `${Math.round(value / 1024)}K` : value}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(event) => setAutoRefresh(event.target.checked)}
                />
                {dictionary.admin.autoRefresh}
              </label>
              <button
                type="button"
                onClick={() => {
                  void loadDashboard();
                  void loadAllRuntimeStatuses();
                }}
                className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950"
              >
                {pending ? "..." : dictionary.admin.refresh}
              </button>
            </div>
          </div>
        </header>

        {error ? (
          <div className="order-21 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="order-22 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
            <p className="text-sm text-slate-400">{dictionary.admin.totalRequests}</p>
            <p className="mt-2 text-3xl font-semibold text-white">{data?.summary.totalRequests ?? 0}</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
            <p className="text-sm text-slate-400">{dictionary.admin.activeRequests}</p>
            <p className="mt-2 text-3xl font-semibold text-white">{data?.summary.activeForTarget ?? 0}</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
            <p className="text-sm text-slate-400">{dictionary.admin.totalTokens}</p>
            <p className="mt-2 text-3xl font-semibold text-white">{formatCompactNumber(data?.summary.totalTokens ?? 0)}</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
            <p className="text-sm text-slate-400">{dictionary.admin.failedRequests}</p>
            <p className="mt-2 text-3xl font-semibold text-white">{data?.summary.failedRequests ?? 0}</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
            <p className="text-sm text-slate-400">{dictionary.admin.latestCheck}</p>
            <p className="mt-2 text-3xl font-semibold text-white">
              {data?.summary.latestCheckOk === null
                ? "--"
                : data?.summary.latestCheckOk
                  ? (dictionary.common.ok || "OK")
                  : (dictionary.common.failed || "Failed")}
            </p>
          </div>
        </div>

        <div className="order-23 grid gap-4 xl:grid-cols-3">
          <SeriesCard title={dictionary.admin.requestTrend} values={requestValues} tone="cyan" />
          <SeriesCard title={dictionary.admin.tokenTrend} values={tokenValues} tone="amber" />
          <SeriesCard title={uiText.concurrencyTrend} values={concurrencyValues} tone="violet" />
        </div>

        <div className="order-24 grid gap-4 xl:grid-cols-3">
          <SeriesCard title={uiText.firstTokenLatency} values={firstTokenLatencyValues} tone="emerald" />
          <SeriesCard title={uiText.totalLatency} values={totalLatencyValues} tone="amber" />
          <SeriesCard title={uiText.tokenThroughput} values={tokenThroughputValues} tone="cyan" />
        </div>

        <div className="order-25">
          <MultiSeriesCard
            title={uiText.latencySplit}
            lines={[
              { label: uiText.firstTokenLatency, values: firstTokenLatencyValues, tone: "emerald" },
              { label: uiText.totalLatency, values: totalLatencyValues, tone: "amber" },
              { label: uiText.appOverhead, values: appOverheadValues, tone: "violet" }
            ]}
          />
        </div>

        <div className="order-26 rounded-3xl border border-white/10 bg-slate-950/70 p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-sm text-slate-300">{uiText.compareView}</p>
              <p className="mt-2 text-xs leading-6 text-slate-500">{uiText.compareTargets}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {agentTargets.map((target) => {
                const active = compareTargetIds.includes(target.id);
                return (
                  <button
                    key={target.id}
                    type="button"
                    onClick={() =>
                      setCompareTargetIds((current) =>
                        current.includes(target.id)
                          ? current.length === 1
                            ? current
                            : current.filter((item) => item !== target.id)
                          : [...current, target.id]
                      )
                    }
                    className={`rounded-full border px-3 py-1.5 text-xs transition ${
                      active
                        ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100"
                        : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    {target.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-slate-400">
                <tr>
                  <th className="px-3 py-2">{uiText.compareTargets}</th>
                  <th className="px-3 py-2">{uiText.provider}</th>
                  <th className="px-3 py-2">{dictionary.admin.totalRequests}</th>
                  <th className="px-3 py-2">{dictionary.admin.totalTokens}</th>
                  <th className="px-3 py-2">{dictionary.admin.failedRequests}</th>
                  <th className="px-3 py-2">{dictionary.admin.activeRequests}</th>
                  <th className="px-3 py-2">{uiText.firstTokenLatency}</th>
                  <th className="px-3 py-2">{uiText.totalLatency}</th>
                  <th className="px-3 py-2">{uiText.tokenThroughput}</th>
                  <th className="px-3 py-2">{uiText.percentiles}</th>
                </tr>
              </thead>
              <tbody>
                {data?.comparison.length ? (
                  data.comparison.map((row) => (
                    <tr key={row.targetId} className="border-t border-white/10">
                      <td className="px-3 py-2 text-slate-100">{row.targetLabel}</td>
                      <td className="px-3 py-2 text-slate-300">{row.providerLabel}</td>
                      <td className="px-3 py-2 text-slate-300">{row.totalRequests}</td>
                      <td className="px-3 py-2 text-slate-300">{formatCompactNumber(row.totalTokens)}</td>
                      <td className="px-3 py-2 text-slate-300">{row.failedRequests}</td>
                      <td className="px-3 py-2 text-slate-300">{row.activeForTarget}</td>
                      <td className="px-3 py-2 text-slate-300">{row.avgFirstTokenLatencyMs.toFixed(1)} ms</td>
                      <td className="px-3 py-2 text-slate-300">{row.avgLatencyMs.toFixed(1)} ms</td>
                      <td className="px-3 py-2 text-slate-300">{row.avgTokenThroughputTps.toFixed(2)} {uiText.tokensPerSecond}</td>
                      <td className="px-3 py-2 text-xs text-slate-300">
                        <div>FT P50/P95/P99: {row.firstTokenLatencyPercentiles.p50.toFixed(0)} / {row.firstTokenLatencyPercentiles.p95.toFixed(0)} / {row.firstTokenLatencyPercentiles.p99.toFixed(0)} ms</div>
                        <div className="mt-1">LAT P50/P95/P99: {row.totalLatencyPercentiles.p50.toFixed(0)} / {row.totalLatencyPercentiles.p95.toFixed(0)} / {row.totalLatencyPercentiles.p99.toFixed(0)} ms</div>
                        <div className="mt-1">TPS P50/P95/P99: {row.tokenThroughputPercentiles.p50.toFixed(2)} / {row.tokenThroughputPercentiles.p95.toFixed(2)} / {row.tokenThroughputPercentiles.p99.toFixed(2)}</div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={10}>
                      {dictionary.admin.noData}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="order-1 rounded-3xl border border-white/10 bg-slate-950/70 p-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <p className="text-sm text-slate-300">{uiText.benchmarkTitle}</p>
                <p className="mt-2 text-xs leading-6 text-slate-500">
                  {uiText.benchmarkTargets} · {uiText.firstTokenLatency} / {uiText.totalLatency} / {uiText.tokenThroughput}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => exportBenchmarkHistory("markdown")}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                >
                  {uiText.exportMarkdown}
                </button>
                <button
                  type="button"
                  onClick={() => exportBenchmarkHistory("json")}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                >
                  {uiText.exportJson}
                </button>
                <button
                  type="button"
                  onClick={exportBenchmarkRegressionReport}
                  className="rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/20"
                >
                  {uiText.exportRegressionReport}
                </button>
                <button
                  type="button"
                  disabled={benchmarkPending || !benchmarkTargetIds.length}
                  onClick={() => void runBenchmark()}
                  className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                >
                  {benchmarkPending ? uiText.benchmarking : uiText.runBenchmark}
                </button>
                <button
                  type="button"
                  disabled={!benchmarkData || benchmarkBaselinePending}
                  onClick={() => void saveBenchmarkBaseline()}
                  className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                >
                  {benchmarkBaselinePending ? uiText.savingBaseline : uiText.saveBaseline}
                </button>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px_220px_220px_220px]">
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkPromptMode}</p>
                <select
                  value={benchmarkPromptMode}
                  onChange={(event) => setBenchmarkPromptMode(event.target.value as "custom" | "prompt-set" | "dataset" | "suite")}
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-slate-100 outline-none"
                >
                  <option value="custom">{uiText.benchmarkPromptModeCustom}</option>
                  <option value="prompt-set">{uiText.benchmarkPromptModeFixedSet}</option>
                  <option value="dataset">{uiText.benchmarkPromptModeDataset}</option>
                  <option value="suite">{uiText.benchmarkPromptModeSuite}</option>
                </select>
                {benchmarkPromptMode === "custom" ? (
                  <>
                    <p className="mb-2 mt-4 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkPrompt}</p>
                    <textarea
                      value={benchmarkPrompt}
                      onChange={(event) => setBenchmarkPrompt(event.target.value)}
                      rows={3}
                      className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-slate-100 outline-none"
                    />
                  </>
                ) : benchmarkPromptMode === "prompt-set" ? (
                  <div className="mt-4 space-y-3">
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkPromptSet}</p>
                      <select
                        value={benchmarkPromptSetId}
                        onChange={(event) => setBenchmarkPromptSetId(event.target.value)}
                        disabled={!promptSets.length}
                        className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-slate-100 outline-none"
                      >
                        {promptSets.length ? (
                          promptSets.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.label}
                            </option>
                          ))
                        ) : (
                          <option value="">{uiText.benchmarkPromptSetNoData}</option>
                        )}
                      </select>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-300">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkPromptSetSummary}</p>
                      <p className="mt-2 text-white">{selectedPromptSet?.label || "--"}</p>
                      <p className="mt-2 text-xs leading-6 text-slate-400">{selectedPromptSet?.description || "--"}</p>
                      <p className="mt-2 text-xs text-slate-500">n={selectedPromptSet?.prompts.length || 0}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkPromptSetManage}</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={openCreatePromptSetEditor}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/10"
                          >
                            {uiText.benchmarkPromptSetCreate}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditPromptSetEditor(selectedPromptSet)}
                            disabled={!selectedPromptSet}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
                          >
                            {uiText.benchmarkPromptSetEditCurrent}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deletePromptSet(selectedPromptSet)}
                            disabled={!selectedPromptSet || promptSetsPending}
                            className="rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1.5 text-xs text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                          >
                            {uiText.benchmarkPromptSetDeleteCurrent}
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 space-y-3">
                        <div>
                          <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkPromptSetLabel}</p>
                          <input
                            value={promptSetEditor.label}
                            onChange={(event) =>
                              setPromptSetEditor((current) => ({
                                ...current,
                                label: event.target.value
                              }))
                            }
                            className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-slate-100 outline-none"
                          />
                        </div>
                        <div>
                          <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkPromptSetDescription}</p>
                          <textarea
                            value={promptSetEditor.description}
                            onChange={(event) =>
                              setPromptSetEditor((current) => ({
                                ...current,
                                description: event.target.value
                              }))
                            }
                            rows={2}
                            className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-slate-100 outline-none"
                          />
                        </div>
                        <div>
                          <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkPromptSetPrompts}</p>
                          <textarea
                            value={promptSetEditor.promptsText}
                            onChange={(event) =>
                              setPromptSetEditor((current) => ({
                                ...current,
                                promptsText: event.target.value
                              }))
                            }
                            rows={6}
                            className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-slate-100 outline-none"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void savePromptSet()}
                            disabled={promptSetsPending}
                            className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                          >
                            {promptSetsPending
                              ? "..."
                              : promptSetEditorMode === "create"
                                ? uiText.benchmarkPromptSetCreate
                                : uiText.benchmarkPromptSetUpdate}
                          </button>
                          {promptSetMessage ? <span className="text-xs text-emerald-300">{promptSetMessage}</span> : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : benchmarkPromptMode === "dataset" ? (
                  <div className="mt-4 space-y-3">
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkDataset}</p>
                      <select
                        value={benchmarkDatasetId}
                        onChange={(event) => setBenchmarkDatasetId(event.target.value)}
                        className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-slate-100 outline-none"
                      >
                        {benchmarkDatasets.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-300">
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkDatasetSource}</p>
                        <p className="mt-2 text-white">{selectedBenchmarkDataset?.sourceLabel || "--"}</p>
                        <a
                          href={selectedBenchmarkDataset?.sourceUrl || "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-block text-xs text-cyan-300 underline-offset-4 hover:underline"
                        >
                          {selectedBenchmarkDataset?.sourceUrl || "--"}
                        </a>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-300">
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkDatasetTaskCategory}</p>
                        <p className="mt-2 text-white">{selectedBenchmarkDataset?.taskCategory || "--"}</p>
                        <p className="mt-2 text-xs text-slate-500">{uiText.benchmarkDatasetScoring}: {selectedBenchmarkDataset?.scoringLabel || "--"}</p>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-300">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkPromptSetSummary}</p>
                      <p className="mt-2 text-white">{selectedBenchmarkDataset?.label || "--"}</p>
                      <p className="mt-2 text-xs leading-6 text-slate-400">{selectedBenchmarkDataset?.description || "--"}</p>
                      <p className="mt-2 text-xs text-slate-500">n={selectedBenchmarkDataset?.sampleCount || 0}</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkSuite}</p>
                      <select
                        value={benchmarkSuiteId}
                        onChange={(event) => setBenchmarkSuiteId(event.target.value)}
                        className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-slate-100 outline-none"
                      >
                        {benchmarkMilestoneSuites.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-300">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkFormalReport}</p>
                      <p className="mt-2 text-white">{selectedBenchmarkSuite?.label || "--"}</p>
                      <p className="mt-2 text-xs leading-6 text-slate-400">{selectedBenchmarkSuite?.description || "--"}</p>
                      <p className="mt-2 text-xs text-slate-500">{uiText.benchmarkSuiteTier}: {selectedBenchmarkSuite?.reportTier || "--"} · {uiText.benchmarkSuiteWorkloads}: {selectedBenchmarkSuite?.workloads.length || 0}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkSuiteWorkloads}</p>
                      <div className="mt-3 space-y-2">
                        {selectedBenchmarkSuite?.workloads.map((entry, index) => (
                          <div key={`${entry.kind}:${index}`} className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
                            <span className="font-medium text-white">{entry.kind === "prompt-set" ? entry.promptSetId : entry.datasetId}</span>
                            <span className="ml-2 text-slate-500">runs={entry.runs || benchmarkRuns}</span>
                            {"sampleLimit" in entry && typeof entry.sampleLimit === "number" ? (
                              <span className="ml-2 text-slate-500">n={entry.sampleLimit}</span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkRuns}</p>
                <select
                  value={benchmarkRuns}
                  onChange={(event) => setBenchmarkRuns(Number(event.target.value))}
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-slate-100 outline-none"
                >
                  {[1, 3, 5].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                    ))}
                  </select>
                {benchmarkPromptMode === "dataset" ? (
                  <>
                    <p className="mb-2 mt-4 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkDatasetSampleLimit}</p>
                    <select
                      value={benchmarkDatasetSampleLimit}
                      onChange={(event) => setBenchmarkDatasetSampleLimit(Number(event.target.value))}
                      className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-slate-100 outline-none"
                    >
                      {Array.from({ length: selectedBenchmarkDataset?.sampleCount || 1 }, (_, index) => index + 1).map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </>
                ) : null}
                <p className="mb-2 mt-4 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.contextWindowFilter}</p>
                <select
                  value={benchmarkContextWindow}
                  onChange={(event) => setBenchmarkContextWindow(Number(event.target.value))}
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-slate-100 outline-none"
                >
                  {[4096, 8192, 16384, 32768].map((value) => (
                    <option key={value} value={value}>
                      {value >= 1024 ? `${Math.round(value / 1024)}K` : value}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs leading-6 text-slate-500">{benchmarkContextRecommendation}</p>
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.exportWindow}</p>
                <select
                  value={benchmarkExportWindowMinutes}
                  onChange={(event) => setBenchmarkExportWindowMinutes(Number(event.target.value))}
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-slate-100 outline-none"
                >
                  {[60, 180, 720, 1440].map((value) => (
                    <option key={value} value={value}>
                      {value}m
                    </option>
                  ))}
                </select>
                <p className="mb-2 mt-4 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.sampleFilter}</p>
                <select
                  value={benchmarkExportSampleStatus}
                  onChange={(event) => setBenchmarkExportSampleStatus(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-slate-100 outline-none"
                >
                  <option value="all">{uiText.allSamples}</option>
                  <option value="success">{uiText.successSamples}</option>
                  <option value="failed">{uiText.failedSamples}</option>
                </select>
                <p className="mb-2 mt-4 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.historyFilter}</p>
                <select
                  value={benchmarkExportHistoryStatus}
                  onChange={(event) => setBenchmarkExportHistoryStatus(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-slate-100 outline-none"
                >
                  <option value="all">{uiText.allHistory}</option>
                  <option value="success">{uiText.successHistory}</option>
                  <option value="failed">{uiText.failedHistory}</option>
                </select>
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkProviderProfile}</p>
                <select
                  value={benchmarkProviderProfile}
                  onChange={(event) => setBenchmarkProviderProfile(event.target.value as "speed" | "balanced" | "tool-first")}
                  disabled={benchmarkBatchProfiles}
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-slate-100 outline-none disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-500"
                >
                  <option value="speed">speed</option>
                  <option value="balanced">balanced</option>
                  <option value="tool-first">tool-first</option>
                </select>
                <p className="mb-2 mt-4 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkThinkingMode}</p>
                <select
                  value={benchmarkThinkingMode}
                  onChange={(event) => setBenchmarkThinkingMode(event.target.value as "standard" | "thinking")}
                  disabled={benchmarkBatchProfiles}
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-slate-100 outline-none disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-500"
                >
                  <option value="standard">{uiText.benchmarkThinkingStandard}</option>
                  <option value="thinking">{uiText.benchmarkThinkingThinking}</option>
                </select>
                <label className="mt-4 flex items-start gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={benchmarkBatchProfiles}
                    onChange={(event) => setBenchmarkBatchProfiles(event.target.checked)}
                    className="mt-1 rounded border-white/20 bg-slate-950"
                  />
                  <span>
                    <span className="block font-medium text-white">{uiText.benchmarkBatchProfiles}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">{uiText.benchmarkBatchProfilesHint}</span>
                  </span>
                </label>
                {benchmarkBatchProfiles && benchmarkPromptMode === "suite" ? (
                  <div className="mt-4">
                    <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkBatchScope}</p>
                    <select
                      value={benchmarkBatchScope}
                      onChange={(event) => setBenchmarkBatchScope(event.target.value as BenchmarkBatchScope)}
                      className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-slate-100 outline-none"
                    >
                      <option value="full-suite">{uiText.benchmarkBatchScopeFull}</option>
                      <option value="comparison-subset">{uiText.benchmarkBatchScopeSubset}</option>
                    </select>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{uiText.benchmarkBatchScopeHint}</p>
                  </div>
                ) : null}
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.benchmarkTargets}</p>
                <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">{dictionary.common.local}</p>
                    <p className="mb-3 text-[11px] leading-5 text-slate-500">
                      {locale === "zh-CN"
                        ? "Qwen3.5 4B 为默认本地 4B 主力，Qwen3 4B 保留为对比项。"
                        : locale === "zh-TW"
                          ? "Qwen3.5 4B 為預設本地 4B 主力，Qwen3 4B 保留為對比項。"
                          : locale === "ja"
                            ? "Qwen3.5 4B を既定のローカル 4B 主力とし、Qwen3 4B は比較用として残します。"
                            : locale === "ko"
                              ? "Qwen3.5 4B를 기본 로컬 4B 주력으로 두고, Qwen3 4B는 비교용으로 유지합니다."
                              : "Qwen3.5 4B is now the default local 4B profile; Qwen3 4B remains as the comparison target."}
                    </p>
                    <div className="space-y-2">
                      {localBenchmarkTargets.map((target) => {
                        const checked = benchmarkTargetIds.includes(target.id);
                        const version = benchmarkTargetVersionMap.get(target.id);
                        return (
                          <label key={target.id} className="flex items-start gap-2 text-sm text-slate-300">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                setBenchmarkTargetIds((current) =>
                                  event.target.checked
                                    ? [...current, target.id]
                                    : current.filter((item) => item !== target.id)
                                )
                              }
                              className="mt-1"
                            />
                            <span>
                              <span className="block text-sm text-slate-200">{target.label}</span>
                              <span className="mt-1 block text-[11px] leading-5 text-slate-500">
                                {formatTargetModelVersion(
                                  version?.standard || target.modelDefault,
                                  version?.thinking || target.thinkingModelDefault
                                )}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div className="border-t border-white/10 pt-3">
                    <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">{dictionary.common.remote}</p>
                    <div className="space-y-2">
                      {remoteBenchmarkTargets.map((target) => {
                        const checked = benchmarkTargetIds.includes(target.id);
                        const version = benchmarkTargetVersionMap.get(target.id);
                        return (
                          <label key={target.id} className="flex items-start gap-2 text-sm text-slate-300">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                setBenchmarkTargetIds((current) =>
                                  event.target.checked
                                    ? [...current, target.id]
                                    : current.filter((item) => item !== target.id)
                                )
                              }
                              className="mt-1"
                            />
                            <span>
                              <span className="block text-sm text-slate-200">{target.label}</span>
                              <span className="mt-1 block text-[11px] leading-5 text-slate-500">
                                {formatTargetModelVersion(
                                  version?.standard || target.modelDefault,
                                  version?.thinking || target.thinkingModelDefault
                                )}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {selectedBenchmarkVersionRows.length ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                      {locale.startsWith("en") ? "Resolved benchmark versions" : "当前对接模型版本"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {locale.startsWith("en")
                        ? "The actual model ids used for the selected benchmark targets."
                        : "这里显示当前选中 benchmark 目标实际会对接的模型版本。"}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 xl:grid-cols-2">
                  {selectedBenchmarkVersionRows.map((row) => (
                    <div
                      key={`benchmark-version:${row.id}`}
                      className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3 text-sm text-slate-300"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-white">{row.label}</span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] text-slate-300">
                          {row.execution === "local" ? dictionary.common.local : dictionary.common.remote}
                        </span>
                      </div>
                      <div className="mt-2 space-y-2">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                            {locale.startsWith("en") ? "Standard" : "标准"}
                          </p>
                          <p className="mt-1 break-all font-mono text-[12px] leading-5 text-white">{row.standardModel}</p>
                        </div>
                        {row.thinkingModel ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                              {locale.startsWith("en") ? "Thinking" : "Thinking"}
                            </p>
                            <p className="mt-1 break-all font-mono text-[12px] leading-5 text-white">{row.thinkingModel}</p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {benchmarkError ? (
              <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                {benchmarkError}
              </div>
            ) : null}

            {benchmarkProgress ? (
              <div className="rounded-3xl border border-cyan-400/20 bg-cyan-400/5 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-cyan-100">{uiText.benchmarkProgress}</p>
                    <p className="mt-1 text-xs text-cyan-50/80">
                      {uiText.benchmarkProgressCompleted}: {benchmarkProgress.completedSamples}/{benchmarkProgress.totalSamples}
                      {" · "}
                      {uiText.benchmarkProgressElapsed}: {formatDurationShort(benchmarkProgress.elapsedMs)}
                      {" · "}
                      {uiText.benchmarkProgressEta}: {formatDurationShort(benchmarkProgress.estimatedRemainingMs)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 text-right text-xs text-cyan-50/80">
                    <div>
                      <div>{formatBenchmarkProgressStatus(benchmarkProgress.status, locale)}</div>
                      <div className="mt-1">
                        {benchmarkProgress.completedGroups}/{benchmarkProgress.totalGroups} groups
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void continueLatestBenchmarkProgress()}
                      disabled={benchmarkControlPending !== ""}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-cyan-50 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {benchmarkControlPending === "continue"
                        ? locale.startsWith("en")
                          ? "Connecting..."
                          : "连接中..."
                        : locale.startsWith("en")
                          ? "Continue unfinished"
                          : "继续未完成 run"}
                    </button>
                    {(benchmarkProgress.status === "running" || benchmarkProgress.status === "pending") ? (
                      <button
                        type="button"
                        onClick={() => void handleBenchmarkProgressAction("stop")}
                        disabled={benchmarkControlPending !== ""}
                        className="rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1.5 text-[11px] text-amber-100 transition hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {benchmarkControlPending === "stop"
                          ? locale.startsWith("en")
                            ? "Stopping..."
                            : "停止中..."
                          : locale.startsWith("en")
                            ? "Stop run"
                            : "停止当前 run"}
                      </button>
                    ) : null}
                    {benchmarkProgress.status !== "abandoned" ? (
                      <button
                        type="button"
                        onClick={() => void handleBenchmarkProgressAction("abandon")}
                        disabled={benchmarkControlPending !== ""}
                        className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {benchmarkControlPending === "abandon"
                          ? locale.startsWith("en")
                            ? "Abandoning..."
                            : "放弃中..."
                          : locale.startsWith("en")
                            ? "Abandon run"
                            : "放弃旧 run"}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-cyan-400 transition-all"
                    style={{
                      width: `${Math.max(
                        2,
                        Math.min(
                          100,
                          benchmarkProgress.totalSamples
                            ? (benchmarkProgress.completedSamples / benchmarkProgress.totalSamples) * 100
                            : 0
                        )
                      )}%`
                    }}
                  />
                </div>
                <div className="mt-3 grid gap-2 text-xs text-cyan-50/80 md:grid-cols-3">
                  <div>
                    <span className="text-cyan-100">{uiText.benchmarkProgressCurrent}</span>
                    <div className="mt-1">
                      {benchmarkProgress.lastCompletedTargetLabel || "--"}
                      {benchmarkProgress.lastCompletedProfile ? ` · ${benchmarkProgress.lastCompletedProfile}` : ""}
                      {benchmarkProgress.lastCompletedThinkingMode ? ` · ${benchmarkProgress.lastCompletedThinkingMode}` : ""}
                    </div>
                    <div className="mt-1">{benchmarkProgress.lastCompletedWorkloadLabel || "--"}</div>
                  </div>
                  <div>
                    <span className="text-cyan-100">OK / Failed</span>
                    <div className="mt-1">
                      {benchmarkProgress.okSamples} / {benchmarkProgress.failedSamples}
                    </div>
                  </div>
                  <div>
                    <span className="text-cyan-100">Run ID</span>
                    <div className="mt-1 break-all">{benchmarkProgress.runId}</div>
                  </div>
                </div>
                {benchmarkQueueSections.length ? (
                  <div className="mt-3 grid gap-2 xl:grid-cols-3">
                    {benchmarkQueueSections.map((section) => (
                      <div
                        key={`queue:${section.key}`}
                        className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-cyan-50/80"
                      >
                        <div className="text-cyan-100">{section.label}</div>
                        <div className="mt-2 space-y-2">
                          {section.values.slice(0, 6).map((group) => (
                            <div
                              key={group.key}
                              className="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2"
                            >
                              <div className="font-medium text-white">
                                {group.targetLabel} · {group.providerProfile} · {group.thinkingMode}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-400">
                                {(group.execution || "remote") === "local"
                                  ? dictionary.common.local
                                  : dictionary.common.remote}
                                {group.sampleCount ? ` · n=${group.sampleCount}` : ""}
                                {group.completedAt ? ` · ${new Date(group.completedAt).toLocaleTimeString()}` : ""}
                              </div>
                            </div>
                          ))}
                          {section.values.length > 6 ? (
                            <div className="text-[11px] text-slate-500">+{section.values.length - 6}</div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {benchmarkProgress.status === "failed" && benchmarkProgress.error ? (
                  <div className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-3 py-2.5 text-sm text-rose-100">
                    {benchmarkProgress.error}
                  </div>
                ) : null}
                {benchmarkProgress.controlMessage ? (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-cyan-50/80">
                    {benchmarkProgress.controlMessage}
                  </div>
                ) : null}
                {benchmarkResumeMessage ? (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-cyan-50/80">
                    {benchmarkResumeMessage}
                  </div>
                ) : null}
              </div>
            ) : null}

            {currentBenchmarkFailureSummary ? (
              <div className="rounded-3xl border border-amber-400/20 bg-amber-400/5 px-4 py-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-amber-100">
                      {locale.startsWith("en") ? "Benchmark 失败摘要" : "Benchmark 失败摘要"}
                    </p>
                    <p className="mt-1 text-xs leading-6 text-amber-50/80">
                      {getFailureSummaryNarrative(currentBenchmarkFailureSummary, locale)}
                    </p>
                  </div>
                  <div className="text-right text-xs text-amber-50/80">
                    <div>{locale.startsWith("en") ? "Failed samples" : "Failed samples"}</div>
                    <div className="mt-1 text-base font-semibold text-amber-100">{currentBenchmarkFailureSummary.total}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {currentBenchmarkFailureSummary.groups.slice(0, 4).map((group) => (
                    <span
                      key={`failure-group:${group.label}`}
                      className="rounded-full border border-amber-300/20 bg-black/20 px-3 py-1.5 text-xs text-amber-100"
                      title={group.detail}
                    >
                      {group.label} · {group.count}
                    </span>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 text-xs text-amber-50/80 md:grid-cols-2 xl:grid-cols-3">
                  {currentBenchmarkFailureSummary.examples.map((example, index) => (
                    <div
                      key={`failure-example:${example.targetLabel}:${example.workloadId}:${example.itemId}:${index}`}
                      className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5"
                    >
                      <div className="font-medium text-amber-100">
                        {example.targetLabel} · {example.providerProfile} · {example.thinkingMode}
                      </div>
                      <div className="mt-1">{example.workloadId} · {example.itemId}</div>
                      <div className="mt-1">{example.classified.label}</div>
                      <div className="mt-1">{typeof example.latencyMs === "number" ? `${example.latencyMs.toFixed(0)} ms` : "--"}</div>
                    </div>
                  ))}
                </div>
                {currentBenchmarkFailureDistribution ? (
                  <div className="mt-3 grid gap-2 xl:grid-cols-3">
                    {[
                      {
                        label: locale.startsWith("en") ? "By target" : "按目标分布",
                        values: currentBenchmarkFailureDistribution.byTarget
                      },
                      {
                        label: locale.startsWith("en") ? "By profile" : "按档位/思考模式分布",
                        values: currentBenchmarkFailureDistribution.byProfile
                      },
                      {
                        label: locale.startsWith("en") ? "By workload" : "按 workload 分布",
                        values: currentBenchmarkFailureDistribution.byWorkload
                      },
                      {
                        label: locale.startsWith("en") ? "By reason" : "按失败原因分布",
                        values: currentBenchmarkFailureDistribution.byReason
                      }
                    ].map((section) => (
                      <div
                        key={`failure-distribution:${section.label}`}
                        className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-amber-50/80"
                      >
                        <div className="text-amber-100">{section.label}</div>
                        <div className="mt-2 space-y-2">
                          {section.values.map((entry) => (
                            <div
                              key={`${section.label}:${entry.label}`}
                              className="flex items-start justify-between gap-3"
                            >
                              <div className="min-w-0 flex-1 leading-5">{entry.label}</div>
                              <div className="rounded-full border border-amber-300/20 bg-white/5 px-2 py-0.5 text-[11px] text-amber-100">
                                {entry.count}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-3 xl:grid-cols-3">
              <MultiSeriesCard
                title={uiText.firstTokenLatency}
                lines={benchmarkTrendLines.map((line) => ({
                  label: `${line.label} · ${uiText.benchmarkSuccessRate} ${line.latestSuccessRate.toFixed(0)}%`,
                  values: line.firstTokenValues,
                  tone: line.tone
                }))}
              />
              <MultiSeriesCard
                title={uiText.totalLatency}
                lines={benchmarkTrendLines.map((line) => ({
                  label: `${line.label} · ${uiText.benchmarkSuccessRate} ${line.latestSuccessRate.toFixed(0)}%`,
                  values: line.totalLatencyValues,
                  tone: line.tone
                }))}
              />
              <MultiSeriesCard
                title={uiText.tokenThroughput}
                lines={benchmarkTrendLines.map((line) => ({
                  label: `${line.label} · ${uiText.benchmarkSuccessRate} ${line.latestSuccessRate.toFixed(0)}%`,
                  values: line.throughputValues,
                  tone: line.tone
                }))}
              />
            </div>

            {comparisonBaseline ? (
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-2.5 text-sm text-emerald-100">
                <span className="font-semibold">{uiText.benchmarkBaselineComparisonTarget}</span>
                {" · "}
                {new Date(comparisonBaseline.savedAt).toLocaleString()}
                {" · "}
                {comparisonBaseline.results.length} results
                {comparisonBaseline.promptSetLabel ? ` · ${comparisonBaseline.promptSetLabel}` : ""}
                {comparisonBaseline.datasetLabel ? ` · ${comparisonBaseline.datasetLabel}` : ""}
                {comparisonBaseline.suiteLabel ? ` · ${comparisonBaseline.suiteLabel}` : ""}
                {" · "}
                {comparisonBaseline.label || uiText.latestBaseline}
                {" · "}
                {buildExecutionSections(comparisonBaseline.results, {
                  local: dictionary.common.local,
                  remote: dictionary.common.remote
                })
                  .map((group) => `${group.label} ${group.rows.length}`)
                  .join(" · ")}
              </div>
            ) : null}

            {benchmarkBaselineMessage ? (
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2.5 text-sm text-cyan-100">
                {benchmarkBaselineMessage}
              </div>
            ) : null}

            {benchmarkPromptMode !== "custom" ? (
              <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <p className="text-sm text-slate-300">{uiText.benchmarkBaselinePanel}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {benchmarkPromptMode === "prompt-set"
                        ? `${uiText.benchmarkPromptSet}: ${selectedPromptSet?.label || "--"}`
                        : benchmarkPromptMode === "dataset"
                          ? `${uiText.benchmarkDataset}: ${selectedBenchmarkDataset?.label || "--"}`
                          : `${uiText.benchmarkSuite}: ${selectedBenchmarkSuite?.label || "--"}`}
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-3">
                  {benchmarkBaselines.length ? (
                    benchmarkBaselines.map((entry) => (
                      <article
                        key={entry.id}
                        className={`rounded-3xl border p-4 ${
                          comparisonBaseline?.id === entry.id
                            ? "border-cyan-400/30 bg-cyan-400/10"
                            : "border-white/10 bg-slate-950/70"
                        }`}
                      >
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-base font-semibold text-white">{entry.label || entry.savedAt}</p>
                              {entry.isDefault ? (
                                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200">
                                  {uiText.benchmarkBaselineDefault}
                                </span>
                              ) : null}
                              {comparisonBaseline?.id === entry.id ? (
                                <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-200">
                                  {dictionary.common.active}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-2 text-xs text-slate-400">{new Date(entry.savedAt).toLocaleString()}</p>
                            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                                {uiText.contextWindowFilter}: {entry.contextWindow >= 1024 ? `${Math.round(entry.contextWindow / 1024)}K` : entry.contextWindow}
                              </span>
                              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                                {uiText.benchmarkRuns}: {entry.runs}
                              </span>
                              {entry.promptSetPromptCount ? (
                                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                                  n={entry.promptSetPromptCount}
                                </span>
                              ) : null}
                              {entry.datasetSampleCount ? (
                                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                                  dataset-n={entry.datasetSampleCount}
                                </span>
                              ) : null}
                              {entry.suiteWorkloadCount ? (
                                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                                  workloads={entry.suiteWorkloadCount}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedComparisonBaselineId(entry.id)}
                              disabled={comparisonBaseline?.id === entry.id}
                              className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-xs text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                            >
                              {uiText.benchmarkBaselineUseForComparison}
                            </button>
                            <button
                              type="button"
                              onClick={() => void renameBenchmarkBaseline(entry)}
                              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/10"
                            >
                              {uiText.benchmarkBaselineRename}
                            </button>
                            <button
                              type="button"
                              onClick={() => void setDefaultBenchmarkBaseline(entry)}
                              className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-400/20"
                            >
                              {uiText.benchmarkBaselineSetDefault}
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteSelectedBenchmarkBaseline(entry)}
                              className="rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1.5 text-xs text-rose-100 transition hover:bg-rose-400/20"
                            >
                              {uiText.benchmarkBaselineDelete}
                            </button>
                          </div>
                        </div>
                        <div className="mt-4 space-y-3">
                          {entry.benchmarkMode === "suite" ? (
                            <div className="space-y-1 text-xs text-slate-500">
                              <p>{uiText.benchmarkSuite}: {entry.suiteLabel || "--"} · n={entry.suiteWorkloadCount || 0}</p>
                              {entry.profileBatchScope ? <p>scope={entry.profileBatchScope}</p> : null}
                            </div>
                          ) : entry.benchmarkMode === "dataset" ? (
                            <div className="space-y-1 text-xs text-slate-500">
                              <p>{uiText.benchmarkDataset}: {entry.datasetLabel || "--"} · n={entry.datasetSampleCount || 0}</p>
                              <p>{uiText.benchmarkDatasetSource}: {entry.datasetSourceLabel || "--"}</p>
                            </div>
                          ) : entry.promptSetLabel ? (
                            <p className="text-xs text-slate-500">
                              {uiText.benchmarkPromptSet}: {entry.promptSetLabel} · n={entry.promptSetPromptCount || 0}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-500">{uiText.benchmarkPrompt}: {entry.prompt}</p>
                          )}
                          {buildExecutionSections(entry.results, {
                            local: dictionary.common.local,
                            remote: dictionary.common.remote
                          }).map((group) => (
                            <section key={`${entry.id}:${group.execution}`} className="space-y-3">
                              <div className="flex items-center justify-between gap-3 px-1">
                                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{group.label}</p>
                                <span className="text-[11px] text-slate-500">{group.rows.length} results</span>
                              </div>
                              {group.rows.map((result) => {
                                const hasMetrics = hasSuccessfulBenchmarkMetrics(result);
                                return (
                                  <div
                                    key={`${entry.id}:${result.targetId}:${result.providerProfile || entry.providerProfile || "default"}:${result.thinkingMode || entry.thinkingMode || "standard"}`}
                                    className="rounded-2xl border border-white/10 bg-black/20 p-4"
                                  >
                                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                      <div>
                                        <p className="text-base font-semibold text-slate-100">{result.targetLabel}</p>
                                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                            {result.okRuns}/{result.runs}
                                          </span>
                                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                            {result.providerProfile || entry.providerProfile || "default"}
                                          </span>
                                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                            {result.thinkingMode || entry.thinkingMode || "standard"}
                                          </span>
                                        </div>
                                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                          <span>{dictionary.common.model}</span>
                                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-slate-200">
                                            {result.resolvedModel}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="grid gap-3 text-xs text-slate-400 sm:grid-cols-2 xl:min-w-[420px] xl:grid-cols-5">
                                        <div>
                                          <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.firstTokenLatency}</p>
                                          <p className="mt-2 text-sm text-white">{formatBenchmarkMetric(result.avgFirstTokenLatencyMs, hasMetrics, 1, " ms")}</p>
                                        </div>
                                        <div>
                                          <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.totalLatency}</p>
                                          <p className="mt-2 text-sm text-white">{formatBenchmarkMetric(result.avgLatencyMs, hasMetrics, 1, " ms")}</p>
                                        </div>
                                        <div>
                                          <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.tokenThroughput}</p>
                                          <p className="mt-2 text-sm text-white">{formatBenchmarkMetric(result.avgTokenThroughputTps, hasMetrics, 2, ` ${uiText.tokensPerSecond}`)}</p>
                                        </div>
                                        <div>
                                          <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.benchmarkScore}</p>
                                          <p className="mt-2 text-sm text-white">{typeof result.avgScore === "number" ? result.avgScore.toFixed(2) : "--"}</p>
                                        </div>
                                        <div>
                                          <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.benchmarkPassRate}</p>
                                          <p className="mt-2 text-sm text-white">{typeof result.passRate === "number" ? `${result.passRate.toFixed(2)}%` : "--"}</p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </section>
                          ))}
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">{uiText.benchmarkBaselineNoData}</p>
                  )}
                </div>
              </div>
            ) : null}

            {benchmarkData?.results.length ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>
                      {benchmarkData.benchmarkMode === "suite"
                        ? `${uiText.benchmarkSuite}: ${benchmarkData.suiteLabel || selectedBenchmarkSuite?.label || "--"}`
                        : benchmarkData.benchmarkMode === "dataset"
                          ? `${uiText.benchmarkDataset}: ${benchmarkData.datasetLabel || selectedBenchmarkDataset?.label || "--"}`
                          : benchmarkPromptMode === "prompt-set"
                            ? `${uiText.benchmarkPromptSet}: ${benchmarkData.promptSetLabel || selectedPromptSet?.label || "--"}`
                            : `${uiText.benchmarkPrompt}: ${benchmarkData.prompt}`}
                    </span>
                    {benchmarkData.promptSetPromptCount ? <span>n={benchmarkData.promptSetPromptCount}</span> : null}
                    {benchmarkData.datasetSampleCount ? <span>dataset-n={benchmarkData.datasetSampleCount}</span> : null}
                    {benchmarkData.suiteWorkloadCount ? <span>workloads={benchmarkData.suiteWorkloadCount}</span> : null}
                    {benchmarkData.profileBatchScope ? <span>scope={benchmarkData.profileBatchScope}</span> : null}
                    <span>{uiText.benchmarkRuns}: {benchmarkData.runs}</span>
                  </div>
                </div>
                <div className="space-y-4">
                  {benchmarkResultGroups.map((group) => (
                    <section key={`results:${group.execution}`} className="space-y-3">
                      <div className="flex items-center justify-between gap-3 px-1">
                        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{group.label}</p>
                        <span className="text-[11px] text-slate-500">{group.rows.length} results</span>
                      </div>
                      <div className="space-y-3">
                        {group.rows.map((row) => {
                          const hasMetrics = hasSuccessfulBenchmarkMetrics(row);
                          const failureSummary = summarizeBenchmarkFailures(
                            [row],
                            row.providerProfile || benchmarkData.providerProfile,
                            row.thinkingMode || benchmarkData.thinkingMode
                          );
                          return (
                            <article
                              key={`${row.targetId}:${row.providerProfile || "default"}:${row.thinkingMode || "standard"}`}
                              className="rounded-3xl border border-white/10 bg-slate-950/70 p-4"
                            >
                              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                <div>
                                  <p className="text-base font-semibold text-slate-100">{row.targetLabel}</p>
                                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                      {row.providerProfile || "default"}
                                    </span>
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                      {row.thinkingMode || "standard"}
                                    </span>
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                      {uiText.contextWindowFilter}: {row.contextWindow >= 1024 ? `${Math.round(row.contextWindow / 1024)}K` : row.contextWindow}
                                    </span>
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                      {row.okRuns}/{row.runs}
                                    </span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                    <span>{dictionary.common.model}</span>
                                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-slate-200">
                                      {row.resolvedModel}
                                    </span>
                                  </div>
                                  {failureSummary ? (
                                    <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-xs text-amber-50/80">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium text-amber-100">{getFailureSummaryHeadline(failureSummary, locale)}</span>
                                        {failureSummary.groups.slice(0, 3).map((item) => (
                                          <span
                                            key={`${row.targetId}:${row.providerProfile || "default"}:${row.thinkingMode || "standard"}:${item.label}`}
                                            className="rounded-full border border-amber-300/20 bg-black/20 px-2.5 py-1 text-[11px] text-amber-100"
                                            title={item.detail}
                                          >
                                            {item.label} · {item.count}
                                          </span>
                                        ))}
                                      </div>
                                      <div className="mt-2 text-[11px] text-amber-50/70">{getFailureSummaryNarrative(failureSummary, locale)}</div>
                                    </div>
                                  ) : null}
                                </div>
                                <div className="grid gap-3 text-xs text-slate-400 sm:grid-cols-2 xl:min-w-[520px] xl:grid-cols-5">
                                  <div>
                                    <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.firstTokenLatency}</p>
                                    <p className="mt-2 text-sm text-white">{formatBenchmarkMetric(row.avgFirstTokenLatencyMs, hasMetrics, 1, " ms")}</p>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.totalLatency}</p>
                                    <p className="mt-2 text-sm text-white">{formatBenchmarkMetric(row.avgLatencyMs, hasMetrics, 1, " ms")}</p>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.tokenThroughput}</p>
                                    <p className="mt-2 text-sm text-white">{formatBenchmarkMetric(row.avgTokenThroughputTps, hasMetrics, 2, ` ${uiText.tokensPerSecond}`)}</p>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.benchmarkScore}</p>
                                    <p className="mt-2 text-sm text-white">{typeof row.avgScore === "number" ? row.avgScore.toFixed(2) : "--"}</p>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.benchmarkPassRate}</p>
                                    <p className="mt-2 text-sm text-white">{typeof row.passRate === "number" ? `${row.passRate.toFixed(2)}%` : "--"}</p>
                                  </div>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>

                {comparisonBaseline ? (
                  <div className="space-y-3">
                    {benchmarkBaselineDeltaGroups.length ? (
                      benchmarkBaselineDeltaGroups.map((group) => (
                        <section key={`baseline-delta:${group.execution}`} className="space-y-3">
                          <div className="flex items-center justify-between gap-3 px-1">
                            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{group.label}</p>
                            <span className="text-[11px] text-slate-500">{group.rows.length} deltas</span>
                          </div>
                          {group.rows.map((row) => (
                            <article
                              key={`${row.targetId}:${row.providerProfile}:${row.thinkingMode}:baseline`}
                              className="rounded-3xl border border-white/10 bg-slate-950/70 p-4"
                            >
                              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                <div>
                                  <p className="text-base font-semibold text-slate-100">{row.targetLabel}</p>
                                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                      {row.providerProfile}
                                    </span>
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                      {row.thinkingMode}
                                    </span>
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                      {row.baselineMatched ? new Date(comparisonBaseline.savedAt).toLocaleString() : uiText.benchmarkNoBaselineComparison}
                                    </span>
                                  </div>
                                  <div className="mt-3 text-xs leading-6 text-slate-400">
                                    <div>{dictionary.common.model}: {row.currentModel}</div>
                                    <div>base: {row.baselineModel || "--"}</div>
                                    <div className="mt-1">now: {row.currentModel}</div>
                                  </div>
                                </div>
                                <div className="grid gap-3 text-xs text-slate-400 sm:grid-cols-2 xl:min-w-[620px] xl:grid-cols-6">
                                  <div>
                                    <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.firstTokenLatency}</p>
                                    <p className={`mt-2 text-sm ${buildDeltaClass(row.deltaFirstTokenLatencyMs, true)}`}>{formatSignedNumber(row.deltaFirstTokenLatencyMs, 1, " ms")}</p>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.totalLatency}</p>
                                    <p className={`mt-2 text-sm ${buildDeltaClass(row.deltaLatencyMs, true)}`}>{formatSignedNumber(row.deltaLatencyMs, 1, " ms")}</p>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.tokenThroughput}</p>
                                    <p className={`mt-2 text-sm ${buildDeltaClass(row.deltaTokenThroughputTps, false)}`}>{formatSignedNumber(row.deltaTokenThroughputTps, 2)}</p>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.benchmarkScore}</p>
                                    <p className={`mt-2 text-sm ${buildDeltaClass(row.deltaScore, false)}`}>{formatSignedNumber(row.deltaScore, 2)}</p>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.benchmarkPassRate}</p>
                                    <p className={`mt-2 text-sm ${buildDeltaClass(row.deltaPassRate, false)}`}>{formatSignedNumber(row.deltaPassRate, 2, "%")}</p>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.benchmarkSuccessRate}</p>
                                    <p className={`mt-2 text-sm ${buildDeltaClass(row.deltaSuccessRate, false)}`}>{formatSignedNumber(row.deltaSuccessRate, 2, "%")}</p>
                                  </div>
                                </div>
                              </div>
                            </article>
                          ))}
                        </section>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-500">
                        {uiText.benchmarkNoBaselineComparison}
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="space-y-4">
                  {benchmarkResultGroups.map((group) => (
                    <section key={`percentiles:${group.execution}`} className="space-y-3">
                      <div className="flex items-center justify-between gap-3 px-1">
                        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{group.label} · {uiText.percentiles}</p>
                        <span className="text-[11px] text-slate-500">{group.rows.length} cards</span>
                      </div>
                      <div className="grid gap-2.5 xl:grid-cols-3">
                        {group.rows.map((row) => {
                          const hasMetrics = hasSuccessfulBenchmarkMetrics(row);
                          return (
                            <div
                              key={`${row.targetId}:${row.providerProfile || "default"}:${row.thinkingMode || "standard"}-percentiles`}
                              className="rounded-2xl border border-white/10 bg-black/20 px-3.5 py-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-medium text-white">{row.targetLabel}</p>
                                <span className="text-[11px] text-slate-500">
                                  {(row.providerProfile || "default")} · {row.thinkingMode || "standard"}
                                </span>
                              </div>
                              {!hasMetrics ? (
                                <p className="mt-2 text-sm text-slate-500">没有成功样本，当前结果不展示分位数。</p>
                              ) : null}
                              <div className="mt-2.5 space-y-2.5">
                                <PercentileRow label={uiText.firstTokenLatency} metrics={row.firstTokenLatencyPercentiles} unit="ms" disabled={!hasMetrics} />
                                <PercentileRow label={uiText.totalLatency} metrics={row.totalLatencyPercentiles} unit="ms" disabled={!hasMetrics} />
                                <PercentileRow label={uiText.tokenThroughput} metrics={row.tokenThroughputPercentiles} unit={uiText.tokensPerSecond} disabled={!hasMetrics} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>

                {benchmarkCompareLastGroups.length ? (
                  <div className="space-y-4">
                    {benchmarkCompareLastGroups.map((group) => (
                      <section key={`compare-last:${group.execution}`} className="space-y-3">
                        <div className="flex items-center justify-between gap-3 px-1">
                          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{group.label} · {uiText.compareLastRun}</p>
                          <span className="text-[11px] text-slate-500">{group.rows.length} rows</span>
                        </div>
                        <div className="overflow-hidden rounded-2xl border border-white/10">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-white/5 text-slate-400">
                              <tr>
                                <th className="px-3 py-2">{uiText.compareLastRun}</th>
                                <th className="px-3 py-2">{uiText.providerProfile}</th>
                                <th className="px-3 py-2">{uiText.benchmarkThinkingMode}</th>
                                <th className="px-3 py-2">{uiText.firstTokenLatency}</th>
                                <th className="px-3 py-2">{uiText.totalLatency}</th>
                                <th className="px-3 py-2">{uiText.tokenThroughput}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((row) => (
                                <tr key={`${row.targetId}:${row.providerProfile}:${row.thinkingMode}:last`} className="border-t border-white/10">
                                  <td className="px-3 py-2 text-slate-100">
                                    <div>{row.targetLabel}</div>
                                    <div className="mt-1 text-xs text-slate-400">
                                      {row.previousGeneratedAt ? new Date(row.previousGeneratedAt).toLocaleString() : "--"}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-slate-300">{row.providerProfile}</td>
                                  <td className="px-3 py-2 text-slate-300">{row.thinkingMode}</td>
                                  <td className="px-3 py-2 text-slate-300">{row.deltaFirstTokenLatencyMs === null || row.deltaFirstTokenLatencyMs === undefined ? "--" : `${row.deltaFirstTokenLatencyMs.toFixed(1)} ms`}</td>
                                  <td className="px-3 py-2 text-slate-300">{row.deltaLatencyMs === null || row.deltaLatencyMs === undefined ? "--" : `${row.deltaLatencyMs.toFixed(1)} ms`}</td>
                                  <td className="px-3 py-2 text-slate-300">{row.deltaTokenThroughputTps === null || row.deltaTokenThroughputTps === undefined ? "--" : row.deltaTokenThroughputTps.toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-500">
                {uiText.benchmarkNoData}
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-300">{uiText.benchmarkHistory}</p>
                <span className="text-[11px] text-slate-500">
                  {uiText.benchmarkTrendTitle} · {data?.benchmarkHistory.length || 0}
                </span>
              </div>
              <div className="mt-3 space-y-3">
                {data?.benchmarkHistory.length ? (
                  data.benchmarkHistory.map((entry) => (
                    <article key={entry.id} className="rounded-3xl border border-white/10 bg-slate-950/70 px-4 py-3.5">
                      {(() => {
                        const entryProfiles = Array.from(
                          new Set(entry.results.map((result) => result.providerProfile || entry.providerProfile || "default"))
                        );
                        const entryThinkingModes = Array.from(
                          new Set(entry.results.map((result) => result.thinkingMode || entry.thinkingMode || "standard"))
                        );
                        const entryExecutionSummary = buildExecutionSections(entry.results, {
                          local: dictionary.common.local,
                          remote: dictionary.common.remote
                        })
                          .map((group) => `${group.label} ${group.rows.length}`)
                          .join(" · ");
                        const profileLabel = entryProfiles.length === 1 ? entryProfiles[0] : "mixed";
                        const thinkingLabel = entryThinkingModes.length === 1 ? entryThinkingModes[0] : "mixed";
                        const failureSummary = summarizeBenchmarkFailures(
                          entry.results,
                          entry.providerProfile,
                          entry.thinkingMode
                        );
                        return (
                          <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="text-base font-semibold text-white">{new Date(entry.generatedAt).toLocaleString()}</p>
                              <div className="mt-2 space-y-1 text-xs text-slate-500">
                                <p>
                                  {entry.benchmarkMode === "suite"
                                    ? `${uiText.benchmarkSuite}: ${entry.suiteLabel || "--"}`
                                    : entry.benchmarkMode === "dataset"
                                      ? `${uiText.benchmarkDataset}: ${entry.datasetLabel || "--"}`
                                      : entry.promptSetLabel
                                        ? `${uiText.benchmarkPromptSet}: ${entry.promptSetLabel}`
                                        : `${uiText.benchmarkPrompt}: ${entry.prompt}`}
                                </p>
                                <p>
                                  {uiText.contextWindowFilter}: {entry.contextWindow >= 1024 ? `${Math.round(entry.contextWindow / 1024)}K` : entry.contextWindow}
                                  {" · "}
                                  {uiText.benchmarkRuns}: {entry.runs}
                                  {" · "}
                                  {uiText.providerProfile}: {profileLabel}
                                  {" · "}
                                  {uiText.benchmarkThinkingMode}: {thinkingLabel}
                                  {entryExecutionSummary ? ` · ${entryExecutionSummary}` : ""}
                                </p>
                              </div>
                              {failureSummary ? (
                                <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-xs text-amber-50/80">
                                  <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                                    <div className="font-medium text-amber-100">{getFailureSummaryHeadline(failureSummary, locale)}</div>
                                    <div>
                                      {getFailureSummaryNarrative(failureSummary, locale)}
                                    </div>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {failureSummary.groups.slice(0, 4).map((group) => (
                                      <span
                                        key={`${entry.id}:failure:${group.label}`}
                                        className="rounded-full border border-amber-300/20 bg-black/20 px-2.5 py-1 text-[11px] text-amber-100"
                                        title={group.detail}
                                      >
                                        {group.label} · {group.count}
                                      </span>
                                    ))}
                                  </div>
                                  {failureSummary.examples[0] ? (
                                    <div className="mt-2 text-[11px] text-amber-50/70">
                                      例如：{failureSummary.examples[0].targetLabel} · {failureSummary.examples[0].providerProfile} · {failureSummary.examples[0].thinkingMode} · {failureSummary.examples[0].workloadId} · {failureSummary.examples[0].classified.label}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                            <div className="text-[11px] text-slate-500">{entry.results.length} results</div>
                          </div>
                        );
                      })()}
                      <div className="mt-3 space-y-3">
                        {entry.benchmarkMode === "suite" ? (
                          <div className="space-y-1 text-xs text-slate-500">
                            <p>{uiText.benchmarkSuite}: {entry.suiteLabel || "--"} · n={entry.suiteWorkloadCount || 0}</p>
                            {entry.profileBatchScope ? <p>scope={entry.profileBatchScope}</p> : null}
                            <p>{uiText.benchmarkPrompt}: {entry.prompt}</p>
                          </div>
                        ) : entry.benchmarkMode === "dataset" ? (
                          <div className="space-y-1 text-xs text-slate-500">
                            <p>{uiText.benchmarkDataset}: {entry.datasetLabel || "--"} · n={entry.datasetSampleCount || 0}</p>
                            <p>{uiText.benchmarkDatasetSource}: {entry.datasetSourceLabel || "--"}</p>
                          </div>
                        ) : entry.promptSetLabel ? (
                          <p className="text-xs text-slate-500">
                            {uiText.benchmarkPromptSet}: {entry.promptSetLabel} · n={entry.promptSetPromptCount || 0}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-500">{uiText.benchmarkPrompt}: {entry.prompt}</p>
                        )}
                        {(() => {
                          const executionGroups = buildExecutionSections(entry.results, {
                            local: dictionary.common.local,
                            remote: dictionary.common.remote
                          });

                          return executionGroups.map((group) => (
                            <section key={`${entry.id}:${group.execution}`} className="space-y-3">
                              <div className="flex items-center justify-between gap-3 px-1">
                                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{group.label}</p>
                                <span className="text-[11px] text-slate-500">{group.rows.length} results</span>
                              </div>
                              {group.rows.map((result) => {
                                const hasMetrics = hasSuccessfulBenchmarkMetrics(result);
                                return (
                                  <div
                                    key={`${entry.id}:${result.targetId}:${result.providerProfile || entry.providerProfile || "default"}:${result.thinkingMode || entry.thinkingMode || "standard"}`}
                                    className="rounded-2xl border border-white/10 bg-black/20 p-4"
                                  >
                                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                      <div>
                                        <p className="text-base font-semibold text-slate-100">{result.targetLabel}</p>
                                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                            {result.okRuns}/{result.runs}
                                          </span>
                                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                            {result.providerProfile || entry.providerProfile || "default"}
                                          </span>
                                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                            {result.thinkingMode || entry.thinkingMode || "standard"}
                                          </span>
                                        </div>
                                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                          <span>{dictionary.common.model}</span>
                                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-slate-200">
                                            {result.resolvedModel}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="grid gap-3 text-xs text-slate-400 sm:grid-cols-2 xl:min-w-[420px] xl:grid-cols-5">
                                        <div>
                                          <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.firstTokenLatency}</p>
                                          <p className="mt-2 text-sm text-white">{formatBenchmarkMetric(result.avgFirstTokenLatencyMs, hasMetrics, 1, " ms")}</p>
                                        </div>
                                        <div>
                                          <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.totalLatency}</p>
                                          <p className="mt-2 text-sm text-white">{formatBenchmarkMetric(result.avgLatencyMs, hasMetrics, 1, " ms")}</p>
                                        </div>
                                        <div>
                                          <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.tokenThroughput}</p>
                                          <p className="mt-2 text-sm text-white">{formatBenchmarkMetric(result.avgTokenThroughputTps, hasMetrics, 2, ` ${uiText.tokensPerSecond}`)}</p>
                                        </div>
                                        <div>
                                          <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.benchmarkScore}</p>
                                          <p className="mt-2 text-sm text-white">{typeof result.avgScore === "number" ? result.avgScore.toFixed(2) : "--"}</p>
                                        </div>
                                        <div>
                                          <p className="uppercase tracking-[0.2em] text-slate-500">{uiText.benchmarkPassRate}</p>
                                          <p className="mt-2 text-sm text-white">{typeof result.passRate === "number" ? `${result.passRate.toFixed(2)}%` : "--"}</p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </section>
                          ));
                        })()}
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">{uiText.benchmarkNoData}</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-slate-400">{uiText.benchmarkHeatmap}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-500">{uiText.providerProfile} × {uiText.benchmarkThinkingMode}</span>
                  <select
                    value={benchmarkHeatmapWindowMinutes}
                    onChange={(event) => setBenchmarkHeatmapWindowMinutes(Number(event.target.value))}
                    className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-slate-100 outline-none"
                  >
                    {[60, 180, 720, 1440].map((value) => (
                      <option key={value} value={value}>
                        {uiText.benchmarkHeatmapWindow}: {value}m
                      </option>
                    ))}
                  </select>
                  <select
                    value={benchmarkHeatmapPromptScope}
                    onChange={(event) => setBenchmarkHeatmapPromptScope(event.target.value as "all" | "fixed-only")}
                    className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-slate-100 outline-none"
                  >
                    <option value="all">{uiText.benchmarkHeatmapPromptScope}: {uiText.benchmarkHeatmapAllPrompts}</option>
                    <option value="fixed-only">{uiText.benchmarkHeatmapPromptScope}: {uiText.benchmarkHeatmapFixedPromptsOnly}</option>
                  </select>
                  <select
                    value={benchmarkHeatmapSampleStatus}
                    onChange={(event) => setBenchmarkHeatmapSampleStatus(event.target.value as "all" | "success" | "failed")}
                    className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-slate-100 outline-none"
                  >
                    <option value="all">{uiText.benchmarkHeatmapSampleStatus}: {uiText.allSamples}</option>
                    <option value="success">{uiText.benchmarkHeatmapSampleStatus}: {uiText.successSamples}</option>
                    <option value="failed">{uiText.benchmarkHeatmapSampleStatus}: {uiText.failedSamples}</option>
                  </select>
                  <select
                    value={benchmarkHeatmapMetric}
                    onChange={(event) => setBenchmarkHeatmapMetric(event.target.value as BenchmarkHeatmapMetricKey)}
                    className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-slate-100 outline-none"
                  >
                    <option value="first-token">{uiText.benchmarkHeatmapMetric}: {uiText.firstTokenLatency}</option>
                    <option value="total-latency">{uiText.benchmarkHeatmapMetric}: {uiText.totalLatency}</option>
                    <option value="throughput">{uiText.benchmarkHeatmapMetric}: {uiText.tokenThroughput}</option>
                    <option value="success-rate">{uiText.benchmarkHeatmapMetric}: {uiText.benchmarkSuccessRate}</option>
                  </select>
                </div>
              </div>
              <div className="mt-2.5 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <p className="text-xs font-medium text-slate-100">{benchmarkHeatmapScopeSummary}</p>
                <p className="mt-1 text-xs leading-6 text-slate-500">{benchmarkHeatmapScopeHint}</p>
              </div>
              <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/5 text-slate-400">
                    <tr>
                      <th className="px-3 py-2">{uiText.providerProfile}</th>
                      <th className="px-3 py-2">standard</th>
                      <th className="px-3 py-2">thinking</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.benchmarkHeatmap || []).map((row) => (
                      <tr key={`heatmap:${row.providerProfile}`} className="border-t border-white/10">
                        <td className="px-3 py-2 text-slate-100">{row.providerProfile}</td>
                        {row.cells.map((cell) => (
                        <td key={`heatmap:${row.providerProfile}:${cell.thinkingMode}`} className="px-3 py-2">
                          {(() => {
                            const hasSamples = cell.sampleCount > 0;
                            const metricValue = benchmarkHeatmapMetric === "first-token"
                              ? cell.avgFirstTokenLatencyMs
                              : benchmarkHeatmapMetric === "throughput"
                                ? cell.avgTokenThroughputTps
                                : benchmarkHeatmapMetric === "success-rate"
                                  ? cell.avgSuccessRate
                                  : cell.avgLatencyMs;
                            const recommendation = getHeatmapRecommendation(
                              row.providerProfile,
                              cell.thinkingMode,
                              hasSamples,
                              locale
                            );
                            return (
                            <div
                              className={`rounded-xl border border-white/10 px-3 py-3 ${
                                hasSamples
                                  ? buildDirectionalHeatmapCellClass(
                                      metricValue,
                                      benchmarkHeatmapMetricMin,
                                      benchmarkHeatmapMetricMax,
                                      benchmarkHeatmapHigherIsBetter
                                    )
                                  : "bg-slate-950/70"
                              }`}
                            >
                              <div className="text-xs uppercase tracking-[0.2em] text-slate-200">{cell.thinkingMode}</div>
                              <div className="mt-2 text-sm font-semibold text-white">
                                {hasSamples
                                  ? benchmarkHeatmapMetric === "first-token"
                                    ? `${cell.avgFirstTokenLatencyMs.toFixed(1)} ms`
                                    : benchmarkHeatmapMetric === "throughput"
                                      ? `${cell.avgTokenThroughputTps.toFixed(2)} ${uiText.tokensPerSecond}`
                                      : benchmarkHeatmapMetric === "success-rate"
                                        ? `${cell.avgSuccessRate.toFixed(1)}%`
                                        : `${cell.avgLatencyMs.toFixed(1)} ms`
                                  : locale.startsWith("en")
                                    ? "No samples yet"
                                    : "暂无样本"}
                              </div>
                              <div className="mt-2 text-xs leading-6 text-slate-100">
                                <div>{uiText.firstTokenLatency}: {hasSamples ? `${cell.avgFirstTokenLatencyMs.toFixed(1)} ms` : locale.startsWith("en") ? "No samples yet" : "暂无样本"}</div>
                                <div>{uiText.totalLatency}: {hasSamples ? `${cell.avgLatencyMs.toFixed(1)} ms` : locale.startsWith("en") ? "No samples yet" : "暂无样本"}</div>
                                <div>{uiText.tokenThroughput}: {hasSamples ? `${cell.avgTokenThroughputTps.toFixed(2)} ${uiText.tokensPerSecond}` : locale.startsWith("en") ? "No samples yet" : "暂无样本"}</div>
                                <div>{uiText.benchmarkSuccessRate}: {hasSamples ? `${cell.avgSuccessRate.toFixed(1)}%` : locale.startsWith("en") ? "No samples yet" : "暂无样本"}</div>
                                <div>{locale.startsWith("en") ? "Recommended use" : "推荐用途"}: {recommendation}</div>
                                <div>{hasSamples ? `n=${cell.sampleCount}` : locale.startsWith("en") ? "No samples yet" : "暂无样本"}</div>
                              </div>
                            </div>
                            );
                          })()}
                        </td>
                      ))}
                    </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="order-30 rounded-3xl border border-white/10 bg-slate-950/70 p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-sm text-slate-300">{uiText.knowledgeBaseTitle}</p>
              <p className="mt-2 text-xs leading-6 text-slate-500">{uiText.knowledgeBaseHint}</p>
            </div>
            <button
              type="button"
              onClick={() => void loadKnowledgeBase(knowledgeEditor.id)}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
            >
              {knowledgePending ? uiText.runtimeRefreshing : uiText.runtimeRefresh}
            </button>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-4">
            <MetricCard label={uiText.knowledgeDocCount} value={knowledgeStats?.documentCount ?? 0} />
            <MetricCard label={uiText.knowledgeChunkCount} value={knowledgeStats?.chunkCount ?? 0} />
            <MetricCard label={uiText.knowledgeAvgChunkChars} value={knowledgeStats?.avgChunkChars?.toFixed(1) || "0.0"} />
            <MetricCard label={uiText.knowledgeAvgChunkTokens} value={knowledgeStats?.avgChunkTokens?.toFixed(1) || "0.0"} />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="grid gap-3">
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                        {locale.startsWith("en") ? "Path import" : "路径导入"}
                      </p>
                      <p className="mt-2 text-xs leading-6 text-slate-400">
                        {locale.startsWith("en")
                          ? "Import a local file or directory into the knowledge base."
                          : "把本地文件或目录直接导入知识库。"}
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={knowledgeImportRecursive}
                        onChange={(event) => setKnowledgeImportRecursive(event.target.checked)}
                      />
                      {locale.startsWith("en") ? "Recursive" : "递归目录"}
                    </label>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                    <input
                      ref={knowledgeImportInputRef}
                      value={knowledgeImportPath}
                      onChange={(event) => {
                        setKnowledgeImportPath(event.target.value);
                        setKnowledgeImportPreview(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void probeKnowledgePath();
                        }
                      }}
                      placeholder={locale.startsWith("en") ? "/absolute/path/to/docs" : "填写本地绝对路径"}
                      className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                    />
                    <input
                      value={knowledgeImportTags}
                      onChange={(event) => setKnowledgeImportTags(event.target.value)}
                      placeholder={locale.startsWith("en") ? "tags (comma separated)" : "标签（逗号分隔）"}
                      className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={fillKnowledgeImportWorkspacePath}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                    >
                      {locale.startsWith("en") ? "Use workspace docs" : "填入当前工作区 docs"}
                    </button>
                    <button
                      type="button"
                      onClick={fillKnowledgeImportWorkspaceRootPath}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                    >
                      {locale.startsWith("en") ? "Use workspace root" : "填入当前工作区根目录"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void probeKnowledgePath()}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                    >
                      {knowledgePending && knowledgeActionPending === "probe"
                        ? locale.startsWith("en")
                          ? "Scanning..."
                          : "检查中"
                        : locale.startsWith("en")
                          ? "Scan path"
                          : "检查路径"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void importKnowledgePath()}
                      className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                    >
                      {knowledgePending && knowledgeActionPending === "import"
                        ? uiText.runtimeRefreshing
                        : locale.startsWith("en")
                          ? "Import path"
                          : "导入路径"}
                    </button>
                    <span className="self-center text-xs text-slate-500">
                      {locale.startsWith("en")
                        ? "Supported: md, txt, rst, json, yaml, ts, tsx, js, jsx, py"
                        : "支持：md、txt、rst、json、yaml、ts、tsx、js、jsx、py"}
                    </span>
                  </div>
                  {knowledgeRecentPaths.length ? (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                        {locale.startsWith("en") ? "Recent import paths" : "最近导入路径"}
                      </p>
                      <div className="mt-2 space-y-2">
                        {knowledgeRecentPaths.map((entry) => (
                          <div key={entry.path} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                            <button
                              type="button"
                              onClick={() => fillKnowledgeImportRecentPath(entry.path)}
                              className="min-w-0 flex-1 break-all text-left text-xs leading-6 text-slate-200 transition hover:text-white"
                            >
                              {entry.path}
                            </button>
                            <button
                              type="button"
                              onClick={() => void probeKnowledgePath(entry.path)}
                              className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-100 transition hover:bg-cyan-400/20"
                            >
                              {locale.startsWith("en") ? "Scan" : "扫描"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void probeAndImportKnowledgePath(entry.path)}
                              className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-100 transition hover:bg-emerald-400/20"
                            >
                              {locale.startsWith("en") ? "Scan + import" : "扫描并导入"}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleKnowledgeImportRecentPathPin(entry.path)}
                              className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
                                entry.pinned
                                  ? "border border-amber-400/20 bg-amber-400/10 text-amber-100"
                                  : "border border-white/10 bg-white/5 text-slate-300"
                              }`}
                            >
                              {entry.pinned
                                ? locale.startsWith("en")
                                  ? "Pinned"
                                  : "已置顶"
                                : locale.startsWith("en")
                                  ? "Pin"
                                  : "置顶"}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeKnowledgeImportRecentPath(entry.path)}
                              className="rounded-full border border-rose-400/20 bg-rose-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-rose-100"
                            >
                              {locale.startsWith("en") ? "Delete" : "删除"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {knowledgeMessage ? (
                    <div
                      className={`mt-3 rounded-2xl border px-3 py-2 text-sm ${
                        knowledgeMessageTone === "error"
                          ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
                          : "border-cyan-400/20 bg-cyan-400/10 text-cyan-100"
                      }`}
                    >
                      {knowledgeMessage}
                    </div>
                  ) : null}
                  {knowledgeImportPreview ? (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-100">
                          {locale.startsWith("en")
                            ? knowledgeImportPreview.kind
                            : knowledgeImportPreview.kind === "directory"
                              ? "目录"
                              : knowledgeImportPreview.kind === "file"
                                ? "文件"
                                : "其他"}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                          {locale.startsWith("en") ? "Importable" : "可导入"} {knowledgeImportPreview.importableCount}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                          {locale.startsWith("en") ? "Skipped" : "跳过"} {knowledgeImportPreview.skippedCount}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                          {locale.startsWith("en") ? "Total files" : "文件总数"} {knowledgeImportPreview.totalFiles}
                        </span>
                      </div>
                      <p className="mt-3 break-all text-xs leading-6 text-slate-300">{knowledgeImportPreview.path}</p>
                      {knowledgeImportPreview.previewFiles.length ? (
                        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                            {locale.startsWith("en") ? "Preview files" : "预览文件"}
                          </p>
                          <div className="mt-2 space-y-1.5">
                            {knowledgeImportPreview.previewFiles.map((filePath) => (
                              <p key={filePath} className="break-all text-xs leading-6 text-slate-200">
                                {filePath}
                              </p>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.knowledgeTitle}</span>
                  <input
                    value={knowledgeEditor.title}
                    onChange={(event) => setKnowledgeEditor((current) => ({ ...current, title: event.target.value }))}
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.knowledgeSource}</span>
                    <input
                      value={knowledgeEditor.source}
                      onChange={(event) => setKnowledgeEditor((current) => ({ ...current, source: event.target.value }))}
                      className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.knowledgeTags}</span>
                    <input
                      value={knowledgeEditor.tagsText}
                      onChange={(event) => setKnowledgeEditor((current) => ({ ...current, tagsText: event.target.value }))}
                      className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                </div>
                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.knowledgeContent}</span>
                  <textarea
                    value={knowledgeEditor.content}
                    onChange={(event) => setKnowledgeEditor((current) => ({ ...current, content: event.target.value }))}
                    rows={14}
                    className="min-h-[280px] rounded-3xl border border-white/10 bg-slate-950/60 px-4 py-4 font-mono text-sm leading-7 text-slate-100 outline-none"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void saveKnowledgeDocument()}
                    className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                  >
                    {knowledgePending ? uiText.runtimeRefreshing : uiText.knowledgeSave}
                  </button>
                  <button
                    type="button"
                    onClick={resetKnowledgeEditor}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                  >
                    {uiText.knowledgeReset}
                  </button>
                  {knowledgeMessage ? (
                    <span
                      className={`self-center text-sm ${
                        knowledgeMessageTone === "error" ? "text-rose-100" : "text-cyan-100"
                      }`}
                    >
                      {knowledgeMessage}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm text-slate-300">{uiText.knowledgeDocuments}</p>
                <div className="mt-3 max-h-[320px] space-y-3 overflow-auto pr-1">
                  {knowledgeDocuments.length ? (
                    knowledgeDocuments.map((document) => (
                      <div
                        key={document.id}
                        id={`knowledge-document:${document.id}`}
                        className={`rounded-2xl border px-3 py-3 transition ${
                          highlightedKnowledgeDocumentIds.includes(document.id)
                            ? "border-cyan-400/30 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]"
                            : "border-white/10 bg-slate-950/60"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-white">{document.title}</p>
                              {highlightedKnowledgeDocumentIds.includes(document.id) ? (
                                <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-100">
                                  {locale.startsWith("en") ? "New import" : "新导入"}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {document.chunkCount} chunks · {new Date(document.updatedAt).toLocaleString()}
                            </p>
                            <p className="mt-2 text-xs leading-6 text-slate-400">
                              {(document.source || "--")} · {document.tags.join(", ") || "--"}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => editKnowledgeDocument(document)}
                              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200"
                            >
                              {uiText.knowledgeEdit}
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteKnowledgeDocumentById(document)}
                              className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-rose-100"
                            >
                              {uiText.knowledgeDelete}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">{uiText.knowledgeNoResults}</p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-300">{uiText.knowledgeSearch}</p>
                  <button
                    type="button"
                    onClick={() => void runKnowledgeQuery()}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                  >
                    {knowledgeQueryPending ? uiText.runtimeRefreshing : uiText.knowledgeSearch}
                  </button>
                </div>
                <textarea
                  value={knowledgeQuery}
                  onChange={(event) => setKnowledgeQuery(event.target.value)}
                  placeholder={uiText.knowledgeSearchPlaceholder}
                  rows={4}
                  className="mt-3 w-full rounded-3xl border border-white/10 bg-slate-950/60 px-4 py-4 text-sm leading-7 text-slate-100 outline-none"
                />
                {knowledgeResults?.lowConfidence ? (
                  <p className="mt-3 text-xs leading-6 text-amber-100">
                    {locale === "en"
                      ? "Retrieval confidence is low. Use the hits as weak evidence only."
                      : locale === "ja"
                        ? "検索信頼度が低いため、命中結果は弱い根拠として扱ってください。"
                        : locale === "ko"
                          ? "검색 신뢰도가 낮으므로, 결과를 약한 근거로만 취급해야 합니다."
                          : locale === "zh-TW"
                            ? "檢索信心偏低，請將命中結果視為弱證據。"
                            : "检索信心偏低，请将命中结果视为弱证据。"}
                  </p>
                ) : null}
                <div className="mt-3 max-h-[320px] space-y-3 overflow-auto pr-1">
                  {knowledgeResults?.results.length ? (
                    knowledgeResults.results.map((result) => (
                      <div key={result.chunkId} className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-white">
                            {result.citationLabel} {result.title}
                          </p>
                          <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                            {result.score.toFixed(1)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          {uiText.knowledgeSection}: {result.sectionPath.length ? result.sectionPath.join(" > ") : "--"}
                          {result.source ? ` · ${result.source}` : ""}
                        </p>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-slate-200">
                          {result.content}
                        </pre>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">{uiText.knowledgeNoResults}</p>
                  )}
                </div>
              </div>

              {knowledgeChunks.length ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-sm text-slate-300">{uiText.knowledgeChunkCount}</p>
                  <div className="mt-3 max-h-[220px] space-y-3 overflow-auto pr-1">
                    {knowledgeChunks.map((chunk) => (
                      <div key={chunk.id} className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-white">#{chunk.order}</p>
                          <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                            {chunk.charCount} chars · {chunk.tokenEstimate} tok
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          {uiText.knowledgeSection}: {chunk.sectionPath.length ? chunk.sectionPath.join(" > ") : "--"}
                        </p>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-slate-200">
                          {chunk.content}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {data?.summary.telemetryAvailable ? (
          <div className="order-31 grid gap-4 xl:grid-cols-3">
            <SeriesCard title={dictionary.admin.memory} values={memoryValues} tone="emerald" />
            <SeriesCard title={uiText.storageTrend} values={storageValues} tone="cyan" />
            <SeriesCard title={dictionary.admin.battery} values={batteryValues} tone="amber" />
            <SeriesCard title={dictionary.admin.gpuProxy} values={gpuValues} tone="violet" />
            <SeriesCard title={uiText.energyTrend} values={energyValues} tone="amber" />
            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <p className="text-sm text-slate-300">{dictionary.admin.localTelemetry}</p>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <div>
                  <p className="text-slate-500">{dictionary.admin.memory}</p>
                  <p className="mt-1 text-white">
                    {formatBytes(latestTelemetry?.memoryUsedBytes)} / {formatBytes(latestTelemetry?.memoryTotalBytes)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">{dictionary.admin.storage}</p>
                  <p className="mt-1 text-white">{formatBytes(latestTelemetry?.diskAvailableBytes)}</p>
                </div>
                <div>
                  <p className="text-slate-500">{dictionary.admin.battery}</p>
                  <p className="mt-1 text-white">
                    {formatPercent(latestTelemetry?.batteryPercent)} ·{" "}
                    {latestTelemetry?.onAcPower ? uiText.acPower : uiText.batteryPower}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">{dictionary.admin.queue}</p>
                  <p className="mt-1 text-white">
                    {latestTelemetry?.queueDepth ?? 0} · {latestTelemetry?.runtimeBusy ? dictionary.common.active : dictionary.agent.runtimeIdle}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="order-27 rounded-3xl border border-white/10 bg-slate-950/70 p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-sm text-slate-300">{uiText.runtimeOps}</p>
              <p className="mt-2 text-xs leading-6 text-slate-500">{uiText.runtimeOpsHint}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadAllRuntimeStatuses()}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
              >
                {uiText.runtimeRefresh}
              </button>
              <button
                type="button"
                disabled={prewarmAllPending}
                onClick={() => void handlePrewarmAllRuntimes()}
                className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
              >
                {prewarmAllPending ? uiText.runtimeRefreshing : uiText.runtimePrewarmAll}
              </button>
            </div>
          </div>
          {prewarmAllMessage ? (
            <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
              {prewarmAllMessage}
            </div>
          ) : null}
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {localTargets.map((target) => {
              const runtime = runtimeStatuses[target.id];
              const action = runtimeActionPending[target.id] || "";
              const runtimeMessage = runtimeMessages[target.id] || runtime?.message || "";
              const logExcerpt = runtimeLogExcerpts[target.id] || "";
              const logSummary = runtimeLogSummaries[target.id];
              const runtimePhase = describeRuntimePhase(runtime, locale);
              const runtimeLogQuery = runtimeLogQueries[target.id] || "";
              const runtimeLogLimit = runtimeLogLimits[target.id] || 120;
              const loadedAliasForTarget = runtime?.loadedAlias === target.id ? runtime.loadedAlias : null;
              const gatewayLoadedOtherAlias =
                runtime?.loadedAlias && runtime.loadedAlias !== target.id ? runtime.loadedAlias : null;
              const lastSwitchMsForTarget = runtimeLastSwitchMs[target.id] ?? null;
              const lastSwitchAtForTarget = runtimeLastSwitchAt[target.id] ?? null;
              return (
                <article key={target.id} className="rounded-3xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-white">{target.label}</p>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] ${runtimePhase.className}`}>
                          {runtimePhase.label}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        {uiText.loadedAlias}: {loadedAliasForTarget ? describeRuntimeAlias(loadedAliasForTarget, localTargets) : "—"}
                      </p>
                      {gatewayLoadedOtherAlias ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {uiText.runtimeCurrentLoaded}: {describeRuntimeAlias(gatewayLoadedOtherAlias, localTargets)}
                        </p>
                      ) : null}
                      {runtime?.loadingAlias ? (
                        <p className="mt-1 text-xs text-amber-200">
                          {uiText.runtimeSwitchingNow}: {describeRuntimeAlias(runtime.loadingAlias, localTargets)}
                          {typeof runtime.loadingElapsedMs === "number"
                            ? ` · ${Math.max(1, Math.round(runtime.loadingElapsedMs / 1000))}s`
                            : ""}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-slate-500">
                        {uiText.runtimeLastSwitchLoad}: {formatRuntimeDuration(lastSwitchMsForTarget)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {uiText.runtimeLastSwitchAt}: {formatRuntimeTimestamp(lastSwitchAtForTarget, locale)}
                      </p>
                      {runtime?.loadingError ? (
                        <p className="mt-1 break-all text-xs text-rose-200">Loading error: {runtime.loadingError}</p>
                      ) : null}
                      <p className="mt-1 text-xs text-slate-500">
                        {uiText.queueLabel}: {runtime?.queueDepth ?? 0} · {uiText.activeLabel}: {runtime?.activeRequests ?? 0}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-2">
                        <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-sm text-slate-300">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{uiText.runtimeSupervisor}</p>
                          <p className="mt-3 text-xl font-semibold text-white">{runtime?.supervisorPid ?? dictionary.common.unknown}</p>
                          <p className="mt-2 text-xs text-slate-400">{runtime?.supervisorAlive ? dictionary.common.ok : dictionary.common.failed}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-sm text-slate-300">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{uiText.runtimeGateway}</p>
                          <p className="mt-3 text-xl font-semibold text-white">{runtime?.gatewayPid ?? dictionary.common.unknown}</p>
                          <p className="mt-2 text-xs text-slate-400">{runtime?.gatewayAlive ? dictionary.common.ok : dictionary.common.failed}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-sm text-slate-300">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{uiText.runtimeRestartCount}</p>
                          <p className="mt-3 text-xl font-semibold text-white">{runtime?.restartCount ?? 0}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-sm text-slate-300">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{uiText.runtimeLastExitCode}</p>
                          <p className="mt-3 text-xl font-semibold text-white">{runtime?.lastExitCode ?? dictionary.common.unknown}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-sm text-slate-300">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{uiText.runtimeLastStart}</p>
                          <p className="mt-3 text-base font-semibold text-white">{runtime?.lastStartAt ? new Date(runtime.lastStartAt).toLocaleString() : dictionary.common.unknown}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-sm text-slate-300">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{uiText.runtimeLastExit}</p>
                          <p className="mt-3 text-base font-semibold text-white">{runtime?.lastExitAt ? new Date(runtime.lastExitAt).toLocaleString() : dictionary.common.unknown}</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Runtime trace</p>
                        <p className="mt-3 text-sm leading-6 text-slate-200">{runtimeMessage || uiText.runtimeNoLog}</p>
                        {runtime?.phaseDetail ? (
                          <p className="mt-2 text-xs leading-6 text-slate-400">{runtime.phaseDetail}</p>
                        ) : null}
                        {runtime?.loadingAlias || runtime?.loadingError ? (
                          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-xs text-slate-300">
                            {runtime?.loadingAlias ? (
                              <p>
                                Loading: {runtime.loadingAlias}
                                {typeof runtime.loadingElapsedMs === "number"
                                  ? ` · ${Math.max(1, Math.round(runtime.loadingElapsedMs / 1000))}s`
                                  : ""}
                              </p>
                            ) : null}
                            {runtime?.loadingError ? (
                              <p className="mt-2 break-all text-rose-200">Loading error: {runtime.loadingError}</p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Model state</p>
                          <span className="text-xs text-slate-500">{action ? uiText.runtimeRefreshing : dictionary.agent.runtimeIdle}</span>
                        </div>
                        <div className="mt-3 space-y-2 text-sm text-slate-300">
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{uiText.loadedAlias}</p>
                            <p className="mt-1 text-sm text-white">
                              {loadedAliasForTarget ? describeRuntimeAlias(loadedAliasForTarget, localTargets) : "—"}
                            </p>
                            {gatewayLoadedOtherAlias ? (
                              <p className="mt-1 text-xs text-slate-500">
                                {uiText.runtimeCurrentLoaded}: {describeRuntimeAlias(gatewayLoadedOtherAlias, localTargets)}
                              </p>
                            ) : null}
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{uiText.runtimeLastSwitchLoad}</p>
                            <p className="mt-1 text-sm text-white">{formatRuntimeDuration(lastSwitchMsForTarget)}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{uiText.runtimeLastSwitchAt}</p>
                            <p className="mt-1 text-sm text-white">
                              {formatRuntimeTimestamp(lastSwitchAtForTarget, locale)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{uiText.runtimeSwitchingNow}</p>
                            <p className="mt-1 text-sm text-white">
                              {runtime?.loadingAlias ? describeRuntimeAlias(runtime.loadingAlias, localTargets) : "—"}
                              {runtime?.loadingAlias && typeof runtime.loadingElapsedMs === "number"
                                ? ` · ${Math.max(1, Math.round(runtime.loadingElapsedMs / 1000))}s`
                                : ""}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{uiText.runtimeLastEvent}</p>
                            <p className="mt-1 text-sm text-white">{runtime?.lastEvent || dictionary.common.unknown}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{uiText.runtimeEnsureReason}</p>
                            <p className="mt-1 text-xs leading-6 text-slate-400">{runtime?.lastEnsureReason || runtimeMessage || uiText.runtimeNoLog}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{uiText.runtimeLogPath}</p>
                            <p className="mt-1 break-all text-xs text-slate-400">{runtime?.logFile || dictionary.common.unknown}</p>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-3">
                          <button
                            type="button"
                            disabled={Boolean(action)}
                            onClick={() => void loadRuntimeStatus(target.id)}
                            className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:text-slate-500"
                          >
                            {action === "refresh" ? uiText.runtimeRefreshing : uiText.runtimeRefresh}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(action)}
                            onClick={() => void handleRuntimePrewarm(target.id)}
                            className="rounded-full border border-cyan-400/20 bg-transparent px-3 py-1.5 text-[11px] text-cyan-200 transition hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                          >
                            {action === "prewarm" ? uiText.runtimeRefreshing : uiText.runtimePrewarm}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(action)}
                            onClick={() => void handleRuntimeAction(target.id, "release")}
                            className="rounded-full border border-emerald-400/20 bg-transparent px-3 py-1.5 text-[11px] text-emerald-200 transition hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                          >
                            {action === "release" ? uiText.runtimeRefreshing : uiText.runtimeRelease}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(action)}
                            onClick={() => void handleRuntimeAction(target.id, "restart")}
                            className="rounded-full border border-amber-400/20 bg-transparent px-3 py-1.5 text-[11px] text-amber-200 transition hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                          >
                            {action === "restart" ? uiText.runtimeRefreshing : uiText.runtimeRestart}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(action)}
                            onClick={() => void handleRuntimeAction(target.id, "read_log")}
                            className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:text-slate-500"
                          >
                            {action === "read_log" ? uiText.runtimeRefreshing : uiText.runtimeReadLog}
                          </button>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-sm text-slate-300">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{uiText.runtimeLog}</p>
                        <div className="mt-3 flex flex-col gap-2 xl:flex-row">
                          <input
                            value={runtimeLogQuery}
                            onChange={(event) =>
                              setRuntimeLogQueries((current) => ({
                                ...current,
                                [target.id]: event.target.value
                              }))
                            }
                            placeholder={locale.startsWith("en") ? "Filter log keywords" : "筛选日志关键词"}
                            className="w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                          />
                          <select
                            value={runtimeLogLimit}
                            onChange={(event) =>
                              setRuntimeLogLimits((current) => ({
                                ...current,
                                [target.id]: Number(event.target.value)
                              }))
                            }
                            className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none"
                          >
                            {[80, 120, 200].map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={Boolean(action)}
                            onClick={() => void handleRuntimeLogSearch(target.id)}
                            className="rounded-full border border-white/10 bg-transparent px-3 py-2 text-[11px] text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:text-slate-500"
                          >
                            {action === "read_log" ? uiText.runtimeRefreshing : uiText.runtimeReadLog}
                          </button>
                        </div>
                        {logSummary ? (
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300">
                            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">
                              {locale.startsWith("en") ? "Matched" : "匹配"} {logSummary.matchedLines}/{logSummary.totalLines}
                            </span>
                            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">
                              {locale.startsWith("en") ? "Errors" : "错误"} {logSummary.errorLines}
                            </span>
                            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">
                              {locale.startsWith("en") ? "Warnings" : "警告"} {logSummary.warningLines}
                            </span>
                            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">
                              {locale.startsWith("en") ? "Restarts" : "重启"} {logSummary.restartMentions}
                            </span>
                            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">
                              {locale.startsWith("en") ? "Loading" : "加载"} {logSummary.loadingMentions}
                            </span>
                          </div>
                        ) : null}
                        {logExcerpt ? (
                          <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-6 text-slate-200">{logExcerpt}</pre>
                        ) : (
                          <p className="mt-3 text-sm text-slate-500">{uiText.runtimeNoLog}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
            <p className="text-sm text-slate-300">{dictionary.admin.recentHistory}</p>
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/5 text-slate-400">
                  <tr>
                    <th className="px-3 py-2">{dictionary.common.latest}</th>
                    <th className="px-3 py-2">{dictionary.common.model}</th>
                    <th className="px-3 py-2">{uiText.contextWindowFilter}</th>
                    <th className="px-3 py-2">{uiText.latencyMs}</th>
                    <th className="px-3 py-2">{uiText.tokens}</th>
                    <th className="px-3 py-2">{uiText.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.recentChats.length ? (
                    data.recentChats.map((row) => (
                      <tr key={row.id} className="border-t border-white/10">
                        <td className="px-3 py-2 text-slate-300">{new Date(row.completedAt).toLocaleTimeString()}</td>
                        <td className="px-3 py-2 text-slate-100">{row.resolvedModel}</td>
                        <td className="px-3 py-2 text-slate-300">
                          {typeof row.contextWindow === "number"
                            ? row.contextWindow >= 1024
                              ? `${Math.round(row.contextWindow / 1024)}K`
                              : row.contextWindow
                            : uiText.defaultContextWindow}
                        </td>
                        <td className="px-3 py-2 text-slate-300">{row.latencyMs}</td>
                        <td className="px-3 py-2 text-slate-300">{row.usage.totalTokens}</td>
                        <td className="px-3 py-2 text-slate-300">{row.ok ? dictionary.common.ok : dictionary.common.failed}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-3 py-4 text-slate-500" colSpan={6}>
                        {dictionary.admin.noData}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <p className="text-sm text-slate-300">{uiText.firstTokenLatency}</p>
              <div className="mt-2 text-3xl font-semibold text-white">{data?.summary.avgFirstTokenLatencyMs?.toFixed(1) || "0.0"} ms</div>
              <p className="mt-2 text-xs text-slate-500">{uiText.totalLatency}: {data?.summary.avgLatencyMs?.toFixed(1) || "0.0"} ms</p>
              <p className="mt-1 text-xs text-slate-500">{uiText.tokenThroughput}: {data?.summary.avgTokenThroughputTps?.toFixed(2) || "0.00"} {uiText.tokensPerSecond}</p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <p className="text-sm text-slate-300">{uiText.percentiles}</p>
              <div className="mt-4 space-y-3">
                <PercentileRow
                  label={uiText.firstTokenLatency}
                  metrics={data?.summary.firstTokenLatencyPercentiles || { p50: 0, p95: 0, p99: 0 }}
                  unit="ms"
                />
                <PercentileRow
                  label={uiText.totalLatency}
                  metrics={data?.summary.latencyPercentiles || { p50: 0, p95: 0, p99: 0 }}
                  unit="ms"
                />
                <PercentileRow
                  label={uiText.tokenThroughput}
                  metrics={data?.summary.tokenThroughputPercentiles || { p50: 0, p95: 0, p99: 0 }}
                  unit={uiText.tokensPerSecond}
                />
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <p className="text-sm text-slate-300">{dictionary.admin.modelBreakdown}</p>
              <div className="mt-4 space-y-3">
                {data?.modelBreakdown.length ? (
                  data.modelBreakdown.slice(0, 6).map((row) => (
                    <div key={row.model} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-white">{row.model}</p>
                        <span className="text-xs text-slate-400">{row.requests}</span>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">Token: {formatCompactNumber(row.totalTokens)}</p>
                      <p className="mt-1 text-xs text-slate-500">{uiText.firstTokenLatency}: {row.avgFirstTokenLatencyMs.toFixed(1)} ms</p>
                      <p className="mt-1 text-xs text-slate-500">{uiText.totalLatency}: {row.avgLatencyMs.toFixed(1)} ms</p>
                      <p className="mt-1 text-xs text-slate-500">{uiText.tokenThroughput}: {row.avgTokenThroughputTps.toFixed(2)} {uiText.tokensPerSecond}</p>
                      <div className="mt-3 space-y-2">
                        <PercentileRow label={uiText.firstTokenLatency} metrics={row.firstTokenLatencyPercentiles} unit="ms" />
                        <PercentileRow label={uiText.totalLatency} metrics={row.latencyPercentiles} unit="ms" />
                        <PercentileRow label={uiText.tokenThroughput} metrics={row.tokenThroughputPercentiles} unit={uiText.tokensPerSecond} />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">{dictionary.admin.noData}</p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <p className="text-sm text-slate-300">{uiText.contextWindowBreakdown}</p>
              <div className="mt-4 space-y-3">
                {data?.contextWindowBreakdown.length ? (
                  data.contextWindowBreakdown.map((row) => (
                    <div
                      key={row.contextWindow === null ? "default" : row.contextWindow}
                      className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-white">
                          {row.contextWindow === null
                            ? uiText.defaultContextWindow
                            : row.contextWindow >= 1024
                              ? `${Math.round(row.contextWindow / 1024)}K`
                              : row.contextWindow}
                        </p>
                        <span className="text-xs text-slate-400">{row.requests}</span>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">Token: {formatCompactNumber(row.totalTokens)}</p>
                      <p className="mt-1 text-xs text-slate-500">{uiText.firstTokenLatency}: {row.avgFirstTokenLatencyMs.toFixed(1)} ms</p>
                      <p className="mt-1 text-xs text-slate-500">{uiText.totalLatency}: {row.avgLatencyMs.toFixed(1)} ms</p>
                      <p className="mt-1 text-xs text-slate-500">{uiText.tokenThroughput}: {row.avgTokenThroughputTps.toFixed(2)} {uiText.tokensPerSecond}</p>
                      <div className="mt-3 space-y-2">
                        <PercentileRow label={uiText.firstTokenLatency} metrics={row.firstTokenLatencyPercentiles} unit="ms" />
                        <PercentileRow label={uiText.totalLatency} metrics={row.latencyPercentiles} unit="ms" />
                        <PercentileRow label={uiText.tokenThroughput} metrics={row.tokenThroughputPercentiles} unit={uiText.tokensPerSecond} />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">{dictionary.admin.noData}</p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <p className="text-sm text-slate-300">{dictionary.admin.recentChecks}</p>
              <div className="mt-4 space-y-3">
                {data?.recentChecks.length ? (
                  data.recentChecks.map((row) => (
                    <div key={row.id} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-white">{row.targetLabel}</p>
                        <span className="text-xs text-slate-400">
                          {row.ok ? dictionary.common.ok : dictionary.common.failed}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">{new Date(row.checkedAt).toLocaleString()}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">{dictionary.admin.noData}</p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <p className="text-sm text-slate-300">{dictionary.admin.savedFiles}</p>
              <div className="mt-3 space-y-2 text-xs leading-6 text-slate-400">
                <p>{data?.paths.chatLogFile || "--"}</p>
                <p>{data?.paths.connectionCheckFile || "--"}</p>
                <p>{data?.paths.telemetryFile || "--"}</p>
                <p>{data?.paths.benchmarkFile || "--"}</p>
                <p>{data?.paths.benchmarkBaselineFile || "--"}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
