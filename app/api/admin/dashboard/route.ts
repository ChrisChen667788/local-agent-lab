import { NextResponse } from "next/server";
import { agentTargets, getAgentTarget } from "@/lib/agent/catalog";
import { calculateTokenThroughputTps, percentile } from "@/lib/agent/metrics";
import { collectDashboardDataWithFilters } from "@/lib/agent/admin-metrics";
import { getObservabilityPaths, readBenchmarkLogs, readChatLogs } from "@/lib/agent/log-store";
import { resolveTargetWithMode } from "@/lib/agent/providers";

export const runtime = "nodejs";

function average(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!filtered.length) return 0;
  return Number((filtered.reduce((sum, value) => sum + value, 0) / filtered.length).toFixed(2));
}

function buildPercentiles(values: Array<number | null | undefined>) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99)
  };
}

function safeResolveModelVersion(targetId: string, thinkingMode: "standard" | "thinking") {
  const target = getAgentTarget(targetId);
  if (!target) return null;

  try {
    return resolveTargetWithMode(targetId, thinkingMode).resolvedModel;
  } catch {
    return thinkingMode === "thinking"
      ? target.thinkingModelDefault || target.modelDefault
      : target.modelDefault;
  }
}

function normalizeBenchmarkResult<T extends {
  avgTokenThroughputTps: number;
  avgFirstTokenLatencyMs: number;
  avgLatencyMs: number;
  samples: Array<{
    firstTokenLatencyMs: number | null;
    latencyMs: number;
    completionTokens: number;
    tokenThroughputTps: number | null;
    ok: boolean;
  }>;
}>(result: T) {
  const normalizedSamples = result.samples.map((sample) => ({
    ...sample,
    tokenThroughputTps:
      calculateTokenThroughputTps(sample.completionTokens, sample.latencyMs, sample.firstTokenLatencyMs) ?? null
  }));
  const successfulSamples = normalizedSamples.filter((sample) => sample.ok);

  return {
    ...result,
    avgFirstTokenLatencyMs: average(successfulSamples.map((sample) => sample.firstTokenLatencyMs)),
    avgLatencyMs: average(successfulSamples.map((sample) => sample.latencyMs)),
    avgTokenThroughputTps: average(successfulSamples.map((sample) => sample.tokenThroughputTps)),
    firstTokenLatencyPercentiles: buildPercentiles(successfulSamples.map((sample) => sample.firstTokenLatencyMs)),
    totalLatencyPercentiles: buildPercentiles(successfulSamples.map((sample) => sample.latencyMs)),
    tokenThroughputPercentiles: buildPercentiles(successfulSamples.map((sample) => sample.tokenThroughputTps)),
    samples: normalizedSamples
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetId = searchParams.get("targetId") || "anthropic-claude";
  const providerFilter = searchParams.get("provider") || "all";
  const modelFilter = searchParams.get("model") || "all";
  const providerProfileFilter = searchParams.get("providerProfile") || "all";
  const benchmarkThinkingModeFilter = searchParams.get("benchmarkThinkingMode") || "all";
  const contextWindowParam = searchParams.get("contextWindow") || "all";
  const compareTargetIds = (searchParams.get("compareTargetIds") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const benchmarkTargetIds = (searchParams.get("benchmarkTargetIds") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const windowMinutesValue = Number(searchParams.get("windowMinutes") || "60");
  const windowMinutes = Number.isFinite(windowMinutesValue)
    ? Math.min(Math.max(windowMinutesValue, 5), 24 * 60)
    : 60;
  const benchmarkHeatmapPromptScope = searchParams.get("benchmarkHeatmapPromptScope") || "all";
  const benchmarkHeatmapSampleStatus = searchParams.get("benchmarkHeatmapSampleStatus") || "all";
  const benchmarkHeatmapWindowMinutesValue = Number(searchParams.get("benchmarkHeatmapWindowMinutes") || "0");
  const benchmarkHeatmapWindowMinutes = Number.isFinite(benchmarkHeatmapWindowMinutesValue) && benchmarkHeatmapWindowMinutesValue > 0
    ? Math.min(Math.max(benchmarkHeatmapWindowMinutesValue, 5), 24 * 60)
    : windowMinutes;
  const normalizedContextWindow =
    contextWindowParam === "all"
      ? null
      : Number.isFinite(Number(contextWindowParam))
        ? Math.max(1024, Math.min(Number(contextWindowParam), 32768))
        : null;

  const target = getAgentTarget(targetId);
  if (!target) {
    return NextResponse.json({ error: `Unknown target: ${targetId}` }, { status: 404 });
  }

  const payload = await collectDashboardDataWithFilters(target, windowMinutes, {
    providerProfile: providerProfileFilter,
    modelFilter,
    contextWindow: normalizedContextWindow ?? "all"
  });
  const sinceIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const matchingLogsBase = readChatLogs({ sinceIso, limit: 1000 }).filter((row) =>
    providerFilter === "all" ? true : row.providerLabel === providerFilter
  );
  const matchingLogs = matchingLogsBase.filter((row) =>
    providerProfileFilter === "all" ? true : row.providerProfile === providerProfileFilter
  );
  const availableModels = Array.from(new Set(matchingLogs.map((row) => row.resolvedModel))).sort();
  const availableProviderProfiles = Array.from(
    new Set(
      matchingLogsBase
        .map((row) => row.providerProfile)
        .filter((value): value is "speed" | "balanced" | "tool-first" => typeof value === "string")
    )
  ).sort();
  const availableContextWindows = Array.from(
    new Set(matchingLogs.map((row) => row.contextWindow).filter((value): value is number => typeof value === "number"))
  ).sort((a, b) => a - b);
  const filteredBenchmarkTargetIds = (benchmarkTargetIds.length ? benchmarkTargetIds : agentTargets.map((item) => item.id))
    .filter((id) => agentTargets.some((item) => item.id === id));
  const benchmarkTargetVersions = filteredBenchmarkTargetIds
    .map((id) => {
      const targetEntry = getAgentTarget(id);
      if (!targetEntry) return null;
      const standardResolvedModel = safeResolveModelVersion(id, "standard") || targetEntry.modelDefault;
      const thinkingResolvedModel =
        targetEntry.thinkingModelDefault || targetEntry.thinkingModelEnv
          ? safeResolveModelVersion(id, "thinking")
          : null;
      return {
        targetId: targetEntry.id,
        targetLabel: targetEntry.label,
        execution: targetEntry.execution,
        standardResolvedModel,
        thinkingResolvedModel
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const benchmarkHistoryRaw = readBenchmarkLogs({ sinceIso, limit: 120 });
  const availableBenchmarkThinkingModes = Array.from(
    new Set(
      benchmarkHistoryRaw.flatMap((entry) =>
        entry.results
          .map((result) => result.thinkingMode || entry.thinkingMode || "standard")
          .filter((value) => typeof value === "string" && value.length > 0)
      )
    )
  ).sort();
  const benchmarkHistoryFiltered = benchmarkHistoryRaw
    .map((entry) => ({
      ...entry,
      results: entry.results
        .filter((result) =>
          filteredBenchmarkTargetIds.length ? filteredBenchmarkTargetIds.includes(result.targetId) : true
        )
        .filter((result) =>
          modelFilter === "all" ? true : result.resolvedModel === modelFilter
        )
        .filter((result) =>
          providerProfileFilter === "all"
            ? true
            : (result.providerProfile || entry.providerProfile) === providerProfileFilter
        )
        .filter((result) =>
          benchmarkThinkingModeFilter === "all"
            ? true
            : (result.thinkingMode || entry.thinkingMode || "standard") === benchmarkThinkingModeFilter
        )
        .map((result) => normalizeBenchmarkResult(result))
    }))
    .filter((entry) => entry.results.length > 0)
    .filter((entry) => (normalizedContextWindow === null ? true : entry.contextWindow === normalizedContextWindow));
  const benchmarkHistory = benchmarkHistoryFiltered.slice(-20).reverse();
  const benchmarkTrendMap = new Map<
    string,
    {
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
    }
  >();
  for (const entry of benchmarkHistoryFiltered) {
    for (const result of entry.results) {
      const resultProviderProfile = result.providerProfile || entry.providerProfile || "default";
      const resultThinkingMode = result.thinkingMode || entry.thinkingMode || "standard";
      const key = `${result.targetId}:${resultProviderProfile}:${resultThinkingMode}`;
      const current = benchmarkTrendMap.get(key) || {
        targetId: result.targetId,
        targetLabel: result.targetLabel,
        providerProfile: resultProviderProfile,
        thinkingMode: resultThinkingMode,
        resolvedModel: result.resolvedModel,
        points: []
      };
      current.points.push({
        timestamp: entry.generatedAt,
        contextWindow: entry.contextWindow,
        avgFirstTokenLatencyMs: result.avgFirstTokenLatencyMs,
        avgLatencyMs: result.avgLatencyMs,
        avgTokenThroughputTps: result.avgTokenThroughputTps,
        successRate: result.runs > 0 ? Number(((result.okRuns / result.runs) * 100).toFixed(2)) : 0
      });
      benchmarkTrendMap.set(key, current);
    }
  }
  const benchmarkTrends = [...benchmarkTrendMap.values()]
    .map((entry) => ({
      ...entry,
      points: entry.points.slice(-24)
    }))
    .sort((a, b) => a.targetLabel.localeCompare(b.targetLabel));
  const benchmarkHeatmapSinceIso = new Date(Date.now() - benchmarkHeatmapWindowMinutes * 60 * 1000).toISOString();
  const benchmarkHeatmapRaw = readBenchmarkLogs({ sinceIso: benchmarkHeatmapSinceIso, limit: 240 });
  const benchmarkHeatmapProfiles = ["speed", "balanced", "tool-first"] as const;
  const benchmarkHeatmapThinkingModes = ["standard", "thinking"] as const;
  const benchmarkHeatmapMap = new Map<
    string,
    {
      providerProfile: string;
      thinkingMode: string;
      sampleCount: number;
      totalFirstTokenLatencyMs: number;
      firstTokenSampleCount: number;
      totalLatencyMs: number;
      totalTokenThroughputTps: number;
      throughputSampleCount: number;
      okCount: number;
    }
  >();

  for (const entry of benchmarkHeatmapRaw) {
    if (normalizedContextWindow !== null && entry.contextWindow !== normalizedContextWindow) continue;
    if (benchmarkHeatmapPromptScope === "fixed-only" && !entry.promptSetId) continue;
    for (const result of entry.results) {
      if (filteredBenchmarkTargetIds.length && !filteredBenchmarkTargetIds.includes(result.targetId)) continue;
      if (modelFilter !== "all" && result.resolvedModel !== modelFilter) continue;
      const resultProviderProfile = result.providerProfile || entry.providerProfile || "default";
      const resultThinkingMode = result.thinkingMode || entry.thinkingMode || "standard";
      if (providerProfileFilter !== "all" && resultProviderProfile !== providerProfileFilter) continue;
      if (benchmarkThinkingModeFilter !== "all" && resultThinkingMode !== benchmarkThinkingModeFilter) continue;
      const normalizedResult = normalizeBenchmarkResult(result);
      const samples = normalizedResult.samples.length
        ? normalizedResult.samples
        : [
            {
              firstTokenLatencyMs: normalizedResult.avgFirstTokenLatencyMs || null,
              latencyMs: normalizedResult.avgLatencyMs,
              completionTokens: 0,
              tokenThroughputTps: normalizedResult.avgTokenThroughputTps || null,
              ok: normalizedResult.okRuns >= normalizedResult.runs
            }
          ];
      const key = `${resultProviderProfile}:${resultThinkingMode}`;
      const current = benchmarkHeatmapMap.get(key) || {
        providerProfile: resultProviderProfile,
        thinkingMode: resultThinkingMode,
        sampleCount: 0,
        totalFirstTokenLatencyMs: 0,
        firstTokenSampleCount: 0,
        totalLatencyMs: 0,
        totalTokenThroughputTps: 0,
        throughputSampleCount: 0,
        okCount: 0
      };
      for (const sample of samples) {
        if (benchmarkHeatmapSampleStatus === "success" && !sample.ok) continue;
        if (benchmarkHeatmapSampleStatus === "failed" && sample.ok) continue;
        current.sampleCount += 1;
        current.totalLatencyMs += sample.latencyMs;
        current.okCount += sample.ok ? 1 : 0;
        if (typeof sample.firstTokenLatencyMs === "number" && Number.isFinite(sample.firstTokenLatencyMs)) {
          current.totalFirstTokenLatencyMs += sample.firstTokenLatencyMs;
          current.firstTokenSampleCount += 1;
        }
        if (typeof sample.tokenThroughputTps === "number" && Number.isFinite(sample.tokenThroughputTps)) {
          current.totalTokenThroughputTps += sample.tokenThroughputTps;
          current.throughputSampleCount += 1;
        }
      }
      benchmarkHeatmapMap.set(key, current);
    }
  }
  const benchmarkHeatmap = benchmarkHeatmapProfiles.map((profile) => ({
    providerProfile: profile,
    cells: benchmarkHeatmapThinkingModes.map((mode) => {
      const cell = benchmarkHeatmapMap.get(`${profile}:${mode}`);
      return {
        thinkingMode: mode,
        sampleCount: cell?.sampleCount || 0,
        avgFirstTokenLatencyMs:
          cell && cell.firstTokenSampleCount > 0
            ? Number((cell.totalFirstTokenLatencyMs / cell.firstTokenSampleCount).toFixed(2))
            : 0,
        avgLatencyMs:
          cell && cell.sampleCount > 0 ? Number((cell.totalLatencyMs / cell.sampleCount).toFixed(2)) : 0,
        avgTokenThroughputTps:
          cell && cell.throughputSampleCount > 0
            ? Number((cell.totalTokenThroughputTps / cell.throughputSampleCount).toFixed(2))
            : 0,
        avgSuccessRate:
          cell && cell.sampleCount > 0 ? Number(((cell.okCount / cell.sampleCount) * 100).toFixed(2)) : 0
      };
    })
  }));

  const availableProviders = Array.from(new Set(agentTargets.map((item) => item.providerLabel))).sort();
  const filteredCompareTargets = (compareTargetIds.length ? compareTargetIds : [target.id])
    .map((id) => getAgentTarget(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => (providerFilter === "all" ? true : item.providerLabel === providerFilter));

  const comparison = await Promise.all(
    filteredCompareTargets.map(async (item) => {
      const comparisonPayload = await collectDashboardDataWithFilters(item, windowMinutes, {
        providerProfile: providerProfileFilter,
        modelFilter,
        contextWindow: normalizedContextWindow ?? "all"
      });
      return {
        targetId: item.id,
        targetLabel: item.label,
        providerLabel: item.providerLabel,
        execution: item.execution,
        totalRequests: comparisonPayload.summary.totalRequests,
        totalTokens: comparisonPayload.summary.totalTokens,
        failedRequests: comparisonPayload.summary.failedRequests,
        activeForTarget: comparisonPayload.summary.activeForTarget,
        latestCheckOk: comparisonPayload.summary.latestCheckOk,
        avgLatencyMs: comparisonPayload.summary.avgLatencyMs,
        avgFirstTokenLatencyMs: comparisonPayload.summary.avgFirstTokenLatencyMs,
        avgTokenThroughputTps: comparisonPayload.summary.avgTokenThroughputTps,
        firstTokenLatencyPercentiles: comparisonPayload.summary.firstTokenLatencyPercentiles,
        totalLatencyPercentiles: comparisonPayload.summary.latencyPercentiles,
        tokenThroughputPercentiles: comparisonPayload.summary.tokenThroughputPercentiles
      };
    })
  );

  return NextResponse.json({
    ...payload,
    filters: {
      provider: providerFilter,
      providerProfile: providerProfileFilter,
      benchmarkThinkingMode: benchmarkThinkingModeFilter,
      benchmarkHeatmapPromptScope,
      benchmarkHeatmapSampleStatus,
      benchmarkHeatmapWindowMinutes: String(benchmarkHeatmapWindowMinutes),
      model: modelFilter,
      contextWindow: contextWindowParam
    },
    availableModels,
    availableProviders,
    availableProviderProfiles,
    availableBenchmarkThinkingModes,
    availableContextWindows,
    benchmarkTargetVersions,
    comparison,
    benchmarkHistory,
    benchmarkTrends,
    benchmarkHeatmap,
    paths: getObservabilityPaths()
  });
}
