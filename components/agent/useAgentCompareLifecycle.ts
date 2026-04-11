"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import type {
  AgentBenchmarkResponse,
  AgentCompareIntent,
  AgentCompareLaneProgress,
  AgentCompareOutputShape,
  AgentCompareProgress,
  AgentCompareResponse,
  AgentProviderProfile,
  AgentRuntimeStatus,
  AgentTarget,
  AgentThinkingMode
} from "@/lib/agent/types";

type Setter<T> = Dispatch<SetStateAction<T>>;

type UseAgentCompareLifecycleInput = {
  agentTargets: AgentTarget[];
  selectedTargetId: string;
  compareTargetIds: string[];
  compareIntent: AgentCompareIntent;
  compareOutputShape: AgentCompareOutputShape;
  comparePending: boolean;
  compareRequestId: string;
  compareResult: AgentCompareResponse | null;
  contextWindow: number;
  enableRetrieval: boolean;
  enableTools: boolean;
  input: string;
  providerProfile: AgentProviderProfile;
  systemPrompt: string;
  thinkingMode: AgentThinkingMode;
  maxCompareLanes: number;
  setCompareTargetIds: Setter<string[]>;
  setCompareError: Setter<string>;
  setBenchmarkError: Setter<string>;
  setCompareBaseTargetId: Setter<string>;
  setCompareRuntimeByTargetId: Setter<Record<string, AgentRuntimeStatus>>;
  setCompareProgressByTargetId: Setter<Record<string, AgentCompareLaneProgress>>;
};

export function useAgentCompareLifecycle({
  agentTargets,
  selectedTargetId,
  compareTargetIds,
  compareIntent,
  compareOutputShape,
  comparePending,
  compareRequestId,
  compareResult,
  contextWindow,
  enableRetrieval,
  enableTools,
  input,
  providerProfile,
  systemPrompt,
  thinkingMode,
  maxCompareLanes,
  setCompareTargetIds,
  setCompareError,
  setBenchmarkError,
  setCompareBaseTargetId,
  setCompareRuntimeByTargetId,
  setCompareProgressByTargetId
}: UseAgentCompareLifecycleInput) {
  useEffect(() => {
    setCompareError("");
    setBenchmarkError("");
  }, [
    compareIntent,
    compareOutputShape,
    compareTargetIds,
    contextWindow,
    enableRetrieval,
    enableTools,
    input,
    providerProfile,
    setBenchmarkError,
    setCompareError,
    systemPrompt,
    thinkingMode
  ]);

  useEffect(() => {
    if (!compareResult?.results.length) {
      setCompareBaseTargetId("");
      return;
    }
    setCompareBaseTargetId((current) => {
      if (current && compareResult.results.some((lane) => lane.targetId === current)) {
        return current;
      }
      return compareResult.results[0]?.targetId || "";
    });
  }, [compareResult, setCompareBaseTargetId]);

  useEffect(() => {
    setCompareRuntimeByTargetId((current) => {
      const nextEntries = Object.entries(current).filter(([targetId]) => compareTargetIds.includes(targetId));
      return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
    });
  }, [compareTargetIds, setCompareRuntimeByTargetId]);

  useEffect(() => {
    setCompareProgressByTargetId((current) => {
      const nextEntries = Object.entries(current).filter(([targetId]) => compareTargetIds.includes(targetId));
      return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
    });
  }, [compareTargetIds, setCompareProgressByTargetId]);

  useEffect(() => {
    if (!comparePending) return;
    const localCompareTargetIds = compareTargetIds.filter(
      (targetId) => agentTargets.find((target) => target.id === targetId)?.execution === "local"
    );
    if (!localCompareTargetIds.length) return;

    let cancelled = false;

    async function loadCompareRuntimeStatuses() {
      try {
        const responses = await Promise.all(
          localCompareTargetIds.map(async (targetId) => {
            const query = new URLSearchParams({
              targetId,
              thinkingMode
            });
            const response = await fetch(`/api/agent/runtime?${query.toString()}`, {
              cache: "no-store"
            });
            const payload = (await response.json()) as AgentRuntimeStatus & { error?: string };
            if (!response.ok) {
              throw new Error(payload.error || `Failed to load runtime for ${targetId}.`);
            }
            return [targetId, payload] as const;
          })
        );
        if (!cancelled) {
          setCompareRuntimeByTargetId(Object.fromEntries(responses));
        }
      } catch {
        // Keep the latest known runtime snapshot if a polling round fails.
      }
    }

    void loadCompareRuntimeStatuses();
    const timer = window.setInterval(() => {
      void loadCompareRuntimeStatuses();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [agentTargets, comparePending, compareTargetIds, setCompareRuntimeByTargetId, thinkingMode]);

  useEffect(() => {
    if (!comparePending || !compareRequestId) return;

    let cancelled = false;

    async function loadCompareProgress() {
      try {
        const query = new URLSearchParams({ requestId: compareRequestId });
        const response = await fetch(`/api/agent/compare/progress?${query.toString()}`, {
          cache: "no-store"
        });
        const payload = (await response.json()) as AgentCompareProgress & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || `Failed to load compare progress for ${compareRequestId}.`);
        }
        if (!cancelled) {
          setCompareProgressByTargetId(
            Object.fromEntries(payload.lanes.map((lane) => [lane.targetId, lane]))
          );
        }
      } catch {
        // Keep the latest known compare progress snapshot if a polling round fails.
      }
    }

    void loadCompareProgress();
    const timer = window.setInterval(() => {
      void loadCompareProgress();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [comparePending, compareRequestId, setCompareProgressByTargetId]);

  useEffect(() => {
    setCompareTargetIds((current) => {
      const validTargetIds = current.filter((targetId) => agentTargets.some((target) => target.id === targetId));
      const deduped = Array.from(new Set(validTargetIds));
      if (!deduped.includes(selectedTargetId)) {
        deduped.unshift(selectedTargetId);
      }
      return deduped.slice(0, maxCompareLanes);
    });
  }, [agentTargets, maxCompareLanes, selectedTargetId, setCompareTargetIds]);
}
