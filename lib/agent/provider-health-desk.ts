import { readChatLogs, readConnectionCheckLogs } from "@/lib/agent/log-store";
import { listServerAgentTargets } from "@/lib/agent/server-targets";
import type { AgentProviderHealthDeskItem, AgentThinkingMode } from "@/lib/agent/types";

type ProviderPricing = {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
};

// Pricing is intentionally approximate and only wired for providers we already benchmark heavily.
// These values were aligned to the current official pricing pages on 2026-04-18.
const PROVIDER_PRICING: Record<string, ProviderPricing> = {
  "openai-gpt54:standard": { inputUsdPer1M: 2.5, outputUsdPer1M: 15 },
  "openai-gpt54:thinking": { inputUsdPer1M: 2.5, outputUsdPer1M: 15 },
  "anthropic-claude:standard": { inputUsdPer1M: 5, outputUsdPer1M: 25 },
  "anthropic-claude:thinking": { inputUsdPer1M: 5, outputUsdPer1M: 25 },
  "deepseek-api:standard": { inputUsdPer1M: 0.27, outputUsdPer1M: 1.1 },
  "deepseek-api:thinking": { inputUsdPer1M: 0.55, outputUsdPer1M: 2.19 }
};

function average(values: number[]) {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function classifyFailureMessage(message: string | undefined) {
  const normalized = (message || "").toLowerCase();
  return {
    timeout:
      normalized.includes("timeout") ||
      normalized.includes("timed out") ||
      normalized.includes("first token timeout") ||
      normalized.includes("stream idle timeout"),
    rateLimit: normalized.includes("429") || normalized.includes("rate limit"),
    auth:
      normalized.includes("401") ||
      normalized.includes("403") ||
      normalized.includes("unauthorized") ||
      normalized.includes("forbidden") ||
      normalized.includes("invalid api key") ||
      normalized.includes("auth"),
    network:
      normalized.includes("connection") ||
      normalized.includes("network") ||
      normalized.includes("abort") ||
      normalized.includes("empty")
  };
}

function estimateCostUsd(targetId: string, thinkingMode: AgentThinkingMode | undefined, promptTokens: number, completionTokens: number) {
  const pricing = PROVIDER_PRICING[`${targetId}:${thinkingMode || "standard"}`];
  if (!pricing) return null;
  const promptCost = (promptTokens / 1_000_000) * pricing.inputUsdPer1M;
  const completionCost = (completionTokens / 1_000_000) * pricing.outputUsdPer1M;
  return Number((promptCost + completionCost).toFixed(4));
}

export function buildProviderHealthDesk(options?: {
  sinceIso?: string;
}) {
  const remoteTargets = listServerAgentTargets().filter((target) => target.execution === "remote");
  const chatLogs = readChatLogs({ sinceIso: options?.sinceIso, limit: 2000 }).filter((row) => row.execution === "remote");
  const connectionChecks = readConnectionCheckLogs({ sinceIso: options?.sinceIso, limit: 400 })
    .filter((row) => remoteTargets.some((target) => target.id === row.targetId));

  return remoteTargets
    .map<AgentProviderHealthDeskItem>((target) => {
      const targetRows = chatLogs.filter((row) => row.targetId === target.id);
      const successRows = targetRows.filter((row) => row.ok);
      const failureRows = targetRows.filter((row) => !row.ok);
      const lastFailure = failureRows[failureRows.length - 1] || null;
      const lastSuccess = successRows[successRows.length - 1] || null;
      const latestConnectionCheck = connectionChecks
        .filter((row) => row.targetId === target.id)
        .sort((left, right) => left.checkedAt.localeCompare(right.checkedAt))
        .pop() || null;

      let timeoutCount = 0;
      let rateLimitCount = 0;
      let authFailureCount = 0;
      let networkFailureCount = 0;
      for (const row of failureRows) {
        const flags = classifyFailureMessage(row.warning || row.outputPreview);
        if (flags.timeout) timeoutCount += 1;
        if (flags.rateLimit) rateLimitCount += 1;
        if (flags.auth) authFailureCount += 1;
        if (flags.network) networkFailureCount += 1;
      }

      const totalPromptTokens = targetRows.reduce((sum, row) => sum + (row.usage?.promptTokens || 0), 0);
      const totalCompletionTokens = targetRows.reduce((sum, row) => sum + (row.usage?.completionTokens || 0), 0);
      const totalTokens = targetRows.reduce((sum, row) => sum + (row.usage?.totalTokens || 0), 0);
      const estimatedCostUsd = targetRows.reduce((sum, row) => {
        const estimated = estimateCostUsd(target.id, row.thinkingMode, row.usage?.promptTokens || 0, row.usage?.completionTokens || 0);
        return sum + (estimated || 0);
      }, 0);

      return {
        targetId: target.id,
        targetLabel: target.label,
        providerLabel: target.providerLabel,
        resolvedModel: lastSuccess?.resolvedModel || lastFailure?.resolvedModel || target.modelDefault,
        totalRequests: targetRows.length,
        successCount: successRows.length,
        failureCount: failureRows.length,
        timeoutCount,
        rateLimitCount,
        authFailureCount,
        networkFailureCount,
        totalPromptTokens,
        totalCompletionTokens,
        totalTokens,
        estimatedCostUsd: Number.isFinite(estimatedCostUsd) && estimatedCostUsd > 0 ? Number(estimatedCostUsd.toFixed(4)) : null,
        pricingSource: PROVIDER_PRICING[`${target.id}:standard`] ? "official" : "unavailable",
        avgFirstTokenLatencyMs: average(successRows.flatMap((row) => (typeof row.firstTokenLatencyMs === "number" ? [row.firstTokenLatencyMs] : []))),
        avgLatencyMs: average(successRows.map((row) => row.latencyMs)),
        lastSuccessAt: lastSuccess?.completedAt || null,
        lastFailureAt: lastFailure?.completedAt || null,
        lastFailureSummary: lastFailure?.warning || null,
        lastConnectionOk: latestConnectionCheck?.ok ?? null,
        lastConnectionAt: latestConnectionCheck?.checkedAt || null,
        lastConnectionSummary: latestConnectionCheck?.stages
          ?.map((stage) => `${stage.id}: ${stage.summary}`)
          .join(" · ") || null
      };
    })
    .sort((left, right) => {
      const leftTime = left.lastSuccessAt || left.lastFailureAt || "";
      const rightTime = right.lastSuccessAt || right.lastFailureAt || "";
      return rightTime.localeCompare(leftTime) || left.targetLabel.localeCompare(right.targetLabel);
    });
}

