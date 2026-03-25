import crypto from "crypto";
import { execFile } from "child_process";
import os from "os";
import { promisify } from "util";
import type { AgentTarget } from "@/lib/agent/types";
import { percentile } from "@/lib/agent/metrics";
import {
  appendTelemetrySnapshot,
  readChatLogs,
  readConnectionCheckLogs,
  readTelemetrySnapshots,
  type StoredTelemetrySnapshot
} from "@/lib/agent/log-store";
import { getRuntimeTrackerSnapshot } from "@/lib/agent/runtime-state";

const execFileAsync = promisify(execFile);

type LocalRuntimeHealth = {
  available: boolean;
  busy?: boolean;
  queue_depth?: number;
  active_requests?: number;
  loaded_alias?: string | null;
  pending_confirmations?: number;
};

async function safeExec(command: string, args: string[] = []) {
  try {
    const result = await execFileAsync(command, args, { timeout: 4000 });
    return result.stdout;
  } catch {
    return "";
  }
}

function parseVmStat(stdout: string, totalMemBytes: number) {
  const lines = stdout.split("\n");
  const pageSizeMatch = lines[0]?.match(/page size of (\d+) bytes/i);
  const pageSize = Number(pageSizeMatch?.[1] || "16384");
  const counters: Record<string, number> = {};

  for (const rawLine of lines.slice(1)) {
    const match = rawLine.match(/^([^:]+):\s+([\d.]+)/);
    if (!match) continue;
    const label = match[1].trim().toLowerCase();
    counters[label] = Number(match[2]);
  }

  const freePages = (counters["pages free"] || 0) + (counters["pages speculative"] || 0);
  const compressedPages = counters["pages occupied by compressor"] || 0;
  const freeBytes = freePages * pageSize;
  const compressedBytes = compressedPages * pageSize;
  const memoryUsedBytes = Math.max(0, totalMemBytes - freeBytes);

  return {
    pageSize,
    memoryUsedBytes,
    memoryFreeBytes: freeBytes,
    compressedBytes
  };
}

function parseDf(stdout: string) {
  const lines = stdout.trim().split("\n");
  if (lines.length < 2) return {};
  const columns = lines[1].trim().split(/\s+/);
  const total = Number(columns[1] || "0") * 1024;
  const used = Number(columns[2] || "0") * 1024;
  const available = Number(columns[3] || "0") * 1024;
  return {
    diskTotalBytes: total,
    diskUsedBytes: used,
    diskAvailableBytes: available
  };
}

function parseBattery(stdout: string) {
  const normalized = stdout.replace(/\n/g, " ");
  const percentMatch = normalized.match(/(\d+)%/);
  const percent = percentMatch ? Number(percentMatch[1]) : null;
  const onAcPower = /AC Power/i.test(normalized) ? true : /Battery Power/i.test(normalized) ? false : null;
  const charging = /charging/i.test(normalized)
    ? true
    : /not charging/i.test(normalized)
      ? false
      : null;

  return {
    batteryPercent: percent,
    onAcPower,
    charging
  };
}

async function fetchLocalRuntimeHealth(target: AgentTarget): Promise<LocalRuntimeHealth> {
  try {
    const response = await fetch(`${target.baseUrlDefault.replace(/\/v1$/, "")}/health`, {
      cache: "no-store"
    });
    if (!response.ok) {
      return { available: false };
    }
    return (await response.json()) as LocalRuntimeHealth;
  } catch {
    return { available: false };
  }
}

function bucketByMinute<T extends { completedAt?: string; checkedAt?: string; timestamp?: string }>(
  rows: T[],
  pickValue: (row: T) => number
) {
  const buckets = new Map<string, number>();
  for (const row of rows) {
    const stamp = row.completedAt || row.checkedAt || row.timestamp;
    if (!stamp) continue;
    const date = new Date(stamp);
    date.setSeconds(0, 0);
    const key = date.toISOString();
    buckets.set(key, (buckets.get(key) || 0) + pickValue(row));
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, value]) => ({ timestamp, value }));
}

function averageBucketByMinute<T extends { completedAt?: string; checkedAt?: string; timestamp?: string }>(
  rows: T[],
  pickValue: (row: T) => number | null | undefined
) {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const stamp = row.completedAt || row.checkedAt || row.timestamp;
    if (!stamp) continue;
    const rawValue = pickValue(row);
    if (typeof rawValue !== "number" || Number.isNaN(rawValue)) continue;
    const date = new Date(stamp);
    date.setSeconds(0, 0);
    const key = date.toISOString();
    const current = buckets.get(key) || { sum: 0, count: 0 };
    current.sum += rawValue;
    current.count += 1;
    buckets.set(key, current);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, value]) => ({
      timestamp,
      value: Number((value.sum / Math.max(value.count, 1)).toFixed(2))
    }));
}

function buildPercentiles(values: Array<number | null | undefined>) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99)
  };
}

function groupByModel(rows: ReturnType<typeof readChatLogs>) {
  const grouped = new Map<
    string,
    {
      requests: number;
      totalTokens: number;
      errors: number;
      latencySum: number;
      firstTokenLatencySum: number;
      firstTokenLatencyCount: number;
      throughputSum: number;
      throughputCount: number;
      latencies: number[];
      firstTokenLatencies: number[];
      throughputs: number[];
    }
  >();
  for (const row of rows) {
    const current = grouped.get(row.resolvedModel) || {
      requests: 0,
      totalTokens: 0,
      errors: 0,
      latencySum: 0,
      firstTokenLatencySum: 0,
      firstTokenLatencyCount: 0,
      throughputSum: 0,
      throughputCount: 0,
      latencies: [],
      firstTokenLatencies: [],
      throughputs: []
    };
    current.requests += 1;
    current.totalTokens += row.usage.totalTokens;
    current.errors += row.ok ? 0 : 1;
    current.latencySum += row.latencyMs;
    if (typeof row.firstTokenLatencyMs === "number") {
      current.firstTokenLatencySum += row.firstTokenLatencyMs;
      current.firstTokenLatencyCount += 1;
      current.firstTokenLatencies.push(row.firstTokenLatencyMs);
    }
    current.latencies.push(row.latencyMs);
    if (typeof row.tokenThroughputTps === "number") {
      current.throughputSum += row.tokenThroughputTps;
      current.throughputCount += 1;
      current.throughputs.push(row.tokenThroughputTps);
    }
    grouped.set(row.resolvedModel, current);
  }
  return [...grouped.entries()]
    .map(([model, value]) => ({
      model,
      requests: value.requests,
      totalTokens: value.totalTokens,
      errors: value.errors,
      avgLatencyMs: Number((value.latencySum / Math.max(value.requests, 1)).toFixed(2)),
      avgFirstTokenLatencyMs: Number((value.firstTokenLatencySum / Math.max(value.firstTokenLatencyCount, 1)).toFixed(2)),
      avgTokenThroughputTps: Number((value.throughputSum / Math.max(value.throughputCount, 1)).toFixed(2)),
      latencyPercentiles: buildPercentiles(value.latencies),
      firstTokenLatencyPercentiles: buildPercentiles(value.firstTokenLatencies),
      tokenThroughputPercentiles: buildPercentiles(value.throughputs)
    }))
    .sort((a, b) => b.requests - a.requests);
}

function groupByContextWindow(rows: ReturnType<typeof readChatLogs>) {
  const grouped = new Map<
    string,
    {
      requests: number;
      totalTokens: number;
      latencySum: number;
      firstTokenLatencySum: number;
      firstTokenLatencyCount: number;
      throughputSum: number;
      throughputCount: number;
      latencies: number[];
      firstTokenLatencies: number[];
      throughputs: number[];
    }
  >();

  for (const row of rows) {
    const key = typeof row.contextWindow === "number" ? `${row.contextWindow}` : "default";
    const current = grouped.get(key) || {
      requests: 0,
      totalTokens: 0,
      latencySum: 0,
      firstTokenLatencySum: 0,
      firstTokenLatencyCount: 0,
      throughputSum: 0,
      throughputCount: 0,
      latencies: [],
      firstTokenLatencies: [],
      throughputs: []
    };
    current.requests += 1;
    current.totalTokens += row.usage.totalTokens;
    current.latencySum += row.latencyMs;
    if (typeof row.firstTokenLatencyMs === "number") {
      current.firstTokenLatencySum += row.firstTokenLatencyMs;
      current.firstTokenLatencyCount += 1;
      current.firstTokenLatencies.push(row.firstTokenLatencyMs);
    }
    current.latencies.push(row.latencyMs);
    if (typeof row.tokenThroughputTps === "number") {
      current.throughputSum += row.tokenThroughputTps;
      current.throughputCount += 1;
      current.throughputs.push(row.tokenThroughputTps);
    }
    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .map(([key, value]) => ({
      contextWindow: key === "default" ? null : Number(key),
      requests: value.requests,
      totalTokens: value.totalTokens,
      avgLatencyMs: Number((value.latencySum / Math.max(value.requests, 1)).toFixed(2)),
      avgFirstTokenLatencyMs: Number((value.firstTokenLatencySum / Math.max(value.firstTokenLatencyCount, 1)).toFixed(2)),
      avgTokenThroughputTps: Number((value.throughputSum / Math.max(value.throughputCount, 1)).toFixed(2)),
      latencyPercentiles: buildPercentiles(value.latencies),
      firstTokenLatencyPercentiles: buildPercentiles(value.firstTokenLatencies),
      tokenThroughputPercentiles: buildPercentiles(value.throughputs)
    }))
    .sort((a, b) => {
      if (a.contextWindow === null) return 1;
      if (b.contextWindow === null) return -1;
      return a.contextWindow - b.contextWindow;
    });
}

function toPercent(part?: number | null, total?: number | null) {
  if (typeof part !== "number" || typeof total !== "number" || total <= 0) return null;
  return Number(((part / total) * 100).toFixed(2));
}

export async function collectDashboardData(target: AgentTarget, windowMinutes: number) {
  return collectDashboardDataWithFilters(target, windowMinutes, {});
}

export async function collectDashboardDataWithFilters(
  target: AgentTarget,
  windowMinutes: number,
  filters: { modelFilter?: string; contextWindow?: number | "all"; providerProfile?: string } = {}
) {
  const now = Date.now();
  const sinceIso = new Date(now - windowMinutes * 60 * 1000).toISOString();
  const chats = readChatLogs({
    sinceIso,
    targetId: target.id,
    resolvedModel: filters.modelFilter && filters.modelFilter !== "all" ? filters.modelFilter : undefined,
    contextWindow: typeof filters.contextWindow === "number" ? filters.contextWindow : undefined,
    providerProfile:
      filters.providerProfile && filters.providerProfile !== "all"
        ? (filters.providerProfile as "speed" | "balanced" | "tool-first")
        : undefined,
    limit: 500
  });
  const checks = readConnectionCheckLogs({ sinceIso, targetId: target.id, limit: 200 });
  const runtimeState = getRuntimeTrackerSnapshot();
  const activeForTarget = runtimeState.activeByTarget[target.id] || 0;

  let telemetrySnapshot: StoredTelemetrySnapshot | null = null;
  if (target.execution === "local") {
    const totalMemBytes = os.totalmem();
    const vmStatOutput = await safeExec("vm_stat");
    const dfOutput = await safeExec("df", ["-k", "/"]);
    const batteryOutput = await safeExec("pmset", ["-g", "batt"]);
    const runtimeHealth = await fetchLocalRuntimeHealth(target);

    const memory = parseVmStat(vmStatOutput, totalMemBytes);
    const disk = parseDf(dfOutput);
    const battery = parseBattery(batteryOutput);

    telemetrySnapshot = {
      kind: "telemetry",
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      targetId: target.id,
      resolvedModel: runtimeHealth.loaded_alias || target.modelDefault,
      activeRequests: runtimeState.activeRequests,
      activeForTarget,
      queueDepth: runtimeHealth.queue_depth || 0,
      runtimeBusy: Boolean(runtimeHealth.busy),
      memoryTotalBytes: totalMemBytes,
      memoryUsedBytes: memory.memoryUsedBytes,
      memoryFreeBytes: memory.memoryFreeBytes,
      compressedBytes: memory.compressedBytes,
      diskTotalBytes: disk.diskTotalBytes,
      diskUsedBytes: disk.diskUsedBytes,
      diskAvailableBytes: disk.diskAvailableBytes,
      batteryPercent: battery.batteryPercent,
      onAcPower: battery.onAcPower,
      charging: battery.charging,
      gpuProxyPct: runtimeHealth.busy ? 100 : 0,
      energyProxyPct: battery.batteryPercent ?? null
    };
  } else {
    telemetrySnapshot = {
      kind: "telemetry",
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      targetId: target.id,
      resolvedModel: target.modelDefault,
      activeRequests: runtimeState.activeRequests,
      activeForTarget,
      queueDepth: 0,
      runtimeBusy: activeForTarget > 0,
      totalRequests: chats.length,
      totalTokens: chats.reduce((sum, row) => sum + row.usage.totalTokens, 0)
    };
  }

  if (telemetrySnapshot) {
    appendTelemetrySnapshot(telemetrySnapshot);
  }

  const telemetry = readTelemetrySnapshots({
    sinceIso,
    targetId: target.id,
    limit: 240
  });

  return {
    generatedAt: new Date().toISOString(),
    target: {
      id: target.id,
      label: target.label,
      providerLabel: target.providerLabel,
      execution: target.execution
    },
    windowMinutes,
    summary: {
      totalRequests: chats.length,
      okRequests: chats.filter((row) => row.ok).length,
      failedRequests: chats.filter((row) => !row.ok).length,
      retrievalTurns: chats.filter((row) => row.retrievalEnabled).length,
      groundedTurns: chats.filter((row) => row.groundedVerdict === "grounded").length,
      groundedFallbackTurns: chats.filter((row) => row.groundedFallbackApplied).length,
      cacheHits: chats.filter((row) => row.cacheHit).length,
      avgCitationCount: (() => {
        const rows = chats.filter((row) => typeof row.groundedCitationCount === "number");
        if (!rows.length) return 0;
        return Number(
          (rows.reduce((sum, row) => sum + (row.groundedCitationCount || 0), 0) / rows.length).toFixed(2)
        );
      })(),
      activeRequests: runtimeState.activeRequests,
      activeForTarget,
      totalTokens: chats.reduce((sum, row) => sum + row.usage.totalTokens, 0),
      totalPromptTokens: chats.reduce((sum, row) => sum + row.usage.promptTokens, 0),
      totalCompletionTokens: chats.reduce((sum, row) => sum + row.usage.completionTokens, 0),
      latestCheckOk: checks.length ? checks[checks.length - 1].ok : null,
      telemetryAvailable: target.execution === "local",
      avgLatencyMs: chats.length
        ? Number((chats.reduce((sum, row) => sum + row.latencyMs, 0) / chats.length).toFixed(2))
        : 0,
      avgFirstTokenLatencyMs: (() => {
        const firstTokenRows = chats.filter((row) => typeof row.firstTokenLatencyMs === "number");
        if (!firstTokenRows.length) return 0;
        return Number(
          (
            firstTokenRows.reduce((sum, row) => sum + (row.firstTokenLatencyMs || 0), 0) /
            firstTokenRows.length
          ).toFixed(2)
        );
      })(),
      avgTokenThroughputTps: (() => {
        const throughputRows = chats.filter((row) => typeof row.tokenThroughputTps === "number");
        if (!throughputRows.length) return 0;
        return Number(
          (
            throughputRows.reduce((sum, row) => sum + (row.tokenThroughputTps || 0), 0) /
            throughputRows.length
          ).toFixed(2)
        );
      })(),
      latencyPercentiles: buildPercentiles(chats.map((row) => row.latencyMs)),
      firstTokenLatencyPercentiles: buildPercentiles(chats.map((row) => row.firstTokenLatencyMs)),
      tokenThroughputPercentiles: buildPercentiles(
        chats.map((row) => (typeof row.tokenThroughputTps === "number" ? row.tokenThroughputTps : null))
      )
    },
    series: {
      requests: bucketByMinute(chats, () => 1),
      totalTokens: bucketByMinute(chats, (row) => row.usage.totalTokens),
      promptTokens: bucketByMinute(chats, (row) => row.usage.promptTokens),
      completionTokens: bucketByMinute(chats, (row) => row.usage.completionTokens),
      firstTokenLatency: averageBucketByMinute(chats, (row) => row.firstTokenLatencyMs),
      totalLatency: averageBucketByMinute(chats, (row) => row.latencyMs),
      appOverhead: averageBucketByMinute(chats, (row) =>
        typeof row.firstTokenLatencyMs === "number"
          ? Math.max(0, row.latencyMs - row.firstTokenLatencyMs)
          : null
      ),
      tokenThroughput: averageBucketByMinute(chats, (row) => row.tokenThroughputTps),
      checks: bucketByMinute(checks, (row) => (row.ok ? 1 : 0)),
      telemetry: telemetry.map((row) => ({
        timestamp: row.timestamp,
        activeRequests: row.activeRequests,
        activeForTarget: row.activeForTarget,
        queueDepth: row.queueDepth || 0,
        memoryUsedPct: toPercent(row.memoryUsedBytes, row.memoryTotalBytes),
        diskUsedPct: toPercent(row.diskUsedBytes, row.diskTotalBytes),
        batteryPercent: row.batteryPercent ?? null,
        gpuProxyPct: row.gpuProxyPct ?? null,
        energyProxyPct: row.energyProxyPct ?? null
      }))
    },
    modelBreakdown: groupByModel(chats),
    contextWindowBreakdown: groupByContextWindow(chats),
    recentChats: chats.slice(-20).reverse(),
    recentChecks: checks.slice(-10).reverse(),
    latestTelemetry: telemetrySnapshot || telemetry[telemetry.length - 1] || null
  };
}
