"use client";

import { useCallback, useReducer, type SetStateAction } from "react";
import type {
  AgentBenchmarkResponse,
  AgentCompareIntent,
  AgentCompareLaneProgress,
  AgentCompareOutputShape,
  AgentCompareReviewSummaryDetail,
  AgentCompareReviewSummaryTone,
  AgentCompareResponse,
  AgentRuntimeStatus
} from "@/lib/agent/types";

export type AgentCompareRecoveryNotice = {
  tone: "info" | "success" | "warning";
  message: string;
};

type AgentCompareState = {
  compareTargetIds: string[];
  compareIntent: AgentCompareIntent;
  compareOutputShape: AgentCompareOutputShape;
  comparePending: boolean;
  compareError: string;
  compareResult: AgentCompareResponse | null;
  compareBaseTargetId: string;
  compareReviewSummaryTone: AgentCompareReviewSummaryTone;
  compareReviewSummaryDetail: AgentCompareReviewSummaryDetail;
  compareRequestId: string;
  compareRuntimeByTargetId: Record<string, AgentRuntimeStatus>;
  compareProgressByTargetId: Record<string, AgentCompareLaneProgress>;
  compareBenchmarkUseOutputContract: boolean;
  compareBenchmarkPreviewDiffOnly: boolean;
  compareRecoveryPendingTargetId: string;
  compareRecoveryConfirmTargetId: string;
  compareRecoveryCooldownByTargetId: Record<string, number>;
  compareRecoveryNotice: AgentCompareRecoveryNotice | null;
  benchmarkPending: boolean;
  benchmarkError: string;
  benchmarkResult: AgentBenchmarkResponse | null;
};

type AgentCompareStateAction = {
  key: keyof AgentCompareState;
  value: unknown;
};

const initialAgentCompareState: AgentCompareState = {
  compareTargetIds: [],
  compareIntent: "model-vs-model",
  compareOutputShape: "freeform",
  comparePending: false,
  compareError: "",
  compareResult: null,
  compareBaseTargetId: "",
  compareReviewSummaryTone: "pr",
  compareReviewSummaryDetail: "compact",
  compareRequestId: "",
  compareRuntimeByTargetId: {},
  compareProgressByTargetId: {},
  compareBenchmarkUseOutputContract: true,
  compareBenchmarkPreviewDiffOnly: false,
  compareRecoveryPendingTargetId: "",
  compareRecoveryConfirmTargetId: "",
  compareRecoveryCooldownByTargetId: {},
  compareRecoveryNotice: null,
  benchmarkPending: false,
  benchmarkError: "",
  benchmarkResult: null
};

function resolveStateUpdate<T>(current: T, update: SetStateAction<T>) {
  return typeof update === "function" ? (update as (previous: T) => T)(current) : update;
}

function agentCompareStateReducer(state: AgentCompareState, action: AgentCompareStateAction): AgentCompareState {
  const currentValue = state[action.key] as unknown;
  const nextValue =
    typeof action.value === "function"
      ? (action.value as (previous: unknown) => unknown)(currentValue)
      : action.value;

  if (Object.is(currentValue, nextValue)) {
    return state;
  }

  return {
    ...state,
    [action.key]: nextValue
  };
}

export function useAgentCompareState() {
  const [state, dispatch] = useReducer(agentCompareStateReducer, initialAgentCompareState);

  const setField = useCallback(
    <K extends keyof AgentCompareState>(key: K, value: SetStateAction<AgentCompareState[K]>) => {
      dispatch({ key, value });
    },
    []
  );

  return {
    ...state,
    setCompareTargetIds: useCallback((value: SetStateAction<string[]>) => setField("compareTargetIds", value), [setField]),
    setCompareIntent: useCallback((value: SetStateAction<AgentCompareIntent>) => setField("compareIntent", value), [setField]),
    setCompareOutputShape: useCallback((value: SetStateAction<AgentCompareOutputShape>) => setField("compareOutputShape", value), [setField]),
    setComparePending: useCallback((value: SetStateAction<boolean>) => setField("comparePending", value), [setField]),
    setCompareError: useCallback((value: SetStateAction<string>) => setField("compareError", value), [setField]),
    setCompareResult: useCallback((value: SetStateAction<AgentCompareResponse | null>) => setField("compareResult", value), [setField]),
    setCompareBaseTargetId: useCallback((value: SetStateAction<string>) => setField("compareBaseTargetId", value), [setField]),
    setCompareReviewSummaryTone: useCallback((value: SetStateAction<AgentCompareReviewSummaryTone>) => setField("compareReviewSummaryTone", value), [setField]),
    setCompareReviewSummaryDetail: useCallback((value: SetStateAction<AgentCompareReviewSummaryDetail>) => setField("compareReviewSummaryDetail", value), [setField]),
    setCompareRequestId: useCallback((value: SetStateAction<string>) => setField("compareRequestId", value), [setField]),
    setCompareRuntimeByTargetId: useCallback((value: SetStateAction<Record<string, AgentRuntimeStatus>>) => setField("compareRuntimeByTargetId", value), [setField]),
    setCompareProgressByTargetId: useCallback((value: SetStateAction<Record<string, AgentCompareLaneProgress>>) => setField("compareProgressByTargetId", value), [setField]),
    setCompareBenchmarkUseOutputContract: useCallback((value: SetStateAction<boolean>) => setField("compareBenchmarkUseOutputContract", value), [setField]),
    setCompareBenchmarkPreviewDiffOnly: useCallback((value: SetStateAction<boolean>) => setField("compareBenchmarkPreviewDiffOnly", value), [setField]),
    setCompareRecoveryPendingTargetId: useCallback((value: SetStateAction<string>) => setField("compareRecoveryPendingTargetId", value), [setField]),
    setCompareRecoveryConfirmTargetId: useCallback((value: SetStateAction<string>) => setField("compareRecoveryConfirmTargetId", value), [setField]),
    setCompareRecoveryCooldownByTargetId: useCallback((value: SetStateAction<Record<string, number>>) => setField("compareRecoveryCooldownByTargetId", value), [setField]),
    setCompareRecoveryNotice: useCallback((value: SetStateAction<AgentCompareRecoveryNotice | null>) => setField("compareRecoveryNotice", value), [setField]),
    setBenchmarkPending: useCallback((value: SetStateAction<boolean>) => setField("benchmarkPending", value), [setField]),
    setBenchmarkError: useCallback((value: SetStateAction<string>) => setField("benchmarkError", value), [setField]),
    setBenchmarkResult: useCallback((value: SetStateAction<AgentBenchmarkResponse | null>) => setField("benchmarkResult", value), [setField])
  };
}
