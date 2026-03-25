import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type {
  AgentBenchmarkMode,
  AgentBenchmarkProfileBatchScope,
  AgentBenchmarkProgress,
  AgentProviderProfile,
  AgentThinkingMode
} from "@/lib/agent/types";

const PROGRESS_DIR = path.join(process.cwd(), "data", "agent-observability", "benchmark-progress");

function ensureProgressDir() {
  mkdirSync(PROGRESS_DIR, { recursive: true });
}

function getProgressPath(runId: string) {
  return path.join(PROGRESS_DIR, `${runId}.json`);
}

function writeProgress(progress: AgentBenchmarkProgress) {
  ensureProgressDir();
  writeFileSync(getProgressPath(progress.runId), `${JSON.stringify(progress, null, 2)}\n`, "utf8");
}

export function createBenchmarkProgress(input: {
  runId: string;
  benchmarkMode?: AgentBenchmarkMode;
  suiteId?: string;
  suiteLabel?: string;
  profileBatchScope?: AgentBenchmarkProfileBatchScope;
  totalGroups: number;
  totalSamples: number;
}) {
  const now = new Date().toISOString();
  const progress: AgentBenchmarkProgress = {
    runId: input.runId,
    status: "pending",
    benchmarkMode: input.benchmarkMode,
    suiteId: input.suiteId,
    suiteLabel: input.suiteLabel,
    profileBatchScope: input.profileBatchScope,
    totalGroups: input.totalGroups,
    completedGroups: 0,
    totalSamples: input.totalSamples,
    completedSamples: 0,
    okSamples: 0,
    failedSamples: 0,
    startedAt: now,
    updatedAt: now,
    elapsedMs: 0,
    estimatedRemainingMs: null,
    activeGroups: []
  };
  writeProgress(progress);
  return progress;
}

export function readBenchmarkProgress(runId: string) {
  const filePath = getProgressPath(runId);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as AgentBenchmarkProgress;
  } catch {
    return null;
  }
}

export function updateBenchmarkProgress(
  runId: string,
  updater: (current: AgentBenchmarkProgress) => AgentBenchmarkProgress
) {
  const current = readBenchmarkProgress(runId);
  if (!current) return null;
  const next = updater(current);
  writeProgress(next);
  return next;
}

function estimateRemainingMs(progress: AgentBenchmarkProgress) {
  if (progress.completedSamples <= 0) return null;
  const remaining = Math.max(progress.totalSamples - progress.completedSamples, 0);
  if (remaining === 0) return 0;
  const averagePerSample = progress.elapsedMs / progress.completedSamples;
  return Math.max(0, Math.round(averagePerSample * remaining));
}

export function markBenchmarkProgressRunning(runId: string) {
  return updateBenchmarkProgress(runId, (current) => ({
    ...current,
    status: "running",
    updatedAt: new Date().toISOString()
  }));
}

export function startBenchmarkProgressGroup(
  runId: string,
  group: {
    key: string;
    targetLabel: string;
    providerProfile: AgentProviderProfile;
    thinkingMode: AgentThinkingMode;
  }
) {
  return updateBenchmarkProgress(runId, (current) => ({
    ...current,
    status: current.status === "pending" ? "running" : current.status,
    updatedAt: new Date().toISOString(),
    activeGroups: [
      ...(current.activeGroups || []).filter((entry) => entry.key !== group.key),
      {
        key: group.key,
        targetLabel: group.targetLabel,
        providerProfile: group.providerProfile,
        thinkingMode: group.thinkingMode
      }
    ]
  }));
}

export function advanceBenchmarkProgress(
  runId: string,
  sample: {
    ok: boolean;
    targetLabel: string;
    providerProfile: NonNullable<AgentBenchmarkProgress["lastCompletedProfile"]>;
    thinkingMode: NonNullable<AgentBenchmarkProgress["lastCompletedThinkingMode"]>;
    workloadLabel: string;
  }
) {
  return updateBenchmarkProgress(runId, (current) => {
    const elapsedMs = Date.now() - new Date(current.startedAt).getTime();
    const next: AgentBenchmarkProgress = {
      ...current,
      status: "running",
      completedSamples: current.completedSamples + 1,
      okSamples: current.okSamples + (sample.ok ? 1 : 0),
      failedSamples: current.failedSamples + (sample.ok ? 0 : 1),
      updatedAt: new Date().toISOString(),
      elapsedMs,
      lastCompletedTargetLabel: sample.targetLabel,
      lastCompletedProfile: sample.providerProfile,
      lastCompletedThinkingMode: sample.thinkingMode,
      lastCompletedWorkloadLabel: sample.workloadLabel
    };
    next.estimatedRemainingMs = estimateRemainingMs(next);
    return next;
  });
}

export function completeBenchmarkProgressGroup(runId: string, groupKey: string) {
  return updateBenchmarkProgress(runId, (current) => {
    const elapsedMs = Date.now() - new Date(current.startedAt).getTime();
    const next: AgentBenchmarkProgress = {
      ...current,
      completedGroups: Math.min(current.completedGroups + 1, current.totalGroups),
      updatedAt: new Date().toISOString(),
      elapsedMs,
      activeGroups: (current.activeGroups || []).filter((entry) => entry.key !== groupKey)
    };
    next.estimatedRemainingMs = estimateRemainingMs(next);
    return next;
  });
}

export function completeBenchmarkProgress(runId: string) {
  return updateBenchmarkProgress(runId, (current) => ({
    ...current,
    status: "completed",
    updatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - new Date(current.startedAt).getTime(),
    estimatedRemainingMs: 0,
    activeGroups: []
  }));
}

export function failBenchmarkProgress(runId: string, error: string) {
  return updateBenchmarkProgress(runId, (current) => ({
    ...current,
    status: "failed",
    updatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - new Date(current.startedAt).getTime(),
    estimatedRemainingMs: null,
    activeGroups: [],
    error
  }));
}
