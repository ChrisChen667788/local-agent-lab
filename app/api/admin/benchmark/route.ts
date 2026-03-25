import crypto from "crypto";
import { NextResponse } from "next/server";
import { agentTargets } from "@/lib/agent/catalog";
import { ensureLocalGatewayAvailableDetailed, restartLocalGateway } from "@/lib/agent/local-gateway";
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
  markBenchmarkProgressRunning,
  startBenchmarkProgressGroup
} from "@/lib/agent/benchmark-progress-store";
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
  AgentProviderProfile,
  AgentThinkingMode,
  AgentBenchmarkWorkloadSummary,
  ResolvedTarget
} from "@/lib/agent/types";

export const runtime = "nodejs";

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
const REMOTE_BENCHMARK_TIMEOUT_MS = 90000;
const REMOTE_PROFILE_COMPARISON_WORKLOAD_IDS = new Set([
  "latency-smoke",
  "instruction-following-lite",
  "ifeval-starter",
  "bfcl-starter"
]);

function average(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!filtered.length) return 0;
  return Number((filtered.reduce((sum, value) => sum + value, 0) / filtered.length).toFixed(2));
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
    normalized.includes("temporarily unavailable") ||
    normalized.includes("bad gateway") ||
    normalized.includes("service unavailable")
  );
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
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
  const firstAttempt = await ensureLocalGatewayAvailableDetailed(baseUrl, { waitMs: 25000 });
  if (firstAttempt.ok) {
    return {
      ok: true,
      reason: firstAttempt.reason
    };
  }

  const restarted = await restartLocalGateway(baseUrl, { waitMs: 30000 });
  if (!restarted) {
    return {
      ok: false,
      reason: `Gateway unavailable after restart attempt. ${firstAttempt.reason}`
    };
  }

  const secondAttempt = await ensureLocalGatewayAvailableDetailed(baseUrl, { waitMs: 10000 });
  return {
    ok: secondAttempt.ok,
    reason: secondAttempt.ok
      ? "Gateway recovered after restart."
      : `Gateway unavailable after restart attempt. ${secondAttempt.reason}`
  };
}

async function runSingleBenchmarkSample(
  target: ResolvedTarget,
  contextWindow: number,
  maxTokens: number,
  prompt: string,
  providerProfile: AgentProviderProfile,
  options?: { ensureGateway?: boolean }
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

  async function requestLocalStream() {
    try {
      return await fetch(`${target.resolvedBaseUrl.replace(/\/v1$/, "")}/v1/chat/completions/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: target.resolvedModel,
          messages: [
            { role: "system", content: "Reply directly and keep the answer concise." },
            { role: "user", content: prompt }
          ],
          max_tokens: effectiveMaxTokens,
          context_window: contextWindow
        })
      });
    } catch {
      const restarted = await restartLocalGateway(target.resolvedBaseUrl, { waitMs: 30000 });
      if (!restarted) {
        throw new Error("Local gateway restart timed out before retrying benchmark.");
      }
      return fetch(`${target.resolvedBaseUrl.replace(/\/v1$/, "")}/v1/chat/completions/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: target.resolvedModel,
          messages: [
            { role: "system", content: "Reply directly and keep the answer concise." },
            { role: "user", content: prompt }
          ],
          max_tokens: effectiveMaxTokens,
          context_window: contextWindow
        })
      });
    }
  }

  async function executeRemoteSample(): Promise<AgentBenchmarkSample> {
    let attempt = 1;
    let lastWarning = "Unknown remote benchmark error.";

    while (attempt <= REMOTE_BENCHMARK_MAX_ATTEMPTS) {
      try {
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
        }, REMOTE_BENCHMARK_TIMEOUT_MS);
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
                  const { done, value } = await reader.read();
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
          outputPreview: outputBuffer.trim().slice(0, 400),
          ok: true
        };
      } catch (error) {
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
      outputPreview: outputBuffer.trim().slice(0, 400),
      ok: true
    };
  } catch (error) {
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
  runner: (task: PlannedSampleTask) => Promise<AgentBenchmarkSample>
) {
  const safeConcurrency = Math.max(1, Math.min(concurrency, tasks.length || 1));
  const results = new Array<AgentBenchmarkSample>(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= tasks.length) return;
      results[currentIndex] = await runner(tasks[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));
  return results;
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number) {
  const safeConcurrency = Math.max(1, Math.min(concurrency, tasks.length || 1));
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= tasks.length) return;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));
  return results;
}

async function prewarmTarget(targetId: string) {
  const target = resolveTargetWithMode(targetId, "standard");
  const prewarmUrl = `${target.resolvedBaseUrl.replace(/\/v1$/, "")}/v1/models/prewarm`;
  const errors: string[] = [];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const ensureResult = await ensureLocalBenchmarkGateway(target.resolvedBaseUrl);
    if (!ensureResult.ok) {
      errors.push(`attempt ${attempt}: ${ensureResult.reason}`);
    } else {
      try {
        const response = await fetch(prewarmUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: target.resolvedModel
          })
        });

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
      await restartLocalGateway(target.resolvedBaseUrl, { waitMs: 30000 });
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

export async function POST(request: Request) {
  let requestRunId = "";
  try {
    const body = (await request.json()) as BenchmarkRequestBody;
    requestRunId = typeof body.runId === "string" && body.runId.trim() ? body.runId.trim() : "";
    const runs = Math.max(1, Math.min(Math.trunc(body.runs || 3), 10));
    const contextWindow = normalizeContextWindow(body.contextWindow, 8192);
    const maxTokens = Math.max(32, Math.min(Math.trunc(body.maxTokens || 192), 512));
    const thinkingMode = normalizeThinkingMode(body.thinkingMode);
    const requestedProviderProfile = normalizeProviderProfile(body.providerProfile);
    const providerProfile = thinkingMode === "thinking" ? "tool-first" : requestedProviderProfile;
    const profileModes = normalizeProfileModes(body.profileModes, requestedProviderProfile, thinkingMode);
    const plan = buildPlan(body, runs);
    if ("error" in plan) {
      return NextResponse.json({ error: plan.error }, { status: 400 });
    }

    const benchmarkTargets = agentTargets;
    const selectedTargets = (body.targetIds?.length
      ? benchmarkTargets.filter((target) => body.targetIds?.includes(target.id))
      : benchmarkTargets);

    if (!selectedTargets.length) {
      return NextResponse.json({ error: "No benchmark targets selected." }, { status: 400 });
    }

    const runId = requestRunId || crypto.randomUUID();
    const profileBatchScope: AgentBenchmarkProfileBatchScope =
      body.profileBatchScope === "comparison-subset" ? "comparison-subset" : "full-suite";
    const plannedTasks = expandPlanTasks(plan, contextWindow, maxTokens);
    const remoteComparisonTasks =
      plan.benchmarkMode === "suite" && profileBatchScope === "comparison-subset"
        ? deriveComparisonSubsetTasks(plannedTasks)
        : plannedTasks;
    const results: AgentBenchmarkResult[] = [];

    const localTargets = selectedTargets.filter((target) => target.execution === "local");
    const remoteTargets = selectedTargets.filter((target) => target.execution === "remote");
    const totalGroups = localTargets.length + remoteTargets.length * profileModes.length;
    const totalSamples =
      localTargets.length * plannedTasks.length +
      remoteTargets.length *
        profileModes.length *
        (profileModes.length > 1 ? remoteComparisonTasks.length : plannedTasks.length);

    createBenchmarkProgress({
      runId,
      benchmarkMode: plan.benchmarkMode,
      suiteId: plan.suiteId,
      suiteLabel: plan.suiteLabel,
      profileBatchScope: profileModes.length > 1 ? profileBatchScope : "full-suite",
      totalGroups,
      totalSamples
    });
    markBenchmarkProgressRunning(runId);

    async function runResultGroup(
      target: (typeof selectedTargets)[number],
      mode: { providerProfile: AgentProviderProfile; thinkingMode: AgentThinkingMode }
    ) {
      const resolvedTarget = resolveTargetWithMode(target.id, mode.thinkingMode);
      const effectiveContextWindow = clampContextWindowForTarget(target.id, contextWindow, {
        enableTools: false,
        enableRetrieval: false
      });
      const groupKey = buildGroupKey(target.id, mode.providerProfile, mode.thinkingMode);
      const tasksForGroup =
        target.execution === "remote" && profileModes.length > 1 && profileBatchScope === "comparison-subset"
          ? remoteComparisonTasks
          : plannedTasks;

      startBenchmarkProgressGroup(runId, {
        key: groupKey,
        targetLabel: target.label,
        providerProfile: mode.providerProfile,
        thinkingMode: mode.thinkingMode
      });

      const runner = async (task: PlannedSampleTask) => {
        let sample = await runSingleBenchmarkSample(
          resolvedTarget,
          effectiveContextWindow,
          task.maxTokens,
          task.prompt,
          mode.providerProfile,
          { ensureGateway: false }
        );

        if (target.execution === "local" && isRetryableLocalSampleFailure(sample)) {
          const restarted = await restartLocalGateway(resolvedTarget.resolvedBaseUrl, { waitMs: 30000 });
          if (restarted) {
            try {
              await prewarmTarget(target.id);
              sample = await runSingleBenchmarkSample(
                resolvedTarget,
                effectiveContextWindow,
                task.maxTokens,
                task.prompt,
                mode.providerProfile,
                { ensureGateway: false }
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
                sample.outputPreview || ""
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

      const samples =
        target.execution === "remote"
          ? await runBenchmarkTasksWithConcurrency(
              tasksForGroup,
              REMOTE_BENCHMARK_SAMPLE_CONCURRENCY,
              runner
            )
          : await runBenchmarkTasksSequentially(tasksForGroup, runner);

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
      try {
        await prewarmTarget(target.id);
      } catch (error) {
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
          samples: [
            {
              run: 1,
              firstTokenLatencyMs: null,
              latencyMs: 0,
              completionTokens: 0,
              totalTokens: 0,
              tokenThroughputTps: null,
              ok: false,
              warning: error instanceof Error ? error.message : "Prewarm failed."
            }
          ]
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
      REMOTE_BENCHMARK_GROUP_CONCURRENCY
    );
    results.push(...remoteResultGroups);

    const payload: AgentBenchmarkResponse = {
      ok: results.some((result) => result.okRuns > 0),
      generatedAt: new Date().toISOString(),
      benchmarkMode: plan.benchmarkMode,
      prompt: plan.prompt,
      promptSetId: plan.promptSetId,
      promptSetLabel: plan.promptSetLabel,
      promptSetPromptCount: plan.promptSetPromptCount,
      datasetId: plan.datasetId,
      datasetLabel: plan.datasetLabel,
      datasetSourceLabel: plan.datasetSourceLabel,
      datasetSourceUrl: plan.datasetSourceUrl,
      datasetSampleCount: plan.datasetSampleCount,
      suiteId: plan.suiteId,
      suiteLabel: plan.suiteLabel,
      suiteWorkloadCount: plan.suiteWorkloadCount,
      workloads: plan.workloads,
      contextWindow,
      runs,
      providerProfile: profileModes.length === 1 ? profileModes[0].providerProfile : undefined,
      thinkingMode: profileModes.length === 1 ? profileModes[0].thinkingMode : undefined,
      runId,
      profileBatchScope: profileModes.length > 1 ? profileBatchScope : undefined,
      profileModes: profileModes.length > 1 ? profileModes : undefined,
      comparisonsToLast: computeComparisonsToLast(results, contextWindow, {
        ...plan,
        profileBatchScope: profileModes.length > 1 ? profileBatchScope : undefined
      }),
      results
    };

    appendBenchmarkLog({
      kind: "benchmark",
      id: crypto.randomUUID(),
      ...payload
    });
    completeBenchmarkProgress(runId);

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Benchmark failed.";
    if (requestRunId) {
      failBenchmarkProgress(requestRunId, message);
    }
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
