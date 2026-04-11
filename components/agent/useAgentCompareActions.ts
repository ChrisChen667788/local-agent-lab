"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type {
  AgentBenchmarkResponse,
  AgentCompareLaneProgress,
  AgentCompareProgress,
  AgentCompareResponse,
  AgentCompareReviewSummaryDetail,
  AgentCompareReviewSummaryTone,
  AgentMessage,
  AgentProviderProfile,
  AgentRuntimeActionResponse,
  AgentRuntimeStatus,
  AgentTarget,
  AgentThinkingMode
} from "@/lib/agent/types";

type Setter<T> = Dispatch<SetStateAction<T>>;

async function loadCompareShareModule() {
  return import("@/lib/agent/compare-share");
}

type UseAgentCompareActionsInput = {
  locale: string;
  agentTargets: AgentTarget[];
  compareTargetIds: string[];
  compareIntent: AgentCompareResponse["compareIntent"];
  compareOutputShape: AgentCompareResponse["compareOutputShape"];
  comparePending: boolean;
  compareResult: AgentCompareResponse | null;
  compareBaseTargetId: string;
  compareRequestId: string;
  compareProgressByTargetId: Record<string, AgentCompareLaneProgress>;
  compareBenchmarkUseOutputContract: boolean;
  compareReviewSummaryTone: AgentCompareReviewSummaryTone;
  compareReviewSummaryDetail: AgentCompareReviewSummaryDetail;
  compareRecoveryConfirmTargetId: string;
  compareRecoveryCooldownByTargetId: Record<string, number>;
  historyMessages: AgentMessage[];
  input: string;
  systemPrompt: string;
  contextWindow: number;
  enableTools: boolean;
  enableRetrieval: boolean;
  providerProfile: AgentProviderProfile;
  thinkingMode: AgentThinkingMode;
  setComparePending: Setter<boolean>;
  setCompareError: Setter<string>;
  setCompareResult: Setter<AgentCompareResponse | null>;
  setCompareBaseTargetId: Setter<string>;
  setCompareRequestId: Setter<string>;
  setCompareProgressByTargetId: Setter<Record<string, AgentCompareLaneProgress>>;
  setCompareRuntimeByTargetId: Setter<Record<string, AgentRuntimeStatus>>;
  setCompareRecoveryPendingTargetId: Setter<string>;
  setCompareRecoveryConfirmTargetId: Setter<string>;
  setCompareRecoveryCooldownByTargetId: Setter<Record<string, number>>;
  setCompareRecoveryNotice: Setter<{ tone: "info" | "success" | "warning"; message: string } | null>;
  setBenchmarkPending: Setter<boolean>;
  setBenchmarkError: Setter<string>;
  setBenchmarkResult: Setter<AgentBenchmarkResponse | null>;
  copyText: (text: string, key: string) => Promise<void>;
};

export function useAgentCompareActions({
  locale,
  agentTargets,
  compareTargetIds,
  compareIntent,
  compareOutputShape,
  comparePending,
  compareResult,
  compareBaseTargetId,
  compareRequestId,
  compareProgressByTargetId,
  compareBenchmarkUseOutputContract,
  compareReviewSummaryTone,
  compareReviewSummaryDetail,
  compareRecoveryConfirmTargetId,
  compareRecoveryCooldownByTargetId,
  historyMessages,
  input,
  systemPrompt,
  contextWindow,
  enableTools,
  enableRetrieval,
  providerProfile,
  thinkingMode,
  setComparePending,
  setCompareError,
  setCompareResult,
  setCompareBaseTargetId,
  setCompareRequestId,
  setCompareProgressByTargetId,
  setCompareRuntimeByTargetId,
  setCompareRecoveryPendingTargetId,
  setCompareRecoveryConfirmTargetId,
  setCompareRecoveryCooldownByTargetId,
  setCompareRecoveryNotice,
  setBenchmarkPending,
  setBenchmarkError,
  setBenchmarkResult,
  copyText
}: UseAgentCompareActionsInput) {
  const compareRecoveryConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compareRecoveryNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncCompareProgressPatch = useCallback(
    async (input: {
      requestId: string;
      targetId: string;
      phase: AgentCompareLaneProgress["phase"];
      detail: string;
      loadingElapsedMs?: number | null;
      recoveryThresholdMs?: number | null;
      recoveryAction?: string;
      recoveryTriggeredAt?: string | null;
      recoveryTriggerElapsedMs?: number | null;
      warning?: string;
      recordTimeline?: boolean;
    }) => {
      const response = await fetch("/api/agent/compare/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const payload = (await response.json()) as AgentCompareProgress & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update compare progress.");
      }
      setCompareProgressByTargetId(Object.fromEntries(payload.lanes.map((lane) => [lane.targetId, lane])));
    },
    [setCompareProgressByTargetId]
  );

  const clearCompareRecoveryConfirm = useCallback(() => {
    if (compareRecoveryConfirmTimeoutRef.current) {
      clearTimeout(compareRecoveryConfirmTimeoutRef.current);
      compareRecoveryConfirmTimeoutRef.current = null;
    }
    setCompareRecoveryConfirmTargetId("");
  }, [setCompareRecoveryConfirmTargetId]);

  const showCompareRecoveryNotice = useCallback(
    (
      tone: "info" | "success" | "warning",
      message: string,
      durationMs = 5000
    ) => {
      if (compareRecoveryNoticeTimeoutRef.current) {
        clearTimeout(compareRecoveryNoticeTimeoutRef.current);
        compareRecoveryNoticeTimeoutRef.current = null;
      }
      setCompareRecoveryNotice({ tone, message });
      compareRecoveryNoticeTimeoutRef.current = setTimeout(() => {
        setCompareRecoveryNotice((current) => (current?.message === message ? null : current));
        compareRecoveryNoticeTimeoutRef.current = null;
      }, durationMs);
    },
    [setCompareRecoveryNotice]
  );

  const armCompareRecoveryConfirm = useCallback(
    (targetId: string) => {
      clearCompareRecoveryConfirm();
      setCompareRecoveryConfirmTargetId(targetId);
      const target = agentTargets.find((entry) => entry.id === targetId);
      showCompareRecoveryNotice(
        "info",
        locale.startsWith("en")
          ? `Click again within 5 seconds to restart ${target?.label || targetId} from Compare.`
          : `请在 5 秒内再次点击，Compare 才会重启 ${target?.label || targetId}。`
      );
      compareRecoveryConfirmTimeoutRef.current = setTimeout(() => {
        setCompareRecoveryConfirmTargetId((current) => (current === targetId ? "" : current));
        compareRecoveryConfirmTimeoutRef.current = null;
      }, 5000);
    },
    [
      agentTargets,
      clearCompareRecoveryConfirm,
      locale,
      setCompareRecoveryConfirmTargetId,
      showCompareRecoveryNotice
    ]
  );

  const startCompareRecoveryCooldown = useCallback(
    (targetId: string, durationMs = 15000) => {
      const expiresAt = Date.now() + durationMs;
      setCompareRecoveryCooldownByTargetId((current) => ({
        ...current,
        [targetId]: expiresAt
      }));
      const target = agentTargets.find((entry) => entry.id === targetId);
      showCompareRecoveryNotice(
        "warning",
        locale.startsWith("en")
          ? `${target?.label || targetId} is in a short recovery cooldown so Compare does not spam restarts.`
          : `${target?.label || targetId} 已进入短暂恢复冷却，避免 Compare 连续重启。`,
        durationMs
      );
      setTimeout(() => {
        setCompareRecoveryCooldownByTargetId((current) => {
          if ((current[targetId] || 0) !== expiresAt) return current;
          const next = { ...current };
          delete next[targetId];
          return next;
        });
      }, durationMs);
    },
    [agentTargets, locale, setCompareRecoveryCooldownByTargetId, showCompareRecoveryNotice]
  );

  const handleRunCompare = useCallback(async () => {
    if (compareTargetIds.length < 2) {
      setCompareError(locale.startsWith("en") ? "Choose at least two targets." : "至少选择两个对比目标。");
      return;
    }

    const requestId = crypto.randomUUID();
    setComparePending(true);
    setCompareError("");
    setBenchmarkError("");
    setBenchmarkResult(null);
    setCompareRequestId(requestId);
    setCompareProgressByTargetId({});
    try {
      const response = await fetch("/api/agent/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          targetIds: compareTargetIds,
          input,
          messages: historyMessages,
          systemPrompt,
          compareIntent,
          compareOutputShape,
          enableTools,
          enableRetrieval,
          contextWindow,
          providerProfile,
          thinkingMode
        })
      });
      const payload = (await response.json()) as AgentCompareResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Compare run failed.");
      }
      setCompareResult(payload);
      setCompareRequestId(payload.requestId || requestId);
      setCompareBaseTargetId(payload.results[0]?.targetId || "");
    } catch (compareRunError) {
      setCompareError(compareRunError instanceof Error ? compareRunError.message : "Compare run failed.");
    } finally {
      setComparePending(false);
    }
  }, [
    compareIntent,
    compareOutputShape,
    compareTargetIds,
    contextWindow,
    enableRetrieval,
    enableTools,
    historyMessages,
    input,
    locale,
    providerProfile,
    setBenchmarkError,
    setBenchmarkResult,
    setCompareBaseTargetId,
    setCompareError,
    setComparePending,
    setCompareProgressByTargetId,
    setCompareRequestId,
    setCompareResult,
    systemPrompt,
    thinkingMode
  ]);

  const handleRerunCompareLane = useCallback(
    async (targetId: string) => {
      if (!targetId) return;

      const requestId = crypto.randomUUID();
      setComparePending(true);
      setCompareError("");
      setBenchmarkError("");
      setBenchmarkResult(null);
      setCompareRequestId(requestId);
      setCompareProgressByTargetId((current) => {
        const next = { ...current };
        delete next[targetId];
        return next;
      });
      try {
        const response = await fetch("/api/agent/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId,
            targetIds: [targetId],
            input,
            messages: historyMessages,
            systemPrompt,
            compareIntent,
            compareOutputShape,
            enableTools,
            enableRetrieval,
            contextWindow,
            providerProfile,
            thinkingMode
          })
        });
        const payload = (await response.json()) as AgentCompareResponse & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Lane rerun failed.");
        }
        setCompareRequestId(payload.requestId || requestId);

        const nextLane = payload.results[0];
        if (!nextLane) {
          throw new Error("Lane rerun returned no result.");
        }

        setCompareResult((current) => {
          if (!current?.results.length) return payload;
          const nextResults = current.results.map((lane) => (lane.targetId === targetId ? nextLane : lane));
          return {
            ...current,
            ok: nextResults.some((lane) => lane.ok),
            generatedAt: payload.generatedAt,
            results: nextResults,
            warning: payload.warning || current.warning
          };
        });
      } catch (rerunError) {
        setCompareError(rerunError instanceof Error ? rerunError.message : "Lane rerun failed.");
      } finally {
        setComparePending(false);
      }
    },
    [
      compareIntent,
      compareOutputShape,
      contextWindow,
      enableRetrieval,
      enableTools,
      historyMessages,
      input,
      providerProfile,
      setBenchmarkError,
      setBenchmarkResult,
      setCompareError,
      setComparePending,
      setCompareProgressByTargetId,
      setCompareRequestId,
      setCompareResult,
      systemPrompt,
      thinkingMode
    ]
  );

  const handleSendCompareToBenchmark = useCallback(async () => {
    if (!compareResult?.results.length) {
      setBenchmarkError(locale.startsWith("en") ? "Run compare first." : "请先运行一次 compare。");
      return;
    }

    const compareShare = await loadCompareShareModule();
    const comparePrompt = compareShare.buildCompareBenchmarkPrompt({
      input,
      systemPrompt,
      compareOutputShape,
      compareBenchmarkUseOutputContract
    });
    const compareRunNote = compareShare.serializeCompareResultAsCompactMarkdown({
      compareResult,
      compareProgressByTargetId,
      compareBaseTargetId,
      prompt: input,
      systemPrompt
    });

    setBenchmarkPending(true);
    setBenchmarkError("");
    setBenchmarkResult(null);
    try {
      const response = await fetch("/api/admin/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetIds: compareResult.results.map((lane) => lane.targetId),
          benchmarkMode: "prompt",
          prompt: comparePrompt,
          runNote: compareRunNote || undefined,
          runs: 1,
          contextWindow,
          providerProfile,
          thinkingMode
        })
      });
      const payload = (await response.json()) as AgentBenchmarkResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Benchmark handoff failed.");
      }
      setBenchmarkResult(payload);
    } catch (handoffError) {
      setBenchmarkError(handoffError instanceof Error ? handoffError.message : "Benchmark handoff failed.");
    } finally {
      setBenchmarkPending(false);
    }
  }, [
    compareBaseTargetId,
    compareBenchmarkUseOutputContract,
    compareOutputShape,
    compareProgressByTargetId,
    compareResult,
    contextWindow,
    input,
    locale,
    providerProfile,
    setBenchmarkError,
    setBenchmarkPending,
    setBenchmarkResult,
    systemPrompt,
    thinkingMode
  ]);

  const handleRetryCompareLaneRecovery = useCallback(
    async (targetId: string) => {
      if (!compareRequestId) {
        setCompareError(locale.startsWith("en") ? "Run compare first." : "请先运行一次 compare。");
        return;
      }
      const target = agentTargets.find((entry) => entry.id === targetId);
      if (!target || target.execution !== "local") {
        setCompareError(
          locale.startsWith("en") ? "Manual recovery is available only for local lanes." : "手动恢复仅支持本地 lane。"
        );
        return;
      }

      const recoveryDetail = locale.startsWith("en")
        ? `Manual recovery requested for ${target.label}. Restarting the local gateway from Compare.`
        : `已为 ${target.label} 发起手动恢复，Compare 正在重启本地网关。`;
      setCompareRecoveryPendingTargetId(targetId);
      clearCompareRecoveryConfirm();
      setCompareError("");
      try {
        await syncCompareProgressPatch({
          requestId: compareRequestId,
          targetId,
          phase: "recovering",
          detail: recoveryDetail,
          recoveryAction: recoveryDetail,
          recoveryTriggeredAt: new Date().toISOString(),
          recordTimeline: true
        });

        const response = await fetch("/api/agent/runtime/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetId,
            action: "restart"
          })
        });
        const payload = (await response.json()) as AgentRuntimeActionResponse & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || payload.message || "Manual local recovery failed.");
        }

        if (payload.runtime) {
          setCompareRuntimeByTargetId((current) => ({
            ...current,
            [targetId]: payload.runtime as AgentRuntimeStatus
          }));
        }

        const completionDetail = payload.message
          ? `${payload.message} Compare will keep polling this lane.`
          : locale.startsWith("en")
            ? `Local gateway restarted for ${target.label}. Compare will keep polling this lane.`
            : `${target.label} 的本地网关已重启，Compare 会继续轮询这条 lane。`;
        showCompareRecoveryNotice(
          "success",
          locale.startsWith("en")
            ? `${target.label} restarted from Compare. The lane will keep polling until it is ready.`
            : `${target.label} 已在 Compare 中重启，系统会继续轮询直到这条 lane 就绪。`
        );
        await syncCompareProgressPatch({
          requestId: compareRequestId,
          targetId,
          phase: "prewarming",
          detail: completionDetail,
          recoveryAction: payload.message || completionDetail,
          recordTimeline: true
        });
      } catch (recoveryError) {
        const message = recoveryError instanceof Error ? recoveryError.message : "Manual local recovery failed.";
        setCompareError(message);
        showCompareRecoveryNotice("warning", message, 7000);
        try {
          await syncCompareProgressPatch({
            requestId: compareRequestId,
            targetId,
            phase: "failed",
            detail: message,
            warning: message,
            recordTimeline: true
          });
        } catch {
          // Ignore secondary sync failures. The primary error is already surfaced.
        }
      } finally {
        setCompareRecoveryPendingTargetId("");
        startCompareRecoveryCooldown(targetId);
      }
    },
    [
      agentTargets,
      clearCompareRecoveryConfirm,
      compareRequestId,
      locale,
      setCompareError,
      setCompareRecoveryPendingTargetId,
      setCompareRuntimeByTargetId,
      showCompareRecoveryNotice,
      startCompareRecoveryCooldown,
      syncCompareProgressPatch
    ]
  );

  const requestRetryCompareLaneRecovery = useCallback(
    async (targetId: string) => {
      const cooldownUntil = compareRecoveryCooldownByTargetId[targetId] || 0;
      if (cooldownUntil > Date.now()) {
        return;
      }
      if (compareRecoveryConfirmTargetId !== targetId) {
        armCompareRecoveryConfirm(targetId);
        return;
      }
      clearCompareRecoveryConfirm();
      await handleRetryCompareLaneRecovery(targetId);
    },
    [
      armCompareRecoveryConfirm,
      clearCompareRecoveryConfirm,
      compareRecoveryConfirmTargetId,
      compareRecoveryCooldownByTargetId,
      handleRetryCompareLaneRecovery
    ]
  );

  const buildCompareMarkdownContent = useCallback(
    async (laneTargetIds?: string[]) => {
      if (!compareResult) return "";
      const compareShare = await loadCompareShareModule();
      return compareShare.serializeCompareResultAsMarkdown({
        compareResult,
        compareProgressByTargetId,
        compareBaseTargetId,
        laneTargetIds,
        prompt: input,
        systemPrompt,
        contextWindow,
        providerProfile,
        thinkingMode,
        enableTools,
        enableRetrieval
      });
    },
    [
      compareBaseTargetId,
      compareProgressByTargetId,
      compareResult,
      contextWindow,
      enableRetrieval,
      enableTools,
      input,
      providerProfile,
      systemPrompt,
      thinkingMode
    ]
  );

  const handleExportCompareMarkdown = useCallback(async () => {
    if (!compareResult) return;
    const content = await buildCompareMarkdownContent();

    const blob = new Blob([content], {
      type: "text/markdown;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `compare-${compareResult.runId}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [buildCompareMarkdownContent, compareResult]);

  const handleExportCompareLaneMarkdown = useCallback(
    async (targetId: string) => {
      if (!compareResult) return;
      const lane = compareResult.results.find((entry) => entry.targetId === targetId);
      if (!lane) return;
      const content = await buildCompareMarkdownContent([targetId]);

      const blob = new Blob([content], {
        type: "text/markdown;charset=utf-8"
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `compare-${compareResult.runId}-${targetId}.md`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [buildCompareMarkdownContent, compareResult]
  );

  const handleCopyCompareMarkdown = useCallback(async () => {
    if (!compareResult) return;
    const compareShare = await loadCompareShareModule();
    await copyText(
      compareShare.serializeCompareResultAsCompactMarkdown({
        compareResult,
        compareProgressByTargetId,
        compareBaseTargetId,
        prompt: input,
        systemPrompt
      }),
      "compare:markdown"
    );
  }, [compareBaseTargetId, compareProgressByTargetId, compareResult, copyText, input, systemPrompt]);

  const handleCopyCompareLaneMarkdown = useCallback(
    async (targetId: string) => {
      if (!compareResult) return;
      const compareShare = await loadCompareShareModule();
      await copyText(
        compareShare.serializeCompareResultAsCompactMarkdown({
          compareResult,
          compareProgressByTargetId,
          compareBaseTargetId,
          laneTargetIds: [targetId],
          prompt: input,
          systemPrompt
        }),
        `compare:lane-markdown:${targetId}`
      );
    },
    [compareBaseTargetId, compareProgressByTargetId, compareResult, copyText, input, systemPrompt]
  );

  const handleCopyCompareLaneReviewSummary = useCallback(
    async (targetId: string) => {
      if (!compareResult) return;
      const compareShare = await loadCompareShareModule();
      await copyText(
        compareShare.serializeCompareLaneReviewSummary({
          compareResult,
          compareProgressByTargetId,
          compareBaseTargetId,
          targetId,
          tone: compareReviewSummaryTone,
          detailMode: compareReviewSummaryDetail
        }),
        `compare:lane-summary:${targetId}`
      );
    },
    [
      compareBaseTargetId,
      compareProgressByTargetId,
      compareResult,
      compareReviewSummaryDetail,
      compareReviewSummaryTone,
      copyText
    ]
  );

  const handlePreviewCompareLaneMarkdown = useCallback(
    async (targetId: string) => {
      if (!compareResult) return;
      const lane = compareResult.results.find((entry) => entry.targetId === targetId);
      if (!lane) return;
      const compareShare = await loadCompareShareModule();
      const html = compareShare.buildMarkdownPreviewHtml(
        locale,
        `${lane.targetLabel} export preview`,
        await buildCompareMarkdownContent([targetId])
      );
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    [buildCompareMarkdownContent, compareResult, locale]
  );

  useEffect(() => {
    return () => {
      if (compareRecoveryConfirmTimeoutRef.current) {
        clearTimeout(compareRecoveryConfirmTimeoutRef.current);
      }
      if (compareRecoveryNoticeTimeoutRef.current) {
        clearTimeout(compareRecoveryNoticeTimeoutRef.current);
      }
    };
  }, []);

  return {
    handleRunCompare,
    handleRerunCompareLane,
    handleSendCompareToBenchmark,
    requestRetryCompareLaneRecovery,
    handleExportCompareMarkdown,
    handleExportCompareLaneMarkdown,
    handleCopyCompareMarkdown,
    handleCopyCompareLaneMarkdown,
    handleCopyCompareLaneReviewSummary,
    handlePreviewCompareLaneMarkdown
  };
}
