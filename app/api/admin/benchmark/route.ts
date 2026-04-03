import crypto from "crypto";
import { NextResponse } from "next/server";
import { agentTargets } from "@/lib/agent/catalog";
import {
  ensureLocalGatewayAvailableDetailed,
  probeLocalGateway,
  restartLocalGateway
} from "@/lib/agent/local-gateway";
import {
  calculateTokenThroughputTps,
  clampContextWindowForTarget,
  normalizeContextWindow,
  percentile
} from "@/lib/agent/metrics";
import { getManagedBenchmarkPromptSet } from "@/lib/agent/benchmark-prompt-set-store";
import {
  getBenchmarkDataset,
  getBenchmarkMilestoneSuite
} from "@/lib/agent/benchmark-datasets";
import { evaluateBenchmarkDatasetOutput } from "@/lib/agent/benchmark-evaluation";
import {
  advanceBenchmarkProgress,
  completeBenchmarkProgress,
  completeBenchmarkProgressGroup,
  createBenchmarkProgress,
  failBenchmarkProgress,
  finalizeBenchmarkProgressControl,
  markBenchmarkProgressRunning,
  readBenchmarkProgress,
  startBenchmarkProgressGroup
} from "@/lib/agent/benchmark-progress-store";
import {
  clearBenchmarkRunController,
  getBenchmarkRunSignal,
  registerBenchmarkRunController
} from "@/lib/agent/benchmark-run-control";
import {
  normalizeProviderProfile,
  normalizeThinkingMode,
  resolveTargetWithMode,
  suggestMaxTokens
} from "@/lib/agent/providers";
import { appendBenchmarkLog, readBenchmarkLogs } from "@/lib/agent/log-store";
import type {
  AgentBenchmarkResponse,
  AgentBenchmarkResult,
  AgentBenchmarkSample,
  AgentBenchmarkDatasetItem,
  AgentBenchmarkMode,
  AgentBenchmarkProfileBatchScope,
  AgentExecution,
  AgentProviderProfile,
  AgentThinkingMode,
  AgentBenchmarkWorkloadSummary,
  ResolvedTarget
} from "@/lib/agent/types";

export const runtime = "nodejs";
const LOCAL_BENCHMARK_STREAM_TIMEOUT_MS = 300000;
const LOCAL_BENCHMARK_WARMUP_WAIT_MS = 300000;
const LOCAL_BENCHMARK_PREWARM_TIMEOUT_MS = 360000;
const LOCAL_BENCHMARK_MAX_CONSECUTIVE_FATAL_FAILURES = 3;
const LOCAL_BENCHMARK_MAX_CONSECUTIVE_FATAL_FAILURES_PER_WORKLOAD = 2;

type BenchmarkRequestBody = {
  runId?: string;
  targetIds?: string[];
  runs?: number;
  contextWindow?: number;
  maxTokens?: number;
  benchmarkMode?: AgentBenchmarkMode;
  prompt?: string;
  promptSetId?: string;
  datasetId?: string;
  datasetSampleLimit?: number;
  suiteId?: string;
  providerProfile?: AgentProviderProfile;
  thinkingMode?: AgentThinkingMode;
  profileModes?: Array<{
    providerProfile?: AgentProviderProfile;
    thinkingMode?: AgentThinkingMode;
  }>;
  profileBatchScope?: AgentBenchmarkProfileBatchScope;
};

type BenchmarkWorkload = {
  benchmarkMode: AgentBenchmarkMode;
  prompt: string;
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
  workloads?: AgentBenchmarkWorkloadSummary[];
};

type PlannedBenchmarkItem = {
  id: string;
  prompt: string;
  workloadId: string;
  workloadLabel: string;
  expectedAnswerPreview?: string;
  evaluator?: AgentBenchmarkDatasetItem["evaluator"];
  runCount: number;
};

type PlannedSampleTask = {
  sampleRun: number;
  prompt: string;
  workloadId: string;
  workloadLabel: string;
  itemId: string;
  expectedAnswerPreview?: string;
  evaluator?: AgentBenchmarkDatasetItem["evaluator"];
  contextWindow: number;
  maxTokens: number;
};

type BenchmarkPlan = BenchmarkWorkload & {
  items: PlannedBenchmarkItem[];
};

function buildSuitePlan(
  benchmarkMode: AgentBenchmarkMode,
  suite: NonNullable<ReturnType<typeof getBenchmarkMilestoneSuite>>,
  runs: number
): BenchmarkPlan | { error: string } {
  const items: PlannedBenchmarkItem[] = [];
  const workloadSummaries: AgentBenchmarkWorkloadSummary[] = [];

  for (const workload of suite.workloads) {
    if (workload.kind === "prompt-set") {
      const promptSet = getManagedBenchmarkPromptSet(workload.promptSetId);
      if (!promptSet) {
        return { error: `Unknown prompt set in suite ${suite.id}: ${workload.promptSetId}` };
      }
      workloadSummaries.push({
        kind: "prompt-set",
        id: promptSet.id,
        label: promptSet.label,
        description: promptSet.description,
        sampleCount: promptSet.prompts.length,
        scorable: false
      });
      for (const [index, prompt] of promptSet.prompts.entries()) {
        items.push({
          id: `${promptSet.id}:${index + 1}`,
          prompt,
          workloadId: promptSet.id,
          workloadLabel: promptSet.label,
          runCount: workload.runs || runs
        });
      }
      continue;
    }

    const dataset = getBenchmarkDataset(workload.datasetId);
    if (!dataset) {
      return { error: `Unknown dataset in suite ${suite.id}: ${workload.datasetId}` };
    }
    const datasetItems = dataset.items.slice(0, workload.sampleLimit || dataset.items.length);
    workloadSummaries.push({
      kind: "dataset",
      id: dataset.id,
      label: dataset.label,
      description: dataset.description,
      sourceLabel: dataset.sourceLabel,
      sourceUrl: dataset.sourceUrl,
      sampleCount: datasetItems.length,
      scorable: datasetItems.some((item) => item.evaluator.kind !== "manual-review")
    });
    for (const item of datasetItems) {
      items.push({
        id: `${dataset.id}:${item.id}`,
        prompt: item.prompt,
        workloadId: dataset.id,
        workloadLabel: dataset.label,
        expectedAnswerPreview: item.expectedAnswerPreview,
        evaluator: item.evaluator,
        runCount: workload.runs || runs
      });
    }
  }

  return {
    benchmarkMode,
    prompt: `[${benchmarkMode}] ${suite.label}`,
    suiteId: suite.id,
    suiteLabel: suite.label,
    suiteWorkloadCount: suite.workloads.length,
    workloads: workloadSummaries,
    items
  };
}

const REMOTE_BENCHMARK_SAMPLE_CONCURRENCY = 1;
const REMOTE_BENCHMARK_GROUP_CONCURRENCY = 1;
const REMOTE_BENCHMARK_MAX_ATTEMPTS = 4;
const REMOTE_BENCHMARK_TIMEOUT_MS = 120000;
const REMOTE_PROFILE_COMPARISON_WORKLOAD_IDS = new Set([
  "latency-smoke",
  "instruction-following-lite",
  "ifeval-starter",
  "bfcl-starter"
]);

class BenchmarkControlError extends Error {
  action: "stop" | "abandon";

  constructor(action: "stop" | "abandon") {
    super(action === "stop" ? "Benchmark run stopped." : "Benchmark run abandoned.");
    this.action = action;
    this.name = "BenchmarkControlError";
  }
}

function average(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!filtered.length) return 0;
  return Number((filtered.reduce((sum, value) => sum + value, 0) / filtered.length).toFixed(2));
}

function readRequestedBenchmarkControl(runId: string) {
  const progress = readBenchmarkProgress(runId);
  if (!progress?.controlAction) return null;
  return progress.controlAction === "stop-requested" ? "stop" : "abandon";
}

function assertBenchmarkRunActive(runId: string) {
  const signal = getBenchmarkRunSignal(runId);
  if (signal?.aborted) {
    throw new BenchmarkControlError(readRequestedBenchmarkControl(runId) || "stop");
  }
  const action = readRequestedBenchmarkControl(runId);
  if (action) {
    throw new BenchmarkControlError(action);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRemoteBenchmarkFailure(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("已达到最大并发数") ||
    normalized.includes("max concurrent") ||
    normalized.includes("rate limit") ||
    normalized.includes("429") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("fetch failed") ||
    normalized.includes("network") ||
    normalized.includes("socket hang up") ||
    normalized.includes("aborted") ||
    normalized.includes("terminated") ||
    normalized.includes("stream idle timeout") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("bad gateway") ||
    normalized.includes("service unavailable")
  );
}

function getRemoteBenchmarkTimeoutMs(
  workloadId: string,
  providerProfile: AgentProviderProfile,
  thinkingMode: AgentThinkingMode
) {
  let timeoutMs = REMOTE_BENCHMARK_TIMEOUT_MS;
  if (thinkingMode === "thinking") timeoutMs += 45000;
  if (providerProfile === "tool-first") timeoutMs += 30000;
  if (
    workloadId === "grounded-kb-qa" ||
    workloadId === "code-rag-repo-qa" ||
    workloadId === "agent-flow-lite" ||
    workloadId === "longbench-starter"
  ) {
    timeoutMs += 30000;
  }
  if (workloadId === "humaneval-starter" || workloadId === "mbppplus-starter") {
    timeoutMs += 45000;
  }
  return timeoutMs;
}

function getRemoteBenchmarkStreamIdleTimeoutMs(totalTimeoutMs: number) {
  return Math.max(90000, Math.min(180000, Math.floor(totalTimeoutMs * 0.8)));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", abortFromExternal);
    }
  }
}

function buildPercentiles(values: Array<number | null | undefined>) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99)
  };
}

function normalizeProfileModes(
  inputModes: BenchmarkRequestBody["profileModes"],
  fallbackProviderProfile: AgentProviderProfile,
  fallbackThinkingMode: AgentThinkingMode
) {
  const baseModes =
    inputModes && inputModes.length
      ? inputModes
      : [{ providerProfile: fallbackProviderProfile, thinkingMode: fallbackThinkingMode }];

  const normalized = baseModes.map((entry) => {
    const thinkingMode = normalizeThinkingMode(entry.thinkingMode || fallbackThinkingMode);
    const requestedProviderProfile = normalizeProviderProfile(entry.providerProfile || fallbackProviderProfile);
    return {
      providerProfile: thinkingMode === "thinking" ? "tool-first" : requestedProviderProfile,
      thinkingMode
    };
  });

  return normalized.filter((entry, index, all) => {
    const key = `${entry.providerProfile}:${entry.thinkingMode}`;
    return all.findIndex((candidate) => `${candidate.providerProfile}:${candidate.thinkingMode}` === key) === index;
  });
}

function matchesBenchmarkWorkload(
  benchmark: {
    prompt: string;
    benchmarkMode?: AgentBenchmarkMode;
    promptSetId?: string | null;
    datasetId?: string | null;
    suiteId?: string | null;
    profileBatchScope?: string | null;
  },
  workload: BenchmarkWorkload & { profileBatchScope?: AgentBenchmarkProfileBatchScope }
) {
  if ((benchmark.benchmarkMode || "prompt") !== workload.benchmarkMode) return false;
  if (workload.profileBatchScope && (benchmark.profileBatchScope || "") !== workload.profileBatchScope) return false;
  if (workload.suiteId) {
    return benchmark.suiteId === workload.suiteId;
  }
  if (workload.datasetId) {
    return benchmark.datasetId === workload.datasetId;
  }
  if (workload.promptSetId) {
    return benchmark.promptSetId === workload.promptSetId;
  }
  return !benchmark.promptSetId && benchmark.prompt === workload.prompt;
}

function averageNullable(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!filtered.length) return null;
  return Number((filtered.reduce((sum, value) => sum + value, 0) / filtered.length).toFixed(2));
}

function normalizeWorkloadBudget(
  workloadId: string,
  requestedContextWindow: number,
  requestedMaxTokens: number
) {
  const byWorkloadId: Record<
    string,
    {
      contextWindow: number;
      maxTokens: number;
    }
  > = {
    "latency-smoke": {
      contextWindow: requestedContextWindow,
      maxTokens: Math.min(requestedMaxTokens, 96)
    },
    "instruction-following-lite": {
      contextWindow: requestedContextWindow,
      maxTokens: Math.min(requestedMaxTokens, 96)
    },
    "ifeval-starter": {
      contextWindow: requestedContextWindow,
      maxTokens: Math.min(requestedMaxTokens, 96)
    },
    "ceval-cs-starter": {
      contextWindow: requestedContextWindow,
      maxTokens: Math.min(requestedMaxTokens, 64)
    },
    "cmmlu-cs-starter": {
      contextWindow: requestedContextWindow,
      maxTokens: Math.min(requestedMaxTokens, 64)
    },
    "bfcl-starter": {
      contextWindow: requestedContextWindow,
      maxTokens: Math.min(requestedMaxTokens, 96)
    },
    "grounded-kb-qa": {
      contextWindow: requestedContextWindow,
      maxTokens: Math.min(requestedMaxTokens, 160)
    },
    "code-rag-repo-qa": {
      contextWindow: requestedContextWindow,
      maxTokens: Math.min(requestedMaxTokens, 160)
    },
    "agent-flow-lite": {
      contextWindow: requestedContextWindow,
      maxTokens: Math.min(requestedMaxTokens, 160)
    },
    "longbench-starter": {
      contextWindow: requestedContextWindow,
      maxTokens: Math.min(requestedMaxTokens, 192)
    },
    "humaneval-starter": {
      contextWindow: requestedContextWindow,
      maxTokens: Math.min(requestedMaxTokens, 256)
    },
    "mbppplus-starter": {
      contextWindow: requestedContextWindow,
      maxTokens: Math.min(requestedMaxTokens, 256)
    }
  };

  return (
    byWorkloadId[workloadId] || {
      contextWindow: requestedContextWindow,
      maxTokens: Math.min(requestedMaxTokens, 160)
    }
  );
}

function expandPlanTasks(
  plan: BenchmarkPlan,
  requestedContextWindow: number,
  requestedMaxTokens: number
) {
  const tasks: PlannedSampleTask[] = [];
  let sampleRun = 1;

  for (const benchmarkPrompt of plan.items) {
    const budget = normalizeWorkloadBudget(
      benchmarkPrompt.workloadId,
      requestedContextWindow,
      requestedMaxTokens
    );
    for (let run = 1; run <= benchmarkPrompt.runCount; run += 1) {
      tasks.push({
        sampleRun,
        prompt: benchmarkPrompt.prompt,
        workloadId: benchmarkPrompt.workloadId,
        workloadLabel: benchmarkPrompt.workloadLabel,
        itemId: benchmarkPrompt.id,
        expectedAnswerPreview: benchmarkPrompt.expectedAnswerPreview,
        evaluator: benchmarkPrompt.evaluator,
        contextWindow: budget.contextWindow,
        maxTokens: budget.maxTokens
      });
      sampleRun += 1;
    }
  }

  return tasks;
}

function buildGroupKey(
  targetId: string,
  providerProfile: AgentProviderProfile,
  thinkingMode: AgentThinkingMode
) {
  return `${targetId}:${providerProfile}:${thinkingMode}`;
}

function deriveComparisonSubsetTasks(tasks: PlannedSampleTask[]) {
  const seenPerWorkload = new Map<string, number>();
  const subset: PlannedSampleTask[] = [];

  for (const task of tasks) {
    if (!REMOTE_PROFILE_COMPARISON_WORKLOAD_IDS.has(task.workloadId)) continue;
    const currentCount = seenPerWorkload.get(task.workloadId) || 0;
    const limit = task.workloadId === "latency-smoke" ? 4 : 3;
    if (currentCount >= limit) continue;
    seenPerWorkload.set(task.workloadId, currentCount + 1);
    subset.push(task);
  }

  return subset.length ? subset : tasks.slice(0, Math.min(tasks.length, 12));
}

function clampBenchmarkContextWindowForTarget(targetId: string, requestedContextWindow: number) {
  if (
    targetId === "local-qwen3-0.6b" ||
    targetId === "local-qwen3-4b-4bit" ||
    targetId === "local-qwen35-4b-4bit"
  ) {
    return Math.min(normalizeContextWindow(requestedContextWindow, 8192), 32768);
  }
  return clampContextWindowForTarget(targetId, requestedContextWindow, {
    enableTools: false,
    enableRetrieval: false
  });
}

function groupBenchmarkTasksByWorkload(tasks: PlannedSampleTask[]) {
  const groups: Array<{
    workloadId: string;
    workloadLabel: string;
    tasks: PlannedSampleTask[];
  }> = [];

  for (const task of tasks) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.workloadId === task.workloadId) {
      lastGroup.tasks.push(task);
      continue;
    }
    groups.push({
      workloadId: task.workloadId,
      workloadLabel: task.workloadLabel,
      tasks: [task]
    });
  }

  return groups;
}

function buildPlan(body: BenchmarkRequestBody, runs: number): BenchmarkPlan | { error: string } {
  const benchmarkMode = body.benchmarkMode || (body.suiteId ? "suite" : body.datasetId ? "dataset" : "prompt");
  const datasetSampleLimit = Math.max(1, Math.min(Math.trunc(body.datasetSampleLimit || 5), 50));

  if (benchmarkMode === "suite") {
    const suite = getBenchmarkMilestoneSuite(body.suiteId);
    if (!suite) {
      return { error: `Unknown benchmark suite: ${body.suiteId || "empty"}` };
    }
    return buildSuitePlan(benchmarkMode, suite, runs);
  }

  if (benchmarkMode === "dataset") {
    const dataset = getBenchmarkDataset(body.datasetId);
    if (!dataset) {
      return { error: `Unknown benchmark dataset: ${body.datasetId || "empty"}` };
    }
    const items = dataset.items.slice(0, datasetSampleLimit).map((item) => ({
      id: item.id,
      prompt: item.prompt,
      workloadId: dataset.id,
      workloadLabel: dataset.label,
      expectedAnswerPreview: item.expectedAnswerPreview,
      evaluator: item.evaluator,
      runCount: runs
    }));
    return {
      benchmarkMode,
      prompt: `[dataset] ${dataset.label}`,
      datasetId: dataset.id,
      datasetLabel: dataset.label,
      datasetSourceLabel: dataset.sourceLabel,
      datasetSourceUrl: dataset.sourceUrl,
      datasetSampleCount: items.length,
      workloads: [
        {
          kind: "dataset",
          id: dataset.id,
          label: dataset.label,
          description: dataset.description,
          sourceLabel: dataset.sourceLabel,
          sourceUrl: dataset.sourceUrl,
          sampleCount: items.length,
          scorable: items.some((item) => item.evaluator?.kind !== "manual-review")
        }
      ],
      items
    };
  }

  const promptSet = getManagedBenchmarkPromptSet(body.promptSetId);
  if (body.promptSetId && !promptSet) {
    return { error: `Unknown prompt set: ${body.promptSetId}` };
  }
  const prompt =
    typeof body.prompt === "string" && body.prompt.trim()
      ? body.prompt.trim()
      : "请用一段简短中文解释本地编码 Agent 的价值。";

  if (promptSet) {
    return {
      benchmarkMode,
      prompt: `[prompt-set] ${promptSet.label}`,
      promptSetId: promptSet.id,
      promptSetLabel: promptSet.label,
      promptSetPromptCount: promptSet.prompts.length,
      workloads: [
        {
          kind: "prompt-set",
          id: promptSet.id,
          label: promptSet.label,
          description: promptSet.description,
          sampleCount: promptSet.prompts.length,
          scorable: false
        }
      ],
      items: promptSet.prompts.map((entry, index) => ({
        id: `${promptSet.id}:${index + 1}`,
        prompt: entry,
        workloadId: promptSet.id,
        workloadLabel: promptSet.label,
        runCount: runs
      }))
    };
  }

  return {
    benchmarkMode,
    prompt,
    workloads: [
      {
        kind: "prompt",
        id: "custom-prompt",
        label: "Custom prompt",
        sampleCount: 1,
        scorable: false
      }
    ],
    items: [
      {
        id: "custom-prompt:1",
        prompt,
        workloadId: "custom-prompt",
        workloadLabel: "Custom prompt",
        runCount: runs
      }
    ]
  };
}

function computeComparisonsToLast(
  results: AgentBenchmarkResult[],
  contextWindow: number,
  workload: BenchmarkWorkload & { profileBatchScope?: AgentBenchmarkProfileBatchScope }
) {
  const previousLogs = readBenchmarkLogs({ limit: 500 });

  return results.map((result) => {
    const previousMatch = [...previousLogs]
      .reverse()
      .filter((entry) => matchesBenchmarkWorkload(entry, workload))
      .flatMap((entry) =>
        entry.results
          .filter((candidate) => candidate.targetId === result.targetId)
          .filter((candidate) => entry.contextWindow === contextWindow)
          .filter(
            (candidate) =>
              (candidate.providerProfile || entry.providerProfile || "default") ===
              (result.providerProfile || "default")
          )
          .filter(
            (candidate) =>
              (candidate.thinkingMode || entry.thinkingMode || "standard") ===
              (result.thinkingMode || "standard")
          )
          .map((candidate) => ({
            generatedAt: entry.generatedAt,
            result: candidate
          }))
      )[0];

    const currentSuccessRate = result.runs > 0 ? Number(((result.okRuns / result.runs) * 100).toFixed(2)) : 0;
    const previousSuccessRate = previousMatch
      ? Number((((previousMatch.result.okRuns / Math.max(previousMatch.result.runs, 1)) || 0) * 100).toFixed(2))
      : null;

    return {
      targetId: result.targetId,
      targetLabel: result.targetLabel,
      providerProfile: result.providerProfile || "balanced",
      thinkingMode: result.thinkingMode || "standard",
      execution: result.execution,
      resolvedModel: result.resolvedModel,
      previousGeneratedAt: previousMatch?.generatedAt,
      previousSuccessRate,
      currentSuccessRate,
      deltaSuccessRate:
        previousSuccessRate === null ? null : Number((currentSuccessRate - previousSuccessRate).toFixed(2)),
      deltaFirstTokenLatencyMs: previousMatch
        ? Number((result.avgFirstTokenLatencyMs - previousMatch.result.avgFirstTokenLatencyMs).toFixed(2))
        : null,
      deltaLatencyMs: previousMatch
        ? Number((result.avgLatencyMs - previousMatch.result.avgLatencyMs).toFixed(2))
        : null,
      deltaTokenThroughputTps: previousMatch
        ? Number((result.avgTokenThroughputTps - previousMatch.result.avgTokenThroughputTps).toFixed(2))
        : null
    };
  });
}

async function readNdjsonStream(
  response: Response,
  onObject: (value: Record<string, unknown>) => void | Promise<void>
) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Upstream stream body is missing.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let lineBreak = buffer.indexOf("\n");
    while (lineBreak !== -1) {
      const line = buffer.slice(0, lineBreak).trim();
      buffer = buffer.slice(lineBreak + 1);
      if (line) {
        await onObject(JSON.parse(line) as Record<string, unknown>);
      }
      lineBreak = buffer.indexOf("\n");
    }
  }

  const tail = buffer.trim();
  if (tail) {
    await onObject(JSON.parse(tail) as Record<string, unknown>);
  }
}

async function ensureLocalBenchmarkGateway(baseUrl: string) {
  const firstAttempt = await ensureLocalGatewayAvailableDetailed(baseUrl, {
    waitMs: LOCAL_BENCHMARK_WARMUP_WAIT_MS
  });
  if (firstAttempt.ok) {
    return {
      ok: true,
      reason: firstAttempt.reason
    };
  }

  const restarted = await restartLocalGateway(baseUrl, { waitMs: LOCAL_BENCHMARK_WARMUP_WAIT_MS });
  if (!restarted) {
    return {
      ok: false,
      reason: `Gateway unavailable after restart attempt. ${firstAttempt.reason}`
    };
  }

  const secondAttempt = await ensureLocalGatewayAvailableDetailed(baseUrl, {
    waitMs: LOCAL_BENCHMARK_WARMUP_WAIT_MS
  });
  return {
    ok: secondAttempt.ok,
    reason: secondAttempt.ok
      ? "Gateway recovered after restart."
      : `Gateway unavailable after restart attempt. ${secondAttempt.reason}`
  };
}

function buildLocalBenchmarkExtraBody(
  target: ResolvedTarget,
  thinkingMode: AgentThinkingMode = "standard"
) {
  if (target.execution !== "local") {
    return undefined;
  }
  if (target.id !== "local-qwen35-4b-4bit") {
    return undefined;
  }
  return {
    chat_template_kwargs: {
      enable_thinking: thinkingMode === "thinking"
    }
  };
}

async function runSingleBenchmarkSample(
  target: ResolvedTarget,
  contextWindow: number,
  maxTokens: number,
  prompt: string,
  providerProfile: AgentProviderProfile,
  options?: { ensureGateway?: boolean; workloadId?: string; thinkingMode?: AgentThinkingMode; runId?: string }
): Promise<AgentBenchmarkSample> {
  const startedAt = Date.now();
  let firstTokenLatencyMs: number | null = null;
  let completionTokens = 0;
  let totalTokens = 0;
  let outputBuffer = "";

  const effectiveMaxTokens = Math.min(
    maxTokens,
    suggestMaxTokens(target.execution, false, prompt, providerProfile)
  );
  const runSignal = options?.runId ? getBenchmarkRunSignal(options.runId) : undefined;
  const localExtraBody = buildLocalBenchmarkExtraBody(target, options?.thinkingMode || "standard");

  async function requestLocalStream() {
    try {
      return await fetchWithTimeout(`${target.resolvedBaseUrl.replace(/\/v1$/, "")}/v1/chat/completions/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: target.resolvedModel,
          messages: [
            { role: "system", content: "Reply directly and keep the answer concise." },
            { role: "user", content: prompt }
          ],
          max_tokens: effectiveMaxTokens,
          context_window: contextWindow,
          ...(localExtraBody ? { extra_body: localExtraBody } : {})
        })
      }, LOCAL_BENCHMARK_STREAM_TIMEOUT_MS, runSignal);
    } catch {
      if (options?.runId) {
        assertBenchmarkRunActive(options.runId);
      }
      const reachable = await probeLocalGateway(target.resolvedBaseUrl, 5000);
      if (reachable) {
        return fetchWithTimeout(`${target.resolvedBaseUrl.replace(/\/v1$/, "")}/v1/chat/completions/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: target.resolvedModel,
            messages: [
              { role: "system", content: "Reply directly and keep the answer concise." },
              { role: "user", content: prompt }
            ],
            max_tokens: effectiveMaxTokens,
            context_window: contextWindow,
            ...(localExtraBody ? { extra_body: localExtraBody } : {})
          })
        }, LOCAL_BENCHMARK_STREAM_TIMEOUT_MS, runSignal);
      }
      const restarted = await restartLocalGateway(target.resolvedBaseUrl, {
        waitMs: LOCAL_BENCHMARK_WARMUP_WAIT_MS
      });
      if (!restarted) {
        throw new Error("Local gateway restart timed out before retrying benchmark.");
      }
      return fetchWithTimeout(`${target.resolvedBaseUrl.replace(/\/v1$/, "")}/v1/chat/completions/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: target.resolvedModel,
          messages: [
            { role: "system", content: "Reply directly and keep the answer concise." },
            { role: "user", content: prompt }
          ],
          max_tokens: effectiveMaxTokens,
          context_window: contextWindow,
          ...(localExtraBody ? { extra_body: localExtraBody } : {})
        })
      }, LOCAL_BENCHMARK_STREAM_TIMEOUT_MS, runSignal);
    }
  }

  async function executeRemoteSample(): Promise<AgentBenchmarkSample> {
    let attempt = 1;
    let lastWarning = "Unknown remote benchmark error.";
    const remoteTimeoutMs = getRemoteBenchmarkTimeoutMs(
      options?.workloadId || "custom-prompt",
      providerProfile,
      options?.thinkingMode || "standard"
    );
    const remoteStreamIdleTimeoutMs = getRemoteBenchmarkStreamIdleTimeoutMs(remoteTimeoutMs);

    while (attempt <= REMOTE_BENCHMARK_MAX_ATTEMPTS) {
      try {
        if (options?.runId) {
          assertBenchmarkRunActive(options.runId);
        }
        const response = await fetchWithTimeout(`${target.resolvedBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(target.resolvedApiKey ? { Authorization: `Bearer ${target.resolvedApiKey}` } : {})
          },
          body: JSON.stringify({
            model: target.resolvedModel,
            messages: [
              { role: "system", content: "Reply directly and keep the answer concise." },
              { role: "user", content: prompt }
            ],
            max_tokens: effectiveMaxTokens,
            stream: true,
            stream_options: { include_usage: true }
          })
        }, remoteTimeoutMs, runSignal);
        if (!response.ok) {
          const warning = await response.text();
          lastWarning = warning || `Remote benchmark request failed with HTTP ${response.status}.`;
          if (attempt < REMOTE_BENCHMARK_MAX_ATTEMPTS && isRetryableRemoteBenchmarkFailure(lastWarning)) {
            await sleep(1000 * attempt);
            attempt += 1;
            continue;
          }
          return {
            run: 0,
            firstTokenLatencyMs: null,
            latencyMs: Date.now() - startedAt,
            completionTokens: 0,
            totalTokens: 0,
            tokenThroughputTps: null,
            ok: false,
            warning: lastWarning
          };
        }

        await readNdjsonStream(
          new Response(
            new ReadableStream({
              async start(controller) {
                const reader = response.body?.getReader();
                if (!reader) {
                  controller.close();
                  return;
                }
                const decoder = new TextDecoder();
                let buffer = "";
                while (true) {
                  const { done, value } = await new Promise<ReadableStreamReadResult<Uint8Array>>(
                    (resolve, reject) => {
                      const timer = setTimeout(() => {
                        reject(new Error("Remote benchmark stream idle timeout."));
                      }, remoteStreamIdleTimeoutMs);
                      reader
                        .read()
                        .then((result) => {
                          clearTimeout(timer);
                          resolve(result);
                        })
                        .catch((error) => {
                          clearTimeout(timer);
                          reject(error);
                        });
                    }
                  );
                  if (done) break;
                  buffer += decoder.decode(value, { stream: true });
                  const events = buffer.split("\n\n");
                  buffer = events.pop() || "";
                  for (const event of events) {
                    const lines = event
                      .split("\n")
                      .map((line) => line.trim())
                      .filter((line) => line.startsWith("data:"));
                    for (const line of lines) {
                      const data = line.slice(5).trim();
                      if (!data || data === "[DONE]") continue;
                      controller.enqueue(new TextEncoder().encode(`${data}\n`));
                    }
                  }
                }
                controller.close();
              }
            })
          ),
          async (payload) => {
            const choices = Array.isArray(payload.choices)
              ? (payload.choices as Array<Record<string, unknown>>)
              : [];
            const delta = choices[0]?.delta as Record<string, unknown> | undefined;
            const content = typeof delta?.content === "string" ? delta.content : "";
            if (content && firstTokenLatencyMs === null) {
              firstTokenLatencyMs = Date.now() - startedAt;
            }
            if (content) {
              outputBuffer += content;
            }
            const usage = payload.usage as Record<string, unknown> | undefined;
            if (usage) {
              completionTokens =
                typeof usage.completion_tokens === "number" ? usage.completion_tokens : completionTokens;
              totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : totalTokens;
            }
          }
        );
        if (firstTokenLatencyMs === null) {
          firstTokenLatencyMs = Date.now() - startedAt;
        }

        const latencyMs = Date.now() - startedAt;
        const tokenThroughputTps =
          calculateTokenThroughputTps(completionTokens, latencyMs, firstTokenLatencyMs) ?? null;

        return {
          run: 0,
          firstTokenLatencyMs,
          latencyMs,
          completionTokens,
          totalTokens,
          tokenThroughputTps,
          outputText: outputBuffer.trim().slice(0, 12000),
          outputPreview: outputBuffer.trim().slice(0, 400),
          ok: true
        };
      } catch (error) {
        if (options?.runId) {
          assertBenchmarkRunActive(options.runId);
        }
        lastWarning = error instanceof Error ? error.message : "Unknown remote benchmark error.";
        if (attempt < REMOTE_BENCHMARK_MAX_ATTEMPTS && isRetryableRemoteBenchmarkFailure(lastWarning)) {
          await sleep(1000 * attempt);
          attempt += 1;
          continue;
        }
        return {
          run: 0,
          firstTokenLatencyMs: null,
          latencyMs: Date.now() - startedAt,
          completionTokens: 0,
          totalTokens: 0,
          tokenThroughputTps: null,
          outputPreview: "",
          ok: false,
          warning: lastWarning
        };
      }
    }

    return {
      run: 0,
      firstTokenLatencyMs: null,
      latencyMs: Date.now() - startedAt,
      completionTokens: 0,
      totalTokens: 0,
      tokenThroughputTps: null,
      outputPreview: "",
      ok: false,
      warning: lastWarning
    };
  }

  try {
    let response: Response;

    if (target.execution === "local") {
      const ensureResult =
        options?.ensureGateway === false
          ? { ok: true, reason: "Skipped per-sample ensure because the gateway was prewarmed." }
          : await ensureLocalBenchmarkGateway(target.resolvedBaseUrl);
      if (!ensureResult.ok) {
        return {
          run: 0,
          firstTokenLatencyMs: null,
          latencyMs: Date.now() - startedAt,
          completionTokens: 0,
          totalTokens: 0,
          tokenThroughputTps: null,
          ok: false,
          warning: ensureResult.reason
        };
      }
      response = await requestLocalStream();
    } else {
      return executeRemoteSample();
    }

    if (!response.ok) {
      return {
        run: 0,
        firstTokenLatencyMs: null,
        latencyMs: Date.now() - startedAt,
        completionTokens: 0,
        totalTokens: 0,
        tokenThroughputTps: null,
        ok: false,
        warning: await response.text()
      };
    }

    if (target.execution === "local") {
      await readNdjsonStream(response, async (payload) => {
        if (payload.type === "delta" && typeof payload.delta === "string" && payload.delta && firstTokenLatencyMs === null) {
          firstTokenLatencyMs = Date.now() - startedAt;
        }
        if (payload.type === "delta" && typeof payload.delta === "string") {
          outputBuffer += payload.delta;
        }
        if (payload.type === "done") {
          const usage = payload.usage as Record<string, unknown> | undefined;
          completionTokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0;
          totalTokens = typeof usage?.total_tokens === "number" ? usage.total_tokens : 0;
          if (typeof payload.content === "string" && !outputBuffer.trim()) {
            outputBuffer = payload.content;
          }
          if (firstTokenLatencyMs === null) {
            firstTokenLatencyMs = Date.now() - startedAt;
          }
        }
      });
    }

    const latencyMs = Date.now() - startedAt;
    const tokenThroughputTps =
      calculateTokenThroughputTps(completionTokens, latencyMs, firstTokenLatencyMs) ?? null;

    return {
      run: 0,
      firstTokenLatencyMs,
      latencyMs,
      completionTokens,
      totalTokens,
      tokenThroughputTps,
      outputText: outputBuffer.trim().slice(0, 12000),
      outputPreview: outputBuffer.trim().slice(0, 400),
      ok: true
    };
  } catch (error) {
    if (options?.runId) {
      assertBenchmarkRunActive(options.runId);
    }
    return {
      run: 0,
      firstTokenLatencyMs: null,
      latencyMs: Date.now() - startedAt,
      completionTokens: 0,
      totalTokens: 0,
      tokenThroughputTps: null,
      outputPreview: "",
      ok: false,
      warning: error instanceof Error ? error.message : "Unknown benchmark error."
    };
  }
}

async function runBenchmarkTasksSequentially(
  tasks: PlannedSampleTask[],
  runner: (task: PlannedSampleTask) => Promise<AgentBenchmarkSample>
) {
  const samples: AgentBenchmarkSample[] = [];
  for (const task of tasks) {
    samples.push(await runner(task));
  }
  return samples;
}

async function runBenchmarkTasksWithConcurrency(
  tasks: PlannedSampleTask[],
  concurrency: number,
  runner: (task: PlannedSampleTask) => Promise<AgentBenchmarkSample>,
  options?: {
    beforeEach?: () => void | Promise<void>;
  }
) {
  const safeConcurrency = Math.max(1, Math.min(concurrency, tasks.length || 1));
  const results = new Array<AgentBenchmarkSample>(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      if (options?.beforeEach) {
        await options.beforeEach();
      }
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= tasks.length) return;
      results[currentIndex] = await runner(tasks[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));
  return results;
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  options?: {
    beforeEach?: () => void | Promise<void>;
  }
) {
  const safeConcurrency = Math.max(1, Math.min(concurrency, tasks.length || 1));
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      if (options?.beforeEach) {
        await options.beforeEach();
      }
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= tasks.length) return;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));
  return results;
}

async function prewarmTarget(targetId: string, runId?: string) {
  const target = resolveTargetWithMode(targetId, "standard");
  const prewarmUrl = `${target.resolvedBaseUrl.replace(/\/v1$/, "")}/v1/models/prewarm`;
  const errors: string[] = [];
  const runSignal = runId ? getBenchmarkRunSignal(runId) : undefined;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (runId) {
      assertBenchmarkRunActive(runId);
    }
    const ensureResult = await ensureLocalBenchmarkGateway(target.resolvedBaseUrl);
    if (!ensureResult.ok) {
      errors.push(`attempt ${attempt}: ${ensureResult.reason}`);
    } else {
      try {
        const response = await fetchWithTimeout(
          prewarmUrl,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: target.resolvedModel
            })
          },
          LOCAL_BENCHMARK_PREWARM_TIMEOUT_MS,
          runSignal
        );

        if (response.ok) {
          await response.json();
          return;
        }

        errors.push(`attempt ${attempt}: ${await response.text()}`);
      } catch (error) {
        errors.push(
          `attempt ${attempt}: ${error instanceof Error ? error.message : "Unknown prewarm error."}`
        );
      }
    }

    if (attempt < 3) {
      await restartLocalGateway(target.resolvedBaseUrl, { waitMs: LOCAL_BENCHMARK_WARMUP_WAIT_MS });
      await sleep(400);
    }
  }

  throw new Error(`Prewarm failed for ${targetId}. ${errors.join(" | ")}`);
}

function isRetryableLocalSampleFailure(sample: AgentBenchmarkSample) {
  if (sample.ok) return false;
  const warning = (sample.warning || "").toLowerCase();
  return (
    warning.includes("fetch failed") ||
    warning.includes("terminated") ||
    warning.includes("gateway") ||
    warning.includes("timed out") ||
    warning.includes("network") ||
    warning.includes("address already in use")
  );
}

function isFatalLocalBenchmarkFailure(sample: AgentBenchmarkSample) {
  if (sample.ok) return false;
  const warning = (sample.warning || "").toLowerCase();
  return (
    warning.includes("still loading") ||
    warning.includes("prewarm failed") ||
    warning.includes("gateway unavailable") ||
    warning.includes("request timed out") ||
    warning.includes("offline")
  );
}

export async function POST(request: Request) {
  let requestRunId = "";
  let responseContext:
    | {
        runId: string;
        plan: BenchmarkPlan;
        contextWindow: number;
        runs: number;
        profileBatchScope?: AgentBenchmarkProfileBatchScope;
        profileModes: Array<{
          providerProfile: AgentProviderProfile;
          thinkingMode: AgentThinkingMode;
        }>;
        results: AgentBenchmarkResult[];
      }
    | null = null;
  try {
    const body = (await request.json()) as BenchmarkRequestBody;
    requestRunId = typeof body.runId === "string" && body.runId.trim() ? body.runId.trim() : "";
    const runs = Math.max(1, Math.min(Math.trunc(body.runs || 3), 10));
    const contextWindow = normalizeContextWindow(body.contextWindow, 32768);
    const maxTokens = Math.max(32, Math.min(Math.trunc(body.maxTokens || 192), 512));
    const thinkingMode = normalizeThinkingMode(body.thinkingMode);
    const requestedProviderProfile = normalizeProviderProfile(body.providerProfile);
    const providerProfile = thinkingMode === "thinking" ? "tool-first" : requestedProviderProfile;
    const profileModes = normalizeProfileModes(body.profileModes, requestedProviderProfile, thinkingMode);
    const plan = buildPlan(body, runs);
    if ("error" in plan) {
      return NextResponse.json({ error: plan.error }, { status: 400 });
    }
    const resolvedPlan = plan;

    const benchmarkTargets = agentTargets;
    const selectedTargets = (body.targetIds?.length
      ? benchmarkTargets.filter((target) => body.targetIds?.includes(target.id))
      : benchmarkTargets);

    if (!selectedTargets.length) {
      return NextResponse.json({ error: "No benchmark targets selected." }, { status: 400 });
    }

    const runId = requestRunId || crypto.randomUUID();
    registerBenchmarkRunController(runId);
    const profileBatchScope: AgentBenchmarkProfileBatchScope =
      body.profileBatchScope === "comparison-subset" ? "comparison-subset" : "full-suite";
    const plannedTasks = expandPlanTasks(resolvedPlan, contextWindow, maxTokens);
    const remoteComparisonTasks =
      resolvedPlan.benchmarkMode === "suite" && profileBatchScope === "comparison-subset"
        ? deriveComparisonSubsetTasks(plannedTasks)
        : plannedTasks;
    const results: AgentBenchmarkResult[] = [];
    responseContext = {
      runId,
      plan: resolvedPlan,
      contextWindow,
      runs,
      profileBatchScope: profileModes.length > 1 ? profileBatchScope : undefined,
      profileModes,
      results
    };

    const localTargets = selectedTargets.filter((target) => target.execution === "local");
    const remoteTargets = selectedTargets.filter((target) => target.execution === "remote");
    const comparisonLocalContextWindow =
      localTargets.length && remoteTargets.length
        ? Math.min(...localTargets.map((target) => clampBenchmarkContextWindowForTarget(target.id, contextWindow)))
        : null;
    const totalGroups = localTargets.length + remoteTargets.length * profileModes.length;
    const totalSamples =
      localTargets.length * plannedTasks.length +
      remoteTargets.length *
        profileModes.length *
        (profileModes.length > 1 ? remoteComparisonTasks.length : plannedTasks.length);
    const plannedGroups = [
      ...localTargets.map((target) => ({
        key: buildGroupKey(target.id, requestedProviderProfile, "standard"),
        targetLabel: target.label,
        providerProfile: requestedProviderProfile,
        thinkingMode: "standard" as AgentThinkingMode,
        execution: target.execution as AgentExecution,
        sampleCount: plannedTasks.length
      })),
      ...remoteTargets.flatMap((target) =>
        profileModes.map((mode) => ({
          key: buildGroupKey(target.id, mode.providerProfile, mode.thinkingMode),
          targetLabel: target.label,
          providerProfile: mode.providerProfile,
          thinkingMode: mode.thinkingMode,
          execution: target.execution as AgentExecution,
          sampleCount:
            profileModes.length > 1 && profileBatchScope === "comparison-subset"
              ? remoteComparisonTasks.length
              : plannedTasks.length
        }))
      )
    ];

    createBenchmarkProgress({
      runId,
      benchmarkMode: plan.benchmarkMode,
      suiteId: plan.suiteId,
      suiteLabel: plan.suiteLabel,
      profileBatchScope: profileModes.length > 1 ? profileBatchScope : "full-suite",
      totalGroups,
      totalSamples,
      pendingGroups: plannedGroups
    });
    markBenchmarkProgressRunning(runId);

    const buildPayload = (inputResults: AgentBenchmarkResult[]): AgentBenchmarkResponse => ({
      ok: inputResults.some((result) => result.okRuns > 0),
      generatedAt: new Date().toISOString(),
      benchmarkMode: resolvedPlan.benchmarkMode,
      prompt: resolvedPlan.prompt,
      promptSetId: resolvedPlan.promptSetId,
      promptSetLabel: resolvedPlan.promptSetLabel,
      promptSetPromptCount: resolvedPlan.promptSetPromptCount,
      datasetId: resolvedPlan.datasetId,
      datasetLabel: resolvedPlan.datasetLabel,
      datasetSourceLabel: resolvedPlan.datasetSourceLabel,
      datasetSourceUrl: resolvedPlan.datasetSourceUrl,
      datasetSampleCount: resolvedPlan.datasetSampleCount,
      suiteId: resolvedPlan.suiteId,
      suiteLabel: resolvedPlan.suiteLabel,
      suiteWorkloadCount: resolvedPlan.suiteWorkloadCount,
      workloads: resolvedPlan.workloads,
      contextWindow,
      runs,
      providerProfile: profileModes.length === 1 ? profileModes[0].providerProfile : undefined,
      thinkingMode: profileModes.length === 1 ? profileModes[0].thinkingMode : undefined,
      runId,
      profileBatchScope: profileModes.length > 1 ? profileBatchScope : undefined,
      profileModes: profileModes.length > 1 ? profileModes : undefined,
      comparisonsToLast: computeComparisonsToLast(inputResults, contextWindow, {
        ...resolvedPlan,
        profileBatchScope: profileModes.length > 1 ? profileBatchScope : undefined
      }),
      results: inputResults
    });

    async function runResultGroup(
      target: (typeof selectedTargets)[number],
      mode: { providerProfile: AgentProviderProfile; thinkingMode: AgentThinkingMode }
    ) {
      assertBenchmarkRunActive(runId);
      const resolvedTarget = resolveTargetWithMode(target.id, mode.thinkingMode);
      const effectiveContextWindow =
        target.execution === "remote" && comparisonLocalContextWindow
          ? Math.min(normalizeContextWindow(contextWindow, 8192), comparisonLocalContextWindow)
          : clampBenchmarkContextWindowForTarget(target.id, contextWindow);
      const groupKey = buildGroupKey(target.id, mode.providerProfile, mode.thinkingMode);
      const tasksForGroup =
        target.execution === "remote" && profileModes.length > 1 && profileBatchScope === "comparison-subset"
          ? remoteComparisonTasks
          : plannedTasks;

      startBenchmarkProgressGroup(runId, {
        key: groupKey,
        targetLabel: target.label,
        providerProfile: mode.providerProfile,
        thinkingMode: mode.thinkingMode,
        execution: target.execution,
        sampleCount: tasksForGroup.length
      });

      const runner = async (task: PlannedSampleTask) => {
        assertBenchmarkRunActive(runId);
        let sample = await runSingleBenchmarkSample(
          resolvedTarget,
          effectiveContextWindow,
          task.maxTokens,
          task.prompt,
          mode.providerProfile,
          { ensureGateway: false, workloadId: task.workloadId, thinkingMode: mode.thinkingMode, runId }
        );

        if (target.execution === "local" && isRetryableLocalSampleFailure(sample)) {
          const restarted = await restartLocalGateway(resolvedTarget.resolvedBaseUrl, {
            waitMs: LOCAL_BENCHMARK_WARMUP_WAIT_MS
          });
          if (restarted) {
            try {
              await prewarmTarget(target.id, runId);
              sample = await runSingleBenchmarkSample(
                resolvedTarget,
                effectiveContextWindow,
                task.maxTokens,
                task.prompt,
                mode.providerProfile,
                { ensureGateway: false, workloadId: task.workloadId, thinkingMode: mode.thinkingMode, runId }
              );
            } catch {
              // Keep the original failed sample if recovery also failed.
            }
          }
        }

        const evaluation =
          sample.ok && task.evaluator
            ? evaluateBenchmarkDatasetOutput(
                {
                  id: task.itemId,
                  prompt: task.prompt,
                  evaluator: task.evaluator,
                  expectedAnswerPreview: task.expectedAnswerPreview
                },
                sample.outputText || sample.outputPreview || ""
              )
            : null;

        const finalSample = {
          ...sample,
          run: task.sampleRun,
          workloadId: task.workloadId,
          workloadLabel: task.workloadLabel,
          itemId: task.itemId,
          expectedAnswerPreview: task.expectedAnswerPreview,
          score: evaluation?.score ?? null,
          passed: evaluation?.passed ?? null,
          warning:
            sample.warning ||
            (evaluation && evaluation.passed === false ? evaluation.rationale : undefined)
        };

        advanceBenchmarkProgress(runId, {
          ok: finalSample.ok,
          targetLabel: target.label,
          providerProfile: mode.providerProfile,
          thinkingMode: mode.thinkingMode,
          workloadLabel: task.workloadLabel
        });

        return finalSample;
      };

      let samples: AgentBenchmarkSample[];
      if (target.execution === "remote") {
        samples = await runBenchmarkTasksWithConcurrency(
          tasksForGroup,
          REMOTE_BENCHMARK_SAMPLE_CONCURRENCY,
          runner,
          {
            beforeEach: () => assertBenchmarkRunActive(runId)
          }
        );
      } else {
        let localSamples: AgentBenchmarkSample[] | null = null;
        const collected: AgentBenchmarkSample[] = [];
        const workloadGroups =
          resolvedPlan.benchmarkMode === "suite" ? groupBenchmarkTasksByWorkload(tasksForGroup) : [{ workloadId: "default", workloadLabel: "default", tasks: tasksForGroup }];
        let consecutiveFatalFailures = 0;

        for (let groupIndex = 0; groupIndex < workloadGroups.length; groupIndex += 1) {
          const workloadGroup = workloadGroups[groupIndex];
          let consecutiveFatalFailuresInWorkload = 0;

          if (groupIndex > 0 && resolvedPlan.benchmarkMode === "suite") {
            try {
              await prewarmTarget(target.id, runId);
            } catch {
              // Let the first sample in the next workload surface the failure; do not abort the whole run here.
            }
          }

          for (let taskIndex = 0; taskIndex < workloadGroup.tasks.length; taskIndex += 1) {
            assertBenchmarkRunActive(runId);
            const task = workloadGroup.tasks[taskIndex];
            const sample = await runner(task);
            collected.push(sample);

            if (isFatalLocalBenchmarkFailure(sample)) {
              consecutiveFatalFailures += 1;
              consecutiveFatalFailuresInWorkload += 1;
            } else {
              consecutiveFatalFailures = 0;
              consecutiveFatalFailuresInWorkload = 0;
            }

            if (
              resolvedPlan.benchmarkMode === "suite" &&
              consecutiveFatalFailuresInWorkload >= LOCAL_BENCHMARK_MAX_CONSECUTIVE_FATAL_FAILURES_PER_WORKLOAD
            ) {
              const remainingTasksInWorkload = workloadGroup.tasks.slice(taskIndex + 1);
              const warning = `Skipped remaining ${workloadGroup.workloadLabel} samples after repeated fatal local runtime failures.`;
              for (const skippedTask of remainingTasksInWorkload) {
                const skippedSample: AgentBenchmarkSample = {
                  run: skippedTask.sampleRun,
                  workloadId: skippedTask.workloadId,
                  workloadLabel: skippedTask.workloadLabel,
                  itemId: skippedTask.itemId,
                  expectedAnswerPreview: skippedTask.expectedAnswerPreview,
                  firstTokenLatencyMs: null,
                  latencyMs: 0,
                  completionTokens: 0,
                  totalTokens: 0,
                  tokenThroughputTps: null,
                  outputPreview: "",
                  ok: false,
                  warning
                };
                collected.push(skippedSample);
                advanceBenchmarkProgress(runId, {
                  ok: false,
                  targetLabel: target.label,
                  providerProfile: mode.providerProfile,
                  thinkingMode: mode.thinkingMode,
                  workloadLabel: skippedTask.workloadLabel
                });
              }
              consecutiveFatalFailures = 0;
              consecutiveFatalFailuresInWorkload = 0;
              break;
            }

            if (consecutiveFatalFailures >= LOCAL_BENCHMARK_MAX_CONSECUTIVE_FATAL_FAILURES) {
              const remainingWorkloadTasks = workloadGroup.tasks.slice(taskIndex + 1);
              const remainingTasks = [
                ...remainingWorkloadTasks,
                ...workloadGroups.slice(groupIndex + 1).flatMap((group) => group.tasks)
              ];
              const warning =
                "Local benchmark group stopped early after repeated fatal local runtime failures.";
              for (const skippedTask of remainingTasks) {
                const skippedSample: AgentBenchmarkSample = {
                  run: skippedTask.sampleRun,
                  workloadId: skippedTask.workloadId,
                  workloadLabel: skippedTask.workloadLabel,
                  itemId: skippedTask.itemId,
                  expectedAnswerPreview: skippedTask.expectedAnswerPreview,
                  firstTokenLatencyMs: null,
                  latencyMs: 0,
                  completionTokens: 0,
                  totalTokens: 0,
                  tokenThroughputTps: null,
                  outputPreview: "",
                  ok: false,
                  warning
                };
                collected.push(skippedSample);
                advanceBenchmarkProgress(runId, {
                  ok: false,
                  targetLabel: target.label,
                  providerProfile: mode.providerProfile,
                  thinkingMode: mode.thinkingMode,
                  workloadLabel: skippedTask.workloadLabel
                  });
              }
              localSamples = collected;
              break;
            }
          }

          if (localSamples) {
            break;
          }
        }

        samples = localSamples || collected;
      }

      const okSamples = samples.filter((sample) => sample.ok);
      const scoredSamples = samples.filter((sample) => typeof sample.score === "number");
      const passSamples = samples.filter((sample) => typeof sample.passed === "boolean");
      const result = {
        targetId: target.id,
        targetLabel: target.label,
        providerLabel: target.providerLabel,
        execution: target.execution,
        resolvedModel: resolvedTarget.resolvedModel,
        contextWindow: effectiveContextWindow,
        providerProfile: mode.providerProfile,
        thinkingMode: mode.thinkingMode,
        runs: samples.length,
        okRuns: okSamples.length,
        avgFirstTokenLatencyMs: average(okSamples.map((sample) => sample.firstTokenLatencyMs)),
        avgLatencyMs: average(okSamples.map((sample) => sample.latencyMs)),
        avgTokenThroughputTps: average(okSamples.map((sample) => sample.tokenThroughputTps)),
        avgScore: averageNullable(scoredSamples.map((sample) => sample.score)),
        passRate: passSamples.length
          ? Number(((passSamples.filter((sample) => sample.passed).length / passSamples.length) * 100).toFixed(2))
          : null,
        scoredSamples: scoredSamples.length,
        firstTokenLatencyPercentiles: buildPercentiles(okSamples.map((sample) => sample.firstTokenLatencyMs)),
        totalLatencyPercentiles: buildPercentiles(okSamples.map((sample) => sample.latencyMs)),
        tokenThroughputPercentiles: buildPercentiles(okSamples.map((sample) => sample.tokenThroughputTps)),
        samples
      } satisfies AgentBenchmarkResult;
      completeBenchmarkProgressGroup(runId, groupKey);
      return result;
    }

    for (const target of localTargets) {
      assertBenchmarkRunActive(runId);
      try {
        await prewarmTarget(target.id, runId);
      } catch (error) {
        const groupKey = buildGroupKey(target.id, requestedProviderProfile, "standard");
        for (const task of plannedTasks) {
          advanceBenchmarkProgress(runId, {
            ok: false,
            targetLabel: target.label,
            providerProfile: requestedProviderProfile,
            thinkingMode: "standard",
            workloadLabel: task.workloadLabel
          });
        }
        completeBenchmarkProgressGroup(runId, groupKey);
        results.push({
          targetId: target.id,
          targetLabel: target.label,
          providerLabel: target.providerLabel,
          execution: target.execution,
          resolvedModel: resolveTargetWithMode(target.id, "standard").resolvedModel,
          contextWindow,
          providerProfile: requestedProviderProfile,
          thinkingMode: "standard",
          runs: plannedTasks.length,
          okRuns: 0,
          avgFirstTokenLatencyMs: 0,
          avgLatencyMs: 0,
          avgTokenThroughputTps: 0,
          firstTokenLatencyPercentiles: buildPercentiles([]),
          totalLatencyPercentiles: buildPercentiles([]),
          tokenThroughputPercentiles: buildPercentiles([]),
          samples: plannedTasks.map((task) => ({
            run: task.sampleRun,
            workloadId: task.workloadId,
            workloadLabel: task.workloadLabel,
            itemId: task.itemId,
            expectedAnswerPreview: task.expectedAnswerPreview,
            firstTokenLatencyMs: null,
            latencyMs: 0,
            completionTokens: 0,
            totalTokens: 0,
            tokenThroughputTps: null,
            ok: false,
            warning: error instanceof Error ? error.message : "Prewarm failed."
          }))
        });
        continue;
      }

      results.push(
        await runResultGroup(target, {
          providerProfile: requestedProviderProfile,
          thinkingMode: "standard"
        })
      );
    }

    const remoteResultGroups = await runWithConcurrency(
      remoteTargets.flatMap((target) =>
        profileModes.map((mode) => () => runResultGroup(target, mode))
      ),
      REMOTE_BENCHMARK_GROUP_CONCURRENCY,
      {
        beforeEach: () => assertBenchmarkRunActive(runId)
      }
    );
    results.push(...remoteResultGroups);

    const payload = buildPayload(results);

    appendBenchmarkLog({
      kind: "benchmark",
      id: crypto.randomUUID(),
      ...payload
    });
    completeBenchmarkProgress(runId);

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BenchmarkControlError && requestRunId) {
      finalizeBenchmarkProgressControl(requestRunId, error.action, error.message);
      if (responseContext) {
        return NextResponse.json({
          ok: responseContext.results.some((result) => result.okRuns > 0),
          generatedAt: new Date().toISOString(),
          benchmarkMode: responseContext.plan.benchmarkMode,
          prompt: responseContext.plan.prompt,
          promptSetId: responseContext.plan.promptSetId,
          promptSetLabel: responseContext.plan.promptSetLabel,
          promptSetPromptCount: responseContext.plan.promptSetPromptCount,
          datasetId: responseContext.plan.datasetId,
          datasetLabel: responseContext.plan.datasetLabel,
          datasetSourceLabel: responseContext.plan.datasetSourceLabel,
          datasetSourceUrl: responseContext.plan.datasetSourceUrl,
          datasetSampleCount: responseContext.plan.datasetSampleCount,
          suiteId: responseContext.plan.suiteId,
          suiteLabel: responseContext.plan.suiteLabel,
          suiteWorkloadCount: responseContext.plan.suiteWorkloadCount,
          workloads: responseContext.plan.workloads,
          contextWindow: responseContext.contextWindow,
          runs: responseContext.runs,
          providerProfile:
            responseContext.profileModes.length === 1 ? responseContext.profileModes[0].providerProfile : undefined,
          thinkingMode:
            responseContext.profileModes.length === 1 ? responseContext.profileModes[0].thinkingMode : undefined,
          runId: responseContext.runId,
          profileBatchScope: responseContext.profileBatchScope,
          profileModes: responseContext.profileModes.length > 1 ? responseContext.profileModes : undefined,
          comparisonsToLast: computeComparisonsToLast(responseContext.results, responseContext.contextWindow, {
            ...responseContext.plan,
            profileBatchScope: responseContext.profileBatchScope
          }),
          results: responseContext.results,
          warning: error.message
        });
      }
      return NextResponse.json({ ok: false, runId: requestRunId, warning: error.message });
    }
    const message = error instanceof Error ? error.message : "Benchmark failed.";
    if (requestRunId) {
      failBenchmarkProgress(requestRunId, message);
    }
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  } finally {
    const runId = responseContext?.runId || requestRunId;
    if (runId) {
      clearBenchmarkRunController(runId);
    }
  }
}
