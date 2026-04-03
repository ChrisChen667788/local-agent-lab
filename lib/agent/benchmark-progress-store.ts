import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import type {
  AgentBenchmarkMode,
  AgentBenchmarkProfileBatchScope,
  AgentBenchmarkProgress,
  AgentExecution,
  AgentProviderProfile,
  AgentThinkingMode
} from "@/lib/agent/types";
import { getLocalAgentDataPath } from "@/lib/agent/data-dir";

const PROGRESS_DIR = getLocalAgentDataPath("benchmark-progress");

function ensureProgressDir() {
  mkdirSync(PROGRESS_DIR, { recursive: true });
}

function getProgressPath(runId: string) {
  return getLocalAgentDataPath("benchmark-progress", `${runId}.json`);
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
  pendingGroups?: Array<{
    key: string;
    targetLabel: string;
    providerProfile: AgentProviderProfile;
    thinkingMode: AgentThinkingMode;
    execution?: AgentExecution;
    sampleCount?: number;
  }>;
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
    activeGroups: [],
    pendingGroups:
      input.pendingGroups?.map((group) => ({
        ...group
      })) || [],
    recentGroups: []
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

export function readLatestBenchmarkProgress(options?: { unfinishedOnly?: boolean }) {
  ensureProgressDir();
  const progresses = readdirSync(PROGRESS_DIR)
    .filter((entry) => entry.endsWith(".json"))
    .map((file) => {
      try {
        return JSON.parse(
          readFileSync(getProgressPath(file.replace(/\.json$/, "")), "utf8")
        ) as AgentBenchmarkProgress;
      } catch {
        return null;
      }
    })
    .filter((progress): progress is AgentBenchmarkProgress => Boolean(progress))
    .filter((progress) =>
      options?.unfinishedOnly
        ? progress.status === "pending" || progress.status === "running"
        : true
    )
    .sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.startedAt).getTime();
      const rightTime = new Date(right.updatedAt || right.startedAt).getTime();
      return rightTime - leftTime;
    });

  return progresses[0] || null;
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
    updatedAt: new Date().toISOString(),
    error: undefined,
    controlAction: undefined,
    controlRequestedAt: undefined,
    controlMessage: undefined
  }));
}

export function touchBenchmarkProgressWorker(
  runId: string,
  worker?: {
    heartbeatAt?: string;
    pid?: number | null;
    phase?: string | null;
  }
) {
  return updateBenchmarkProgress(runId, (current) => ({
    ...current,
    updatedAt: worker?.heartbeatAt || new Date().toISOString(),
    workerHeartbeatAt: worker?.heartbeatAt || new Date().toISOString(),
    workerPid:
      typeof worker?.pid === "number"
        ? worker.pid
        : current.workerPid,
    workerPhase:
      typeof worker?.phase === "string"
        ? worker.phase
        : worker?.phase === null
          ? undefined
          : current.workerPhase
  }));
}

export function startBenchmarkProgressGroup(
  runId: string,
  group: {
    key: string;
    targetLabel: string;
    providerProfile: AgentProviderProfile;
    thinkingMode: AgentThinkingMode;
    execution?: AgentExecution;
    sampleCount?: number;
  }
) {
  return updateBenchmarkProgress(runId, (current) => {
    const now = new Date().toISOString();
    const pendingGroups = (current.pendingGroups || []).filter((entry) => entry.key !== group.key);
    return {
      ...current,
      status: current.status === "pending" ? "running" : current.status,
      updatedAt: now,
      activeGroups: [
        ...(current.activeGroups || []).filter((entry) => entry.key !== group.key),
        {
          key: group.key,
          targetLabel: group.targetLabel,
          providerProfile: group.providerProfile,
          thinkingMode: group.thinkingMode,
          execution: group.execution,
          sampleCount: group.sampleCount,
          startedAt: now
        }
      ],
      pendingGroups
    };
  });
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
    const now = new Date().toISOString();
    const activeGroup = (current.activeGroups || []).find((entry) => entry.key === groupKey);
    const pendingGroup = (current.pendingGroups || []).find((entry) => entry.key === groupKey);
    const recentGroups = [
      {
        ...(activeGroup || pendingGroup || { key: groupKey, targetLabel: groupKey, providerProfile: "balanced" as AgentProviderProfile, thinkingMode: "standard" as AgentThinkingMode }),
        completedAt: now
      },
      ...(current.recentGroups || []).filter((entry) => entry.key !== groupKey)
    ].slice(0, 8);
    const elapsedMs = Date.now() - new Date(current.startedAt).getTime();
    const next: AgentBenchmarkProgress = {
      ...current,
      completedGroups: Math.min(current.completedGroups + 1, current.totalGroups),
      updatedAt: now,
      elapsedMs,
      activeGroups: (current.activeGroups || []).filter((entry) => entry.key !== groupKey),
      pendingGroups: (current.pendingGroups || []).filter((entry) => entry.key !== groupKey),
      recentGroups
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
    activeGroups: [],
    pendingGroups: [],
    localPrewarm: undefined,
    workerHeartbeatAt: undefined,
    workerPid: undefined,
    workerPhase: undefined,
    error: undefined,
    controlAction: undefined,
    controlRequestedAt: undefined,
    controlMessage: undefined
  }));
}

export function requestBenchmarkProgressControl(runId: string, action: "stop" | "abandon") {
  return updateBenchmarkProgress(runId, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    controlAction: action === "stop" ? "stop-requested" : "abandon-requested",
    controlRequestedAt: new Date().toISOString(),
    controlMessage: action === "stop" ? "Stop requested." : "Abandon requested."
  }));
}

export function finalizeBenchmarkProgressControl(
  runId: string,
  action: "stop" | "abandon",
  message?: string
) {
  return updateBenchmarkProgress(runId, (current) => ({
    ...current,
    status: action === "stop" ? "stopped" : "abandoned",
    updatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - new Date(current.startedAt).getTime(),
    estimatedRemainingMs: null,
    activeGroups: [],
    pendingGroups: action === "abandon" ? [] : current.pendingGroups || [],
    localPrewarm: undefined,
    workerHeartbeatAt: undefined,
    workerPid: undefined,
    workerPhase: undefined,
    error: undefined,
    controlAction: undefined,
    controlRequestedAt: undefined,
    controlMessage: message || (action === "stop" ? "Benchmark run stopped." : "Benchmark run abandoned.")
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
    localPrewarm: undefined,
    workerHeartbeatAt: undefined,
    workerPid: undefined,
    workerPhase: undefined,
    controlAction: undefined,
    controlRequestedAt: undefined,
    controlMessage: undefined,
    error
  }));
}

export function setBenchmarkProgressLocalPrewarm(
  runId: string,
  prewarm:
    | AgentBenchmarkProgress["localPrewarm"]
    | null
) {
  return updateBenchmarkProgress(runId, (current) => {
    const now = new Date().toISOString();
    const previous = current.localPrewarm;
    const preserveRecovery =
      prewarm &&
      previous &&
      previous.targetId === prewarm.targetId
        ? {
            lastRecoveryAction: previous.lastRecoveryAction,
            lastRecoveryAt: previous.lastRecoveryAt
          }
        : {};

    return {
      ...current,
      updatedAt: now,
      localPrewarm: prewarm
        ? {
            ...preserveRecovery,
            ...prewarm,
            updatedAt: now
          }
        : undefined
    };
  });
}
