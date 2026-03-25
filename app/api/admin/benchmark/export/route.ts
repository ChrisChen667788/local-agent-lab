import { NextResponse } from "next/server";
import {
  readBenchmarkLogs,
  serializeBenchmarksAsMarkdown
} from "@/lib/agent/log-store";
import { percentile } from "@/lib/agent/metrics";

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const format = (searchParams.get("format") || "markdown").toLowerCase();
  const benchmarkMode = (searchParams.get("benchmarkMode") || "all").toLowerCase();
  const sampleStatus = (searchParams.get("sampleStatus") || "all").toLowerCase();
  const historyStatus = (searchParams.get("historyStatus") || "all").toLowerCase();
  const providerProfile = (searchParams.get("providerProfile") || "all").toLowerCase();
  const thinkingMode = (searchParams.get("thinkingMode") || "all").toLowerCase();
  const promptSetId = (searchParams.get("promptSetId") || "").trim();
  const datasetId = (searchParams.get("datasetId") || "").trim();
  const suiteId = (searchParams.get("suiteId") || "").trim();
  const profileBatchScope = (searchParams.get("profileBatchScope") || "").trim();
  const prompt = (searchParams.get("prompt") || "").trim();
  const targetIds = (searchParams.get("targetIds") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const contextWindowRaw = searchParams.get("contextWindow");
  const contextWindowValue = contextWindowRaw ? Number(contextWindowRaw) : Number.NaN;
  const contextWindow = Number.isFinite(contextWindowValue) ? contextWindowValue : undefined;
  const windowMinutesValue = Number(searchParams.get("windowMinutes") || "");
  const sinceIso = Number.isFinite(windowMinutesValue)
    ? new Date(Date.now() - Math.min(Math.max(windowMinutesValue, 5), 24 * 60) * 60 * 1000).toISOString()
    : undefined;
  const limitValue = Number(searchParams.get("limit") || "200");
  const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 1000) : 200;

  const logs = readBenchmarkLogs({ sinceIso, limit })
    .filter((entry) => {
      if (benchmarkMode !== "all" && (entry.benchmarkMode || "prompt") !== benchmarkMode) return false;
      if (profileBatchScope && (entry.profileBatchScope || "") !== profileBatchScope) return false;
      if (suiteId) return entry.suiteId === suiteId;
      if (datasetId) return entry.datasetId === datasetId;
      if (promptSetId) return entry.promptSetId === promptSetId;
      if (prompt) return !entry.promptSetId && entry.prompt === prompt;
      return true;
    })
    .map((entry) => ({
      ...entry,
      results: entry.results
        .filter((result) => (targetIds.length ? targetIds.includes(result.targetId) : true))
        .filter((result) =>
          providerProfile === "all"
            ? true
            : (result.providerProfile || entry.providerProfile || "default") === providerProfile
        )
        .filter((result) =>
          thinkingMode === "all"
            ? true
            : (result.thinkingMode || entry.thinkingMode || "standard") === thinkingMode
        )
        .map((result) => {
          const filteredSamples = result.samples.filter((sample) => {
            if (sampleStatus === "success") return sample.ok;
            if (sampleStatus === "failed") return !sample.ok;
            return true;
          });
          return {
            ...result,
            runs: filteredSamples.length,
            okRuns: filteredSamples.filter((sample) => sample.ok).length,
            firstTokenLatencyPercentiles: buildPercentiles(filteredSamples.map((sample) => sample.firstTokenLatencyMs)),
            totalLatencyPercentiles: buildPercentiles(filteredSamples.map((sample) => sample.latencyMs)),
            tokenThroughputPercentiles: buildPercentiles(filteredSamples.map((sample) => sample.tokenThroughputTps)),
            avgFirstTokenLatencyMs: average(filteredSamples.map((sample) => sample.firstTokenLatencyMs)),
            avgLatencyMs: average(filteredSamples.map((sample) => sample.latencyMs)),
            avgTokenThroughputTps: average(filteredSamples.map((sample) => sample.tokenThroughputTps)),
            avgScore: average(filteredSamples.map((sample) => sample.score)),
            passRate: filteredSamples.filter((sample) => typeof sample.passed === "boolean").length
              ? Number((
                  (filteredSamples.filter((sample) => sample.passed).length /
                    filteredSamples.filter((sample) => typeof sample.passed === "boolean").length) *
                  100
                ).toFixed(2))
              : null,
            scoredSamples: filteredSamples.filter((sample) => typeof sample.score === "number").length,
            samples: filteredSamples
          };
        })
        .filter((result) => result.samples.length > 0)
    }))
    .filter((entry) => (typeof contextWindow === "number" ? entry.contextWindow === contextWindow : true))
    .filter((entry) => {
      if (historyStatus === "success") {
        return entry.results.every((result) => result.runs > 0 && result.okRuns === result.runs);
      }
      if (historyStatus === "failed") {
        return entry.results.some((result) => result.okRuns < result.runs);
      }
      return true;
    })
    .filter((entry) => entry.results.length > 0);

  if (format === "json") {
    return new NextResponse(JSON.stringify(logs, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"benchmark-history${targetIds.length ? `-${targetIds.join("-")}` : ""}.json\"`
      }
    });
  }

  const markdown = serializeBenchmarksAsMarkdown(logs);
  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"benchmark-history${targetIds.length ? `-${targetIds.join("-")}` : ""}.md\"`
    }
  });
}
