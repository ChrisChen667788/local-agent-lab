"use client";

import type {
  AgentCompareIntent,
  AgentCompareOutputShape,
  AgentCompareReviewSummaryDetail,
  AgentCompareReviewSummaryTone
} from "@/lib/agent/types";

type ComparePreferenceInput = {
  compareTargetIds?: string[];
  compareBaseTargetId?: string;
  compareReviewSummaryTone?: AgentCompareReviewSummaryTone;
  compareReviewSummaryDetail?: AgentCompareReviewSummaryDetail;
  compareBenchmarkUseOutputContract?: boolean;
  compareBenchmarkPreviewDiffOnly?: boolean;
  compareIntent?: AgentCompareIntent;
  compareOutputShape?: AgentCompareOutputShape;
};

const VALID_COMPARE_TONES: AgentCompareReviewSummaryTone[] = ["issue", "pr", "chat"];
const VALID_COMPARE_DETAILS: AgentCompareReviewSummaryDetail[] = ["compact", "strict-review", "friendly-report"];
const VALID_COMPARE_INTENTS: AgentCompareIntent[] = [
  "model-vs-model",
  "preset-vs-preset",
  "template-vs-template",
  "before-vs-after"
];
const VALID_COMPARE_OUTPUT_SHAPES: AgentCompareOutputShape[] = ["freeform", "bullet-list", "strict-json"];

export function normalizeStoredComparePreferences(
  input: ComparePreferenceInput | null | undefined,
  validTargetIds: string[],
  maxCompareLanes: number
) {
  if (!input) {
    return {};
  }

  const validTargetSet = new Set(validTargetIds);
  const compareTargetIds = Array.isArray(input.compareTargetIds)
    ? Array.from(
        new Set(
          input.compareTargetIds.filter(
            (targetId): targetId is string => typeof targetId === "string" && validTargetSet.has(targetId)
          )
        )
      ).slice(0, maxCompareLanes)
    : [];

  return {
    compareTargetIds,
    compareBaseTargetId:
      typeof input.compareBaseTargetId === "string" && validTargetSet.has(input.compareBaseTargetId)
        ? input.compareBaseTargetId
        : undefined,
    compareReviewSummaryTone: VALID_COMPARE_TONES.includes(input.compareReviewSummaryTone as AgentCompareReviewSummaryTone)
      ? (input.compareReviewSummaryTone as AgentCompareReviewSummaryTone)
      : undefined,
    compareReviewSummaryDetail: VALID_COMPARE_DETAILS.includes(
      input.compareReviewSummaryDetail as AgentCompareReviewSummaryDetail
    )
      ? (input.compareReviewSummaryDetail as AgentCompareReviewSummaryDetail)
      : undefined,
    compareBenchmarkUseOutputContract:
      typeof input.compareBenchmarkUseOutputContract === "boolean" ? input.compareBenchmarkUseOutputContract : undefined,
    compareBenchmarkPreviewDiffOnly:
      typeof input.compareBenchmarkPreviewDiffOnly === "boolean" ? input.compareBenchmarkPreviewDiffOnly : undefined,
    compareIntent: VALID_COMPARE_INTENTS.includes(input.compareIntent as AgentCompareIntent)
      ? (input.compareIntent as AgentCompareIntent)
      : undefined,
    compareOutputShape: VALID_COMPARE_OUTPUT_SHAPES.includes(input.compareOutputShape as AgentCompareOutputShape)
      ? (input.compareOutputShape as AgentCompareOutputShape)
      : undefined
  };
}

export function buildStoredComparePreferences(input: {
  compareTargetIds: string[];
  compareBaseTargetId: string | null;
  compareReviewSummaryTone: AgentCompareReviewSummaryTone;
  compareReviewSummaryDetail: AgentCompareReviewSummaryDetail;
  compareBenchmarkUseOutputContract: boolean;
  compareBenchmarkPreviewDiffOnly: boolean;
  compareIntent: AgentCompareIntent;
  compareOutputShape: AgentCompareOutputShape;
}) {
  return {
    compareTargetIds: input.compareTargetIds,
    compareBaseTargetId: input.compareBaseTargetId,
    compareReviewSummaryTone: input.compareReviewSummaryTone,
    compareReviewSummaryDetail: input.compareReviewSummaryDetail,
    compareBenchmarkUseOutputContract: input.compareBenchmarkUseOutputContract,
    compareBenchmarkPreviewDiffOnly: input.compareBenchmarkPreviewDiffOnly,
    compareIntent: input.compareIntent,
    compareOutputShape: input.compareOutputShape
  };
}
