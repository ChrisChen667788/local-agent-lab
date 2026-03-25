import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type {
  AgentBenchmarkBaseline,
  AgentCacheMode,
  AgentBenchmarkResponse,
  AgentConnectionCheckResponse,
  AgentExecution,
  AgentGroundedVerificationVerdict,
  AgentThinkingMode,
  AgentProviderProfile
} from "@/lib/agent/types";

export type UsageSummary = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type StoredChatLog = {
  kind: "chat";
  id: string;
  targetId: string;
  targetLabel: string;
  providerLabel: string;
  execution: AgentExecution;
  resolvedModel: string;
  resolvedBaseUrl: string;
  contextWindow?: number;
  providerProfile?: AgentProviderProfile;
  thinkingMode?: AgentThinkingMode;
  retrievalEnabled?: boolean;
  retrievalHitCount?: number;
  retrievalLowConfidence?: boolean;
  groundedVerdict?: AgentGroundedVerificationVerdict;
  groundedFallbackApplied?: boolean;
  groundedCitationCount?: number;
  groundedUnsupportedCitationCount?: number;
  cacheHit?: boolean;
  cacheMode?: AgentCacheMode;
  plannerStepCount?: number;
  memorySummaryLength?: number;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  firstTokenLatencyMs?: number;
  tokenThroughputTps?: number;
  ok: boolean;
  inputPreview: string;
  outputPreview: string;
  toolRunsCount: number;
  warning?: string;
  usage: UsageSummary;
};

export type StoredConnectionCheckLog = AgentConnectionCheckResponse & {
  kind: "connection-check";
  id: string;
};

export type StoredTelemetrySnapshot = {
  kind: "telemetry";
  id: string;
  timestamp: string;
  targetId: string;
  resolvedModel?: string;
  activeRequests: number;
  activeForTarget: number;
  queueDepth?: number;
  runtimeBusy?: boolean;
  totalRequests?: number;
  totalTokens?: number;
  memoryTotalBytes?: number;
  memoryUsedBytes?: number;
  memoryFreeBytes?: number;
  compressedBytes?: number;
  diskTotalBytes?: number;
  diskUsedBytes?: number;
  diskAvailableBytes?: number;
  batteryPercent?: number | null;
  onAcPower?: boolean | null;
  charging?: boolean | null;
  gpuProxyPct?: number | null;
  energyProxyPct?: number | null;
};

export type StoredBenchmarkLog = AgentBenchmarkResponse & {
  kind: "benchmark";
  id: string;
};

export type StoredBenchmarkBaseline = AgentBenchmarkBaseline;

const DATA_DIR = path.join(process.cwd(), "data", "agent-observability");
const CHAT_LOG_FILE = path.join(DATA_DIR, "chat-history.jsonl");
const CHECK_LOG_FILE = path.join(DATA_DIR, "connection-checks.jsonl");
const TELEMETRY_LOG_FILE = path.join(DATA_DIR, "telemetry.jsonl");
const BENCHMARK_LOG_FILE = path.join(DATA_DIR, "benchmark-history.jsonl");
const BENCHMARK_BASELINE_FILE = path.join(DATA_DIR, "benchmark-baselines.jsonl");
const BENCHMARK_PROMPT_SET_FILE = path.join(DATA_DIR, "benchmark-prompt-sets.json");
const KNOWLEDGE_DOCUMENT_FILE = path.join(DATA_DIR, "knowledge-base-documents.json");
const KNOWLEDGE_CHUNK_FILE = path.join(DATA_DIR, "knowledge-base-chunks.json");

function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

function appendJsonl(filePath: string, value: Record<string, unknown>) {
  ensureDataDir();
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const source = readFileSync(filePath, "utf8");
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

function rewriteJsonl(filePath: string, values: Record<string, unknown>[]) {
  ensureDataDir();
  const source = values.map((value) => JSON.stringify(value)).join("\n");
  writeFileSync(filePath, source ? `${source}\n` : "", "utf8");
}

function filterSince<T extends { checkedAt?: string; completedAt?: string; timestamp?: string; generatedAt?: string }>(
  rows: T[],
  sinceIso?: string
) {
  if (!sinceIso) return rows;
  const sinceTime = new Date(sinceIso).getTime();
  return rows.filter((row) => {
    const value = row.checkedAt || row.completedAt || row.timestamp || row.generatedAt;
    if (!value) return false;
    const time = new Date(value).getTime();
    return Number.isFinite(time) && time >= sinceTime;
  });
}

export function getObservabilityPaths() {
  ensureDataDir();
  return {
    dataDir: DATA_DIR,
    chatLogFile: CHAT_LOG_FILE,
    connectionCheckFile: CHECK_LOG_FILE,
    telemetryFile: TELEMETRY_LOG_FILE,
    benchmarkFile: BENCHMARK_LOG_FILE,
    benchmarkBaselineFile: BENCHMARK_BASELINE_FILE,
    benchmarkPromptSetFile: BENCHMARK_PROMPT_SET_FILE,
    knowledgeDocumentFile: KNOWLEDGE_DOCUMENT_FILE,
    knowledgeChunkFile: KNOWLEDGE_CHUNK_FILE
  };
}

export function appendChatLog(value: StoredChatLog) {
  appendJsonl(CHAT_LOG_FILE, value);
}

export function readChatLogs(options?: {
  sinceIso?: string;
  targetId?: string;
  providerLabel?: string;
  resolvedModel?: string;
  contextWindow?: number;
  providerProfile?: AgentProviderProfile;
  thinkingMode?: AgentThinkingMode;
  limit?: number;
}) {
  const rows = readJsonl<StoredChatLog>(CHAT_LOG_FILE);
  const filtered = filterSince(rows, options?.sinceIso).filter((row) => {
    if (options?.targetId && row.targetId !== options.targetId) return false;
    if (options?.providerLabel && row.providerLabel !== options.providerLabel) return false;
    if (options?.resolvedModel && row.resolvedModel !== options.resolvedModel) return false;
    if (typeof options?.contextWindow === "number" && row.contextWindow !== options.contextWindow) return false;
    if (options?.providerProfile && row.providerProfile !== options.providerProfile) return false;
    if (options?.thinkingMode && row.thinkingMode !== options.thinkingMode) return false;
    return true;
  });
  const sorted = filtered.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  if (options?.limit && options.limit > 0) {
    return sorted.slice(-options.limit);
  }
  return sorted;
}

export function appendConnectionCheckLog(value: StoredConnectionCheckLog) {
  appendJsonl(CHECK_LOG_FILE, value);
}

export function readConnectionCheckLogs(options?: {
  sinceIso?: string;
  targetId?: string;
  limit?: number;
}) {
  const rows = readJsonl<StoredConnectionCheckLog>(CHECK_LOG_FILE);
  const filtered = filterSince(rows, options?.sinceIso).filter((row) =>
    options?.targetId ? row.targetId === options.targetId : true
  );
  const sorted = filtered.sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
  if (options?.limit && options.limit > 0) {
    return sorted.slice(-options.limit);
  }
  return sorted;
}

export function appendTelemetrySnapshot(value: StoredTelemetrySnapshot) {
  appendJsonl(TELEMETRY_LOG_FILE, value);
}

export function readTelemetrySnapshots(options?: {
  sinceIso?: string;
  targetId?: string;
  limit?: number;
}) {
  const rows = readJsonl<StoredTelemetrySnapshot>(TELEMETRY_LOG_FILE);
  const filtered = filterSince(rows, options?.sinceIso).filter((row) =>
    options?.targetId ? row.targetId === options.targetId : true
  );
  const sorted = filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (options?.limit && options.limit > 0) {
    return sorted.slice(-options.limit);
  }
  return sorted;
}

export function appendBenchmarkLog(value: StoredBenchmarkLog) {
  appendJsonl(BENCHMARK_LOG_FILE, value);
}

export function readBenchmarkLogs(options?: { sinceIso?: string; limit?: number }) {
  const rows = readJsonl<StoredBenchmarkLog>(BENCHMARK_LOG_FILE);
  const filtered = filterSince(rows, options?.sinceIso);
  const sorted = filtered.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  if (options?.limit && options.limit > 0) {
    return sorted.slice(-options.limit);
  }
  return sorted;
}

export function appendBenchmarkBaseline(value: StoredBenchmarkBaseline) {
  appendJsonl(BENCHMARK_BASELINE_FILE, value);
}

export function readBenchmarkBaselines(options?: { sinceIso?: string; limit?: number }) {
  const rows = readJsonl<StoredBenchmarkBaseline>(BENCHMARK_BASELINE_FILE);
  const filtered = filterSince(rows, options?.sinceIso).filter((row) => row.kind === "benchmark-baseline");
  const sorted = filtered.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  if (options?.limit && options.limit > 0) {
    return sorted.slice(-options.limit);
  }
  return sorted;
}

export function updateBenchmarkBaseline(
  id: string,
  updater: (value: StoredBenchmarkBaseline) => StoredBenchmarkBaseline
) {
  const rows = readJsonl<StoredBenchmarkBaseline>(BENCHMARK_BASELINE_FILE);
  let updated: StoredBenchmarkBaseline | null = null;
  const nextRows = rows.map((row) => {
    if (row.kind === "benchmark-baseline" && row.id === id) {
      updated = updater(row);
      return updated;
    }
    return row;
  });
  if (!updated) return null;
  rewriteJsonl(BENCHMARK_BASELINE_FILE, nextRows as unknown as Record<string, unknown>[]);
  return updated;
}

export function deleteBenchmarkBaseline(id: string) {
  const rows = readJsonl<StoredBenchmarkBaseline>(BENCHMARK_BASELINE_FILE);
  const nextRows = rows.filter((row) => !(row.kind === "benchmark-baseline" && row.id === id));
  if (nextRows.length === rows.length) return false;
  rewriteJsonl(BENCHMARK_BASELINE_FILE, nextRows as unknown as Record<string, unknown>[]);
  return true;
}

export function replaceBenchmarkBaselines(rows: StoredBenchmarkBaseline[]) {
  rewriteJsonl(BENCHMARK_BASELINE_FILE, rows as unknown as Record<string, unknown>[]);
}

export function serializeConnectionChecksAsMarkdown(logs: StoredConnectionCheckLog[]) {
  const lines: string[] = [
    "# Agent Connection Check History",
    "",
    `Generated at: ${new Date().toISOString()}`,
    ""
  ];

  for (const log of logs) {
    lines.push(`## ${log.targetLabel} · ${log.checkedAt}`);
    lines.push("");
    lines.push(`- Status: ${log.ok ? "PASS" : "ATTENTION"}`);
    lines.push(`- Provider: ${log.providerLabel}`);
    lines.push(`- Model: ${log.resolvedModel}`);
    lines.push(`- Endpoint: ${log.resolvedBaseUrl}`);
    if (log.docsUrl) {
      lines.push(`- Docs: ${log.docsUrl}`);
    }
    lines.push("");
    lines.push("| Stage | Status | Latency (ms) | HTTP | Summary |");
    lines.push("| --- | --- | ---: | ---: | --- |");
    for (const stage of log.stages) {
      lines.push(
        `| ${stage.id} | ${stage.ok ? "ok" : "failed"} | ${stage.latencyMs} | ${stage.httpStatus ?? ""} | ${stage.summary.replace(/\|/g, "\\|")} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function serializeBenchmarksAsMarkdown(logs: StoredBenchmarkLog[]) {
  const lines: string[] = [
    "# Agent Benchmark History",
    "",
    `Generated at: ${new Date().toISOString()}`,
    ""
  ];

  for (const log of logs) {
    lines.push(`## Benchmark · ${log.generatedAt}`);
    lines.push("");
    lines.push(`- Mode: ${log.benchmarkMode || "prompt"}`);
    lines.push(`- Prompt: ${log.prompt}`);
    if (log.promptSetLabel) {
      lines.push(`- Prompt set: ${log.promptSetLabel} (${log.promptSetId || "custom"})`);
      lines.push(`- Prompt count: ${log.promptSetPromptCount || 0}`);
    }
    if (log.datasetLabel) {
      lines.push(`- Dataset: ${log.datasetLabel} (${log.datasetId || "dataset"})`);
      lines.push(`- Dataset source: ${log.datasetSourceLabel || "--"}`);
      lines.push(`- Dataset URL: ${log.datasetSourceUrl || "--"}`);
      lines.push(`- Dataset sample count: ${log.datasetSampleCount || 0}`);
    }
    if (log.suiteLabel) {
      lines.push(`- Suite: ${log.suiteLabel} (${log.suiteId || "suite"})`);
      lines.push(`- Suite workloads: ${log.suiteWorkloadCount || 0}`);
      if (log.profileBatchScope) {
        lines.push(`- Batch scope: ${log.profileBatchScope}`);
      }
    }
    if (Array.isArray(log.workloads) && log.workloads.length) {
      lines.push("- Workload breakdown:");
      for (const workload of log.workloads) {
        const base = `  - [${workload.kind}] ${workload.label} · n=${workload.sampleCount}`;
        if (workload.kind === "dataset") {
          lines.push(`${base}${workload.sourceLabel ? ` · ${workload.sourceLabel}` : ""}`);
        } else {
          lines.push(base);
        }
      }
    }
    lines.push(`- Context window: ${log.contextWindow}`);
    lines.push(`- Runs: ${log.runs}`);
    if (log.providerProfile) {
      lines.push(`- Provider profile: ${log.providerProfile}`);
    }
    if (log.thinkingMode) {
      lines.push(`- Thinking mode: ${log.thinkingMode}`);
    }
    lines.push("");
    lines.push(
      "| Target | Provider | Profile | Thinking | Model | Success | Avg first token (ms) | Avg total latency (ms) | Avg throughput (tps) | Avg score | Pass rate | P50 / P95 / P99 first token | P50 / P95 / P99 total latency | P50 / P95 / P99 throughput |"
    );
    lines.push("| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |");
    for (const result of log.results) {
      lines.push(
        `| ${result.targetLabel} | ${(result.providerLabel || "--").replace(/\|/g, "\\|")} | ${(result.providerProfile || log.providerProfile || "--").replace(/\|/g, "\\|")} | ${(result.thinkingMode || log.thinkingMode || "--").replace(/\|/g, "\\|")} | ${result.resolvedModel.replace(/\|/g, "\\|")} | ${result.okRuns}/${result.runs} | ${result.avgFirstTokenLatencyMs.toFixed(2)} | ${result.avgLatencyMs.toFixed(2)} | ${result.avgTokenThroughputTps.toFixed(2)} | ${typeof result.avgScore === "number" ? result.avgScore.toFixed(2) : "--"} | ${typeof result.passRate === "number" ? `${result.passRate.toFixed(2)}%` : "--"} | ${result.firstTokenLatencyPercentiles.p50.toFixed(2)} / ${result.firstTokenLatencyPercentiles.p95.toFixed(2)} / ${result.firstTokenLatencyPercentiles.p99.toFixed(2)} | ${result.totalLatencyPercentiles.p50.toFixed(2)} / ${result.totalLatencyPercentiles.p95.toFixed(2)} / ${result.totalLatencyPercentiles.p99.toFixed(2)} | ${result.tokenThroughputPercentiles.p50.toFixed(2)} / ${result.tokenThroughputPercentiles.p95.toFixed(2)} / ${result.tokenThroughputPercentiles.p99.toFixed(2)} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
