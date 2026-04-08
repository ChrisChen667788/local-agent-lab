import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import type { AgentCompareLaneTimelineEntry, AgentCompareProgress, AgentExecution } from "@/lib/agent/types";
import { getLocalAgentDataPath } from "@/lib/agent/data-dir";

function getProgressDir() {
  return getLocalAgentDataPath("compare-progress");
}

function ensureProgressDir() {
  mkdirSync(getProgressDir(), { recursive: true });
}

function getProgressPath(requestId: string) {
  return getLocalAgentDataPath("compare-progress", `${requestId}.json`);
}

function writeProgress(progress: AgentCompareProgress) {
  ensureProgressDir();
  writeFileSync(getProgressPath(progress.requestId), `${JSON.stringify(progress, null, 2)}\n`, "utf8");
}

export function createCompareProgress(input: {
  requestId: string;
  lanes: Array<{
    targetId: string;
    targetLabel: string;
    execution: AgentExecution;
    detail?: string;
  }>;
}) {
  const now = new Date().toISOString();
  const progress: AgentCompareProgress = {
    requestId: input.requestId,
    status: "pending",
    startedAt: now,
    updatedAt: now,
    lanes: input.lanes.map((lane) => ({
      targetId: lane.targetId,
      targetLabel: lane.targetLabel,
      execution: lane.execution,
      phase: "queued",
      detail: lane.detail || "Waiting for compare execution.",
      startedAt: now,
      updatedAt: now,
      loadingElapsedMs: null,
      recoveryThresholdMs: null,
      recoveryTriggeredAt: null,
      recoveryTriggerElapsedMs: null,
      timeline: [
        {
          at: now,
          phase: "queued",
          detail: lane.detail || "Waiting for compare execution."
        }
      ]
    }))
  };
  writeProgress(progress);
  return progress;
}

export function readCompareProgress(requestId: string) {
  const filePath = getProgressPath(requestId);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as AgentCompareProgress;
  } catch {
    return null;
  }
}

export function updateCompareProgress(
  requestId: string,
  updater: (current: AgentCompareProgress) => AgentCompareProgress
) {
  const current = readCompareProgress(requestId);
  if (!current) return null;
  const next = updater(current);
  writeProgress(next);
  return next;
}

export function touchCompareLaneProgress(
  requestId: string,
  targetId: string,
  patch: Partial<AgentCompareProgress["lanes"][number]> & {
    phase: AgentCompareProgress["lanes"][number]["phase"];
    detail: string;
    recordTimeline?: boolean;
  }
) {
  return updateCompareProgress(requestId, (current) => {
    const now = new Date().toISOString();
    const { recordTimeline, ...lanePatch } = patch;
    const nextLanes = current.lanes.map((lane) =>
      lane.targetId === targetId
        ? (() => {
            const timelineEntry: AgentCompareLaneTimelineEntry = {
              at: now,
              phase: lanePatch.phase,
              detail: lanePatch.detail,
              loadingElapsedMs:
                typeof lanePatch.loadingElapsedMs === "number" ? lanePatch.loadingElapsedMs : undefined,
              recoveryAction: lanePatch.recoveryAction,
              recoveryTriggerElapsedMs:
                typeof lanePatch.recoveryTriggerElapsedMs === "number" ? lanePatch.recoveryTriggerElapsedMs : undefined,
              warning: lanePatch.warning
            };
            const shouldAppendTimeline = Boolean(recordTimeline);
            const nextTimeline = shouldAppendTimeline
              ? (() => {
                  const currentTimeline = lane.timeline || [];
                  const previousEntry = currentTimeline[currentTimeline.length - 1];
                  if (
                    previousEntry &&
                    previousEntry.phase === timelineEntry.phase &&
                    previousEntry.detail === timelineEntry.detail &&
                    previousEntry.recoveryAction === timelineEntry.recoveryAction &&
                    previousEntry.warning === timelineEntry.warning
                  ) {
                    return currentTimeline;
                  }
                  return [...currentTimeline, timelineEntry];
                })()
              : lane.timeline || [];

            return {
              ...lane,
              ...lanePatch,
              updatedAt: now,
              timeline: nextTimeline
            };
          })()
        : lane
    );
    return {
      ...current,
      status:
        patch.phase === "failed"
          ? "failed"
          : patch.phase === "completed" && nextLanes.every((lane) => lane.phase === "completed" || lane.phase === "failed")
            ? current.status
            : "running",
      activeTargetId:
        patch.phase === "completed" || patch.phase === "failed"
          ? current.activeTargetId === targetId
            ? undefined
            : current.activeTargetId
          : targetId,
      updatedAt: now,
      lanes: nextLanes
    };
  });
}

export function completeCompareProgress(requestId: string, status: AgentCompareProgress["status"]) {
  return updateCompareProgress(requestId, (current) => ({
    ...current,
    status,
    activeTargetId: undefined,
    updatedAt: new Date().toISOString()
  }));
}

export function deleteCompareProgress(requestId: string) {
  const filePath = getProgressPath(requestId);
  if (!existsSync(filePath)) return;
  try {
    unlinkSync(filePath);
  } catch {
    // ignore cleanup failures
  }
}
