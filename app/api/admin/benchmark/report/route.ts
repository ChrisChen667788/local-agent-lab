import { NextResponse } from "next/server";
import { readBenchmarkBaselines, readBenchmarkLogs } from "@/lib/agent/log-store";
import type { AgentBenchmarkBaseline, AgentBenchmarkResponse, AgentBenchmarkResult } from "@/lib/agent/types";

export const runtime = "nodejs";

function average(values: number[]) {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function parseTargetIds(searchParams: URLSearchParams) {
  return (searchParams.get("targetIds") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseContextWindow(searchParams: URLSearchParams) {
  const raw = searchParams.get("contextWindow");
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? value : undefined;
}

function parseBenchmarkMode(searchParams: URLSearchParams) {
  return (searchParams.get("benchmarkMode") || "all").trim();
}

function parseSinceIso(searchParams: URLSearchParams) {
  const raw = Number(searchParams.get("windowMinutes") || "720");
  const windowMinutes = Number.isFinite(raw) ? Math.min(Math.max(raw, 5), 24 * 60) : 720;
  return {
    windowMinutes,
    sinceIso: new Date(Date.now() - windowMinutes * 60 * 1000).toISOString()
  };
}

function matchesWorkload(
  entry: { prompt: string; benchmarkMode?: string | null; promptSetId?: string | null; datasetId?: string | null; datasetSampleCount?: number | null; suiteId?: string | null; profileBatchScope?: string | null; contextWindow: number },
  options: { benchmarkMode?: string; promptSetId?: string; datasetId?: string; datasetSampleCount?: number; suiteId?: string; profileBatchScope?: string; prompt?: string; contextWindow?: number }
) {
  if (options.benchmarkMode && options.benchmarkMode !== "all" && (entry.benchmarkMode || "prompt") !== options.benchmarkMode) return false;
  if (typeof options.contextWindow === "number" && entry.contextWindow !== options.contextWindow) return false;
  if (options.profileBatchScope && (entry.profileBatchScope || "") !== options.profileBatchScope) return false;
  if (options.suiteId) return entry.suiteId === options.suiteId;
  if (options.datasetId) {
    if (entry.datasetId !== options.datasetId) return false;
    if (typeof options.datasetSampleCount === "number" && entry.datasetSampleCount !== options.datasetSampleCount) return false;
    return true;
  }
  if (options.promptSetId) return entry.promptSetId === options.promptSetId;
  if (options.prompt) return !entry.promptSetId && entry.prompt === options.prompt;
  return true;
}

function filterResults(entry: AgentBenchmarkResponse, options: {
  targetIds: string[];
  providerProfile: string;
  thinkingMode: string;
}) {
  return entry.results.filter((result) => {
    if (options.targetIds.length && !options.targetIds.includes(result.targetId)) return false;
    const profile = result.providerProfile || entry.providerProfile || "default";
    const thinking = result.thinkingMode || entry.thinkingMode || "standard";
    if (options.providerProfile !== "all" && profile !== options.providerProfile) return false;
    if (options.thinkingMode !== "all" && thinking !== options.thinkingMode) return false;
    return true;
  });
}

function selectBaseline(
  baselines: AgentBenchmarkBaseline[],
  workload: { targetIds: string[]; benchmarkMode?: string; promptSetId?: string; datasetId?: string; datasetSampleCount?: number; suiteId?: string; profileBatchScope?: string; prompt?: string; contextWindow?: number }
) {
  const matching = baselines
    .filter((entry) => matchesWorkload(entry, workload))
    .filter((entry) =>
      workload.targetIds.length
        ? workload.targetIds.every((targetId) => entry.results.some((result) => result.targetId === targetId))
        : true
    )
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return matching.find((entry) => entry.isDefault) || matching[0] || null;
}

function compareToBaseline(current: AgentBenchmarkResponse, baseline: AgentBenchmarkBaseline | null) {
  if (!baseline) return [];
  const baselineMap = new Map(
    baseline.results.map((result) => [
      `${result.targetId}:${result.providerProfile || baseline.providerProfile || "default"}:${result.thinkingMode || baseline.thinkingMode || "standard"}`,
      result
    ])
  );

  return current.results.map((result) => {
    const signature = `${result.targetId}:${result.providerProfile || current.providerProfile || "default"}:${result.thinkingMode || current.thinkingMode || "standard"}`;
    const previous = baselineMap.get(signature) || null;
    const currentSuccessRate = result.runs > 0 ? Number(((result.okRuns / result.runs) * 100).toFixed(2)) : 0;
    const baselineSuccessRate = previous && previous.runs > 0
      ? Number(((previous.okRuns / previous.runs) * 100).toFixed(2))
      : null;

    return {
      targetLabel: result.targetLabel,
      providerProfile: result.providerProfile || current.providerProfile || "default",
      thinkingMode: result.thinkingMode || current.thinkingMode || "standard",
      baselineMatched: Boolean(previous),
      deltaFirstTokenLatencyMs: previous ? Number((result.avgFirstTokenLatencyMs - previous.avgFirstTokenLatencyMs).toFixed(2)) : null,
      deltaLatencyMs: previous ? Number((result.avgLatencyMs - previous.avgLatencyMs).toFixed(2)) : null,
      deltaTokenThroughputTps: previous ? Number((result.avgTokenThroughputTps - previous.avgTokenThroughputTps).toFixed(2)) : null,
      deltaScore:
        typeof result.avgScore === "number" && typeof previous?.avgScore === "number"
          ? Number((result.avgScore - previous.avgScore).toFixed(2))
          : null,
      deltaPassRate:
        typeof result.passRate === "number" && typeof previous?.passRate === "number"
          ? Number((result.passRate - previous.passRate).toFixed(2))
          : null,
      deltaSuccessRate: baselineSuccessRate === null ? null : Number((currentSuccessRate - baselineSuccessRate).toFixed(2)),
      successRate: currentSuccessRate
    };
  });
}

function buildHeatmapSummary(logs: AgentBenchmarkResponse[]) {
  const map = new Map<string, {
    providerProfile: string;
    thinkingMode: string;
    sampleCount: number;
    latencies: number[];
    firstTokenLatencies: number[];
    throughputs: number[];
    okCount: number;
  }>();

  for (const entry of logs) {
    for (const result of entry.results) {
      const providerProfile = result.providerProfile || entry.providerProfile || "default";
      const thinkingMode = result.thinkingMode || entry.thinkingMode || "standard";
      const key = `${providerProfile}:${thinkingMode}`;
      const bucket = map.get(key) || {
        providerProfile,
        thinkingMode,
        sampleCount: 0,
        latencies: [],
        firstTokenLatencies: [],
        throughputs: [],
        okCount: 0
      };
      for (const sample of result.samples) {
        bucket.sampleCount += 1;
        bucket.latencies.push(sample.latencyMs);
        if (typeof sample.firstTokenLatencyMs === "number") {
          bucket.firstTokenLatencies.push(sample.firstTokenLatencyMs);
        }
        if (typeof sample.tokenThroughputTps === "number") {
          bucket.throughputs.push(sample.tokenThroughputTps);
        }
        if (sample.ok) bucket.okCount += 1;
      }
      map.set(key, bucket);
    }
  }

  return [...map.values()]
    .map((bucket) => ({
      providerProfile: bucket.providerProfile,
      thinkingMode: bucket.thinkingMode,
      sampleCount: bucket.sampleCount,
      avgFirstTokenLatencyMs: average(bucket.firstTokenLatencies),
      avgLatencyMs: average(bucket.latencies),
      avgTokenThroughputTps: average(bucket.throughputs),
      successRate: bucket.sampleCount ? Number(((bucket.okCount / bucket.sampleCount) * 100).toFixed(2)) : 0
    }))
    .sort((a, b) => `${a.providerProfile}:${a.thinkingMode}`.localeCompare(`${b.providerProfile}:${b.thinkingMode}`));
}

function buildAnomalies(current: AgentBenchmarkResponse, deltas: ReturnType<typeof compareToBaseline>) {
  const lines: string[] = [];
  const failures = current.results.filter((result) => result.okRuns < result.runs);
  for (const failed of failures) {
    lines.push(`- ${failed.targetLabel} · ${failed.providerProfile || current.providerProfile || "default"} · ${failed.thinkingMode || current.thinkingMode || "standard"}: ${failed.runs - failed.okRuns} failed samples.`);
  }
  for (const delta of deltas) {
    if (delta.deltaLatencyMs !== null && delta.deltaLatencyMs > 500) {
      lines.push(`- ${delta.targetLabel} total latency regressed by ${delta.deltaLatencyMs.toFixed(1)} ms.`);
    }
    if (delta.deltaSuccessRate !== null && delta.deltaSuccessRate < -5) {
      lines.push(`- ${delta.targetLabel} success rate dropped by ${delta.deltaSuccessRate.toFixed(2)}%.`);
    }
    if (delta.deltaPassRate !== null && delta.deltaPassRate < -5) {
      lines.push(`- ${delta.targetLabel} task pass rate dropped by ${delta.deltaPassRate.toFixed(2)}%.`);
    }
  }
  return lines.length ? lines : ["- No obvious regression anomaly detected in the current workload."];
}

function renderMarkdown(input: {
  generatedAt: string;
  windowMinutes: number;
  latest: AgentBenchmarkResponse;
  baseline: AgentBenchmarkBaseline | null;
  deltas: ReturnType<typeof compareToBaseline>;
  heatmapSummary: ReturnType<typeof buildHeatmapSummary>;
  anomalies: string[];
}) {
  const lines: string[] = [
    "# Benchmark Regression Report",
    "",
    `Generated at: ${input.generatedAt}`,
    `Window: last ${input.windowMinutes} minutes`,
    "Export schema: 0.2.1",
    "",
    "## Workload",
    "",
    `- Mode: ${input.latest.benchmarkMode || "prompt"}`,
    `- Prompt: ${input.latest.prompt}`,
    `- Context window: ${input.latest.contextWindow}`,
    `- Runs: ${input.latest.runs}`,
    `- Provider profile: ${input.latest.providerProfile || "--"}`,
    `- Thinking mode: ${input.latest.thinkingMode || "standard"}`
  ];

  if (input.latest.promptSetLabel) {
    lines.push(`- Prompt set: ${input.latest.promptSetLabel} (${input.latest.promptSetPromptCount || 0} prompts)`);
  }
  if (input.latest.datasetLabel) {
    lines.push(`- Dataset: ${input.latest.datasetLabel} (${input.latest.datasetSampleCount || 0} samples)`);
    lines.push(`- Dataset source: ${input.latest.datasetSourceLabel || "--"}`);
    lines.push(`- Dataset URL: ${input.latest.datasetSourceUrl || "--"}`);
  }
  if (input.latest.suiteLabel) {
    lines.push(`- Suite: ${input.latest.suiteLabel} (${input.latest.suiteWorkloadCount || 0} workloads)`);
    if (input.latest.profileBatchScope) {
      lines.push(`- Batch scope: ${input.latest.profileBatchScope}`);
    }
  }
  if (Array.isArray(input.latest.workloads) && input.latest.workloads.length) {
    lines.push("", "## Workload breakdown", "");
    for (const workload of input.latest.workloads) {
      const base = `- [${workload.kind}] ${workload.label} · n=${workload.sampleCount}`;
      if (workload.kind === "dataset") {
        lines.push(`${base}${workload.sourceLabel ? ` · ${workload.sourceLabel}` : ""}`);
      } else {
        lines.push(base);
      }
    }
  }

  lines.push("", "## Current results", "", "| Target | Profile | Thinking | Success | Avg first token (ms) | Avg total latency (ms) | Avg throughput (tps) | Avg score | Pass rate |", "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const result of input.latest.results) {
    lines.push(`| ${result.targetLabel} | ${result.providerProfile || input.latest.providerProfile || "default"} | ${result.thinkingMode || input.latest.thinkingMode || "standard"} | ${result.okRuns}/${result.runs} | ${result.avgFirstTokenLatencyMs.toFixed(2)} | ${result.avgLatencyMs.toFixed(2)} | ${result.avgTokenThroughputTps.toFixed(2)} | ${typeof result.avgScore === "number" ? result.avgScore.toFixed(2) : "--"} | ${typeof result.passRate === "number" ? `${result.passRate.toFixed(2)}%` : "--"} |`);
  }

  lines.push("", "## Baseline", "");
  if (input.baseline) {
    lines.push(`- Baseline label: ${input.baseline.label || "(latest/default baseline)"}`);
    lines.push(`- Baseline saved at: ${input.baseline.savedAt}`);
    lines.push(`- Baseline default: ${input.baseline.isDefault ? "yes" : "no"}`);
    lines.push("", "| Target | Profile | Thinking | Δ first token (ms) | Δ total latency (ms) | Δ throughput (tps) | Δ score | Δ pass rate | Δ success rate |", "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const delta of input.deltas) {
      lines.push(`| ${delta.targetLabel} | ${delta.providerProfile} | ${delta.thinkingMode} | ${delta.deltaFirstTokenLatencyMs ?? "--"} | ${delta.deltaLatencyMs ?? "--"} | ${delta.deltaTokenThroughputTps ?? "--"} | ${delta.deltaScore ?? "--"} | ${delta.deltaPassRate ?? "--"} | ${delta.deltaSuccessRate ?? "--"} |`);
    }
  } else {
    lines.push("- No matching baseline found for this workload.");
  }

  lines.push("", "## Heatmap summary", "", "| Profile | Thinking | Samples | Avg first token (ms) | Avg total latency (ms) | Avg throughput (tps) | Success rate |", "| --- | --- | ---: | ---: | ---: | ---: | ---: |");
  for (const row of input.heatmapSummary) {
    lines.push(`| ${row.providerProfile} | ${row.thinkingMode} | ${row.sampleCount} | ${row.avgFirstTokenLatencyMs.toFixed(2)} | ${row.avgLatencyMs.toFixed(2)} | ${row.avgTokenThroughputTps.toFixed(2)} | ${row.successRate.toFixed(2)}% |`);
  }

  lines.push("", "## Anomaly summary", "", ...input.anomalies, "");
  return lines.join("\n");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetIds = parseTargetIds(searchParams);
  const benchmarkMode = parseBenchmarkMode(searchParams);
  const providerProfile = (searchParams.get("providerProfile") || "all").trim();
  const thinkingMode = (searchParams.get("thinkingMode") || "all").trim();
  const promptSetId = (searchParams.get("promptSetId") || "").trim();
  const datasetId = (searchParams.get("datasetId") || "").trim();
  const suiteId = (searchParams.get("suiteId") || "").trim();
  const profileBatchScope = (searchParams.get("profileBatchScope") || "").trim();
  const prompt = (searchParams.get("prompt") || "").trim();
  const contextWindow = parseContextWindow(searchParams);
  const { windowMinutes, sinceIso } = parseSinceIso(searchParams);

  const filteredLogs = readBenchmarkLogs({ sinceIso, limit: 300 })
    .filter((entry) => matchesWorkload(entry, { benchmarkMode, promptSetId, datasetId, suiteId, profileBatchScope, prompt, contextWindow }))
    .map((entry) => ({
      ...entry,
      results: filterResults(entry, { targetIds, providerProfile, thinkingMode })
    }))
    .filter((entry) => entry.results.length > 0);

  const latestSuccessful =
    [...filteredLogs].reverse().find((entry) => entry.results.some((result) => result.okRuns > 0)) || null;
  const latest = latestSuccessful || filteredLogs[filteredLogs.length - 1] || null;
  if (!latest) {
    return NextResponse.json({ error: "No matching benchmark history for this workload." }, { status: 404 });
  }

  const baseline = selectBaseline(readBenchmarkBaselines({ limit: 500 }), {
    targetIds,
    benchmarkMode: latest.benchmarkMode || "prompt",
    datasetId,
    datasetSampleCount: latest.datasetSampleCount,
    suiteId,
    profileBatchScope,
    promptSetId,
    prompt,
    contextWindow: latest.contextWindow
  });
  const deltas = compareToBaseline(latest, baseline);
  const heatmapSummary = buildHeatmapSummary(filteredLogs);
  const anomalies = buildAnomalies(latest, deltas);
  const markdown = renderMarkdown({
    generatedAt: new Date().toISOString(),
    windowMinutes,
    latest,
    baseline,
    deltas,
    heatmapSummary,
    anomalies
  });

  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="benchmark-regression-report${promptSetId ? `-${promptSetId}` : ""}.md"`
    }
  });
}
