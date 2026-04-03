"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { agentTargets, agentToolSpecs } from "@/lib/agent/catalog";
import { useLocale } from "@/components/layout/LocaleProvider";
import {
  getDefaultSystemPromptForLocale,
  getLocalizedStarterPrompts,
  getLocalizedTargetDescription,
  getLocalizedToolDescription
} from "@/lib/i18n";
import { clampContextWindowForTarget } from "@/lib/agent/metrics";
import type {
  AgentCacheMode,
  AgentChatResponse,
  AgentConnectionCheckResponse,
  AgentConnectionCheckStage,
  AgentGroundedVerification,
  AgentMessage,
  AgentProviderProfile,
  AgentRetrievalSummary,
  AgentThinkingMode,
  AgentRuntimeActionResponse,
  AgentRuntimePrewarmAllResponse,
  AgentRuntimePrewarmResponse,
  AgentRuntimeStatus,
  AgentTarget,
  AgentToolDecisionResponse,
  AgentToolRun
} from "@/lib/agent/types";

type AgentTurn = {
  id: string;
  kind?: "chat" | "check";
  targetId: string;
  prompt: string;
  displayPrompt?: string;
  response: string;
  providerLabel: string;
  targetLabel: string;
  resolvedModel: string;
  resolvedBaseUrl: string;
  providerProfile?: AgentProviderProfile;
  thinkingMode?: AgentThinkingMode;
  thinkingFallbackToStandard?: boolean;
  localFallbackUsed?: boolean;
  localFallbackTargetId?: string;
  localFallbackTargetLabel?: string;
  localFallbackReason?: string;
  cacheHit?: boolean;
  cacheMode?: AgentCacheMode;
  plannerSteps?: string[];
  memorySummary?: string;
  retrieval?: AgentRetrievalSummary;
  verification?: AgentGroundedVerification;
  toolRuns: AgentToolRun[];
  warning?: string;
  connectionCheck?: AgentConnectionCheckResponse;
  replaySource?: {
    turnId: string;
    targetId: string;
    targetLabel: string;
    resolvedModel: string;
    response: string;
    includeHistory: boolean;
    targetMode: "original" | "current";
  };
};

type StoredAgentSession = {
  id: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
  selectedTargetId: string;
  enableTools: boolean;
  enableRetrieval: boolean;
  contextWindow: number;
  providerProfile: AgentProviderProfile;
  thinkingMode: AgentThinkingMode;
  input: string;
  systemPrompt: string;
  turns: AgentTurn[];
  connectionChecksByTargetId: Record<string, AgentConnectionCheckResponse>;
};

type ParsedToolOutput = Record<string, unknown>;
type ToolReviewItem = {
  key: string;
  toolName: string;
  status: string;
  affectedFiles: string[];
  diffPreview: string;
  contentPreview: string;
  verificationEntries: Array<Record<string, unknown>>;
  files: Array<{
    path: string;
    diffPreview: string;
    contentPreview: string;
    changed: boolean | null;
    existedBefore: boolean | null;
    existsAfter: boolean | null;
  }>;
  verified: boolean | null;
  confirmationRequired: boolean;
  confirmationUsed: boolean;
  errorText: string;
};

type WorkspaceFileView = {
  path: string;
  absolutePath?: string;
  content?: string;
  truncated?: boolean;
  loading: boolean;
  error?: string;
};

type FocusedFileExcerpt = {
  startLine: number;
  endLine: number;
  content: string;
};

const RUNTIME_SWITCH_HISTORY_STORAGE_KEY = "local-agent-runtime-switch-history-v1";

type RuntimeSwitchHistoryEntry = {
  loadMs: number | null;
  switchedAt: string | null;
};

type WorkspaceFileFocusState = {
  path: string;
  anchors: number[];
  index: number;
};
type AgentStreamEvent =
  | {
      type: "meta";
      targetId: string;
      targetLabel: string;
      providerLabel: string;
      resolvedModel: string;
      resolvedBaseUrl: string;
      execution: "local" | "remote";
      providerProfile?: AgentProviderProfile;
      thinkingMode?: AgentThinkingMode;
      thinkingFallbackToStandard?: boolean;
      localFallbackUsed?: boolean;
      localFallbackTargetId?: string;
      localFallbackTargetLabel?: string;
      localFallbackReason?: string;
      cacheHit?: boolean;
      cacheMode?: AgentCacheMode;
      plannerSteps?: string[];
      memorySummary?: string;
      retrieval?: AgentRetrievalSummary;
      verification?: AgentGroundedVerification;
    }
  | { type: "delta"; delta: string }
  | {
      type: "done";
      content: string;
      toolRuns?: AgentToolRun[];
      providerProfile?: AgentProviderProfile;
      thinkingMode?: AgentThinkingMode;
      thinkingFallbackToStandard?: boolean;
      localFallbackUsed?: boolean;
      localFallbackTargetId?: string;
      localFallbackTargetLabel?: string;
      localFallbackReason?: string;
      cacheHit?: boolean;
      cacheMode?: AgentCacheMode;
      plannerSteps?: string[];
      memorySummary?: string;
      retrieval?: AgentRetrievalSummary;
      verification?: AgentGroundedVerification;
      warning?: string;
      usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    }
  | { type: "error"; error: string };

const CONTEXT_WINDOW_OPTIONS = [4096, 8192, 16384, 32768];
const PROVIDER_PROFILE_OPTIONS: AgentProviderProfile[] = ["speed", "balanced", "tool-first"];
const THINKING_MODE_OPTIONS: AgentThinkingMode[] = ["standard", "thinking"];
const PREFERENCES_STORAGE_KEY = "agent-workbench:v1";
const SESSIONS_STORAGE_KEY = "agent-workbench:sessions:v1";
const MAX_STORED_SESSIONS = 12;
const SERVER_SESSION_SYNC_DEBOUNCE_MS = 1200;

function clampUiContextWindow(
  targetId: string,
  contextWindow: number,
  enableTools: boolean,
  enableRetrieval: boolean
) {
  return clampContextWindowForTarget(targetId, contextWindow, {
    enableTools,
    enableRetrieval
  });
}

function sortSessions(sessions: StoredAgentSession[]) {
  return [...sessions].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function normalizeStoredSessions(input: unknown): StoredAgentSession[] {
  if (!Array.isArray(input)) return [];
  return sortSessions(
    input.flatMap((session) => {
      if (!session || typeof session !== "object") return [];
      const candidate = session as Partial<StoredAgentSession>;
      if (typeof candidate.id !== "string" || typeof candidate.updatedAt !== "string") return [];
      return [{
        id: candidate.id,
        title: typeof candidate.title === "string" ? candidate.title : "New session",
        updatedAt: candidate.updatedAt,
        pinned: Boolean(candidate.pinned),
        selectedTargetId:
          typeof candidate.selectedTargetId === "string" ? candidate.selectedTargetId : "anthropic-claude",
        enableTools: Boolean(candidate.enableTools),
        enableRetrieval: Boolean(candidate.enableRetrieval),
        contextWindow: typeof candidate.contextWindow === "number" ? candidate.contextWindow : 32768,
        providerProfile: PROVIDER_PROFILE_OPTIONS.includes(candidate.providerProfile as AgentProviderProfile)
          ? (candidate.providerProfile as AgentProviderProfile)
          : "balanced",
        thinkingMode: THINKING_MODE_OPTIONS.includes(candidate.thinkingMode as AgentThinkingMode)
          ? (candidate.thinkingMode as AgentThinkingMode)
          : "standard",
        input: typeof candidate.input === "string" ? candidate.input : "",
        systemPrompt: typeof candidate.systemPrompt === "string" ? candidate.systemPrompt : "",
        turns: Array.isArray(candidate.turns) ? (candidate.turns as AgentTurn[]) : [],
        connectionChecksByTargetId:
          candidate.connectionChecksByTargetId && typeof candidate.connectionChecksByTargetId === "object"
            ? (candidate.connectionChecksByTargetId as Record<string, AgentConnectionCheckResponse>)
            : {}
      }];
    })
  ).slice(0, MAX_STORED_SESSIONS);
}

function mergeStoredSessions(localSessions: StoredAgentSession[], remoteSessions: StoredAgentSession[]) {
  const merged = new Map<string, StoredAgentSession>();
  for (const session of [...localSessions, ...remoteSessions]) {
    const existing = merged.get(session.id);
    if (!existing || session.updatedAt >= existing.updatedAt) {
      merged.set(session.id, session);
    }
  }
  return sortSessions([...merged.values()]).slice(0, MAX_STORED_SESSIONS);
}

function filterSessionsForExport(
  sessions: StoredAgentSession[],
  options: {
    scope: "visible" | "pinned";
    sessionTargetFilter: string;
    sessionSearch: string;
  }
) {
  const normalizedSearch = options.sessionSearch.trim().toLowerCase();
  return sortSessions(
    sessions.filter((session) => {
      if (options.scope === "pinned") {
        return Boolean(session.pinned);
      }
      if (options.sessionTargetFilter !== "all" && session.selectedTargetId !== options.sessionTargetFilter) {
        return false;
      }
      if (!normalizedSearch) return true;
      return (
        session.title.toLowerCase().includes(normalizedSearch) ||
        session.selectedTargetId.toLowerCase().includes(normalizedSearch)
      );
    })
  );
}

function buildSessionExportEnvelope(
  sessions: StoredAgentSession[],
  options: {
    scope: "visible" | "pinned";
    sessionTargetFilter: string;
    sessionSearch: string;
  }
) {
  return {
    kind: "agent-session-export",
    schemaVersion: "0.2.1",
    generatedAt: new Date().toISOString(),
    filters: {
      scope: options.scope,
      sessionTargetFilter: options.sessionTargetFilter,
      sessionSearch: options.sessionSearch
    },
    sessions
  };
}

function createSessionTitle(turns: AgentTurn[], fallback = "New session") {
  const firstPrompt = turns.find((turn) => turn.kind !== "check")?.displayPrompt
    || turns.find((turn) => turn.kind !== "check")?.prompt
    || turns[0]?.displayPrompt
    || turns[0]?.prompt
    || "";
  const normalized = firstPrompt.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
}

function flattenTurns(turns: AgentTurn[]): AgentMessage[] {
  return turns
    .filter((turn) => turn.kind !== "check")
    .flatMap((turn) => [
      { role: "user", content: turn.prompt },
      { role: "assistant", content: turn.response }
    ]);
}

function parseToolOutput(output: string): ParsedToolOutput | null {
  try {
    const parsed = JSON.parse(output) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ParsedToolOutput)
      : null;
  } catch {
    return null;
  }
}

function readStringField(source: ParsedToolOutput | null, key: string) {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value : "";
}

function readBooleanField(source: ParsedToolOutput | null, key: string) {
  return typeof source?.[key] === "boolean" ? Boolean(source[key]) : null;
}

function readVerificationField(source: ParsedToolOutput | null) {
  const value = source?.verification;
  return Array.isArray(value) ? value : [];
}

function describeRuntimePhase(runtime: AgentRuntimeStatus | null, locale: string) {
  const phase = runtime?.phase || "offline";
  switch (phase) {
    case "remote":
      return {
        label: locale.startsWith("en") ? "Remote" : "远端",
        className: "bg-violet-400/15 text-violet-200"
      };
    case "ready":
      return {
        label: locale.startsWith("en") ? "Ready" : "已就绪",
        className: "bg-emerald-400/15 text-emerald-200"
      };
    case "busy":
      return {
        label: locale.startsWith("en") ? "Busy" : "处理中",
        className: "bg-amber-400/15 text-amber-200"
      };
    case "loading":
      return {
        label: locale.startsWith("en") ? "Loading" : "加载中",
        className: "bg-amber-400/15 text-amber-200"
      };
    case "recovering":
      return {
        label: locale.startsWith("en") ? "Recovering" : "恢复中",
        className: "bg-cyan-400/15 text-cyan-200"
      };
    case "error":
      return {
        label: locale.startsWith("en") ? "Error" : "异常",
        className: "bg-rose-400/15 text-rose-200"
      };
    default:
      return {
        label: locale.startsWith("en") ? "Offline" : "离线",
        className: "bg-rose-400/15 text-rose-200"
      };
  }
}

function buildRuntimeStageItems(runtime: AgentRuntimeStatus | null, locale: string) {
  const labels = locale.startsWith("en")
    ? {
        offline: "Offline",
        recovering: "Recovering",
        loading: "Loading",
        busy: "Busy",
        ready: "Ready"
      }
    : {
        offline: "离线",
        recovering: "恢复中",
        loading: "加载中",
        busy: "处理中",
        ready: "已就绪"
      };
  const steps: Array<keyof typeof labels> = ["offline", "recovering", "loading", "busy", "ready"];
  const phase = runtime?.phase || "offline";
  const phaseIndex = steps.indexOf(phase as keyof typeof labels);
  return steps.map((step, index) => ({
    key: step,
    label: labels[step],
    active: step === phase,
    completed: phase !== "error" && phaseIndex >= 0 && index < phaseIndex
  }));
}

function formatRuntimeDuration(ms: number | null | undefined) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function formatRuntimeTimestamp(timestamp: string | null | undefined, locale: string) {
  if (!timestamp) return "—";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(locale);
}

function describeRuntimeAlias(alias: string | null | undefined, targets: AgentTarget[]) {
  if (!alias) return "—";
  const matched = targets.find((target) => target.id === alias);
  return matched ? `${matched.label}` : alias;
}

function readNumberField(source: ParsedToolOutput | null, key: string) {
  const value = source?.[key];
  return typeof value === "number" ? value : null;
}

function formatCacheMode(mode: AgentCacheMode | undefined) {
  switch (mode) {
    case "exact":
      return "exact";
    case "semantic":
      return "semantic";
    default:
      return "";
  }
}

function readArrayField(source: ParsedToolOutput | null, key: string) {
  const value = source?.[key];
  return Array.isArray(value) ? value : [];
}

function readObjectArrayField(source: ParsedToolOutput | null, key: string) {
  const value = source?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry === "object") as Array<Record<string, unknown>>;
}

function splitDiffPreviewByFile(diffPreview: string) {
  if (!diffPreview.trim()) return new Map<string, string>();
  const sections = diffPreview.split(/^diff --git /m).filter(Boolean);
  const chunks = new Map<string, string>();

  sections.forEach((section) => {
    const normalized = section.startsWith("a/")
      ? `diff --git ${section}`
      : `diff --git ${section}`;
    const lines = normalized.split("\n");
    const header = lines[0] || "";
    const match = header.match(/^diff --git a\/(.+?) b\/(.+)$/);
    const path = match?.[2] || match?.[1];
    if (!path) return;
    chunks.set(path, normalized.trim());
  });

  return chunks;
}

function readFirstNewFileLineFromDiff(diffPreview: string) {
  if (!diffPreview.trim()) return null;
  const match = diffPreview.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/m);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readNewFileLineAnchorsFromDiff(diffPreview: string) {
  if (!diffPreview.trim()) return [];
  const matches = [...diffPreview.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm)];
  return matches
    .map((match) => Number(match[1]))
    .filter((value, index, list) => Number.isFinite(value) && value > 0 && list.indexOf(value) === index);
}

function buildFocusedFileExcerpt(content: string, lineNumber: number, radius = 16): FocusedFileExcerpt {
  const lines = content.split("\n");
  const startLine = Math.max(1, lineNumber - radius);
  const endLine = Math.min(lines.length, lineNumber + radius);
  return {
    startLine,
    endLine,
    content: lines
      .slice(startLine - 1, endLine)
      .map((line, index) => `${String(startLine + index).padStart(4, " ")} | ${line}`)
      .join("\n")
  };
}

function buildReplayComparison(turn: AgentTurn, locale: string) {
  if (!turn.replaySource) return null;
  const originalResponse = turn.replaySource.response.trim();
  const replayResponse = turn.response.trim();
  const sameTarget = turn.replaySource.targetId === turn.targetId;
  const sameResponse = originalResponse === replayResponse;
  const sameOpening =
    !sameResponse &&
    originalResponse.slice(0, 120) &&
    originalResponse.slice(0, 120) === replayResponse.slice(0, 120);
  const responseDelta = replayResponse.length - originalResponse.length;
  const originalLines = originalResponse.split("\n").map((line) => line.trim());
  const replayLines = replayResponse.split("\n").map((line) => line.trim());
  const maxLines = Math.max(originalLines.length, replayLines.length);
  const keyDiffs: string[] = [];
  for (let index = 0; index < maxLines && keyDiffs.length < 3; index += 1) {
    const originalLine = originalLines[index] || "";
    const replayLine = replayLines[index] || "";
    if (originalLine === replayLine) continue;
    if (!originalLine && replayLine) {
      keyDiffs.push(
        locale.startsWith("en")
          ? `Replay added: ${replayLine.slice(0, 80)}`
          : `回放新增：${replayLine.slice(0, 80)}`
      );
      continue;
    }
    if (originalLine && !replayLine) {
      keyDiffs.push(
        locale.startsWith("en")
          ? `Replay omitted: ${originalLine.slice(0, 80)}`
          : `回放省略：${originalLine.slice(0, 80)}`
      );
      continue;
    }
    keyDiffs.push(
      locale.startsWith("en")
        ? `Changed "${originalLine.slice(0, 40)}" -> "${replayLine.slice(0, 40)}"`
        : `已变化：“${originalLine.slice(0, 20)}” -> “${replayLine.slice(0, 20)}”`
    );
  }

  return {
    sourceLabel: `${turn.replaySource.targetLabel} · ${turn.replaySource.resolvedModel}`,
    replayModeLabel: turn.replaySource.includeHistory
      ? locale.startsWith("en")
        ? "Context replay"
        : "上下文回放"
      : locale.startsWith("en")
        ? "Clean replay"
        : "干净回放",
    targetModeLabel: turn.replaySource.targetMode === "original"
      ? locale.startsWith("en")
        ? "Original target"
        : "保留原目标"
      : locale.startsWith("en")
        ? "Current target"
        : "切换目标回放",
    summary: sameResponse
      ? locale.startsWith("en")
        ? "Replay response matches the original turn."
        : "回放结果与原轮响应一致。"
      : sameOpening
        ? locale.startsWith("en")
          ? "Replay starts similarly but diverges later."
          : "回放开头相近，但后续结果出现分歧。"
        : locale.startsWith("en")
          ? "Replay response differs noticeably from the original turn."
          : "回放结果与原轮存在明显差异。",
    responseDelta,
    keyDiffs
  };
}

function buildReplayComparisonSummaryText(
  comparison: ReturnType<typeof buildReplayComparison>,
  locale: string
) {
  if (!comparison) return "";
  return [
    locale.startsWith("en") ? "Replay compare" : "回放对比",
    comparison.sourceLabel,
    `${comparison.replayModeLabel} · ${comparison.targetModeLabel}`,
    `${locale.startsWith("en") ? "Response delta" : "响应长度变化"}: ${comparison.responseDelta > 0 ? "+" : ""}${comparison.responseDelta}`,
    comparison.summary,
    ...comparison.keyDiffs.map((diff, index) =>
      `${locale.startsWith("en") ? "Diff" : "差异"} ${index + 1}: ${diff}`
    )
  ].join("\n");
}

function collectToolReviewItems(turn: AgentTurn) {
  return turn.toolRuns.flatMap((toolRun, index) => {
    const parsed = parseToolOutput(toolRun.output);
    const diffPreview = readStringField(parsed, "diffPreview");
    const contentPreview = readStringField(parsed, "contentPreview");
    const verificationEntries = readObjectArrayField(parsed, "verification");
    const affectedFiles = readArrayField(parsed, "affectedFiles").filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
    );
    const verified = readBooleanField(parsed, "verified");
    const confirmationUsed = Boolean(readBooleanField(parsed, "confirmationUsed"));
    const confirmationRequired = readStringField(parsed, "status") === "confirmation_required";
    const errorText = readStringField(parsed, "error");
    const diffByFile = splitDiffPreviewByFile(diffPreview);
    const files = verificationEntries.map((entry) => ({
      path: typeof entry.path === "string" ? entry.path : "",
      diffPreview:
        typeof entry.path === "string" && diffByFile.has(entry.path)
          ? diffByFile.get(entry.path) || ""
          : "",
      contentPreview: typeof entry.contentPreview === "string" ? entry.contentPreview : "",
      changed: typeof entry.changed === "boolean" ? entry.changed : null,
      existedBefore: typeof entry.existedBefore === "boolean" ? entry.existedBefore : null,
      existsAfter: typeof entry.existsAfter === "boolean" ? entry.existsAfter : null
    })).filter((entry) => entry.path);

    if (!diffPreview && !contentPreview && !verificationEntries.length && !affectedFiles.length) {
      return [];
    }

    return [{
      key: `${turn.id}:review:${index}`,
      toolName: toolRun.name,
      status: readStringField(parsed, "status") || "completed",
      affectedFiles,
      diffPreview,
      contentPreview,
      verificationEntries,
      files,
      verified,
      confirmationRequired,
      confirmationUsed,
      errorText
    }];
  });
}

function formatConnectionStageLabel(stageId: AgentConnectionCheckStage["id"]) {
  switch (stageId) {
    case "models":
      return "models";
    case "chat":
      return "chat";
    case "tool_calls":
      return "tool calls";
    default:
      return stageId;
  }
}

function formatGroundedVerdictLabel(
  verification: AgentGroundedVerification | undefined,
  labels: {
    grounded: string;
    weaklyGrounded: string;
    unsupported: string;
    notApplicable: string;
  }
) {
  switch (verification?.verdict) {
    case "grounded":
      return labels.grounded;
    case "weakly-grounded":
      return labels.weaklyGrounded;
    case "unsupported":
      return labels.unsupported;
    case "not-applicable":
    default:
      return labels.notApplicable;
  }
}

function formatGroundedFallbackReason(
  reason: AgentGroundedVerification["fallbackReason"] | undefined,
  labels: {
    noEvidence: string;
    lowConfidence: string;
    missingCitations: string;
    unsupportedClaims: string;
  }
) {
  switch (reason) {
    case "no-evidence":
      return labels.noEvidence;
    case "low-confidence":
      return labels.lowConfidence;
    case "missing-citations":
      return labels.missingCitations;
    case "unsupported-claims":
      return labels.unsupportedClaims;
    default:
      return "";
  }
}

function formatGroundedNote(
  note: string,
  labels: {
    retrievalDisabled: string;
    noEvidence: string;
    unsupportedCitations: string;
    missingCitations: string;
    lowConfidence: string;
    weakOverlap: string;
  }
) {
  switch (note) {
    case "retrieval-disabled":
      return labels.retrievalDisabled;
    case "no-evidence":
      return labels.noEvidence;
    case "unsupported-citations":
      return labels.unsupportedCitations;
    case "missing-citations":
      return labels.missingCitations;
    case "low-confidence":
      return labels.lowConfidence;
    case "weak-overlap":
      return labels.weakOverlap;
    default:
      return note;
  }
}

function formatLocalFallbackReason(
  reason: string | undefined,
  labels: {
    loading: string;
    health: string;
    empty: string;
    failure: string;
    simple: string;
  }
) {
  switch (reason) {
    case "primary-local-still-loading":
      return labels.loading;
    case "primary-local-health-warning":
      return labels.health;
    case "empty-visible-answer":
      return labels.empty;
    case "primary-local-failure":
      return labels.failure;
    case "simple-local-route":
      return labels.simple;
    default:
      return reason || "";
  }
}

function formatTargetModelVersion(
  modelDefault: string,
  thinkingModelDefault?: string
) {
  if (thinkingModelDefault && thinkingModelDefault !== modelDefault) {
    return `${modelDefault} · Thinking ${thinkingModelDefault}`;
  }
  return modelDefault;
}

function getConnectionStageBadgeClass(ok: boolean) {
  return ok
    ? "bg-emerald-400/15 text-emerald-200"
    : "bg-rose-400/15 text-rose-200";
}

function buildConnectionCheckNarrative(
  check: AgentConnectionCheckResponse,
  labels: {
    title: string;
    overall: string;
    model: string;
    endpoint: string;
    ok: string;
    failed: string;
  }
) {
  const lines = [
    `${labels.title}: ${check.targetLabel}`,
    `${labels.overall}: ${check.ok ? labels.ok : labels.failed}`,
    `${labels.model}: ${check.resolvedModel}`,
    `${labels.endpoint}: ${check.resolvedBaseUrl}`,
    "",
    ...check.stages.map(
      (stage) =>
        `- ${formatConnectionStageLabel(stage.id)}: ${stage.ok ? labels.ok : labels.failed} · ${stage.latencyMs} ms · ${stage.summary}`
    )
  ];
  return lines.join("\n");
}

function buildTurnMarkdownLines(turns: AgentTurn[]) {
  const lines: string[] = [];
  for (const turn of turns) {
    lines.push(`## ${turn.targetLabel} · ${turn.providerLabel}`);
    lines.push("");
    lines.push(`- Resolved model: ${turn.resolvedModel}`);
    lines.push(`- Resolved endpoint: ${turn.resolvedBaseUrl}`);
    if (turn.providerProfile) {
      lines.push(`- Provider profile used: ${turn.providerProfile}`);
    }
    if (turn.thinkingMode) {
      lines.push(`- Thinking mode used: ${turn.thinkingMode}`);
    }
    if (turn.localFallbackUsed) {
      lines.push(`- Local fallback used: yes`);
      if (turn.localFallbackTargetLabel) {
        lines.push(`- Fallback target: ${turn.localFallbackTargetLabel}`);
      }
      if (turn.localFallbackReason) {
        lines.push(`- Fallback reason: ${turn.localFallbackReason}`);
      }
    }
    if (turn.retrieval) {
      lines.push(`- Retrieval hits: ${turn.retrieval.hitCount}`);
      lines.push(`- Retrieval confidence: ${turn.retrieval.lowConfidence ? "low" : "ok"}`);
    }
    if (turn.verification) {
      lines.push(`- Grounded verdict: ${turn.verification.verdict}`);
      lines.push(`- Fallback applied: ${turn.verification.fallbackApplied ? "yes" : "no"}`);
      lines.push(`- Citation count: ${turn.verification.citedLabels.length}`);
    }
    if (turn.cacheHit) {
      lines.push(`- Cache hit: yes${turn.cacheMode ? ` (${turn.cacheMode})` : ""}`);
    }
    if (turn.plannerSteps?.length) {
      lines.push(`- Planner steps: ${turn.plannerSteps.length}`);
    }
    if (turn.providerProfile || turn.thinkingMode || turn.localFallbackUsed || turn.retrieval || turn.verification) {
      lines.push("");
    }
    lines.push("### User");
    lines.push("");
    lines.push("```text");
    lines.push(turn.displayPrompt || turn.prompt);
    lines.push("```");
    lines.push("");

    if (turn.toolRuns.length) {
      lines.push("### Tool Runs");
      lines.push("");
      turn.toolRuns.forEach((toolRun, index) => {
        lines.push(`#### ${index + 1}. ${toolRun.name}`);
        lines.push("");
        lines.push("Input:");
        lines.push("```json");
        lines.push(JSON.stringify(toolRun.input, null, 2));
        lines.push("```");
        lines.push("");
        lines.push("Output:");
        lines.push("```text");
        lines.push(toolRun.output);
        lines.push("```");
        lines.push("");
      });
    }

    if (turn.retrieval?.results.length) {
      lines.push("### Retrieval");
      lines.push("");
      turn.retrieval.results.forEach((result) => {
        lines.push(
          `- ${result.citationLabel} ${result.title}${
            result.sectionPath.length ? ` > ${result.sectionPath.join(" > ")}` : ""
          }${result.source ? ` · ${result.source}` : ""} · score ${result.score.toFixed(2)}`
        );
      });
      lines.push("");
    }

    if (turn.verification) {
      lines.push("### Grounded Verification");
      lines.push("");
      lines.push(`- Verdict: ${turn.verification.verdict}`);
      lines.push(`- Fallback applied: ${turn.verification.fallbackApplied ? "yes" : "no"}`);
      lines.push(`- Lexical grounding score: ${turn.verification.lexicalGroundingScore}`);
      if (turn.verification.fallbackReason) {
        lines.push(`- Fallback reason: ${turn.verification.fallbackReason}`);
      }
      if (turn.verification.citedLabels.length) {
        lines.push(`- Cited labels: ${turn.verification.citedLabels.join(", ")}`);
      }
      if (turn.verification.unsupportedLabels.length) {
        lines.push(`- Unsupported labels: ${turn.verification.unsupportedLabels.join(", ")}`);
      }
      if (turn.verification.notes.length) {
        lines.push("- Notes:");
        turn.verification.notes.forEach((note) => lines.push(`  - ${note}`));
      }
    }
    if (turn.plannerSteps?.length) {
      lines.push("", "### Planner", "");
      turn.plannerSteps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    }
    if (turn.memorySummary) {
      lines.push("", "### Memory", "", turn.memorySummary);
    }
    lines.push("### Assistant");
    lines.push("");
    lines.push("```text");
    lines.push(turn.response);
    lines.push("```");
    lines.push("");
  }

  return lines;
}

function serializeTurnsAsMarkdown(turns: AgentTurn[]) {
  const lines: string[] = [
    "# Agent Transcript",
    "",
    `Generated: ${new Date().toISOString()}`,
    "Export schema: 0.2.1",
    ""
  ];
  lines.push(...buildTurnMarkdownLines(turns));

  return lines.join("\n");
}

function serializeSessionsAsMarkdown(sessions: StoredAgentSession[]) {
  const lines: string[] = [
    "# Agent Sessions",
    "",
    `Generated: ${new Date().toISOString()}`,
    "Export schema: 0.2.1",
    ""
  ];
  for (const session of sessions) {
    lines.push(`## ${session.title}`);
    lines.push("");
    lines.push(`- Target: ${session.selectedTargetId}`);
    lines.push(`- Updated: ${session.updatedAt}`);
    lines.push(`- Context window: ${session.contextWindow}`);
    lines.push(`- Tools: ${session.enableTools ? "enabled" : "disabled"}`);
    lines.push(`- Retrieval: ${session.enableRetrieval ? "enabled" : "disabled"}`);
    lines.push(`- Provider profile: ${session.providerProfile}`);
    lines.push(`- Thinking mode: ${session.thinkingMode}`);
    lines.push(`- Pinned: ${session.pinned ? "yes" : "no"}`);
    lines.push("");
    lines.push(...buildTurnMarkdownLines(session.turns));
    lines.push("");
  }
  return lines.join("\n");
}

function formatContextWindowLabel(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return value >= 1024 ? `${Math.round(value / 1024)}K` : `${value}`;
}

function getHealthBadge(check: AgentConnectionCheckResponse | null) {
  if (!check) {
    return {
      label: "unknown",
      className: "bg-white/5 text-slate-300"
    };
  }

  if (check.ok) {
    return {
      label: "healthy",
      className: "bg-emerald-400/15 text-emerald-200"
    };
  }

  const hasChatFailure = check.stages.some((stage) => !stage.ok && stage.id !== "models");
  return {
    label: hasChatFailure ? "degraded" : "warning",
    className: hasChatFailure ? "bg-rose-400/15 text-rose-200" : "bg-amber-400/15 text-amber-200"
  };
}

export function AgentWorkbench() {
  const { locale, dictionary } = useLocale();
  const starterPrompts = useMemo(() => getLocalizedStarterPrompts(locale), [locale]);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [savedSessions, setSavedSessions] = useState<StoredAgentSession[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionTargetFilter, setSessionTargetFilter] = useState("all");
  const [sessionExportScope, setSessionExportScope] = useState<"visible" | "pinned">("visible");
  const [selectedTargetId, setSelectedTargetId] = useState("anthropic-claude");
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [input, setInput] = useState(() => getLocalizedStarterPrompts("zh-CN")[0]);
  const [systemPrompt, setSystemPrompt] = useState(() => getDefaultSystemPromptForLocale("zh-CN"));
  const [enableTools, setEnableTools] = useState(true);
  const [enableRetrieval, setEnableRetrieval] = useState(false);
  const [contextWindow, setContextWindow] = useState(32768);
  const [providerProfile, setProviderProfile] = useState<AgentProviderProfile>("balanced");
  const [thinkingMode, setThinkingMode] = useState<AgentThinkingMode>("standard");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [runtimeStatus, setRuntimeStatus] = useState<AgentRuntimeStatus | null>(null);
  const [runtimeLastSwitchMsByTarget, setRuntimeLastSwitchMsByTarget] = useState<Record<string, number | null>>({});
  const [runtimeLastSwitchAtByTarget, setRuntimeLastSwitchAtByTarget] = useState<Record<string, string | null>>({});
  const [prewarmPending, setPrewarmPending] = useState(false);
  const [prewarmAllPending, setPrewarmAllPending] = useState(false);
  const [prewarmMessage, setPrewarmMessage] = useState("");
  const [runtimeActionPending, setRuntimeActionPending] = useState<"" | "release" | "restart" | "read_log">("");
  const [runtimeLogExcerpt, setRuntimeLogExcerpt] = useState("");
  const [expandedCitationKey, setExpandedCitationKey] = useState("");
  const [expandedTraceTurnId, setExpandedTraceTurnId] = useState("");
  const [expandedReviewFileKey, setExpandedReviewFileKey] = useState("");
  const [openWorkspaceFilePath, setOpenWorkspaceFilePath] = useState("");
  const [focusedWorkspaceFilePath, setFocusedWorkspaceFilePath] = useState("");
  const [workspaceFileFocusState, setWorkspaceFileFocusState] = useState<WorkspaceFileFocusState | null>(null);
  const [workspaceFileViews, setWorkspaceFileViews] = useState<Record<string, WorkspaceFileView>>({});
  const [replayTargetMode, setReplayTargetMode] = useState<"original" | "current">("original");
  const [toolDecisionBusyKey, setToolDecisionBusyKey] = useState("");
  const [toolDecisionStatusByToken, setToolDecisionStatusByToken] = useState<Record<string, "approved" | "rejected">>(
    {}
  );
  const [copyState, setCopyState] = useState("");
  const [connectionChecksByTargetId, setConnectionChecksByTargetId] = useState<
    Record<string, AgentConnectionCheckResponse>
  >({});
  const [connectionCheckPending, setConnectionCheckPending] = useState(false);
  const [connectionCheckError, setConnectionCheckError] = useState("");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [serverSessionSyncState, setServerSessionSyncState] = useState<"" | "syncing" | "synced" | "error">("");
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const runtimeRequestInFlightRef = useRef(false);
  const sessionSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedTarget = useMemo(
    () => agentTargets.find((target) => target.id === selectedTargetId) || agentTargets[0],
    [selectedTargetId]
  );
  const runtimePhase = useMemo(() => describeRuntimePhase(runtimeStatus, locale), [runtimeStatus, locale]);
  const runtimeStageItems = useMemo(() => buildRuntimeStageItems(runtimeStatus, locale), [runtimeStatus, locale]);
  const loadedAliasForSelectedTarget =
    runtimeStatus?.loadedAlias === selectedTargetId ? runtimeStatus.loadedAlias : null;
  const gatewayLoadedOtherAlias =
    runtimeStatus?.loadedAlias && runtimeStatus.loadedAlias !== selectedTargetId ? runtimeStatus.loadedAlias : null;
  const selectedTargetLastSwitchMs = runtimeLastSwitchMsByTarget[selectedTargetId] ?? null;
  const selectedTargetLastSwitchAt = runtimeLastSwitchAtByTarget[selectedTargetId] ?? null;
  const lastChatTurn = useMemo(
    () => [...turns].reverse().find((turn) => turn.kind !== "check" && turn.targetId === selectedTargetId),
    [selectedTargetId, turns]
  );
  const sessionTargetOptions = useMemo(
    () =>
      Array.from(new Set(savedSessions.map((session) => session.selectedTargetId)))
        .map((targetId) => ({
          id: targetId,
          label: agentTargets.find((target) => target.id === targetId)?.label || targetId
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [savedSessions]
  );

  const historyMessages = useMemo(() => flattenTurns(turns), [turns]);
  const lastTurn = turns[turns.length - 1];
  const currentSession = useMemo(
    () => savedSessions.find((session) => session.id === sessionId) || null,
    [savedSessions, sessionId]
  );
  const filteredHistorySessions = useMemo(() => {
    const normalizedSearch = sessionSearch.trim().toLowerCase();
    return savedSessions
      .filter((session) => session.id !== sessionId)
      .filter((session) => (sessionTargetFilter === "all" ? true : session.selectedTargetId === sessionTargetFilter))
      .filter((session) =>
        normalizedSearch
          ? session.title.toLowerCase().includes(normalizedSearch)
            || session.selectedTargetId.toLowerCase().includes(normalizedSearch)
          : true
      );
  }, [savedSessions, sessionId, sessionSearch, sessionTargetFilter]);
  const exportableSessions = useMemo(
    () =>
      filterSessionsForExport(savedSessions, {
        scope: sessionExportScope,
        sessionTargetFilter,
        sessionSearch
      }),
    [savedSessions, sessionExportScope, sessionTargetFilter, sessionSearch]
  );
  const sessionGroups = useMemo(() => {
    const groups = new Map<string, StoredAgentSession[]>();
    for (const session of filteredHistorySessions) {
      const key = session.selectedTargetId;
      const current = groups.get(key) || [];
      current.push(session);
      groups.set(key, current);
    }
    return [...groups.entries()].map(([targetId, sessionsInGroup]) => ({
      targetId,
      targetLabel: agentTargets.find((target) => target.id === targetId)?.label || targetId,
      sessions: sessionsInGroup
    }));
  }, [filteredHistorySessions]);
  const supportsConnectionCheck = selectedTarget.execution === "remote" && Boolean(selectedTarget.apiKeyEnv);
  const connectionCheck = connectionChecksByTargetId[selectedTargetId] || null;
  const previousLocaleRef = useRef(locale);
  const sessionSyncLabel = useMemo(() => {
    if (serverSessionSyncState === "syncing") {
      return locale.startsWith("en") ? "Syncing server copy" : "同步服务端快照中";
    }
    if (serverSessionSyncState === "synced") {
      return locale.startsWith("en") ? "Server snapshot synced" : "服务端快照已同步";
    }
    if (serverSessionSyncState === "error") {
      return locale.startsWith("en") ? "Server snapshot unavailable" : "服务端快照暂不可用";
    }
    return locale.startsWith("en") ? "Local-first session storage" : "本地优先会话存储";
  }, [locale, serverSessionSyncState]);
  const uiText = useMemo(() => {
    switch (locale) {
      case "zh-TW":
        return {
          requestFailed: "請求失敗。",
          runtimeFailed: "載入執行時狀態失敗。",
          toolDecisionFailed: "工具決策失敗。",
          connectionCheckFailed: "連線自檢失敗。",
          copyFailed: "複製失敗。",
          resumeFailed: "續跑失敗。",
          noAssistantContent: "提供方未返回可見助手內容，請檢查目標配置後再試。",
          attentionNeeded: "一個或多個自檢階段需要注意。",
          remoteNoQueue: "遠端目標，不提供本地執行佇列。",
          runtimeSerializing: "本地執行時正在串行處理請求。",
          runtimeReady: "本地執行時已就緒。",
          runtimeUnavailable: "本地執行時不可用。",
          approve: "批准",
          approving: "批准中...",
          reject: "拒絕",
          rejecting: "拒絕中...",
          approved: "已批准",
          rejected: "已拒絕",
          confirmationRequired: "需要確認",
          token: "令牌",
          expires: "過期時間",
          resumeAgent: "續跑 Agent",
          diffPreview: "Diff 預覽",
          contentPreview: "內容預覽",
          verification: "校驗",
          repairPatch: "修復補丁",
          rejectArtifacts: "拒絕產物",
          initialFailure: "初始失敗",
          repairAttempt: "修復嘗試",
          standardOutput: "標準輸出",
          standardError: "標準錯誤",
          step: "步驟",
          verified: "已驗證",
          unverified: "未驗證",
          confirmationApproved: "此確認令牌已經批准。",
          confirmationRejected: "此確認令牌已被拒絕。",
          loadedAlias: "已載入別名",
          runtimeMessage: "執行時訊息",
          enterHint: "Enter 送出，Shift+Enter 換行",
          submit: "送出",
          submitting: "處理中...",
          queueLabel: "佇列",
          activeLabel: "活躍",
          fallbackLaunchHint: "遠端目標，不需要本地啟動命令。",
          contextWindow: "上下文體量",
          selectedTargetLabel: "目標",
          executionMode: "執行模式",
          toolLoopState: "工具迴圈",
          enableRetrieval: "檢索增強",
          retrievalHint: "把知識庫命中結果注入系統提示詞，要求回答盡量基於證據並附引用。",
          retrievalGrounding: "檢索證據",
          retrievalHits: "命中數",
          retrievalLowConfidence: "檢索信心偏低，回答應明確標註不確定性。",
          retrievalNoEvidence: "目前沒有可用檢索證據。",
          groundedVerification: "證據校驗",
          groundedVerdict: "校驗結論",
          groundedVerdictGrounded: "已基於證據",
          groundedVerdictWeak: "部分基於證據",
          groundedVerdictUnsupported: "證據不足",
          groundedVerdictNotApplicable: "未啟用",
          groundedFallbackApplied: "已套用保守回退",
          groundedFallbackReason: "回退原因",
          groundedCitations: "引用標籤",
          groundedUnsupportedCitations: "無效引用",
          groundedLexicalScore: "證據重合度",
          groundedNotes: "校驗說明",
          groundedReasonNoEvidence: "沒有檢索到可用證據",
          groundedReasonLowConfidence: "檢索信心偏低",
          groundedReasonMissingCitations: "回答缺少引用",
          groundedReasonUnsupportedClaims: "回答與證據不匹配",
          groundedNoteRetrievalDisabled: "本輪未啟用檢索增強。",
          groundedNoteNoEvidence: "本輪沒有檢索到可用證據。",
          groundedNoteUnsupportedCitations: "回答使用了無效引用標籤。",
          groundedNoteMissingCitations: "回答沒有引用檢索證據。",
          groundedNoteLowConfidence: "檢索信心偏低。",
          groundedNoteWeakOverlap: "回答與證據的詞面重合度偏弱。",
          enabled: "開啟",
          disabled: "關閉",
          runtimeSnapshot: "執行狀態快照",
          prewarmModel: "預熱模型",
          prewarmAllModels: "全部預熱",
          prewarmingAll: "全部預熱中...",
          prewarmAllDone: "全部本地模型預熱已完成。",
          prewarming: "預熱中...",
          prewarmDone: "模型預熱已完成。",
          releaseModel: "釋放模型",
          releasingModel: "釋放中...",
          restartGateway: "重啟網關",
          restartingGateway: "重啟中...",
          viewRuntimeLog: "查看日誌",
          loadingRuntimeLog: "讀取中...",
          supervisor: "守護程序",
          gatewayProcess: "網關程序",
          logExcerpt: "執行日誌",
          runtimeActions: "執行時操作",
          sessions: "會話歷史",
          newSession: "新建會話",
          restoreSession: "恢復會話",
          currentSession: "當前會話",
          sessionSaved: "已自動保存",
          noSessions: "尚無已保存會話",
          renameSession: "重命名",
          deleteSession: "刪除",
          pinSession: "固定",
          unpinSession: "取消固定",
          pinned: "已固定",
          deleteSessionConfirm: "確定刪除此會話？",
          sessionSearch: "搜索会话",
          clearAllSessions: "清空全部",
          clearUnpinnedSessions: "清空未固定",
          targetGroup: "目标分组",
          sessionTargetFilter: "会话目标过滤",
          allTargets: "全部目标",
          exportSessionsMarkdown: "导出会话 Markdown",
          exportSessionsJson: "导出会话 JSON",
          sessionExportScope: "导出范围",
          exportVisibleSessions: "仅当前筛选可见项",
          exportPinnedSessions: "仅固定项",
          providerProfile: "远端提供方档位",
          providerProfileSpeed: "极速",
          providerProfileBalanced: "平衡",
          providerProfileToolFirst: "工具优先",
          autoSpeedHint: "短问答且无工具意图时，会自动降到 speed 以压首字延时。",
          thinkingMode: "思考模式",
          thinkingModeStandard: "标准",
          thinkingModeThinking: "Thinking / 满血版",
          actualResolvedModel: "当前实际解析模型",
          actualProviderProfile: "本次实际采用档位",
          actualThinkingMode: "本次实际采用思考模式",
          fallbackBadge: "已回退",
          thinkingModelFallback: "未配置专用 Thinking 模型，当前回退到标准模型。",
          latencySplit: "上游首字 vs 应用总耗时",
          appOverhead: "应用层额外耗时",
          runtimeLoading: "运行中加载",
          runtimeLoadingElapsed: "已等待",
          runtimeLoadingError: "加载错误",
          runtimeCurrentLoaded: "当前已加载",
          runtimeSwitchingNow: "正在切模",
          runtimeLastSwitchLoad: "最近切换耗时",
          runtimeLastSwitchAt: "最近切模时间",
          runtimeDowngradeHint: "本地 4B 仍在冷加载时，简单问答会自动降到 0.6B 以先给出结果。",
          localFallbackUsed: "本地自动降级",
          localFallbackTarget: "降级目标",
          localFallbackReason: "降级原因",
          localFallbackReasonLoading: "本地 4B 仍在加载",
          localFallbackReasonHealth: "本地 4B 运行时告警",
          localFallbackReasonEmpty: "本地 4B 返回空可见答案",
          localFallbackReasonFailure: "本地 4B 请求失败",
          localFallbackReasonSimple: "简单问答优先走已预热 0.6B"
        };
      case "ko":
        return {
          requestFailed: "요청에 실패했습니다.",
          runtimeFailed: "런타임 상태를 불러오지 못했습니다.",
          toolDecisionFailed: "도구 결정에 실패했습니다.",
          connectionCheckFailed: "연결 점검에 실패했습니다.",
          copyFailed: "복사에 실패했습니다.",
          resumeFailed: "이어 실행에 실패했습니다.",
          noAssistantContent: "표시 가능한 응답이 없습니다. 대상 설정을 확인하세요.",
          attentionNeeded: "하나 이상의 자가 진단 단계에 주의가 필요합니다.",
          remoteNoQueue: "원격 대상이므로 로컬 실행 대기열이 없습니다.",
          runtimeSerializing: "로컬 런타임이 요청을 직렬 처리 중입니다.",
          runtimeReady: "로컬 런타임이 준비되었습니다.",
          runtimeUnavailable: "로컬 런타임을 사용할 수 없습니다.",
          approve: "승인",
          approving: "승인 중...",
          reject: "거부",
          rejecting: "거부 중...",
          approved: "승인됨",
          rejected: "거부됨",
          confirmationRequired: "확인 필요",
          token: "토큰",
          expires: "만료 시각",
          resumeAgent: "Agent 이어 실행",
          diffPreview: "Diff 미리보기",
          contentPreview: "내용 미리보기",
          verification: "검증",
          repairPatch: "복구 패치",
          rejectArtifacts: "거부 산출물",
          initialFailure: "초기 실패",
          repairAttempt: "복구 시도",
          standardOutput: "표준 출력",
          standardError: "표준 오류",
          step: "단계",
          verified: "검증됨",
          unverified: "미검증",
          confirmationApproved: "이 확인 토큰은 이미 승인되었습니다.",
          confirmationRejected: "이 확인 토큰은 거부되었습니다.",
          loadedAlias: "로드된 별칭",
          runtimeMessage: "런타임 메시지",
          enterHint: "Enter 전송, Shift+Enter 줄바꿈",
          submit: "전송",
          submitting: "처리 중...",
          queueLabel: "대기열",
          activeLabel: "활성",
          fallbackLaunchHint: "원격 대상이므로 로컬 부트스트랩 명령이 필요하지 않습니다.",
          contextWindow: "컨텍스트 크기",
          selectedTargetLabel: "대상",
          executionMode: "실행 모드",
          toolLoopState: "도구 루프",
          enableRetrieval: "검색 증강",
          retrievalHint: "지식 베이스 검색 결과를 시스템 프롬프트에 주입해 근거 중심 응답과 인용을 유도합니다.",
          retrievalGrounding: "검색 근거",
          retrievalHits: "히트 수",
          retrievalLowConfidence: "검색 신뢰도가 낮습니다. 답변에서 불확실성을 분명히 밝혀야 합니다.",
          retrievalNoEvidence: "사용 가능한 검색 근거가 없습니다.",
          groundedVerification: "근거 검증",
          groundedVerdict: "검증 결과",
          groundedVerdictGrounded: "근거 기반",
          groundedVerdictWeak: "부분 근거 기반",
          groundedVerdictUnsupported: "근거 부족",
          groundedVerdictNotApplicable: "적용 안 됨",
          groundedFallbackApplied: "보수적 폴백 적용됨",
          groundedFallbackReason: "폴백 사유",
          groundedCitations: "인용 라벨",
          groundedUnsupportedCitations: "유효하지 않은 인용",
          groundedLexicalScore: "근거 중복도",
          groundedNotes: "검증 메모",
          groundedReasonNoEvidence: "사용 가능한 검색 근거 없음",
          groundedReasonLowConfidence: "검색 신뢰도 낮음",
          groundedReasonMissingCitations: "응답에 인용 없음",
          groundedReasonUnsupportedClaims: "응답이 근거와 맞지 않음",
          groundedNoteRetrievalDisabled: "이 턴에서는 검색 증강이 비활성화되었습니다.",
          groundedNoteNoEvidence: "이 턴에서는 검색 근거가 없었습니다.",
          groundedNoteUnsupportedCitations: "응답에 유효하지 않은 인용 라벨이 있습니다.",
          groundedNoteMissingCitations: "응답에 검색 근거 인용이 없습니다.",
          groundedNoteLowConfidence: "검색 신뢰도가 낮았습니다.",
          groundedNoteWeakOverlap: "응답과 근거의 어휘 중복이 약합니다.",
          enabled: "켜짐",
          disabled: "꺼짐",
          runtimeSnapshot: "런타임 상태 요약",
          prewarmModel: "모델 예열",
          prewarmAllModels: "전체 예열",
          prewarmingAll: "전체 예열 중...",
          prewarmAllDone: "모든 로컬 모델 예열이 완료되었습니다.",
          prewarming: "예열 중...",
          prewarmDone: "모델 예열이 완료되었습니다.",
          releaseModel: "모델 해제",
          releasingModel: "해제 중...",
          restartGateway: "게이트웨이 재시작",
          restartingGateway: "재시작 중...",
          viewRuntimeLog: "로그 보기",
          loadingRuntimeLog: "불러오는 중...",
          supervisor: "슈퍼바이저",
          gatewayProcess: "게이트웨이 프로세스",
          logExcerpt: "실행 로그",
          runtimeActions: "런타임 작업",
          sessions: "세션 기록",
          newSession: "새 세션",
          restoreSession: "세션 복원",
          currentSession: "현재 세션",
          sessionSaved: "자동 저장됨",
          noSessions: "저장된 세션이 없습니다",
          renameSession: "이름 변경",
          deleteSession: "삭제",
          pinSession: "고정",
          unpinSession: "고정 해제",
          pinned: "고정됨",
          deleteSessionConfirm: "이 세션을 삭제하시겠습니까?",
          sessionSearch: "세션 검색",
          clearAllSessions: "전체 삭제",
          clearUnpinnedSessions: "고정 해제 항목 삭제",
          targetGroup: "대상 그룹",
          sessionTargetFilter: "세션 대상 필터",
          allTargets: "전체 대상",
          exportSessionsMarkdown: "세션 Markdown 내보내기",
          exportSessionsJson: "세션 JSON 내보내기",
          sessionExportScope: "내보내기 범위",
          exportVisibleSessions: "현재 필터 결과만",
          exportPinnedSessions: "고정 항목만",
          providerProfile: "원격 제공자 프로필",
          providerProfileSpeed: "속도 우선",
          providerProfileBalanced: "균형",
          providerProfileToolFirst: "도구 우선",
          autoSpeedHint: "짧은 질의이고 도구 의도가 없으면 첫 토큰 지연을 줄이기 위해 자동으로 speed로 내려갑니다.",
          thinkingMode: "사고 모드",
          thinkingModeStandard: "표준",
          thinkingModeThinking: "Thinking / 풀 버전",
          actualResolvedModel: "현재 실제 해석 모델",
          actualProviderProfile: "이번 요청의 실제 프로필",
          actualThinkingMode: "이번 요청의 실제 사고 모드",
          fallbackBadge: "폴백",
          thinkingModelFallback: "전용 Thinking 모델이 없어 현재 표준 모델로 대체됩니다.",
          latencySplit: "업스트림 첫 토큰 vs 앱 총 지연",
          appOverhead: "앱 추가 지연",
          runtimeLoading: "로딩 중",
          runtimeLoadingElapsed: "대기 시간",
          runtimeLoadingError: "로딩 오류",
          runtimeCurrentLoaded: "현재 로드됨",
          runtimeSwitchingNow: "전환 중",
          runtimeLastSwitchLoad: "최근 전환 시간",
          runtimeLastSwitchAt: "최근 전환 시각",
          runtimeDowngradeHint: "로컬 4B가 아직 콜드 로딩 중이면 간단한 질문은 0.6B로 자동 낮춰 먼저 응답합니다.",
          localFallbackUsed: "로컬 자동 강등",
          localFallbackTarget: "강등 대상",
          localFallbackReason: "강등 사유",
          localFallbackReasonLoading: "로컬 4B가 아직 로딩 중",
          localFallbackReasonHealth: "로컬 4B 런타임 경고",
          localFallbackReasonEmpty: "로컬 4B가 빈 가시 응답을 반환",
          localFallbackReasonFailure: "로컬 4B 요청 실패",
          localFallbackReasonSimple: "간단한 질문을 위해 미리 예열된 0.6B 사용"
        };
      case "ja":
        return {
          requestFailed: "リクエストに失敗しました。",
          runtimeFailed: "ランタイム状態の取得に失敗しました。",
          toolDecisionFailed: "ツール判断に失敗しました。",
          connectionCheckFailed: "接続チェックに失敗しました。",
          copyFailed: "コピーに失敗しました。",
          resumeFailed: "再開に失敗しました。",
          noAssistantContent: "表示可能な応答がありません。ターゲット設定を確認してください。",
          attentionNeeded: "セルフチェックの一部ステージに注意が必要です。",
          remoteNoQueue: "リモートターゲットのため、ローカル実行キューはありません。",
          runtimeSerializing: "ローカル実行環境がリクエストを直列処理しています。",
          runtimeReady: "ローカル実行環境は準備完了です。",
          runtimeUnavailable: "ローカル実行環境は利用できません。",
          approve: "承認",
          approving: "承認中...",
          reject: "拒否",
          rejecting: "拒否中...",
          approved: "承認済み",
          rejected: "拒否済み",
          confirmationRequired: "確認が必要",
          token: "トークン",
          expires: "有効期限",
          resumeAgent: "Agent を再開",
          diffPreview: "Diff プレビュー",
          contentPreview: "内容プレビュー",
          verification: "検証",
          repairPatch: "修復パッチ",
          rejectArtifacts: "拒否成果物",
          initialFailure: "初回失敗",
          repairAttempt: "修復試行",
          standardOutput: "標準出力",
          standardError: "標準エラー",
          step: "ステップ",
          verified: "検証済み",
          unverified: "未検証",
          confirmationApproved: "この確認トークンはすでに承認されています。",
          confirmationRejected: "この確認トークンは拒否されています。",
          loadedAlias: "読み込み済み別名",
          runtimeMessage: "ランタイムメッセージ",
          enterHint: "Enter で送信、Shift+Enter で改行",
          submit: "送信",
          submitting: "処理中...",
          queueLabel: "キュー",
          activeLabel: "アクティブ",
          fallbackLaunchHint: "リモートターゲットのため、ローカル起動コマンドは不要です。",
          contextWindow: "コンテキスト量",
          selectedTargetLabel: "ターゲット",
          executionMode: "実行モード",
          toolLoopState: "ツールループ",
          enableRetrieval: "検索拡張",
          retrievalHint: "ナレッジベースの検索結果をシステムプロンプトに注入し、根拠付き回答と引用を促します。",
          retrievalGrounding: "検索エビデンス",
          retrievalHits: "ヒット数",
          retrievalLowConfidence: "検索信頼度が低いため、不確実性を明示する必要があります。",
          retrievalNoEvidence: "利用可能な検索エビデンスがありません。",
          groundedVerification: "根拠検証",
          groundedVerdict: "検証結果",
          groundedVerdictGrounded: "根拠あり",
          groundedVerdictWeak: "一部根拠あり",
          groundedVerdictUnsupported: "根拠不足",
          groundedVerdictNotApplicable: "未適用",
          groundedFallbackApplied: "保守的フォールバック適用済み",
          groundedFallbackReason: "フォールバック理由",
          groundedCitations: "引用ラベル",
          groundedUnsupportedCitations: "無効な引用",
          groundedLexicalScore: "根拠一致度",
          groundedNotes: "検証メモ",
          groundedReasonNoEvidence: "利用可能な検索根拠なし",
          groundedReasonLowConfidence: "検索信頼度が低い",
          groundedReasonMissingCitations: "回答に引用がない",
          groundedReasonUnsupportedClaims: "回答が根拠と一致しない",
          groundedNoteRetrievalDisabled: "このターンでは検索拡張が無効でした。",
          groundedNoteNoEvidence: "このターンでは検索根拠がありませんでした。",
          groundedNoteUnsupportedCitations: "回答に無効な引用ラベルがあります。",
          groundedNoteMissingCitations: "回答に検索根拠の引用がありません。",
          groundedNoteLowConfidence: "検索信頼度が低い状態でした。",
          groundedNoteWeakOverlap: "回答と根拠の語彙的重なりが弱いです。",
          enabled: "有効",
          disabled: "無効",
          runtimeSnapshot: "ランタイム状態サマリー",
          prewarmModel: "モデルを予熱",
          prewarmAllModels: "すべて予熱",
          prewarmingAll: "一括予熱中...",
          prewarmAllDone: "すべてのローカルモデルの予熱が完了しました。",
          prewarming: "予熱中...",
          prewarmDone: "モデルの予熱が完了しました。",
          releaseModel: "モデルを解放",
          releasingModel: "解放中...",
          restartGateway: "ゲートウェイ再起動",
          restartingGateway: "再起動中...",
          viewRuntimeLog: "ログを表示",
          loadingRuntimeLog: "読込中...",
          supervisor: "スーパーバイザー",
          gatewayProcess: "ゲートウェイプロセス",
          logExcerpt: "実行ログ",
          runtimeActions: "ランタイム操作",
          sessions: "セッション履歴",
          newSession: "新規セッション",
          restoreSession: "セッションを復元",
          currentSession: "現在のセッション",
          sessionSaved: "自動保存済み",
          noSessions: "保存されたセッションはありません",
          renameSession: "名前変更",
          deleteSession: "削除",
          pinSession: "固定",
          unpinSession: "固定解除",
          pinned: "固定済み",
          deleteSessionConfirm: "このセッションを削除しますか？",
          sessionSearch: "セッション検索",
          clearAllSessions: "すべて削除",
          clearUnpinnedSessions: "未固定を削除",
          targetGroup: "ターゲット別",
          sessionTargetFilter: "セッション対象フィルター",
          allTargets: "すべての対象",
          exportSessionsMarkdown: "セッションを Markdown で出力",
          exportSessionsJson: "セッションを JSON で出力",
          sessionExportScope: "出力範囲",
          exportVisibleSessions: "現在のフィルター結果のみ",
          exportPinnedSessions: "固定済みのみ",
          providerProfile: "リモートプロバイダープロファイル",
          providerProfileSpeed: "高速",
          providerProfileBalanced: "バランス",
          providerProfileToolFirst: "ツール優先",
          autoSpeedHint: "短い質問でツール意図がない場合、初回トークン遅延を抑えるため自動で speed に落とします。",
          thinkingMode: "Thinking モード",
          thinkingModeStandard: "標準",
          thinkingModeThinking: "Thinking / フル版",
          actualResolvedModel: "現在の実解決モデル",
          actualProviderProfile: "今回実際に使われたプロファイル",
          actualThinkingMode: "今回実際に使われた Thinking モード",
          fallbackBadge: "フォールバック",
          thinkingModelFallback: "専用 Thinking モデルが未設定のため、現在は標準モデルにフォールバックしています。",
          latencySplit: "上流の初回トークン vs アプリ総遅延",
          appOverhead: "アプリ追加遅延",
          runtimeLoading: "読み込み中",
          runtimeLoadingElapsed: "経過",
          runtimeLoadingError: "読み込みエラー",
          runtimeCurrentLoaded: "現在読み込み済み",
          runtimeSwitchingNow: "切り替え中",
          runtimeLastSwitchLoad: "直近切替時間",
          runtimeLastSwitchAt: "直近切替時刻",
          runtimeDowngradeHint: "ローカル 4B のコールドロード中は、簡単な質問を 0.6B に自動で落として先に応答します。",
          localFallbackUsed: "ローカル自動フォールバック",
          localFallbackTarget: "フォールバック先",
          localFallbackReason: "フォールバック理由",
          localFallbackReasonLoading: "ローカル 4B がまだ読み込み中",
          localFallbackReasonHealth: "ローカル 4B のランタイム警告",
          localFallbackReasonEmpty: "ローカル 4B が可視回答を返さなかった",
          localFallbackReasonFailure: "ローカル 4B リクエスト失敗",
          localFallbackReasonSimple: "簡単な質問は予熱済み 0.6B を優先"
        };
      case "en":
        return {
          requestFailed: "Request failed.",
          runtimeFailed: "Failed to load runtime status.",
          toolDecisionFailed: "Tool decision failed.",
          connectionCheckFailed: "Connection check failed.",
          copyFailed: "Copy failed.",
          resumeFailed: "Resume request failed.",
          noAssistantContent: "The provider returned no visible assistant content. Check the target configuration and try again.",
          attentionNeeded: "One or more self-check stages need attention.",
          remoteNoQueue: "Remote target. No local runtime queue.",
          runtimeSerializing: "The local runtime is serializing requests.",
          runtimeReady: "The local runtime is ready.",
          runtimeUnavailable: "The local runtime is unavailable.",
          approve: "Approve",
          approving: "Approving...",
          reject: "Reject",
          rejecting: "Rejecting...",
          approved: "Approved",
          rejected: "Rejected",
          confirmationRequired: "Confirmation Required",
          token: "Token",
          expires: "Expires",
          resumeAgent: "Resume Agent",
          diffPreview: "Diff Preview",
          contentPreview: "Content Preview",
          verification: "Verification",
          repairPatch: "Repair Patch",
          rejectArtifacts: "Reject Artifacts",
          initialFailure: "Initial Failure",
          repairAttempt: "Repair Attempt",
          standardOutput: "stdout",
          standardError: "stderr",
          step: "Step",
          verified: "Verified",
          unverified: "Unverified",
          confirmationApproved: "This confirmation token has already been approved.",
          confirmationRejected: "This confirmation token has been rejected.",
          loadedAlias: "Loaded Alias",
          runtimeMessage: "Message",
          enterHint: "Press Enter to send, Shift+Enter for a new line",
          submit: "Send",
          submitting: "Processing...",
          queueLabel: "Queue",
          activeLabel: "Active",
          fallbackLaunchHint: "Remote target. No local bootstrap command required.",
          contextWindow: "Context window",
          selectedTargetLabel: "Target",
          executionMode: "Execution mode",
          toolLoopState: "Tool loop",
          enableRetrieval: "Retrieval grounding",
          retrievalHint: "Inject knowledge-base hits into the system prompt and push the answer toward evidence-backed claims with citations.",
          retrievalGrounding: "Retrieved evidence",
          retrievalHits: "Hits",
          retrievalLowConfidence: "Retrieval confidence is low. The answer should state uncertainty explicitly.",
          retrievalNoEvidence: "No retrieval evidence is available for this turn.",
          groundedVerification: "Grounded verification",
          groundedVerdict: "Verification verdict",
          groundedVerdictGrounded: "Grounded",
          groundedVerdictWeak: "Weakly grounded",
          groundedVerdictUnsupported: "Unsupported",
          groundedVerdictNotApplicable: "Not applicable",
          groundedFallbackApplied: "Conservative fallback applied",
          groundedFallbackReason: "Fallback reason",
          groundedCitations: "Citation labels",
          groundedUnsupportedCitations: "Unsupported citations",
          groundedLexicalScore: "Lexical grounding score",
          groundedNotes: "Verification notes",
          groundedReasonNoEvidence: "No supporting evidence",
          groundedReasonLowConfidence: "Retrieval confidence is low",
          groundedReasonMissingCitations: "The answer is missing citations",
          groundedReasonUnsupportedClaims: "The answer does not match the evidence",
          groundedNoteRetrievalDisabled: "Retrieval grounding was disabled for this turn.",
          groundedNoteNoEvidence: "No retrieval evidence was available for this turn.",
          groundedNoteUnsupportedCitations: "The answer used unsupported citation labels.",
          groundedNoteMissingCitations: "The answer did not cite retrieved evidence.",
          groundedNoteLowConfidence: "Retrieval confidence was low.",
          groundedNoteWeakOverlap: "Lexical overlap between the answer and evidence was weak.",
          enabled: "Enabled",
          disabled: "Disabled",
          runtimeSnapshot: "Runtime snapshot",
          prewarmModel: "Prewarm model",
          prewarmAllModels: "Prewarm all",
          prewarmingAll: "Prewarming all...",
          prewarmAllDone: "All local models finished prewarming.",
          prewarming: "Prewarming...",
          prewarmDone: "Model prewarm finished.",
          releaseModel: "Release model",
          releasingModel: "Releasing...",
          restartGateway: "Restart gateway",
          restartingGateway: "Restarting...",
          viewRuntimeLog: "View log",
          loadingRuntimeLog: "Loading...",
          supervisor: "Supervisor",
          gatewayProcess: "Gateway process",
          logExcerpt: "Runtime log",
          runtimeActions: "Runtime actions",
          sessions: "Session history",
          newSession: "New session",
          restoreSession: "Restore session",
          currentSession: "Current session",
          sessionSaved: "Auto-saved",
          noSessions: "No saved sessions yet",
          renameSession: "Rename",
          deleteSession: "Delete",
          pinSession: "Pin",
          unpinSession: "Unpin",
          pinned: "Pinned",
          deleteSessionConfirm: "Delete this session?",
          sessionSearch: "Search sessions",
          clearAllSessions: "Clear all",
          clearUnpinnedSessions: "Clear unpinned",
          targetGroup: "Target groups",
          sessionTargetFilter: "Session target filter",
          allTargets: "All targets",
          exportSessionsMarkdown: "Export sessions Markdown",
          exportSessionsJson: "Export sessions JSON",
          sessionExportScope: "Export scope",
          exportVisibleSessions: "Visible filtered sessions",
          exportPinnedSessions: "Pinned only",
          providerProfile: "Remote provider profile",
          providerProfileSpeed: "Speed",
          providerProfileBalanced: "Balanced",
          providerProfileToolFirst: "Tool-first",
          autoSpeedHint: "Short Q&A without tool intent automatically falls back to speed to reduce first-token latency.",
          thinkingMode: "Thinking mode",
          thinkingModeStandard: "Standard",
          thinkingModeThinking: "Thinking / full model",
          actualResolvedModel: "Actual resolved model",
          actualProviderProfile: "Actual provider profile used",
          actualThinkingMode: "Actual thinking mode used",
          fallbackBadge: "Fallback",
          thinkingModelFallback: "No dedicated thinking model is configured. Falling back to the standard model.",
          latencySplit: "Upstream first token vs app total latency",
          appOverhead: "App overhead",
          runtimeLoading: "Loading",
          runtimeLoadingElapsed: "Elapsed",
          runtimeLoadingError: "Loading error",
          runtimeCurrentLoaded: "Currently loaded",
          runtimeSwitchingNow: "Switching now",
          runtimeLastSwitchLoad: "Last switch time",
          runtimeLastSwitchAt: "Last switch at",
          runtimeDowngradeHint: "If local 4B is still cold-loading, simple questions automatically downgrade to 0.6B so we can answer sooner.",
          localFallbackUsed: "Local auto-fallback",
          localFallbackTarget: "Fallback target",
          localFallbackReason: "Fallback reason",
          localFallbackReasonLoading: "Local 4B is still loading",
          localFallbackReasonHealth: "Local 4B runtime warning",
          localFallbackReasonEmpty: "Local 4B returned no visible answer",
          localFallbackReasonFailure: "Local 4B request failed",
          localFallbackReasonSimple: "Simple Q&A routed to prewarmed 0.6B"
        };
      case "zh-CN":
      default:
        return {
          requestFailed: "请求失败。",
          runtimeFailed: "加载运行时状态失败。",
          toolDecisionFailed: "工具决策失败。",
          connectionCheckFailed: "连接自检失败。",
          copyFailed: "复制失败。",
          resumeFailed: "续跑失败。",
          noAssistantContent: "提供方未返回可见助手内容，请检查目标配置后重试。",
          attentionNeeded: "一个或多个自检阶段需要关注。",
          remoteNoQueue: "远端目标，不提供本地运行队列。",
          runtimeSerializing: "本地运行时正在串行处理请求。",
          runtimeReady: "本地运行时已就绪。",
          runtimeUnavailable: "本地运行时不可用。",
          approve: "批准",
          approving: "批准中...",
          reject: "拒绝",
          rejecting: "拒绝中...",
          approved: "已批准",
          rejected: "已拒绝",
          confirmationRequired: "需要确认",
          token: "令牌",
          expires: "过期时间",
          resumeAgent: "续跑 Agent",
          diffPreview: "Diff 预览",
          contentPreview: "内容预览",
          verification: "校验",
          repairPatch: "修复补丁",
          rejectArtifacts: "拒绝产物",
          initialFailure: "初始失败",
          repairAttempt: "修复尝试",
          standardOutput: "标准输出",
          standardError: "标准错误",
          step: "步骤",
          verified: "已验证",
          unverified: "未验证",
          confirmationApproved: "该确认令牌已经批准。",
          confirmationRejected: "该确认令牌已被拒绝。",
          loadedAlias: "已加载别名",
          runtimeMessage: "运行时消息",
          enterHint: "Enter 发送，Shift+Enter 换行",
          submit: "发送",
          submitting: "处理中...",
          queueLabel: "队列",
          activeLabel: "活跃",
          fallbackLaunchHint: "远端目标，不需要本地启动命令。",
          contextWindow: "上下文体量",
          selectedTargetLabel: "目标",
          executionMode: "执行模式",
          toolLoopState: "工具循环",
          enableRetrieval: "检索增强",
          retrievalHint: "把知识库命中结果注入系统提示词，要求回答尽量基于证据并附引用。",
          retrievalGrounding: "检索证据",
          retrievalHits: "命中数",
          retrievalLowConfidence: "检索信心偏低，回答应明确标注不确定性。",
          retrievalNoEvidence: "当前没有可用检索证据。",
          groundedVerification: "证据校验",
          groundedVerdict: "校验结论",
          groundedVerdictGrounded: "已基于证据",
          groundedVerdictWeak: "部分基于证据",
          groundedVerdictUnsupported: "证据不足",
          groundedVerdictNotApplicable: "未启用",
          groundedFallbackApplied: "已应用保守回退",
          groundedFallbackReason: "回退原因",
          groundedCitations: "引用标签",
          groundedUnsupportedCitations: "无效引用",
          groundedLexicalScore: "证据重合度",
          groundedNotes: "校验说明",
          groundedReasonNoEvidence: "没有检索到可用证据",
          groundedReasonLowConfidence: "检索信心偏低",
          groundedReasonMissingCitations: "回答缺少引用",
          groundedReasonUnsupportedClaims: "回答与证据不匹配",
          groundedNoteRetrievalDisabled: "本轮未启用检索增强。",
          groundedNoteNoEvidence: "本轮没有检索到可用证据。",
          groundedNoteUnsupportedCitations: "回答使用了无效引用标签。",
          groundedNoteMissingCitations: "回答没有引用检索证据。",
          groundedNoteLowConfidence: "检索信心偏低。",
          groundedNoteWeakOverlap: "回答与证据的词面重合度偏弱。",
          enabled: "开启",
          disabled: "关闭",
          runtimeSnapshot: "运行状态快照",
          prewarmModel: "预热模型",
          prewarmAllModels: "全部预热",
          prewarmingAll: "全部预热中...",
          prewarmAllDone: "全部本地模型预热已完成。",
          prewarming: "预热中...",
          prewarmDone: "模型预热已完成。",
          releaseModel: "释放模型",
          releasingModel: "释放中...",
          restartGateway: "重启网关",
          restartingGateway: "重启中...",
          viewRuntimeLog: "查看日志",
          loadingRuntimeLog: "读取中...",
          supervisor: "守护进程",
          gatewayProcess: "网关进程",
          logExcerpt: "运行日志",
          runtimeActions: "运行时操作",
          sessions: "会话历史",
          newSession: "新建会话",
          restoreSession: "恢复会话",
          currentSession: "当前会话",
          sessionSaved: "已自动保存",
          noSessions: "还没有已保存会话",
          renameSession: "重命名",
          deleteSession: "删除",
          pinSession: "固定",
          unpinSession: "取消固定",
          pinned: "已固定",
          deleteSessionConfirm: "确定删除这个会话？",
          sessionSearch: "搜索会话",
          clearAllSessions: "清空全部",
          clearUnpinnedSessions: "清空未固定",
          targetGroup: "目标分组",
          sessionTargetFilter: "会话目标过滤",
          allTargets: "全部目标",
          exportSessionsMarkdown: "导出会话 Markdown",
          exportSessionsJson: "导出会话 JSON",
          sessionExportScope: "导出范围",
          exportVisibleSessions: "仅当前筛选可见项",
          exportPinnedSessions: "仅固定项",
          providerProfile: "远端提供方档位",
          providerProfileSpeed: "极速",
          providerProfileBalanced: "平衡",
          providerProfileToolFirst: "工具优先",
          autoSpeedHint: "短问答且无工具意图时，会自动降到 speed 以压首字延时。",
          thinkingMode: "思考模式",
          thinkingModeStandard: "标准",
          thinkingModeThinking: "Thinking / 满血版",
          actualResolvedModel: "当前实际解析模型",
          actualProviderProfile: "本次实际采用档位",
          actualThinkingMode: "本次实际采用思考模式",
          fallbackBadge: "已回退",
          thinkingModelFallback: "未配置专用 Thinking 模型，当前回退到标准模型。",
          latencySplit: "上游首字 vs 应用总耗时",
          appOverhead: "应用层额外耗时",
          runtimeLoading: "运行中加载",
          runtimeLoadingElapsed: "已等待",
          runtimeLoadingError: "加载错误",
          runtimeDowngradeHint: "本地 4B 仍在冷加载时，简单问答会自动降到 0.6B 以先给出结果。",
          localFallbackUsed: "本地自动降级",
          localFallbackTarget: "降级目标",
          localFallbackReason: "降级原因",
          localFallbackReasonLoading: "本地 4B 仍在加载",
          localFallbackReasonHealth: "本地 4B 运行时告警",
          localFallbackReasonEmpty: "本地 4B 返回空可见答案",
          localFallbackReasonFailure: "本地 4B 请求失败",
          localFallbackReasonSimple: "简单问答优先走已预热 0.6B"
        };
      }
  }, [locale]);
  const activeSessionTargetLabel = useMemo(
    () =>
      sessionTargetFilter === "all"
        ? uiText.allTargets
        : sessionTargetOptions.find((option) => option.id === sessionTargetFilter)?.label || sessionTargetFilter,
    [sessionTargetFilter, sessionTargetOptions, uiText.allTargets]
  );

  function restoreSession(session: StoredAgentSession) {
    setSessionId(session.id);
    setSelectedTargetId(
      agentTargets.some((target) => target.id === session.selectedTargetId)
        ? session.selectedTargetId
        : "anthropic-claude"
    );
    setEnableTools(Boolean(session.enableTools));
    setEnableRetrieval(Boolean(session.enableRetrieval));
    setContextWindow(
      CONTEXT_WINDOW_OPTIONS.includes(session.contextWindow) ? session.contextWindow : 32768
    );
    setProviderProfile(PROVIDER_PROFILE_OPTIONS.includes(session.providerProfile) ? session.providerProfile : "balanced");
    setThinkingMode(THINKING_MODE_OPTIONS.includes(session.thinkingMode) ? session.thinkingMode : "standard");
    setInput(session.input || "");
    setSystemPrompt(session.systemPrompt || getDefaultSystemPromptForLocale(locale));
    setTurns(Array.isArray(session.turns) ? session.turns : []);
    setConnectionChecksByTargetId(session.connectionChecksByTargetId || {});
    setError("");
    setRuntimeLogExcerpt("");
    setToolDecisionBusyKey("");
    setToolDecisionStatusByToken({});
  }

  function updateSessions(updater: (current: StoredAgentSession[]) => StoredAgentSession[]) {
    setSavedSessions((current) => {
      const next = sortSessions(updater(current)).slice(0, MAX_STORED_SESSIONS);
      window.localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function startNewSession() {
    setSessionId(crypto.randomUUID());
    setTurns([]);
    setInput("");
    setError("");
    setRuntimeLogExcerpt("");
    setToolDecisionBusyKey("");
    setToolDecisionStatusByToken({});
    setConnectionChecksByTargetId({});
    setSystemPrompt(getDefaultSystemPromptForLocale(locale));
    setProviderProfile("balanced");
    setThinkingMode("standard");
  }

  function handleRenameSession(targetSessionId: string) {
    const session = savedSessions.find((item) => item.id === targetSessionId);
    if (!session) return;
    const nextTitle = window.prompt(uiText.renameSession, session.title)?.trim();
    if (!nextTitle) return;
    updateSessions((current) =>
      current.map((item) =>
        item.id === targetSessionId
          ? {
              ...item,
              title: nextTitle,
              updatedAt: new Date().toISOString()
            }
          : item
      )
    );
  }

  function handleTogglePinSession(targetSessionId: string) {
    updateSessions((current) =>
      current.map((item) =>
        item.id === targetSessionId
          ? {
              ...item,
              pinned: !item.pinned,
              updatedAt: new Date().toISOString()
            }
          : item
      )
    );
  }

  function handleDeleteSession(targetSessionId: string) {
    const session = savedSessions.find((item) => item.id === targetSessionId);
    if (!session) return;
    if (!window.confirm(uiText.deleteSessionConfirm)) return;

    const remaining = savedSessions.filter((item) => item.id !== targetSessionId);
    window.localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sortSessions(remaining)));
    setSavedSessions(sortSessions(remaining));

    if (targetSessionId === sessionId) {
      if (remaining.length) {
        restoreSession(sortSessions(remaining)[0]);
      } else {
        startNewSession();
      }
    }
  }

  function handleBulkClearSessions(mode: "all" | "unpinned") {
    const nextSessions = mode === "all"
      ? []
      : savedSessions.filter((session) => session.pinned);

    window.localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sortSessions(nextSessions)));
    setSavedSessions(sortSessions(nextSessions));

    if (!nextSessions.some((session) => session.id === sessionId)) {
      if (nextSessions.length) {
        restoreSession(nextSessions[0]);
      } else {
        startNewSession();
      }
    }
  }

  function handleExportSessions(format: "markdown" | "json") {
    const sessions = filterSessionsForExport(savedSessions, {
      scope: sessionExportScope,
      sessionTargetFilter,
      sessionSearch
    });
    if (!sessions.length) return;

    const content =
      format === "markdown"
        ? serializeSessionsAsMarkdown(sessions)
        : JSON.stringify(
            buildSessionExportEnvelope(sessions, {
              scope: sessionExportScope,
              sessionTargetFilter,
              sessionSearch
            }),
            null,
            2
          );

    const blob = new Blob([content], {
      type: format === "markdown" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `agent-sessions-${sessionTargetFilter}-${Date.now()}.${format === "markdown" ? "md" : "json"}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    setConnectionCheckError("");
    setPrewarmMessage("");
    setRuntimeLogExcerpt("");
  }, [selectedTargetId]);

  useEffect(() => {
    const next = clampUiContextWindow(selectedTargetId, contextWindow, enableTools, enableRetrieval);
    if (next !== contextWindow) {
      setContextWindow(next);
    }
  }, [contextWindow, enableRetrieval, enableTools, selectedTargetId]);

  useEffect(() => {
    const previousLocale = previousLocaleRef.current;
    const previousDefaultPrompt = getDefaultSystemPromptForLocale(previousLocale);
    const nextDefaultPrompt = getDefaultSystemPromptForLocale(locale);
    setSystemPrompt((current) => (current === previousDefaultPrompt ? nextDefaultPrompt : current));

    const previousPrompts = getLocalizedStarterPrompts(previousLocale);
    setInput((current) => (previousPrompts.includes(current) ? starterPrompts[0] : current));
    previousLocaleRef.current = locale;
  }, [locale, starterPrompts]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateWorkbenchState() {
      try {
        const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
        const rawSessions = window.localStorage.getItem(SESSIONS_STORAGE_KEY);
        const localSessions = rawSessions ? normalizeStoredSessions(JSON.parse(rawSessions)) : [];
        let mergedSessions = localSessions;

        if (!cancelled && localSessions.length) {
          setSavedSessions(localSessions);
        }

        try {
          const response = await fetch("/api/agent/sessions", { cache: "no-store" });
          const payload = (await response.json()) as { sessions?: unknown; error?: string };
          if (!response.ok) {
            throw new Error(payload.error || "Failed to load server sessions.");
          }
          mergedSessions = mergeStoredSessions(localSessions, normalizeStoredSessions(payload.sessions || []));
          if (!cancelled) {
            setSavedSessions(mergedSessions);
            window.localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(mergedSessions));
            setServerSessionSyncState("synced");
          }
        } catch {
          if (!cancelled) {
            setServerSessionSyncState(localSessions.length ? "error" : "");
          }
        }

        if (raw) {
          const parsed = JSON.parse(raw) as {
            selectedTargetId?: string;
            enableTools?: boolean;
            enableRetrieval?: boolean;
            contextWindow?: number;
            providerProfile?: AgentProviderProfile;
            thinkingMode?: AgentThinkingMode;
          };
          if (
            typeof parsed.selectedTargetId === "string" &&
            agentTargets.some((target) => target.id === parsed.selectedTargetId)
          ) {
            setSelectedTargetId(parsed.selectedTargetId);
          }
          if (typeof parsed.enableTools === "boolean") {
            setEnableTools(parsed.enableTools);
          }
          if (typeof parsed.enableRetrieval === "boolean") {
            setEnableRetrieval(parsed.enableRetrieval);
          }
          if (
            typeof parsed.contextWindow === "number" &&
            CONTEXT_WINDOW_OPTIONS.includes(parsed.contextWindow)
          ) {
            setContextWindow(parsed.contextWindow);
          }
          if (
            typeof parsed.providerProfile === "string" &&
            PROVIDER_PROFILE_OPTIONS.includes(parsed.providerProfile as AgentProviderProfile)
          ) {
            setProviderProfile(parsed.providerProfile as AgentProviderProfile);
          }
          if (
            typeof parsed.thinkingMode === "string" &&
            THINKING_MODE_OPTIONS.includes(parsed.thinkingMode as AgentThinkingMode)
          ) {
            setThinkingMode(parsed.thinkingMode as AgentThinkingMode);
          }
        }

        if (mergedSessions.length && !cancelled) {
          restoreSession(mergedSessions[0]);
        }

        if (typeof window !== "undefined") {
          const rawRuntimeHistory = window.localStorage.getItem(RUNTIME_SWITCH_HISTORY_STORAGE_KEY);
          if (rawRuntimeHistory) {
            const parsedRuntimeHistory = JSON.parse(rawRuntimeHistory) as Record<
              string,
              { loadMs?: number | null; switchedAt?: string | null }
            >;
            if (parsedRuntimeHistory && typeof parsedRuntimeHistory === "object") {
              const nextLoadMs: Record<string, number | null> = {};
              const nextSwitchedAt: Record<string, string | null> = {};
              for (const [targetId, entry] of Object.entries(parsedRuntimeHistory)) {
                nextLoadMs[targetId] =
                  typeof entry?.loadMs === "number" && Number.isFinite(entry.loadMs) ? entry.loadMs : null;
                nextSwitchedAt[targetId] = typeof entry?.switchedAt === "string" ? entry.switchedAt : null;
              }
              if (!cancelled) {
                setRuntimeLastSwitchMsByTarget(nextLoadMs);
                setRuntimeLastSwitchAtByTarget(nextSwitchedAt);
              }
            }
          }
        }
      } catch {
        // Ignore invalid local state and fall back to defaults.
      } finally {
        if (!cancelled) {
          setPreferencesReady(true);
        }
      }
    }

    void hydrateWorkbenchState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        selectedTargetId,
        enableTools,
        enableRetrieval,
        contextWindow,
        providerProfile,
        thinkingMode
      })
    );
  }, [contextWindow, enableRetrieval, enableTools, preferencesReady, providerProfile, selectedTargetId, thinkingMode]);

  useEffect(() => {
    if (!preferencesReady) return;
    const hasSessionContent =
      turns.length > 0 || Boolean(input.trim()) || Object.keys(connectionChecksByTargetId).length > 0;

    setSavedSessions((current) => {
      const existingSession = current.find((session) => session.id === sessionId) || null;
      if (!hasSessionContent && !current.some((session) => session.id === sessionId)) {
        return current;
      }
      const nextSession: StoredAgentSession = {
        id: sessionId,
        title:
          existingSession?.title
          || createSessionTitle(turns, input.trim() || uiText.newSession),
        updatedAt: new Date().toISOString(),
        pinned: existingSession?.pinned || false,
        selectedTargetId,
        enableTools,
        enableRetrieval,
        contextWindow,
        providerProfile,
        thinkingMode,
        input,
        systemPrompt,
        turns,
        connectionChecksByTargetId
      };
      const merged = sortSessions([nextSession, ...current.filter((session) => session.id !== sessionId)])
        .slice(0, MAX_STORED_SESSIONS);
      window.localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(merged));
      return merged;
    });
  }, [
    connectionChecksByTargetId,
    contextWindow,
    enableRetrieval,
    enableTools,
    input,
    preferencesReady,
    providerProfile,
    selectedTargetId,
    sessionId,
    systemPrompt,
    thinkingMode,
    turns,
    uiText
  ]);

  useEffect(() => {
    if (!preferencesReady) return;
    if (sessionSyncTimeoutRef.current) {
      clearTimeout(sessionSyncTimeoutRef.current);
    }
    sessionSyncTimeoutRef.current = setTimeout(async () => {
      setServerSessionSyncState("syncing");
      try {
        const response = await fetch("/api/agent/sessions", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessions: savedSessions })
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Failed to sync server sessions.");
        }
        setServerSessionSyncState("synced");
      } catch {
        setServerSessionSyncState("error");
      }
    }, SERVER_SESSION_SYNC_DEBOUNCE_MS);

    return () => {
      if (sessionSyncTimeoutRef.current) {
        clearTimeout(sessionSyncTimeoutRef.current);
        sessionSyncTimeoutRef.current = null;
      }
    };
  }, [preferencesReady, savedSessions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const targetIds = new Set([
      ...Object.keys(runtimeLastSwitchMsByTarget),
      ...Object.keys(runtimeLastSwitchAtByTarget)
    ]);
    const payload: Record<string, RuntimeSwitchHistoryEntry> = {};
    targetIds.forEach((targetId) => {
      payload[targetId] = {
        loadMs: runtimeLastSwitchMsByTarget[targetId] ?? null,
        switchedAt: runtimeLastSwitchAtByTarget[targetId] ?? null
      };
    });
    window.localStorage.setItem(RUNTIME_SWITCH_HISTORY_STORAGE_KEY, JSON.stringify(payload));
  }, [runtimeLastSwitchAtByTarget, runtimeLastSwitchMsByTarget]);

  useEffect(() => {
    if (!transcriptRef.current) return;
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [turns, pending, toolDecisionBusyKey]);

  useEffect(() => {
    if (!copyState) return;
    const timer = window.setTimeout(() => setCopyState(""), 1200);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function loadRuntimeStatus(currentTargetId = selectedTargetId, options?: { force?: boolean }) {
    const target = agentTargets.find((item) => item.id === currentTargetId) || selectedTarget;

    if (runtimeRequestInFlightRef.current && !options?.force) {
      return;
    }

    runtimeRequestInFlightRef.current = true;

    try {
      const query = new URLSearchParams({
        targetId: currentTargetId,
        thinkingMode
      });
      const response = await fetch(`/api/agent/runtime?${query.toString()}`, {
        cache: "no-store"
      });
      const data = (await response.json()) as AgentRuntimeStatus & { error?: string };
      if (!response.ok) {
        setRuntimeStatus({
          targetId: currentTargetId,
          targetLabel: target.label,
          execution: target.execution,
          available: false,
          message: data.error || uiText.runtimeFailed
        });
        return;
      }
      setRuntimeStatus(data);
    } catch (runtimeError) {
      setRuntimeStatus({
        targetId: currentTargetId,
        targetLabel: target.label,
        execution: target.execution,
        available: false,
        message: runtimeError instanceof Error ? runtimeError.message : uiText.runtimeFailed
      });
    } finally {
      runtimeRequestInFlightRef.current = false;
    }
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    void loadRuntimeStatus(selectedTargetId, { force: true });
    if (selectedTarget.execution === "local") {
      timer = setInterval(() => {
        if (!cancelled && !document.hidden) {
          void loadRuntimeStatus(selectedTargetId);
        }
      }, pending ? 6000 : 12000);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [pending, selectedTarget.execution, selectedTarget.label, selectedTargetId, thinkingMode]);

  async function runPrompt(
    nextPrompt: string,
    options?: {
      targetId?: string;
      enableTools?: boolean;
      enableRetrieval?: boolean;
      providerProfile?: AgentProviderProfile;
      thinkingMode?: AgentThinkingMode;
      historyTurns?: AgentTurn[];
      replaySource?: AgentTurn["replaySource"];
      displayPrompt?: string;
    }
  ) {
    const effectiveTargetId = options?.targetId || selectedTargetId;
    const effectiveTarget = agentTargets.find((target) => target.id === effectiveTargetId) || selectedTarget;
    const effectiveEnableTools = options?.enableTools ?? enableTools;
    const effectiveEnableRetrieval = options?.enableRetrieval ?? enableRetrieval;
    const effectiveProviderProfile = options?.providerProfile ?? providerProfile;
    const effectiveThinkingMode = options?.thinkingMode ?? thinkingMode;
    const priorTurns = options?.historyTurns ?? turns;
    const requestMessages = flattenTurns(priorTurns);
    const turnId = `${Date.now()}`;

    setPending(true);
    setError("");
    setInput("");
    setTurns([
      ...priorTurns,
      {
        id: turnId,
        targetId: effectiveTargetId,
        prompt: nextPrompt,
        displayPrompt: options?.displayPrompt || nextPrompt,
        response: "",
        providerLabel: effectiveTarget.providerLabel,
        targetLabel: effectiveTarget.label,
        resolvedModel: effectiveTarget.modelDefault,
        resolvedBaseUrl: effectiveTarget.baseUrlDefault,
        providerProfile: effectiveTarget.execution === "remote" ? effectiveProviderProfile : undefined,
        thinkingMode: effectiveTarget.execution === "remote" ? effectiveThinkingMode : undefined,
        thinkingFallbackToStandard: false,
        localFallbackUsed: false,
        localFallbackTargetId: undefined,
        localFallbackTargetLabel: undefined,
        localFallbackReason: undefined,
        cacheHit: false,
        cacheMode: undefined,
        plannerSteps: undefined,
        memorySummary: undefined,
        retrieval: undefined,
        verification: undefined,
        toolRuns: [],
        replaySource: options?.replaySource
      }
    ]);

    try {
      const response = await fetch("/api/agent/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          targetId: effectiveTargetId,
          input: nextPrompt,
          messages: requestMessages,
          systemPrompt,
          enableTools: effectiveEnableTools,
          enableRetrieval: effectiveEnableRetrieval,
          contextWindow,
          providerProfile: effectiveProviderProfile,
          thinkingMode: effectiveThinkingMode
        })
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || uiText.requestFailed);
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error(uiText.requestFailed);
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let lineBreak = buffer.indexOf("\n");
        while (lineBreak !== -1) {
          const line = buffer.slice(0, lineBreak).trim();
          buffer = buffer.slice(lineBreak + 1);

          if (line) {
            const event = JSON.parse(line) as AgentStreamEvent;

            if (event.type === "meta") {
              setTurns((currentTurns) =>
                currentTurns.map((turn) =>
                  turn.id === turnId
                    ? {
                        ...turn,
                        providerLabel: event.providerLabel,
                        targetLabel: event.targetLabel,
                        resolvedModel: event.resolvedModel,
                        resolvedBaseUrl: event.resolvedBaseUrl,
                        providerProfile: event.providerProfile,
                        thinkingMode: event.thinkingMode,
                        thinkingFallbackToStandard: event.thinkingFallbackToStandard,
                        localFallbackUsed: event.localFallbackUsed,
                        localFallbackTargetId: event.localFallbackTargetId,
                        localFallbackTargetLabel: event.localFallbackTargetLabel,
                        localFallbackReason: event.localFallbackReason,
                        cacheHit: event.cacheHit,
                        cacheMode: event.cacheMode,
                        plannerSteps: event.plannerSteps,
                        memorySummary: event.memorySummary,
                        retrieval: event.retrieval,
                        verification: event.verification
                      }
                    : turn
                )
              );
            }

            if (event.type === "delta") {
              setTurns((currentTurns) =>
                currentTurns.map((turn) =>
                  turn.id === turnId
                    ? {
                        ...turn,
                        response: `${turn.response}${event.delta}`
                      }
                    : turn
                )
              );
            }

            if (event.type === "done") {
              setTurns((currentTurns) =>
                currentTurns.map((turn) =>
                  turn.id === turnId
                    ? {
                        ...turn,
                        response: event.content || turn.response || event.warning || uiText.noAssistantContent,
                        toolRuns: event.toolRuns || [],
                        providerProfile: event.providerProfile || turn.providerProfile,
                        thinkingMode: event.thinkingMode || turn.thinkingMode,
                        thinkingFallbackToStandard: event.thinkingFallbackToStandard ?? turn.thinkingFallbackToStandard,
                        localFallbackUsed: event.localFallbackUsed ?? turn.localFallbackUsed,
                        localFallbackTargetId: event.localFallbackTargetId || turn.localFallbackTargetId,
                        localFallbackTargetLabel: event.localFallbackTargetLabel || turn.localFallbackTargetLabel,
                        localFallbackReason: event.localFallbackReason || turn.localFallbackReason,
                        cacheHit: event.cacheHit ?? turn.cacheHit,
                        cacheMode: event.cacheMode || turn.cacheMode,
                        plannerSteps: event.plannerSteps || turn.plannerSteps,
                        memorySummary: event.memorySummary || turn.memorySummary,
                        retrieval: event.retrieval || turn.retrieval,
                        verification: event.verification || turn.verification,
                        warning: event.warning
                      }
                    : turn
                )
              );
            }

            if (event.type === "error") {
              throw new Error(event.error || uiText.requestFailed);
            }
          }

          lineBreak = buffer.indexOf("\n");
        }
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unknown error";
      setError(message);
      setInput(nextPrompt);
      setTurns((currentTurns) => currentTurns.filter((turn) => turn.id !== turnId));
    } finally {
      setPending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim() || pending) return;
    await runPrompt(input.trim());
  }

  function handlePrepareReplayTurn(turn: AgentTurn) {
    if (replayTargetMode === "original") {
      setSelectedTargetId(turn.targetId);
      if (turn.providerProfile) {
        setProviderProfile(turn.providerProfile);
      }
      if (turn.thinkingMode) {
        setThinkingMode(turn.thinkingMode);
      }
      setEnableRetrieval(Boolean(turn.retrieval));
    }
    setInput(turn.prompt);
    setError("");
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.scrollIntoView({ block: "nearest" });
    });
  }

  async function handleReplayTurn(
    turnIndex: number,
    turn: AgentTurn,
    options?: { includeHistory?: boolean }
  ) {
    if (pending) return;
    const useOriginalTarget = replayTargetMode === "original";
    const replayTargetId = useOriginalTarget ? turn.targetId : selectedTargetId;
    const replayTargetLabel = useOriginalTarget ? turn.targetLabel : selectedTarget.label;
    const replayProfile = useOriginalTarget ? turn.providerProfile : providerProfile;
    const replayThinkingMode = useOriginalTarget ? turn.thinkingMode : thinkingMode;
    const replayRetrieval = useOriginalTarget ? Boolean(turn.retrieval) : enableRetrieval;

    if (useOriginalTarget) {
      setSelectedTargetId(turn.targetId);
      if (turn.providerProfile) {
        setProviderProfile(turn.providerProfile);
      }
      if (turn.thinkingMode) {
        setThinkingMode(turn.thinkingMode);
      }
      setEnableRetrieval(Boolean(turn.retrieval));
    }
    const includeHistory = Boolean(options?.includeHistory);
    await runPrompt(turn.prompt, {
      targetId: replayTargetId,
      enableTools,
      enableRetrieval: replayRetrieval,
      providerProfile: replayProfile,
      thinkingMode: replayThinkingMode,
      historyTurns: includeHistory ? turns.slice(0, turnIndex) : [],
      replaySource: {
        turnId: turn.id,
        targetId: turn.targetId,
        targetLabel: turn.targetLabel,
        resolvedModel: turn.resolvedModel,
        response: turn.response,
        includeHistory,
        targetMode: replayTargetMode
      },
      displayPrompt: includeHistory
        ? locale.startsWith("en")
          ? `$ context replay ${replayTargetLabel}`
          : `$ 上下文回放 ${replayTargetLabel}`
        : locale.startsWith("en")
          ? `$ clean replay ${replayTargetLabel}`
          : `$ 干净回放 ${replayTargetLabel}`
    });
  }

  async function handleResumeAgent(
    turnIndex: number,
    turnId: string,
    turnTargetId: string,
    sourceToolRun: AgentToolRun,
    options?: { approvalContext?: boolean }
  ) {
    if (pending || toolDecisionBusyKey) return;

    const resumePrompt = [
      "Continue the current task from this point.",
      "",
      options?.approvalContext
        ? "A previously blocked tool step has now been approved and executed."
        : "Treat the following tool result as the replay point for the task.",
      `Tool: ${sourceToolRun.name}`,
      "Arguments:",
      JSON.stringify(sourceToolRun.input, null, 2),
      "",
      "Tool result:",
      sourceToolRun.output,
      "",
      "Use more tools if needed. Otherwise finish the task succinctly."
    ].join("\n");

    const priorTurns = turns.slice(0, turnIndex + 1);
    const requestMessages = flattenTurns(priorTurns);

    const useOriginalTarget = replayTargetMode === "original";
    const resumeTargetId = useOriginalTarget ? turnTargetId : selectedTargetId;

    if (useOriginalTarget) {
      setSelectedTargetId(turnTargetId);
    }
    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          targetId: resumeTargetId,
          input: resumePrompt,
          messages: requestMessages,
          systemPrompt,
          enableTools: true,
          enableRetrieval,
          contextWindow,
          providerProfile,
          thinkingMode
        })
      });

      const data = (await response.json()) as AgentChatResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || uiText.resumeFailed);
      }

      const assistantContent =
        data.content ||
        data.warning ||
        uiText.noAssistantContent;

      setTurns((currentTurns) => [
        ...currentTurns,
        {
          id: `${Date.now()}-resume`,
          targetId: turnTargetId,
          prompt: resumePrompt,
          displayPrompt: `$ resume after approved tool::${sourceToolRun.name}`,
          response: assistantContent,
          providerLabel: data.providerLabel,
          targetLabel: data.targetLabel,
          resolvedModel: data.resolvedModel,
          resolvedBaseUrl: data.resolvedBaseUrl,
          providerProfile: data.providerProfile,
          thinkingMode: data.thinkingMode,
          thinkingFallbackToStandard: data.thinkingFallbackToStandard,
          localFallbackUsed: data.localFallbackUsed,
          localFallbackTargetId: data.localFallbackTargetId,
          localFallbackTargetLabel: data.localFallbackTargetLabel,
          localFallbackReason: data.localFallbackReason,
          cacheHit: data.cacheHit,
          cacheMode: data.cacheMode,
          plannerSteps: data.plannerSteps,
          memorySummary: data.memorySummary,
          retrieval: data.retrieval,
          verification: data.verification,
          toolRuns: data.toolRuns,
          warning: data.warning
        }
      ]);
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : uiText.resumeFailed);
    } finally {
      setPending(false);
    }
  }

  async function handleCopy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(key);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : uiText.copyFailed);
    }
  }

  function handleStepWorkspaceFileAnchor(direction: -1 | 1) {
    setWorkspaceFileFocusState((current) => {
      if (!current || current.anchors.length <= 1) return current;
      const nextIndex = current.index + direction;
      if (nextIndex < 0 || nextIndex >= current.anchors.length) return current;
      return {
        ...current,
        index: nextIndex
      };
    });
  }

  async function handleOpenWorkspaceFile(
    relativePath: string,
    options?: { focusDiff?: boolean; anchors?: number[]; anchorIndex?: number }
  ) {
    if (!relativePath) return;

    const nextOpenPath = openWorkspaceFilePath === relativePath ? "" : relativePath;
    setOpenWorkspaceFilePath(nextOpenPath);
    setFocusedWorkspaceFilePath(nextOpenPath && options?.focusDiff ? relativePath : "");
    setWorkspaceFileFocusState(
      nextOpenPath && options?.focusDiff
        ? {
            path: relativePath,
            anchors: options?.anchors?.length ? options.anchors : [1],
            index: Math.max(
              0,
              Math.min(options?.anchorIndex ?? 0, Math.max((options?.anchors?.length || 1) - 1, 0))
            )
          }
        : null
    );
    const cached = workspaceFileViews[relativePath];
    if (!nextOpenPath || cached?.content || cached?.loading) return;

    setWorkspaceFileViews((current) => ({
      ...current,
      [relativePath]: {
        path: relativePath,
        loading: true
      }
    }));

    try {
      const response = await fetch(`/api/agent/workspace-file?path=${encodeURIComponent(relativePath)}`, {
        cache: "no-store"
      });
      const payload = (await response.json()) as {
        error?: string;
        path?: string;
        absolutePath?: string;
        content?: string;
        truncated?: boolean;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to open workspace file.");
      }
      setWorkspaceFileViews((current) => ({
        ...current,
        [relativePath]: {
          path: payload.path || relativePath,
          absolutePath: payload.absolutePath,
          content: payload.content || "",
          truncated: Boolean(payload.truncated),
          loading: false
        }
      }));
    } catch (workspaceFileError) {
      setWorkspaceFileViews((current) => ({
        ...current,
        [relativePath]: {
          path: relativePath,
          loading: false,
          error:
            workspaceFileError instanceof Error
              ? workspaceFileError.message
              : "Failed to open workspace file."
        }
      }));
    }
  }

  function handleExportTurns(format: "markdown" | "json") {
    if (!turns.length) return;

    const content =
      format === "markdown"
        ? serializeTurnsAsMarkdown(turns)
        : JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              turns
            },
            null,
            2
          );

    const blob = new Blob([content], {
      type: format === "markdown" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `agent-transcript-${selectedTargetId}-${Date.now()}.${format === "markdown" ? "md" : "json"}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!pending && input.trim()) {
        void runPrompt(input.trim());
      }
    }
  }

  async function handleToolDecision(
    turnId: string,
    turnTargetId: string,
    toolRunIndex: number,
    toolName: string,
    toolInput: Record<string, unknown>,
    confirmationToken: string,
    action: "approve" | "reject"
  ) {
    const busyKey = `${turnId}:${toolRunIndex}:${action}`;
    if (toolDecisionBusyKey) return;

    setToolDecisionBusyKey(busyKey);
    setError("");

    try {
      const response = await fetch("/api/agent/tool/decision", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          targetId: turnTargetId,
          toolName,
          input: toolInput,
          confirmationToken,
          action
        })
      });

      const data = (await response.json()) as AgentToolDecisionResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || uiText.toolDecisionFailed);
      }

      const decisionOutput = parseToolOutput(data.toolRun.output);
      const decisionStatus = readStringField(decisionOutput, "status");

      setTurns((currentTurns) =>
        currentTurns.map((turn) =>
          turn.id !== turnId
            ? turn
            : {
                ...turn,
                toolRuns: [...turn.toolRuns, data.toolRun]
              }
        )
      );

      if (action === "reject" || decisionStatus !== "confirmation_required") {
        setToolDecisionStatusByToken((current) => ({
          ...current,
          [confirmationToken]: action === "approve" ? "approved" : "rejected"
        }));
      }
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : uiText.toolDecisionFailed);
    } finally {
      setToolDecisionBusyKey("");
    }
  }

  async function handleConnectionCheck() {
    if (!supportsConnectionCheck || connectionCheckPending || pending) return;

    setConnectionCheckPending(true);
    setConnectionCheckError("");

    try {
      const response = await fetch(
        `/api/agent/connection-check?targetId=${encodeURIComponent(selectedTargetId)}`,
        {
          cache: "no-store"
        }
      );
      const data = (await response.json()) as AgentConnectionCheckResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || uiText.connectionCheckFailed);
      }
      setConnectionChecksByTargetId((current) => ({
        ...current,
        [selectedTargetId]: data
      }));
      setTurns((currentTurns) => [
        ...currentTurns,
        {
          id: `${Date.now()}-check`,
          kind: "check",
          targetId: selectedTargetId,
          prompt: `$ connection-check ${selectedTarget.label}`,
          displayPrompt: `$ connection-check ${selectedTarget.label}`,
          response: buildConnectionCheckNarrative(data, {
            title: dictionary.agent.connectionRecord,
            overall: dictionary.common.latest,
            model: dictionary.common.model,
            endpoint: dictionary.common.endpoint,
            ok: dictionary.common.ok,
            failed: dictionary.common.failed
          }),
          providerLabel: data.providerLabel,
          targetLabel: data.targetLabel,
          resolvedModel: data.resolvedModel,
          resolvedBaseUrl: data.resolvedBaseUrl,
          toolRuns: [],
          warning: data.ok ? undefined : uiText.attentionNeeded,
          connectionCheck: data
        }
      ]);
    } catch (checkError) {
      setConnectionCheckError(
        checkError instanceof Error ? checkError.message : uiText.connectionCheckFailed
      );
    } finally {
      setConnectionCheckPending(false);
    }
  }

  async function handlePrewarm() {
    if (selectedTarget.execution !== "local" || prewarmPending || pending) return;

    setPrewarmPending(true);
    setPrewarmMessage("");
    setError("");

    try {
      const response = await fetch("/api/agent/runtime/prewarm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          targetId: selectedTargetId
        })
      });
      const data = (await response.json()) as AgentRuntimePrewarmResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || uiText.runtimeFailed);
      }
      const details = [
        data.message || uiText.prewarmDone,
        data.status === "ready" && typeof data.loadMs === "number" ? `load ${data.loadMs.toFixed(1)} ms` : "",
        data.status === "ready" && typeof data.warmupMs === "number" ? `warm ${data.warmupMs.toFixed(1)} ms` : ""
      ]
        .filter(Boolean)
        .join(" · ");
      setPrewarmMessage(details);
      if (data.status === "ready" && typeof data.loadMs === "number") {
        const switchedAt = new Date().toISOString();
        setRuntimeLastSwitchMsByTarget((current) => ({
          ...current,
          [selectedTargetId]: data.loadMs ?? null
        }));
        setRuntimeLastSwitchAtByTarget((current) => ({
          ...current,
          [selectedTargetId]: switchedAt
        }));
      }
      await loadRuntimeStatus(selectedTargetId);
    } catch (prewarmError) {
      setError(prewarmError instanceof Error ? prewarmError.message : uiText.runtimeFailed);
    } finally {
      setPrewarmPending(false);
    }
  }

  async function handlePrewarmAll() {
    if (selectedTarget.execution !== "local" || prewarmAllPending || prewarmPending || pending) return;

    setPrewarmAllPending(true);
    setPrewarmMessage("");
    setError("");

    try {
      const response = await fetch("/api/agent/runtime/prewarm-all", {
        method: "POST"
      });
      const data = (await response.json()) as AgentRuntimePrewarmAllResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || uiText.runtimeFailed);
      }
      const details = data.results
        .map((item) => {
          const statusLabel =
            item.status === "loading"
              ? "loading"
              : item.status === "queued"
                ? "queued"
                : item.status === "failed"
                  ? "failed"
                  : "ready";
          const parts = [
            item.targetLabel,
            statusLabel,
            item.status === "ready" && typeof item.loadMs === "number" ? `load ${item.loadMs.toFixed(1)} ms` : "",
            item.status === "ready" && typeof item.warmupMs === "number" ? `warm ${item.warmupMs.toFixed(1)} ms` : ""
          ].filter(Boolean);
          return parts.join(" · ");
        })
        .join(" | ");
      setPrewarmMessage(`${uiText.prewarmAllDone}${details ? ` ${details}` : ""}`);
      setRuntimeLastSwitchMsByTarget((current) => {
        const next = { ...current };
        data.results.forEach((item) => {
          if (item.status === "ready" && typeof item.loadMs === "number") {
            next[item.targetId] = item.loadMs;
          }
        });
        return next;
      });
      setRuntimeLastSwitchAtByTarget((current) => {
        const next = { ...current };
        data.results.forEach((item) => {
          if (item.status === "ready" && typeof item.loadMs === "number") {
            next[item.targetId] = new Date().toISOString();
          }
        });
        return next;
      });
      await loadRuntimeStatus(selectedTargetId);
    } catch (prewarmError) {
      setError(prewarmError instanceof Error ? prewarmError.message : uiText.runtimeFailed);
    } finally {
      setPrewarmAllPending(false);
    }
  }

  async function handleRuntimeAction(action: "release" | "restart" | "read_log") {
    if (selectedTarget.execution !== "local" || runtimeActionPending || pending) return;

    setRuntimeActionPending(action);
    setError("");
    if (action !== "read_log") {
      setRuntimeLogExcerpt("");
    }

    try {
      const response = await fetch("/api/agent/runtime/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          targetId: selectedTargetId,
          action
        })
      });
      const data = (await response.json()) as AgentRuntimeActionResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || data.message || uiText.runtimeFailed);
      }
      if (data.runtime) {
        setRuntimeStatus(data.runtime);
      } else {
        await loadRuntimeStatus(selectedTargetId);
      }
      if (data.logExcerpt) {
        setRuntimeLogExcerpt(data.logExcerpt);
      }
      if (data.message) {
        setPrewarmMessage(data.message);
      }
    } catch (runtimeActionError) {
      setError(runtimeActionError instanceof Error ? runtimeActionError.message : uiText.runtimeFailed);
    } finally {
      setRuntimeActionPending("");
    }
  }

  return (
    <section className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.14),_transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(249,115,22,0.14),_transparent_28%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] px-4 py-6 text-slate-100 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/70 shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur">
          <div className="border-b border-white/10 px-5 py-4">
            <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-300">{dictionary.agent.shell}</p>
            <h1 className="mt-2 text-2xl font-semibold text-white">{dictionary.agent.title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">{dictionary.agent.subtitle}</p>
          </div>

          <div className="space-y-5 px-4 py-4">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{dictionary.agent.targets}</p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                  {agentTargets.length}
                </span>
              </div>
              <div className="space-y-2">
                {agentTargets.map((target) => {
                  const active = target.id === selectedTargetId;
                  const targetConnectionCheck = connectionChecksByTargetId[target.id] || null;
                  const healthBadge = getHealthBadge(targetConnectionCheck);
                  return (
                    <button
                      key={target.id}
                      type="button"
                      onClick={() => setSelectedTargetId(target.id)}
                      className={`w-full rounded-[22px] border px-3 py-2.5 text-left transition ${
                        active
                          ? "border-cyan-400/45 bg-cyan-400/[0.08] shadow-[0_0_0_1px_rgba(34,211,238,0.1)]"
                          : "border-white/10 bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.06]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[15px] font-semibold text-white">{target.label}</p>
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{target.providerLabel}</p>
                          <p className="mt-1 line-clamp-1 text-[10px] text-slate-500">
                            {dictionary.common.model}: {formatTargetModelVersion(target.modelDefault, target.thinkingModelDefault)}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className={`rounded-full px-2 py-[3px] text-[10px] uppercase tracking-[0.2em] ${
                              target.execution === "local"
                                ? "bg-emerald-400/10 text-emerald-300"
                                : "bg-violet-400/10 text-violet-300"
                            }`}
                          >
                            {target.execution === "local" ? dictionary.common.local : dictionary.common.remote}
                          </span>
                          {target.execution === "remote" ? (
                            <span
                              className={`rounded-full px-2 py-[3px] text-[10px] uppercase tracking-[0.2em] ${healthBadge.className}`}
                            >
                              {healthBadge.label === "healthy"
                                ? dictionary.agent.healthHealthy
                                : healthBadge.label === "warning"
                                  ? dictionary.agent.healthWarning
                                  : healthBadge.label === "degraded"
                                    ? dictionary.agent.healthDegraded
                                    : dictionary.agent.healthUnknown}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[12.5px] leading-6 text-slate-400">
                        {getLocalizedTargetDescription(locale, target.id, target.description)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-[24px] border border-white/8 bg-white/[0.035] px-4 py-3.5">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{dictionary.agent.selectedProfile}</p>
              <div className="mt-2.5 space-y-2.5 text-sm text-slate-300">
                <div>
                  <p className="text-slate-500">{dictionary.agent.context}</p>
                  <p className="mt-1 text-[13px] leading-6 text-white">{selectedTarget.recommendedContext}</p>
                </div>
                <div>
                  <p className="text-slate-500">{uiText.contextWindow}</p>
                  <select
                    value={contextWindow}
                    onChange={(event) => setContextWindow(Number(event.target.value))}
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    {CONTEXT_WINDOW_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value >= 1024 ? `${Math.round(value / 1024)}K` : value}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedTarget.execution === "remote" ? (
                  <div>
                    <p className="text-slate-500">{uiText.providerProfile}</p>
                    <select
                      value={providerProfile}
                      onChange={(event) => setProviderProfile(event.target.value as AgentProviderProfile)}
                      disabled={thinkingMode === "thinking"}
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none"
                    >
                      <option value="speed">{uiText.providerProfileSpeed}</option>
                      <option value="balanced">{uiText.providerProfileBalanced}</option>
                      <option value="tool-first">{uiText.providerProfileToolFirst}</option>
                    </select>
                    {thinkingMode !== "thinking" ? (
                      <p className="mt-1.5 text-xs leading-5 text-slate-500">{uiText.autoSpeedHint}</p>
                    ) : null}
                  </div>
                ) : null}
                {selectedTarget.execution === "remote" ? (
                  <div>
                    <p className="text-slate-500">{uiText.thinkingMode}</p>
                    <select
                      value={thinkingMode}
                      onChange={(event) => setThinkingMode(event.target.value as AgentThinkingMode)}
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none"
                    >
                      <option value="standard">{uiText.thinkingModeStandard}</option>
                      <option value="thinking">{uiText.thinkingModeThinking}</option>
                    </select>
                  </div>
                ) : null}
                {selectedTarget.execution === "remote" ? (
                  <div>
                    <p className="text-slate-500">{uiText.actualResolvedModel}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-100">
                        live
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[12px] leading-5 text-white">
                        {runtimeStatus?.resolvedModel || lastChatTurn?.resolvedModel || selectedTarget.modelDefault}
                      </span>
                    </div>
                    <p className="mt-2.5 text-slate-500">{uiText.actualProviderProfile}</p>
                    <p className="mt-1 break-all text-[13px] leading-6 text-white">
                      {lastChatTurn?.providerProfile || (thinkingMode === "thinking" ? "tool-first" : providerProfile)}
                    </p>
                    <p className="mt-2.5 text-slate-500">{uiText.actualThinkingMode}</p>
                    <p className="mt-1 break-all text-[13px] leading-6 text-white">
                      {lastChatTurn?.thinkingMode || thinkingMode}
                    </p>
                    <p className="mt-2.5 text-slate-500">{uiText.thinkingModeStandard}</p>
                    <div className="mt-1.5">
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[12px] leading-5 text-white">
                        {runtimeStatus?.standardResolvedModel || selectedTarget.modelDefault}
                      </span>
                    </div>
                    <p className="mt-2.5 text-slate-500">{uiText.thinkingModeThinking}</p>
                    <div className="mt-1.5">
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[12px] leading-5 text-white">
                        {runtimeStatus?.thinkingResolvedModel || selectedTarget.thinkingModelDefault || selectedTarget.modelDefault}
                      </span>
                    </div>
                    {(lastChatTurn?.thinkingFallbackToStandard ||
                      (thinkingMode === "thinking" && runtimeStatus?.thinkingModelConfigured === false)) ? (
                        <p className="mt-1.5 text-xs leading-5 text-amber-200">
                          {uiText.thinkingModelFallback} {runtimeStatus?.resolvedModel || lastChatTurn?.resolvedModel || selectedTarget.modelDefault}
                        </p>
                      ) : null}
                  </div>
                ) : null}
                <div>
                  <p className="text-slate-500">{dictionary.agent.memory}</p>
                  <p className="mt-1 text-[13px] leading-6">{selectedTarget.memoryProfile}</p>
                </div>
                <div>
                  <p className="text-slate-500">{dictionary.agent.toolMode}</p>
                  <p className="mt-1 text-[13px] leading-6">
                    {selectedTarget.supportsTools
                      ? dictionary.agent.toolsAvailable
                      : dictionary.agent.toolsUnavailable}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">{uiText.enableRetrieval}</p>
                  <p className="mt-1 text-[13px] leading-6 text-slate-300">
                    {enableRetrieval ? uiText.enabled : uiText.disabled}
                  </p>
                  <p className="mt-1.5 text-xs leading-5 text-slate-500">{uiText.retrievalHint}</p>
                </div>
              </div>
            </section>

            <details className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{uiText.sessions}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{uiText.sessionSaved}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                    {savedSessions.length}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200">
                    {uiText.newSession}
                  </span>
                </div>
              </summary>
              <div className="mt-4 space-y-2">
                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-300">{uiText.currentSession}</p>
                    {currentSession?.pinned ? (
                      <span className="rounded-full bg-cyan-950/70 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-100">
                        {uiText.pinned}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm font-medium text-white">{currentSession?.title || createSessionTitle(turns, uiText.newSession)}</p>
                  <p className="mt-1 text-xs text-cyan-100/80">
                    {uiText.sessionSaved} · {currentSession?.updatedAt ? new Date(currentSession.updatedAt).toLocaleString() : "--"}
                  </p>
                  <p className="mt-1 text-[11px] text-cyan-100/70">{sessionSyncLabel}</p>
                  {currentSession ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleRenameSession(currentSession.id)}
                        className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/15"
                      >
                        {uiText.renameSession}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTogglePinSession(currentSession.id)}
                        className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/15"
                      >
                        {currentSession.pinned ? uiText.unpinSession : uiText.pinSession}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSession(currentSession.id)}
                        className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-[11px] font-semibold text-rose-100 transition hover:bg-rose-400/20"
                      >
                        {uiText.deleteSession}
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2">
                    <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                        {uiText.sessionTargetFilter} · {activeSessionTargetLabel}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                        {uiText.sessionExportScope} · {sessionExportScope === "visible" ? uiText.exportVisibleSessions : uiText.exportPinnedSessions}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {uiText.sessions} · {exportableSessions.length}/{savedSessions.length}
                    </span>
                  </div>
                  <input
                    value={sessionSearch}
                    onChange={(event) => setSessionSearch(event.target.value)}
                    placeholder={uiText.sessionSearch}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                  <select
                    value={sessionTargetFilter}
                    onChange={(event) => setSessionTargetFilter(event.target.value)}
                    className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    <option value="all">{uiText.sessionTargetFilter} · {uiText.allTargets}</option>
                    {sessionTargetOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {uiText.sessionTargetFilter} · {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={sessionExportScope}
                    onChange={(event) => setSessionExportScope(event.target.value as "visible" | "pinned")}
                    className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    <option value="visible">{uiText.sessionExportScope} · {uiText.exportVisibleSessions}</option>
                    <option value="pinned">{uiText.sessionExportScope} · {uiText.exportPinnedSessions}</option>
                  </select>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleExportSessions("markdown")}
                      disabled={!exportableSessions.length}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                    >
                      {uiText.exportSessionsMarkdown}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportSessions("json")}
                      disabled={!exportableSessions.length}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                    >
                      {uiText.exportSessionsJson}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulkClearSessions("unpinned")}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                    >
                      {uiText.clearUnpinnedSessions}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulkClearSessions("all")}
                      className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-[11px] font-semibold text-rose-100 transition hover:bg-rose-400/20"
                    >
                      {uiText.clearAllSessions}
                    </button>
                  </div>
                </div>
                {sessionGroups.length ? (
                  sessionGroups.map((group) => (
                    <div key={group.targetId} className="space-y-2">
                      <p className="px-1 text-[11px] uppercase tracking-[0.22em] text-slate-500">
                        {uiText.targetGroup} · {group.targetLabel}
                      </p>
                      {group.sessions.map((session) => (
                        <div
                          key={session.id}
                          className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm text-white">{session.title}</p>
                              <p className="mt-2 text-xs text-slate-400">{new Date(session.updatedAt).toLocaleString()}</p>
                            </div>
                            {session.pinned ? (
                              <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                                {uiText.pinned}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => restoreSession(session)}
                              className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                            >
                              {uiText.restoreSession}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRenameSession(session.id)}
                              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                            >
                              {uiText.renameSession}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTogglePinSession(session.id)}
                              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                            >
                              {session.pinned ? uiText.unpinSession : uiText.pinSession}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSession(session.id)}
                              className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-[11px] font-semibold text-rose-100 transition hover:bg-rose-400/20"
                            >
                              {uiText.deleteSession}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  <p className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-400">
                    {uiText.noSessions}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={startNewSession}
                className="mt-4 w-full rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
              >
                {uiText.newSession}
              </button>
            </details>

            <details className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{dictionary.agent.toolRegistry}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{dictionary.agent.toolsAvailable}</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                  {agentToolSpecs.length}
                </span>
              </summary>
              <div className="mt-4 space-y-3">
                {agentToolSpecs.map((tool) => (
                  <div key={tool.name} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="font-mono text-xs text-cyan-300">{tool.name}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      {getLocalizedToolDescription(locale, tool.name, tool.description)}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          </div>
        </aside>

        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/75 shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur">
          <header className="border-b border-white/10 px-5 py-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-cyan-400/[0.07] px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] text-cyan-300">
                    {selectedTarget.providerLabel}
                  </span>
                  <span className="rounded-full bg-white/[0.03] px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] text-slate-300">
                    {selectedTarget.transport}
                  </span>
                  <span className="rounded-full bg-white/[0.03] px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] text-slate-300">
                    {selectedTarget.execution === "local" ? dictionary.common.local : dictionary.common.remote}
                  </span>
                </div>
                <h2 className="mt-3 text-2xl font-semibold text-white">{selectedTarget.label}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{dictionary.agent.subtitle}</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[318px]">
                <div className="rounded-[20px] border border-white/8 bg-white/[0.035] px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">{dictionary.agent.messages}</p>
                  <p className="mt-1.5 text-lg font-semibold text-white">{historyMessages.length}</p>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-white/[0.035] px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">{dictionary.agent.turns}</p>
                  <p className="mt-1.5 text-lg font-semibold text-white">{turns.length}</p>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-white/[0.035] px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">{dictionary.agent.tools}</p>
                  <p className="mt-1.5 text-lg font-semibold text-white">
                    {turns.reduce((count, turn) => count + turn.toolRuns.length, 0)}
                  </p>
                </div>
              </div>
            </div>
          </header>

          <div className="border-b border-white/10 bg-black/20 px-5 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-100">
                {uiText.selectedTargetLabel}: {selectedTarget.label}
              </span>
              <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
                {uiText.executionMode}: {selectedTarget.execution === "local" ? dictionary.common.local : dictionary.common.remote}
              </span>
              <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
                {uiText.contextWindow}: {formatContextWindowLabel(contextWindow)}
              </span>
              <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
                {uiText.toolLoopState}: {enableTools ? uiText.enabled : uiText.disabled}
              </span>
              <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
                {uiText.enableRetrieval}: {enableRetrieval ? uiText.enabled : uiText.disabled}
              </span>
              <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
                {uiText.loadedAlias}: {loadedAliasForSelectedTarget || "—"}
              </span>
              {gatewayLoadedOtherAlias ? (
                <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
                  {uiText.runtimeCurrentLoaded}: {describeRuntimeAlias(gatewayLoadedOtherAlias, agentTargets)}
                </span>
              ) : null}
              {selectedTarget.execution === "local" && runtimeStatus ? (
                <>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      runtimeStatus.available
                        ? runtimeStatus.busy
                          ? "border-amber-400/20 bg-amber-400/10 text-amber-100"
                          : "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                        : "border-rose-400/20 bg-rose-400/10 text-rose-100"
                    }`}
                  >
                    {runtimeStatus.available
                      ? runtimeStatus.busy
                        ? dictionary.agent.runtimeBusy
                        : dictionary.agent.runtimeIdle
                      : dictionary.agent.runtimeOffline}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                    {uiText.queueLabel}: {runtimeStatus.queueDepth ?? 0}
                  </span>
                  {runtimeStatus.loadingAlias ? (
                    <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-100">
                      {uiText.runtimeSwitchingNow}: {describeRuntimeAlias(runtimeStatus.loadingAlias, agentTargets)}
                      {typeof runtimeStatus.loadingElapsedMs === "number"
                        ? ` · ${uiText.runtimeLoadingElapsed} ${Math.max(1, Math.round(runtimeStatus.loadingElapsedMs / 1000))}s`
                        : ""}
                    </span>
                  ) : null}
                  <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
                    {uiText.runtimeLastSwitchLoad}: {formatRuntimeDuration(selectedTargetLastSwitchMs)}
                  </span>
                  <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
                    {uiText.runtimeLastSwitchAt}: {formatRuntimeTimestamp(selectedTargetLastSwitchAt, locale)}
                  </span>
                  {runtimeStatus.loadingError ? (
                    <span className="rounded-full border border-rose-400/20 bg-rose-400/10 px-2.5 py-1 text-[11px] text-rose-100">
                      {uiText.runtimeLoadingError}
                    </span>
                  ) : null}
                </>
              ) : null}
              {prewarmMessage ? (
                <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-100">
                  {uiText.prewarmModel}: {prewarmMessage}
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="border-b border-white/10 xl:border-b-0 xl:border-r xl:border-white/10">
              <div className="border-b border-white/10 bg-black/20 px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setInput(prompt)}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-cyan-400/30 hover:bg-cyan-400/10 hover:text-white"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>

              <div
                ref={transcriptRef}
                className="h-[52vh] min-h-[360px] max-h-[72vh] resize-y overflow-y-auto bg-[linear-gradient(180deg,rgba(15,23,42,0.18),rgba(2,6,23,0.12))] px-5 py-5 font-mono text-[13px] leading-7 sm:h-[58vh]"
              >
                {turns.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-5 text-sm leading-7 text-slate-400">
                    <p className="text-cyan-300">$ boot</p>
                    <p className="mt-2">{dictionary.agent.transcriptReady}</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {turns.map((turn, turnIndex) => {
                      const reviewItems = collectToolReviewItems(turn);
                      const traceOpen = expandedTraceTurnId === turn.id;
                      const replayComparison = buildReplayComparison(turn, locale);
                      return (
                      <article key={turn.id} className="space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-slate-300">
                              {turn.targetLabel}
                            </span>
                            <span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-cyan-300">
                              {turn.providerLabel}
                            </span>
                            {turn.providerProfile ? (
                              <span className="rounded-full bg-violet-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-violet-200">
                                {turn.providerProfile}
                              </span>
                            ) : null}
                            {turn.thinkingMode ? (
                              <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-amber-200">
                                {turn.thinkingMode}
                              </span>
                            ) : null}
                            {turn.thinkingFallbackToStandard ? (
                              <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-amber-100">
                                {uiText.fallbackBadge}
                              </span>
                            ) : null}
                            {turn.localFallbackUsed ? (
                              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-emerald-100">
                                {uiText.localFallbackUsed}
                              </span>
                            ) : null}
                            {turn.cacheHit ? (
                              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-emerald-100">
                                cache{turn.cacheMode ? `:${formatCacheMode(turn.cacheMode)}` : ""}
                              </span>
                            ) : null}
                            {turn.retrieval ? (
                              <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-emerald-200">
                                {uiText.retrievalHits}: {turn.retrieval.hitCount}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/20 px-1 py-1">
                              <button
                                type="button"
                                onClick={() => setReplayTargetMode("original")}
                                className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition ${
                                  replayTargetMode === "original"
                                    ? "bg-cyan-400/15 text-cyan-100"
                                    : "text-slate-400 hover:text-slate-200"
                                }`}
                              >
                                {locale.startsWith("en") ? "Original target" : "保留原目标"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setReplayTargetMode("current")}
                                className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition ${
                                  replayTargetMode === "current"
                                    ? "bg-cyan-400/15 text-cyan-100"
                                    : "text-slate-400 hover:text-slate-200"
                                }`}
                              >
                                {locale.startsWith("en") ? "Current target" : "切换目标回放"}
                              </button>
                            </div>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => handlePrepareReplayTurn(turn)}
                              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {locale.startsWith("en") ? "Load replay" : "载入回放"}
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => void handleReplayTurn(turnIndex, turn, { includeHistory: true })}
                              className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {locale.startsWith("en") ? "Context replay" : "上下文回放"}
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => void handleReplayTurn(turnIndex, turn, { includeHistory: false })}
                              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {locale.startsWith("en") ? "Clean replay" : "干净回放"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setExpandedTraceTurnId((current) => (current === turn.id ? "" : turn.id))}
                              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300 transition hover:bg-white/10"
                            >
                              {traceOpen
                                ? locale.startsWith("en")
                                  ? "Hide trace"
                                  : "收起轨迹"
                                : locale.startsWith("en")
                                  ? "Show trace"
                                  : "查看轨迹"}
                            </button>
                            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                              {turn.resolvedModel}
                            </span>
                          </div>
                        </div>

                        {traceOpen ? (
                          <div className="rounded-2xl border border-sky-400/15 bg-sky-400/5 px-3 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200">
                                {locale.startsWith("en") ? "Tool steps" : "工具步骤"} {turn.toolRuns.length}
                              </span>
                              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200">
                                {locale.startsWith("en") ? "Plan steps" : "规划步骤"} {turn.plannerSteps?.length || 0}
                              </span>
                              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200">
                                {locale.startsWith("en") ? "Patch reviews" : "变更审阅"} {reviewItems.length}
                              </span>
                              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200">
                                {locale.startsWith("en") ? "Retrieval hits" : "检索命中"} {turn.retrieval?.hitCount || 0}
                              </span>
                            </div>
                            <div className="mt-3 grid gap-2 md:grid-cols-2">
                              <div className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-3 text-xs leading-6 text-slate-200">
                                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                                  {locale.startsWith("en") ? "Replay source" : "回放来源"}
                                </p>
                                <p className="mt-2">{turn.targetLabel} · {turn.providerLabel}</p>
                                <p>{turn.providerProfile || "--"} · {turn.thinkingMode || "--"}</p>
                                <p>{turn.resolvedModel}</p>
                              </div>
                              <div className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-3 text-xs leading-6 text-slate-200">
                                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                                  {locale.startsWith("en") ? "Execution notes" : "执行摘要"}
                                </p>
                                <p className="mt-2">
                                  {turn.warning
                                    ? turn.warning
                                    : locale.startsWith("en")
                                      ? "No extra warning on this turn."
                                      : "该轮没有额外告警。"}
                                </p>
                              </div>
                            </div>
                            {reviewItems.length ? (
                              <div className="mt-3 space-y-3">
                                <p className="text-[11px] uppercase tracking-[0.22em] text-sky-200">
                                  {locale.startsWith("en") ? "Patch / diff review" : "Patch / Diff 审核"}
                                </p>
                                {reviewItems.map((item) => (
                                  <div key={item.key} className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-sky-200">
                                        {item.toolName}
                                      </span>
                                      <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                                        {item.status}
                                      </span>
                                      {item.confirmationRequired ? (
                                        <span className="rounded-full bg-violet-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-violet-200">
                                          {locale.startsWith("en") ? "Needs approval" : "待审批"}
                                        </span>
                                      ) : null}
                                      {item.confirmationUsed ? (
                                        <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-200">
                                          {locale.startsWith("en") ? "Approved" : "已审批"}
                                        </span>
                                      ) : null}
                                      {item.verified !== null ? (
                                        <span className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${item.verified ? "bg-emerald-400/10 text-emerald-200" : "bg-rose-400/10 text-rose-200"}`}>
                                          {item.verified
                                            ? locale.startsWith("en") ? "Verified" : "已验证"
                                            : locale.startsWith("en") ? "Needs review" : "待复核"}
                                        </span>
                                      ) : null}
                                    </div>
                                    {item.affectedFiles.length ? (
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        {item.affectedFiles.map((filePath) => (
                                          <span key={filePath} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-200">
                                            {filePath}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                    {item.files.length ? (
                                      <div className="mt-3 space-y-2">
                                        {item.files.map((file) => {
                                          const reviewFileKey = `${item.key}:${file.path}`;
                                          const open = expandedReviewFileKey === reviewFileKey;
                                          const openedFile = workspaceFileViews[file.path];
                                          const workspaceFileOpen = openWorkspaceFilePath === file.path;
                                          const focusAnchors = file.diffPreview
                                            ? readNewFileLineAnchorsFromDiff(file.diffPreview)
                                            : [];
                                          const focusLine =
                                            workspaceFileOpen &&
                                            workspaceFileFocusState?.path === file.path &&
                                            workspaceFileFocusState.anchors.length
                                              ? workspaceFileFocusState.anchors[workspaceFileFocusState.index]
                                              : focusAnchors[0] || null;
                                          const focusedExcerpt =
                                            workspaceFileOpen &&
                                            focusedWorkspaceFilePath === file.path &&
                                            focusLine &&
                                            openedFile?.content
                                              ? buildFocusedFileExcerpt(openedFile.content, focusLine)
                                              : null;
                                          return (
                                            <div key={reviewFileKey} className="rounded-xl border border-white/10 bg-black/20">
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  setExpandedReviewFileKey((current) =>
                                                    current === reviewFileKey ? "" : reviewFileKey
                                                  )
                                                }
                                                className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left"
                                              >
                                                <div className="flex flex-wrap items-center gap-2">
                                                  <span className="text-xs font-semibold text-white">{file.path}</span>
                                                  {file.changed !== null ? (
                                                    <span className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${
                                                      file.changed
                                                        ? "bg-emerald-400/10 text-emerald-200"
                                                        : "bg-white/5 text-slate-300"
                                                    }`}>
                                                      {file.changed
                                                        ? locale.startsWith("en")
                                                          ? "Changed"
                                                          : "已变更"
                                                        : locale.startsWith("en")
                                                          ? "No diff"
                                                          : "无差异"}
                                                    </span>
                                                  ) : null}
                                                  {file.existedBefore === false ? (
                                                    <span className="rounded-full bg-cyan-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-200">
                                                      {locale.startsWith("en") ? "Created" : "新建"}
                                                    </span>
                                                  ) : null}
                                                  {file.existsAfter === false ? (
                                                    <span className="rounded-full bg-rose-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-rose-200">
                                                      {locale.startsWith("en") ? "Removed" : "已删除"}
                                                    </span>
                                                  ) : null}
                                                </div>
                                                <span className="text-[11px] text-slate-400">
                                                  {open
                                                    ? locale.startsWith("en")
                                                      ? "Collapse"
                                                      : "收起"
                                                    : locale.startsWith("en")
                                                      ? "Expand"
                                                      : "展开"}
                                                </span>
                                              </button>
                                              <div className="flex flex-wrap gap-2 px-3 pb-2">
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleCopy(
                                                      file.diffPreview || file.contentPreview || file.path,
                                                      `${reviewFileKey}:file`
                                                    )
                                                  }
                                                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
                                                >
                                                  {copyState === `${reviewFileKey}:file`
                                                    ? dictionary.common.copied
                                                    : locale.startsWith("en")
                                                      ? "Copy file diff"
                                                      : "复制文件 diff"}
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => void handleOpenWorkspaceFile(file.path)}
                                                  className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-100 transition hover:bg-cyan-400/20"
                                                >
                                                  {workspaceFileOpen
                                                    ? locale.startsWith("en")
                                                      ? "Hide file"
                                                      : "收起文件"
                                                    : locale.startsWith("en")
                                                      ? "Open file"
                                                      : "打开文件"}
                                                </button>
                                                {focusLine ? (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      void handleOpenWorkspaceFile(file.path, {
                                                        focusDiff: true,
                                                        anchors: focusAnchors,
                                                        anchorIndex: 0
                                                      })
                                                    }
                                                    className="rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-violet-100 transition hover:bg-violet-400/20"
                                                  >
                                                    {locale.startsWith("en") ? "Jump to diff" : "跳到 diff"}
                                                  </button>
                                                ) : null}
                                              </div>
                                              {open ? (
                                                <div className="border-t border-white/10 px-3 py-3">
                                                  {file.diffPreview ? (
                                                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-cyan-400/15 bg-cyan-400/5 px-3 py-3 text-xs leading-6 text-cyan-50">
                                                      {file.diffPreview}
                                                    </pre>
                                                  ) : file.contentPreview ? (
                                                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-slate-950/70 px-3 py-3 text-xs leading-6 text-slate-200">
                                                      {file.contentPreview}
                                                    </pre>
                                                  ) : (
                                                    <p className="text-xs leading-6 text-slate-400">
                                                      {locale.startsWith("en") ? "No file-level preview available." : "当前没有文件级预览内容。"}
                                                    </p>
                                                  )}
                                                  {workspaceFileOpen ? (
                                                    <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-3">
                                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                                                          {locale.startsWith("en") ? "Workspace file" : "工作区文件"}
                                                        </p>
                                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                                          {workspaceFileOpen &&
                                                          workspaceFileFocusState?.path === file.path &&
                                                          workspaceFileFocusState.anchors.length ? (
                                                            <>
                                                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                                                                {workspaceFileFocusState.index + 1}/{workspaceFileFocusState.anchors.length}
                                                              </span>
                                                              {focusedExcerpt ? (
                                                                <button
                                                                  type="button"
                                                                  onClick={() =>
                                                                    handleCopy(focusedExcerpt.content, `${reviewFileKey}:segment`)
                                                                  }
                                                                  className="rounded-full border border-violet-400/20 bg-violet-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-violet-100 transition hover:bg-violet-400/20"
                                                                >
                                                                  {copyState === `${reviewFileKey}:segment`
                                                                    ? dictionary.common.copied
                                                                    : locale.startsWith("en")
                                                                      ? "Copy current hunk"
                                                                      : "复制当前变更段"}
                                                                </button>
                                                              ) : null}
                                                              <button
                                                                type="button"
                                                                disabled={workspaceFileFocusState.index === 0}
                                                                onClick={() => handleStepWorkspaceFileAnchor(-1)}
                                                                className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                                                              >
                                                                {locale.startsWith("en") ? "Prev change" : "上一处变更"}
                                                              </button>
                                                              <button
                                                                type="button"
                                                                disabled={
                                                                  workspaceFileFocusState.index >=
                                                                  workspaceFileFocusState.anchors.length - 1
                                                                }
                                                                onClick={() => handleStepWorkspaceFileAnchor(1)}
                                                                className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                                                              >
                                                                {locale.startsWith("en") ? "Next change" : "下一处变更"}
                                                              </button>
                                                            </>
                                                          ) : null}
                                                          {openedFile?.absolutePath ? (
                                                            <span className="text-[11px] text-slate-500">{openedFile.absolutePath}</span>
                                                          ) : null}
                                                        </div>
                                                      </div>
                                                      {openedFile?.loading ? (
                                                        <p className="mt-2 text-xs leading-6 text-slate-400">
                                                          {locale.startsWith("en") ? "Loading file..." : "正在读取文件..."}
                                                        </p>
                                                      ) : openedFile?.error ? (
                                                        <p className="mt-2 text-xs leading-6 text-rose-100">{openedFile.error}</p>
                                                      ) : (
                                                        <>
                                                          {focusedExcerpt ? (
                                                            <p className="mt-2 text-[11px] text-violet-200">
                                                              {locale.startsWith("en")
                                                                ? `Focused near line ${focusLine}`
                                                                : `已定位到第 ${focusLine} 行附近`}
                                                            </p>
                                                          ) : null}
                                                          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-slate-200">
                                                            {focusedExcerpt?.content || openedFile?.content || ""}
                                                          </pre>
                                                          {openedFile?.truncated ? (
                                                            <p className="mt-2 text-[11px] text-amber-100">
                                                              {locale.startsWith("en")
                                                                ? "Preview truncated to keep the trace panel responsive."
                                                                : "为保持轨迹面板响应速度，文件预览已截断。"}
                                                            </p>
                                                          ) : null}
                                                        </>
                                                      )}
                                                    </div>
                                                  ) : null}
                                                </div>
                                              ) : null}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : null}
                                    {item.diffPreview ? (
                                      <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-cyan-400/15 bg-cyan-400/5 px-3 py-3 text-xs leading-6 text-cyan-50">
                                        {item.diffPreview}
                                      </pre>
                                    ) : item.contentPreview ? (
                                      <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs leading-6 text-slate-200">
                                        {item.contentPreview}
                                      </pre>
                                    ) : null}
                                    {item.errorText ? (
                                      <p className="mt-3 text-xs leading-6 text-rose-100">{item.errorText}</p>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{dictionary.agent.user}</p>
                            <button
                              type="button"
                              onClick={() => handleCopy(turn.displayPrompt || turn.prompt, `${turn.id}:user`)}
                              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300 transition hover:bg-white/10"
                            >
                              {copyState === `${turn.id}:user` ? dictionary.common.copied : dictionary.common.copy}
                            </button>
                          </div>
                          <pre className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-100">{`> ${turn.displayPrompt || turn.prompt}`}</pre>
                        </div>

                        {turn.toolRuns.length ? (
                          <div className="space-y-3">
                            {turn.toolRuns.map((toolRun, index) => (
                              (() => {
                                const parsedOutput = parseToolOutput(toolRun.output);
                                const status = readStringField(parsedOutput, "status");
                                const policyLevel = readStringField(parsedOutput, "policyLevel");
                                const diffPreview = readStringField(parsedOutput, "diffPreview");
                                const contentPreview = readStringField(parsedOutput, "contentPreview");
                                const stdout = readStringField(parsedOutput, "stdout");
                                const stderr = readStringField(parsedOutput, "stderr");
                                const errorText = readStringField(parsedOutput, "error");
                                const message = readStringField(parsedOutput, "message");
                                const confirmationToken = readStringField(parsedOutput, "confirmationToken");
                                const repairPatch = readStringField(parsedOutput, "repairPatch");
                                const verified = readBooleanField(parsedOutput, "verified");
                                const expiresAt = readNumberField(parsedOutput, "expiresAt");
                                const verification = readVerificationField(parsedOutput);
                                const rejectArtifacts = readArrayField(parsedOutput, "rejectArtifacts");
                                const initialFailure = parsedOutput?.initialFailure;
                                const repairAttempt = parsedOutput?.repairAttempt;
                                const decisionState = confirmationToken
                                  ? toolDecisionStatusByToken[confirmationToken]
                                  : undefined;
                                const decisionBusy =
                                  toolDecisionBusyKey === `${turn.id}:${index}:approve` ||
                                  toolDecisionBusyKey === `${turn.id}:${index}:reject`;
                                const confirmationUsed = readBooleanField(parsedOutput, "confirmationUsed");
                                const policyReason = readStringField(parsedOutput, "policyReason");

                                return (
                                  <div
                                    key={`${turn.id}-tool-${index}`}
                                    className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-3"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-[11px] uppercase tracking-[0.24em] text-amber-300">
                                          tool::{toolRun.name}
                                        </p>
                                        {status ? (
                                          <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-50">
                                            {status}
                                          </span>
                                        ) : null}
                                        {policyLevel ? (
                                          <span className="rounded-full bg-slate-950/70 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-200">
                                            {policyLevel}
                                          </span>
                                        ) : null}
                                        {verified !== null ? (
                                          <span
                                            className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.2em] ${
                                              verified
                                                ? "bg-emerald-400/15 text-emerald-200"
                                                : "bg-rose-400/15 text-rose-200"
                                            }`}
                                          >
                                            {verified ? uiText.verified : uiText.unverified}
                                          </span>
                                        ) : null}
                                        {decisionState ? (
                                          <span
                                            className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.2em] ${
                                              decisionState === "approved"
                                                ? "bg-emerald-400/15 text-emerald-200"
                                                : "bg-rose-400/15 text-rose-200"
                                            }`}
                                          >
                                            {decisionState}
                                          </span>
                                        ) : null}
                                      </div>
                                      <span className="text-[11px] uppercase tracking-[0.24em] text-amber-200/70">
                                        {uiText.step} {index + 1}
                                      </span>
                                    </div>

                                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6 text-amber-100">
                                      {JSON.stringify(toolRun.input, null, 2)}
                                    </pre>

                                    {diffPreview ? (
                                      <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-3">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-300">
                                          {uiText.diffPreview}
                                        </p>
                                        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-cyan-50">
                                          {diffPreview}
                                        </pre>
                                      </div>
                                    ) : null}

                                    {policyReason ? (
                                      <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-3">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                                          Policy
                                        </p>
                                        <p className="mt-2 text-xs leading-6 text-slate-200">{policyReason}</p>
                                      </div>
                                    ) : null}

                                    {confirmationToken ? (
                                      <div className="mt-3 rounded-xl border border-violet-400/25 bg-violet-400/10 px-3 py-3">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-violet-300">
                                          {uiText.confirmationRequired}
                                        </p>
                                        <p className="mt-2 break-all text-xs leading-6 text-violet-100">
                                          {uiText.token}: {confirmationToken}
                                        </p>
                                        {expiresAt ? (
                                          <p className="mt-2 text-xs leading-6 text-violet-200/80">
                                            {uiText.expires}: {new Date(expiresAt).toLocaleString()}
                                          </p>
                                        ) : null}
                                        {message ? (
                                          <p className="mt-2 text-xs leading-6 text-violet-100">{message}</p>
                                        ) : null}
                                        {!decisionState ? (
                                          <div className="mt-3 flex flex-wrap gap-2">
                                            <button
                                              type="button"
                                              disabled={Boolean(decisionBusy) || pending}
                                              onClick={() =>
                                                handleToolDecision(
                                                  turn.id,
                                                  turn.targetId,
                                                  index,
                                                  toolRun.name,
                                                  toolRun.input,
                                                  confirmationToken,
                                                  "approve"
                                                )
                                              }
                                              className="rounded-full bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                                            >
                                              {toolDecisionBusyKey === `${turn.id}:${index}:approve` ? uiText.approving : uiText.approve}
                                            </button>
                                            <button
                                              type="button"
                                              disabled={Boolean(decisionBusy) || pending}
                                              onClick={() =>
                                                handleToolDecision(
                                                  turn.id,
                                                  turn.targetId,
                                                  index,
                                                  toolRun.name,
                                                  toolRun.input,
                                                  confirmationToken,
                                                  "reject"
                                                )
                                              }
                                              className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                                            >
                                              {toolDecisionBusyKey === `${turn.id}:${index}:reject` ? uiText.rejecting : uiText.reject}
                                            </button>
                                          </div>
                                        ) : (
                                          <p className="mt-3 text-xs leading-6 text-violet-200/80">
                                            {decisionState === "approved"
                                              ? uiText.confirmationApproved
                                              : uiText.confirmationRejected}
                                          </p>
                                        )}
                                      </div>
                                    ) : null}

                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {confirmationUsed ? (
                                        <button
                                          type="button"
                                          disabled={pending || Boolean(toolDecisionBusyKey)}
                                          onClick={() =>
                                            handleResumeAgent(turnIndex, turn.id, turn.targetId, toolRun, {
                                              approvalContext: true
                                            })
                                          }
                                          className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                                        >
                                          {uiText.resumeAgent}
                                        </button>
                                      ) : null}
                                      <button
                                        type="button"
                                        disabled={pending || Boolean(toolDecisionBusyKey)}
                                        onClick={() =>
                                          handleResumeAgent(turnIndex, turn.id, turn.targetId, toolRun, {
                                            approvalContext: false
                                          })
                                        }
                                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                                      >
                                        {locale.startsWith("en") ? "Replay from here" : "从该步骤继续"}
                                      </button>
                                    </div>

                                    {contentPreview ? (
                                      <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-3">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                                          {uiText.contentPreview}
                                        </p>
                                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-slate-200">
                                          {contentPreview}
                                        </pre>
                                      </div>
                                    ) : null}

                                    {verification.length ? (
                                      <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-3">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                                          {uiText.verification}
                                        </p>
                                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-slate-200">
                                          {JSON.stringify(verification, null, 2)}
                                        </pre>
                                      </div>
                                    ) : null}

                                    {repairPatch ? (
                                      <div className="mt-3 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-3">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-sky-300">
                                          {uiText.repairPatch}
                                        </p>
                                        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-sky-50">
                                          {repairPatch}
                                        </pre>
                                      </div>
                                    ) : null}

                                    {rejectArtifacts.length ? (
                                      <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-3">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-amber-300">
                                          {uiText.rejectArtifacts}
                                        </p>
                                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-amber-50">
                                          {JSON.stringify(rejectArtifacts, null, 2)}
                                        </pre>
                                      </div>
                                    ) : null}

                                    {initialFailure && typeof initialFailure === "object" ? (
                                      <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-3">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-rose-300">
                                          {uiText.initialFailure}
                                        </p>
                                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-rose-100">
                                          {JSON.stringify(initialFailure, null, 2)}
                                        </pre>
                                      </div>
                                    ) : null}

                                    {repairAttempt && typeof repairAttempt === "object" ? (
                                      <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-3">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-rose-300">
                                          {uiText.repairAttempt}
                                        </p>
                                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-rose-100">
                                          {JSON.stringify(repairAttempt, null, 2)}
                                        </pre>
                                      </div>
                                    ) : null}

                                    {stdout ? (
                                      <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-3">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{uiText.standardOutput}</p>
                                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-slate-200">
                                          {stdout}
                                        </pre>
                                      </div>
                                    ) : null}

                                    {stderr ? (
                                      <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/5 px-3 py-3">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-rose-300">{uiText.standardError}</p>
                                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-rose-100">
                                          {stderr}
                                        </pre>
                                      </div>
                                    ) : null}

                                    {errorText ? (
                                      <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/5 px-3 py-3 text-xs leading-6 text-rose-100">
                                        {errorText}
                                      </div>
                                    ) : null}

                                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-slate-950/70 px-3 py-3 text-xs leading-6 text-slate-200">
                                      {toolRun.output}
                                    </pre>
                                  </div>
                                );
                              })()
                            ))}
                          </div>
                        ) : null}

                        {turn.warning ? (
                          <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3 py-3 text-sm leading-6 text-amber-100">
                            {turn.warning}
                          </div>
                        ) : null}

                        {replayComparison ? (
                          <div className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.06] px-3 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-violet-100">
                                  {locale.startsWith("en") ? "Replay compare" : "回放对比"}
                                </span>
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200">
                                  {replayComparison.replayModeLabel}
                                </span>
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200">
                                  {replayComparison.targetModeLabel}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopy(
                                    buildReplayComparisonSummaryText(replayComparison, locale),
                                    `${turn.id}:replay-compare`
                                  )
                                }
                                className="rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-violet-100 transition hover:bg-violet-400/20"
                              >
                                {copyState === `${turn.id}:replay-compare`
                                  ? dictionary.common.copied
                                  : locale.startsWith("en")
                                    ? "Copy diff summary"
                                    : "复制差异摘要"}
                              </button>
                            </div>
                            <p className="mt-2 text-xs leading-6 text-slate-200">{replayComparison.sourceLabel}</p>
                            <p className="mt-1 text-xs leading-6 text-slate-300">
                              {locale.startsWith("en") ? "Response delta" : "响应长度变化"}:{" "}
                              {replayComparison.responseDelta > 0 ? "+" : ""}
                              {replayComparison.responseDelta}
                            </p>
                            <p className="mt-2 text-xs leading-6 text-violet-100">{replayComparison.summary}</p>
                            {replayComparison.keyDiffs.length ? (
                              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                                  {locale.startsWith("en") ? "Top 3 key differences" : "前 3 处关键差异"}
                                </p>
                                <ul className="mt-2 space-y-1 text-xs leading-6 text-slate-200">
                                  {replayComparison.keyDiffs.map((diff, index) => (
                                    <li key={`${turn.id}:replay-diff:${index}`}>- {diff}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                            <div className="mt-3 grid gap-2 md:grid-cols-2">
                              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                                  {locale.startsWith("en") ? "Original" : "原轮"}
                                </p>
                                <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-slate-200">
                                  {(turn.replaySource?.response || "").trim().slice(0, 240) ||
                                    (locale.startsWith("en") ? "No original response." : "没有原轮响应。")}
                                  {(turn.replaySource?.response || "").trim().length > 240 ? "…" : ""}
                                </pre>
                              </div>
                              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                                  {locale.startsWith("en") ? "Replay" : "回放"}
                                </p>
                                <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-slate-200">
                                  {turn.response.trim().slice(0, 240) ||
                                    (locale.startsWith("en") ? "No replay response." : "没有回放响应。")}
                                  {turn.response.trim().length > 240 ? "…" : ""}
                                </pre>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {turn.plannerSteps?.length ? (
                          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-3">
                            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">plan</p>
                            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-6 text-slate-200">
                              {turn.plannerSteps.map((step, index) => (
                                <li key={`${turn.id}:plan:${index}`}>{step}</li>
                              ))}
                            </ol>
                          </div>
                        ) : null}

                        {turn.memorySummary ? (
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
                            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">memory</p>
                            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-slate-200">
                              {turn.memorySummary}
                            </pre>
                          </div>
                        ) : null}

                        {turn.retrieval ? (
                          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-200">
                                {uiText.retrievalGrounding}
                              </p>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-emerald-100">
                                  {uiText.retrievalHits}: {turn.retrieval.hitCount}
                                </span>
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200">
                                  {turn.retrieval.bypassGrounding
                                    ? locale.startsWith("en")
                                      ? "General answer"
                                      : "常识直答"
                                    : locale.startsWith("en")
                                      ? "Evidence-backed"
                                      : "证据回答"}
                                </span>
                              </div>
                            </div>
                            {turn.retrieval.lowConfidence ? (
                              <p className="mt-2 text-xs leading-6 text-amber-100">{uiText.retrievalLowConfidence}</p>
                            ) : null}
                            {turn.retrieval.bypassGrounding ? (
                              <div className="mt-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs leading-6 text-slate-200">
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                                  {locale.startsWith("en") ? "General answer mode" : "常识直答模式"}
                                </span>
                                <p className="mt-2">
                                  {turn.retrieval.bypassReason === "general-question-no-evidence"
                                    ? locale.startsWith("en")
                                      ? "No local evidence was required for this question, so the answer could rely on general knowledge."
                                      : "这个问题不依赖本地知识证据，因此允许直接按常识回答。"
                                    : locale.startsWith("en")
                                      ? "Retrieval confidence was too low, so the answer stayed conservative and separated evidence from general guidance."
                                      : "检索信心偏低，因此回答会把本地证据与一般性建议分开表达。"}
                                </p>
                              </div>
                            ) : null}
                            {turn.retrieval.results.length ? (
                              <div className="mt-3 space-y-2.5">
                                {turn.retrieval.results
                                  .slice(
                                    0,
                                    Math.max(
                                      2,
                                      turn.retrieval.results.findIndex(
                                        (result) => `${turn.id}:${result.chunkId}` === expandedCitationKey
                                      ) + 1
                                    )
                                  )
                                  .map((result) => (
                                  <button
                                    key={`${turn.id}:${result.chunkId}`}
                                    id={`citation:${turn.id}:${result.chunkId}`}
                                    type="button"
                                    onClick={() =>
                                      setExpandedCitationKey((current) =>
                                        current === `${turn.id}:${result.chunkId}` ? "" : `${turn.id}:${result.chunkId}`
                                      )
                                    }
                                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2.5 text-left transition hover:border-white/20 hover:bg-slate-950/80"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <p className="text-xs font-semibold text-white">
                                        {result.citationLabel} {result.title}
                                      </p>
                                      <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                                        {result.score.toFixed(1)}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs leading-5 text-slate-400">
                                      {result.sectionPath.length ? result.sectionPath.join(" > ") : "--"}
                                      {result.source ? ` · ${result.source}` : ""}
                                    </p>
                                    <p className="mt-2 text-xs leading-6 text-slate-200">
                                      {expandedCitationKey === `${turn.id}:${result.chunkId}`
                                        ? result.content
                                        : result.content.length > 220
                                          ? `${result.content.slice(0, 220)}…`
                                          : result.content}
                                    </p>
                                    <p className="mt-2 text-[11px] text-cyan-300">
                                      {expandedCitationKey === `${turn.id}:${result.chunkId}`
                                        ? locale.startsWith("en")
                                          ? "Click again to collapse"
                                          : "再次点击可收起"
                                        : locale.startsWith("en")
                                          ? "Click to inspect full citation"
                                          : "点击查看完整引用"}
                                    </p>
                                  </button>
                                ))}
                                {turn.retrieval.results.length > 2 ? (
                                  <p className="px-1 text-xs leading-6 text-slate-400">
                                    +{turn.retrieval.results.length - 2} 条额外证据已命中
                                  </p>
                                ) : null}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs leading-6 text-slate-400">{uiText.retrievalNoEvidence}</p>
                            )}
                          </div>
                        ) : null}

                        {turn.verification ? (
                          <div
                            className={`rounded-2xl border px-3 py-3 ${
                              turn.verification.verdict === "grounded"
                                ? "border-emerald-400/20 bg-emerald-400/5"
                                : turn.verification.verdict === "weakly-grounded"
                                  ? "border-amber-400/20 bg-amber-400/10"
                                  : "border-rose-400/20 bg-rose-400/10"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-200">
                                {uiText.groundedVerification}
                              </p>
                              <span
                                className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] ${
                                  turn.verification.verdict === "grounded"
                                    ? "bg-emerald-400/15 text-emerald-100"
                                    : turn.verification.verdict === "weakly-grounded"
                                      ? "bg-amber-400/15 text-amber-100"
                                      : "bg-rose-400/15 text-rose-100"
                                }`}
                              >
                                {formatGroundedVerdictLabel(turn.verification, {
                                  grounded: uiText.groundedVerdictGrounded,
                                  weaklyGrounded: uiText.groundedVerdictWeak,
                                  unsupported: uiText.groundedVerdictUnsupported,
                                  notApplicable: uiText.groundedVerdictNotApplicable
                                })}
                              </span>
                            </div>
                            <div className="mt-3 grid gap-2 text-xs leading-6 text-slate-200">
                              <p>
                                {uiText.groundedLexicalScore}: {turn.verification.lexicalGroundingScore.toFixed(3)}
                              </p>
                              <div>
                                <p>{uiText.groundedCitations}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {turn.verification.citedLabels.length ? (
                                    turn.verification.citedLabels.map((label) => {
                                      const matchedResult = turn.retrieval?.results.find((result) => result.citationLabel === label);
                                      return (
                                        <button
                                          key={`${turn.id}:cited:${label}`}
                                          type="button"
                                          onClick={() => {
                                            if (!matchedResult) return;
                                            const nextKey = `${turn.id}:${matchedResult.chunkId}`;
                                            setExpandedCitationKey(nextKey);
                                            window.requestAnimationFrame(() => {
                                              document.getElementById(`citation:${turn.id}:${matchedResult.chunkId}`)?.scrollIntoView({
                                                behavior: "smooth",
                                                block: "nearest"
                                              });
                                            });
                                          }}
                                          className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-100 transition hover:bg-white/[0.08]"
                                        >
                                          {label}
                                        </button>
                                      );
                                    })
                                  ) : (
                                    <span className="text-slate-500">--</span>
                                  )}
                                </div>
                              </div>
                              {turn.verification.unsupportedLabels.length ? (
                                <p>
                                  {uiText.groundedUnsupportedCitations}:{" "}
                                  {turn.verification.unsupportedLabels.join(", ")}
                                </p>
                              ) : null}
                              {turn.verification.fallbackApplied ? (
                                <p className="text-amber-100">
                                  {uiText.groundedFallbackApplied}
                                  {turn.verification.fallbackReason
                                    ? ` · ${uiText.groundedFallbackReason}: ${formatGroundedFallbackReason(
                                        turn.verification.fallbackReason,
                                        {
                                          noEvidence: uiText.groundedReasonNoEvidence,
                                          lowConfidence: uiText.groundedReasonLowConfidence,
                                          missingCitations: uiText.groundedReasonMissingCitations,
                                          unsupportedClaims: uiText.groundedReasonUnsupportedClaims
                                        }
                                      )}`
                                    : ""}
                                </p>
                              ) : null}
                            </div>
                            {turn.verification.notes.length ? (
                              <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-3">
                                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                                  {uiText.groundedNotes}
                                </p>
                                <ul className="mt-2 space-y-1 text-xs leading-6 text-slate-200">
                                  {turn.verification.notes.slice(0, 2).map((note, noteIndex) => (
                                    <li key={`${turn.id}:verification-note:${noteIndex}`}>
                                      -{" "}
                                      {formatGroundedNote(note, {
                                        retrievalDisabled: uiText.groundedNoteRetrievalDisabled,
                                        noEvidence: uiText.groundedNoteNoEvidence,
                                        unsupportedCitations: uiText.groundedNoteUnsupportedCitations,
                                        missingCitations: uiText.groundedNoteMissingCitations,
                                        lowConfidence: uiText.groundedNoteLowConfidence,
                                        weakOverlap: uiText.groundedNoteWeakOverlap
                                      })}
                                    </li>
                                  ))}
                                  {turn.verification.notes.length > 2 ? (
                                    <li className="text-slate-500">+{turn.verification.notes.length - 2} 条补充说明</li>
                                  ) : null}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {turn.thinkingFallbackToStandard ? (
                          <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3 py-3 text-sm leading-6 text-amber-100">
                            {uiText.thinkingModelFallback} {turn.resolvedModel}
                          </div>
                        ) : null}

                        {turn.localFallbackUsed ? (
                          <div className="rounded-2xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-3 text-sm leading-6 text-emerald-50">
                            <p>
                              {uiText.localFallbackUsed}
                              {turn.localFallbackTargetLabel ? ` · ${uiText.localFallbackTarget}: ${turn.localFallbackTargetLabel}` : ""}
                            </p>
                            {turn.localFallbackReason ? (
                              <p className="mt-1 text-emerald-100/90">
                                {uiText.localFallbackReason}:{" "}
                                {formatLocalFallbackReason(turn.localFallbackReason, {
                                  loading: uiText.localFallbackReasonLoading,
                                  health: uiText.localFallbackReasonHealth,
                                  empty: uiText.localFallbackReasonEmpty,
                                  failure: uiText.localFallbackReasonFailure,
                                  simple: uiText.localFallbackReasonSimple
                                })}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {turn.connectionCheck ? (
                          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] ${
                                  turn.connectionCheck.ok
                                    ? "bg-emerald-400/15 text-emerald-200"
                                    : "bg-amber-400/15 text-amber-200"
                                }`}
                              >
                                {dictionary.agent.connectionRecord}
                              </span>
                              <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-slate-300">
                                {new Date(turn.connectionCheck.checkedAt).toLocaleString()}
                              </span>
                            </div>
                            <div className="mt-3 grid gap-3">
                              {turn.connectionCheck.stages.map((stage) => (
                                <div
                                  key={`${turn.id}-${stage.id}`}
                                  className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span
                                        className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] ${getConnectionStageBadgeClass(stage.ok)}`}
                                      >
                                        {formatConnectionStageLabel(stage.id)}
                                      </span>
                                      {typeof stage.httpStatus === "number" ? (
                                        <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-slate-300">
                                          http {stage.httpStatus}
                                        </span>
                                      ) : null}
                                    </div>
                                    <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                                      {stage.latencyMs} ms
                                    </span>
                                  </div>
                                  <p className="mt-2 text-sm leading-6 text-slate-300">{stage.summary}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.06] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">{dictionary.agent.assistant}</p>
                            <button
                              type="button"
                              onClick={() => handleCopy(turn.response, `${turn.id}:assistant`)}
                              className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-100 transition hover:bg-cyan-400/20"
                            >
                              {copyState === `${turn.id}:assistant` ? dictionary.common.copied : dictionary.common.copy}
                            </button>
                          </div>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-100">
                            {turn.response}
                          </pre>
                        </div>
                      </article>
                    );
                  })}

                    {pending ? (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm leading-7 text-slate-400">
                        <p className="text-cyan-300">$ agent.run</p>
                        <p className="mt-2">
                          {dictionary.agent.processingWith} {selectedTarget.label}...
                        </p>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <form onSubmit={handleSubmit} className="border-t border-white/10 bg-slate-950/90 px-5 py-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={enableTools}
                        onChange={(event) => setEnableTools(event.target.checked)}
                        className="rounded border-white/20 bg-slate-950"
                      />
                      {dictionary.agent.enableToolLoop}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={enableRetrieval}
                        onChange={(event) => setEnableRetrieval(event.target.checked)}
                        className="rounded border-white/20 bg-slate-950"
                      />
                      {uiText.enableRetrieval}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                      <span>{uiText.contextWindow}</span>
                      <select
                        value={contextWindow}
                        onChange={(event) => setContextWindow(Number(event.target.value))}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-100 outline-none"
                      >
                        {CONTEXT_WINDOW_OPTIONS.map((value) => (
                          <option key={value} value={value}>
                            {value >= 1024 ? `${Math.round(value / 1024)}K` : value}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!turns.length}
                      onClick={() => handleExportTurns("markdown")}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs uppercase tracking-[0.22em] text-slate-300 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {dictionary.agent.exportMarkdown}
                    </button>
                    <button
                      type="button"
                      disabled={!turns.length}
                      onClick={() => handleExportTurns("json")}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs uppercase tracking-[0.22em] text-slate-300 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {dictionary.agent.exportJson}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        startNewSession();
                      }}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs uppercase tracking-[0.22em] text-slate-300 transition hover:border-white/20 hover:bg-white/[0.08]"
                    >
                      {dictionary.agent.clearSession}
                    </button>
                  </div>
                </div>

                <textarea
                  ref={composerRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  rows={5}
                  placeholder={starterPrompts[0]}
                  className="min-h-[150px] w-full resize-y rounded-3xl border border-white/10 bg-black/25 px-4 py-4 font-mono text-sm leading-7 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/40 focus:bg-black/35"
                />
                <p className="mt-2 text-xs text-slate-500">{uiText.enterHint}</p>

                {selectedTarget.execution === "local" && runtimeStatus ? (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] ${runtimePhase.className}`}>
                          {runtimePhase.label}
                        </span>
                        {typeof runtimeStatus.queueDepth === "number" ? (
                          <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-slate-300">
                            {uiText.queueLabel} {runtimeStatus.queueDepth}
                          </span>
                        ) : null}
                        {typeof runtimeStatus.activeRequests === "number" ? (
                          <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-slate-300">
                            {uiText.activeLabel} {runtimeStatus.activeRequests}
                          </span>
                        ) : null}
                        {loadedAliasForSelectedTarget ? (
                          <span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-cyan-300">
                            {describeRuntimeAlias(loadedAliasForSelectedTarget, agentTargets)}
                          </span>
                        ) : null}
                        {gatewayLoadedOtherAlias ? (
                          <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-slate-300">
                            {uiText.runtimeCurrentLoaded} {describeRuntimeAlias(gatewayLoadedOtherAlias, agentTargets)}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={prewarmAllPending || prewarmPending || pending || Boolean(runtimeActionPending)}
                          onClick={handlePrewarmAll}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                        >
                          {prewarmAllPending ? uiText.prewarmingAll : uiText.prewarmAllModels}
                        </button>
                        <button
                          type="button"
                          disabled={prewarmAllPending || prewarmPending || pending || Boolean(runtimeActionPending)}
                          onClick={handlePrewarm}
                          className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                        >
                          {prewarmPending ? uiText.prewarming : uiText.prewarmModel}
                        </button>
                      </div>
                    </div>
                    <p className="mt-2 text-xs leading-6 text-slate-400">
                      {runtimeStatus.phaseDetail ||
                        (runtimeStatus.available
                          ? runtimeStatus.busy
                            ? uiText.runtimeSerializing
                            : uiText.runtimeReady
                          : runtimeStatus.message || uiText.runtimeUnavailable)}
                    </p>
                      {runtimeStatus.loadingAlias ? (
                        <div className="mt-2 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-6 text-amber-100">
                          <p>
                          {uiText.runtimeSwitchingNow}: {describeRuntimeAlias(runtimeStatus.loadingAlias, agentTargets)}
                          {typeof runtimeStatus.loadingElapsedMs === "number"
                            ? ` · ${uiText.runtimeLoadingElapsed} ${Math.max(1, Math.round(runtimeStatus.loadingElapsedMs / 1000))}s`
                            : ""}
                        </p>
                        {selectedTarget.id === "local-qwen3-4b-4bit" || selectedTarget.id === "local-qwen35-4b-4bit" ? (
                          <p className="mt-1 text-amber-50/90">{uiText.runtimeDowngradeHint}</p>
                        ) : null}
                      </div>
                    ) : null}
                    {runtimeStatus.loadingError ? (
                      <div className="mt-2 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs leading-6 text-rose-100">
                        {uiText.runtimeLoadingError}: {runtimeStatus.loadingError}
                      </div>
                    ) : null}
                    {prewarmMessage ? (
                      <p className="mt-1 text-xs leading-6 text-cyan-200">{prewarmMessage}</p>
                    ) : null}
                  </div>
                ) : null}

                {error ? (
                  <div className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-3 py-3 text-sm text-rose-100">
                    {error}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    {dictionary.common.endpoint} {selectedTarget.baseUrlEnv} · {dictionary.common.model}{" "}
                    {selectedTarget.modelEnv}
                  </div>
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
                  >
                    {pending ? uiText.submitting : uiText.submit}
                  </button>
                </div>
              </form>
            </div>

            <aside className="bg-white/[0.03]">
              <div className="border-b border-white/10 px-5 py-3.5">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{dictionary.nav.agent}</p>
                <h3 className="mt-1.5 text-base font-semibold text-white">
                  {dictionary.agent.localRuntime} / {dictionary.agent.promptFrame}
                </h3>
              </div>

              <div className="space-y-4 px-5 py-4">
                <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{dictionary.agent.resolvedEndpoint}</p>
                  <p className="mt-1.5 break-all text-[13px] leading-6 text-slate-200">
                    {lastTurn?.resolvedBaseUrl || selectedTarget.baseUrlDefault}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{dictionary.agent.providerSelfCheck}</p>
                      <p className="mt-1.5 text-[13px] leading-6 text-slate-300">
                        {dictionary.agent.selfCheckDescription}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!supportsConnectionCheck || connectionCheckPending || pending}
                        onClick={handleConnectionCheck}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                      >
                        {connectionCheckPending ? dictionary.agent.checking : dictionary.agent.runCheck}
                      </button>
                      <a
                        href={`/api/agent/check-history/export?targetId=${encodeURIComponent(selectedTargetId)}&format=markdown`}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                      >
                        {dictionary.agent.exportMarkdown}
                      </a>
                      <a
                        href={`/api/agent/check-history/export?targetId=${encodeURIComponent(selectedTargetId)}&format=json`}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                      >
                        {dictionary.agent.exportJson}
                      </a>
                    </div>
                  </div>

                  {!supportsConnectionCheck ? (
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                      {dictionary.agent.checkOnlyRemote}
                    </p>
                  ) : null}

                  {connectionCheckError ? (
                    <div className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-3 py-3 text-sm text-rose-100">
                      {connectionCheckError}
                    </div>
                  ) : null}

                  {connectionCheck ? (
                    <div className="mt-3.5 space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] ${
                            connectionCheck.ok
                              ? "bg-emerald-400/15 text-emerald-200"
                              : "bg-amber-400/15 text-amber-200"
                          }`}
                        >
                          {connectionCheck.ok ? dictionary.agent.allChecksPassed : dictionary.agent.checkAttention}
                        </span>
                        <span className="rounded-full bg-white/[0.04] px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] text-slate-300">
                          {new Date(connectionCheck.checkedAt).toLocaleTimeString()}
                        </span>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-xs leading-6 text-slate-300">
                        <p>{dictionary.common.model}: {connectionCheck.resolvedModel}</p>
                        <p className="break-all">{dictionary.common.endpoint}: {connectionCheck.resolvedBaseUrl}</p>
                        {connectionCheck.docsUrl ? (
                          <a
                            href={connectionCheck.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-cyan-300 underline decoration-cyan-300/40 underline-offset-4"
                          >
                            {dictionary.agent.openDocs}
                          </a>
                        ) : null}
                        <p className="mt-2 text-slate-500">
                          {dictionary.agent.historySavedAt}: <span className="text-slate-300">data/agent-observability</span>
                        </p>
                      </div>

                      {connectionCheck.stages.map((stage) => (
                        <div
                          key={stage.id}
                          className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-full px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] ${getConnectionStageBadgeClass(stage.ok)}`}
                              >
                                {formatConnectionStageLabel(stage.id)}
                              </span>
                              <span className="rounded-full bg-white/[0.04] px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] text-slate-300">
                                {stage.ok ? dictionary.common.ok : dictionary.common.failed}
                              </span>
                              {typeof stage.httpStatus === "number" ? (
                                <span className="rounded-full bg-white/[0.04] px-2 py-[3px] text-[10px] uppercase tracking-[0.18em] text-slate-300">
                                  http {stage.httpStatus}
                                </span>
                              ) : null}
                            </div>
                            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                              {stage.latencyMs} ms
                            </span>
                          </div>
                          <p className="mt-1.5 text-[13px] leading-6 text-slate-300">{stage.summary}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{dictionary.agent.resolvedModel}</p>
                  <div className="mt-2.5 space-y-2.5 text-sm text-slate-300">
                    <div>
                      <p className="text-slate-500">{dictionary.common.model}</p>
                      <p className="mt-1 break-all text-[13px] leading-6 text-slate-200">
                        {runtimeStatus?.resolvedModel || lastTurn?.resolvedModel || selectedTarget.modelDefault}
                      </p>
                    </div>
                    {selectedTarget.execution === "remote" ? (
                      <>
                        <div>
                          <p className="text-slate-500">{uiText.thinkingModeStandard}</p>
                          <p className="mt-1 break-all text-[13px] leading-6 text-slate-200">
                            {runtimeStatus?.standardResolvedModel || selectedTarget.modelDefault}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">{uiText.thinkingModeThinking}</p>
                          <p className="mt-1 break-all text-[13px] leading-6 text-slate-200">
                            {runtimeStatus?.thinkingResolvedModel || selectedTarget.thinkingModelDefault || selectedTarget.modelDefault}
                          </p>
                        </div>
                      </>
                    ) : null}
                    <div>
                      <p className="text-slate-500">{dictionary.common.endpoint}</p>
                      <p className="mt-1 break-all text-[13px] leading-6 text-slate-200">
                        {lastTurn?.resolvedBaseUrl || selectedTarget.baseUrlDefault}
                      </p>
                    </div>
                    {connectionCheck?.docsUrl ? (
                      <div>
                        <a
                          href={connectionCheck.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block text-cyan-300 underline decoration-cyan-300/40 underline-offset-4"
                        >
                          {dictionary.agent.openDocs}
                        </a>
                      </div>
                    ) : null}
                    <div>
                      <p className="text-slate-500">{dictionary.agent.historySavedAt}</p>
                      <p className="mt-1 text-xs leading-6 text-slate-400">data/agent-observability</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{dictionary.agent.promptFrame}</p>
                  <textarea
                    value={systemPrompt}
                    onChange={(event) => setSystemPrompt(event.target.value)}
                    rows={14}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-3 font-mono text-xs leading-6 text-slate-200 outline-none transition focus:border-cyan-400/40"
                  />
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{dictionary.agent.launchHints}</p>
                  <div className="mt-2 space-y-2">
                    {(selectedTarget.launchHints || [uiText.fallbackLaunchHint]).map(
                      (hint) => (
                        <pre
                          key={hint}
                          className="overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 font-mono text-xs leading-6 text-slate-200"
                        >
                          {hint}
                        </pre>
                      )
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{dictionary.agent.localRuntime}</p>
                    {selectedTarget.execution === "local" ? (
                      <span className={`rounded-full px-2 py-[3px] text-[10px] uppercase tracking-[0.2em] ${runtimePhase.className}`}>
                        {runtimePhase.label}
                      </span>
                    ) : null}
                  </div>
                  {runtimeStatus ? (
                    <div className="mt-3 space-y-3 text-sm text-slate-200">
                      <div className="flex flex-wrap items-center gap-2">
                        {typeof runtimeStatus.queueDepth === "number" ? (
                          <span className="rounded-full bg-white/[0.04] px-2 py-[3px] text-[10px] uppercase tracking-[0.2em] text-slate-300">
                            {uiText.queueLabel} {runtimeStatus.queueDepth}
                          </span>
                        ) : null}
                        {typeof runtimeStatus.activeRequests === "number" ? (
                          <span className="rounded-full bg-white/[0.04] px-2 py-[3px] text-[10px] uppercase tracking-[0.2em] text-slate-300">
                            {uiText.activeLabel} {runtimeStatus.activeRequests}
                          </span>
                        ) : null}
                        {loadedAliasForSelectedTarget ? (
                          <span className="rounded-full bg-cyan-400/10 px-2 py-[3px] text-[10px] uppercase tracking-[0.2em] text-cyan-300">
                            {describeRuntimeAlias(loadedAliasForSelectedTarget, agentTargets)}
                          </span>
                        ) : null}
                        {gatewayLoadedOtherAlias ? (
                          <span className="rounded-full bg-white/[0.04] px-2 py-[3px] text-[10px] uppercase tracking-[0.2em] text-slate-300">
                            {uiText.runtimeCurrentLoaded} {describeRuntimeAlias(gatewayLoadedOtherAlias, agentTargets)}
                          </span>
                        ) : null}
                        {runtimeStatus.loadingAlias ? (
                          <span className="rounded-full bg-amber-400/10 px-2 py-[3px] text-[10px] uppercase tracking-[0.2em] text-amber-200">
                            {uiText.runtimeSwitchingNow}: {describeRuntimeAlias(runtimeStatus.loadingAlias, agentTargets)}
                          </span>
                        ) : null}
                      </div>
                      <div>
                        <p className="text-slate-500">{uiText.runtimeMessage}</p>
                        <p className="mt-1 leading-6">
                          {runtimeStatus.phaseDetail || runtimeStatus.message || dictionary.common.unknown}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">{locale.startsWith("en") ? "Runtime stage" : "运行阶段"}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {runtimeStageItems.map((step) => (
                            <span
                              key={`runtime-stage:${step.key}`}
                              className={`rounded-full border px-2 py-[3px] text-[10px] uppercase tracking-[0.2em] ${
                                step.active
                                  ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-200"
                                  : step.completed
                                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                                    : "border-white/10 bg-white/[0.04] text-slate-400"
                              }`}
                            >
                              {step.label}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-slate-500">{uiText.supervisor}</p>
                          <p className="mt-1 break-all text-white">
                            {runtimeStatus.supervisorPid ?? dictionary.common.unknown} ·{" "}
                            {runtimeStatus.supervisorAlive ? dictionary.common.ok : dictionary.common.failed}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">{uiText.gatewayProcess}</p>
                          <p className="mt-1 break-all text-white">
                            {runtimeStatus.gatewayPid ?? dictionary.common.unknown} ·{" "}
                            {runtimeStatus.gatewayAlive ? dictionary.common.ok : dictionary.common.failed}
                          </p>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-slate-500">{uiText.runtimeCurrentLoaded}</p>
                          <p className="mt-1 break-all text-white">
                            {describeRuntimeAlias(runtimeStatus.loadedAlias, agentTargets)}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">{uiText.runtimeLastSwitchLoad}</p>
                          <p className="mt-1 break-all text-white">{formatRuntimeDuration(selectedTargetLastSwitchMs)}</p>
                        </div>
                        <div>
                          <p className="text-slate-500">{uiText.runtimeLastSwitchAt}</p>
                          <p className="mt-1 break-all text-white">
                            {formatRuntimeTimestamp(selectedTargetLastSwitchAt, locale)}
                          </p>
                        </div>
                      </div>
                      {(runtimeStatus.loadingAlias || runtimeStatus.loadingError) ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          {runtimeStatus.loadingAlias ? (
                            <div>
                              <p className="text-slate-500">{uiText.runtimeSwitchingNow}</p>
                              <p className="mt-1 break-all text-white">
                                {describeRuntimeAlias(runtimeStatus.loadingAlias, agentTargets)}
                                {typeof runtimeStatus.loadingElapsedMs === "number"
                                  ? ` · ${uiText.runtimeLoadingElapsed} ${Math.max(1, Math.round(runtimeStatus.loadingElapsedMs / 1000))}s`
                                  : ""}
                              </p>
                            </div>
                          ) : null}
                          {runtimeStatus.loadingError ? (
                            <div>
                              <p className="text-slate-500">{uiText.runtimeLoadingError}</p>
                              <p className="mt-1 break-all text-rose-200">{runtimeStatus.loadingError}</p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {prewarmMessage ? (
                        <div>
                          <p className="text-slate-500">{uiText.runtimeActions}</p>
                          <p className="mt-1 leading-6 text-cyan-200">{prewarmMessage}</p>
                        </div>
                      ) : null}
                      {runtimeLogExcerpt ? (
                        <div>
                          <p className="text-slate-500">{uiText.logExcerpt}</p>
                          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-3 font-mono text-xs leading-6 text-slate-300">
                            {runtimeLogExcerpt}
                          </pre>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
                        <button
                          type="button"
                          disabled={prewarmAllPending || prewarmPending || pending || Boolean(runtimeActionPending)}
                          onClick={handlePrewarmAll}
                          className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                        >
                          {prewarmAllPending ? uiText.prewarmingAll : uiText.prewarmAllModels}
                        </button>
                        <button
                          type="button"
                          disabled={prewarmAllPending || prewarmPending || pending || Boolean(runtimeActionPending)}
                          onClick={handlePrewarm}
                          className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                        >
                          {prewarmPending ? uiText.prewarming : uiText.prewarmModel}
                        </button>
                        <button
                          type="button"
                          disabled={prewarmAllPending || prewarmPending || pending || Boolean(runtimeActionPending)}
                          onClick={() => void handleRuntimeAction("release")}
                          className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                        >
                          {runtimeActionPending === "release" ? uiText.releasingModel : uiText.releaseModel}
                        </button>
                        <button
                          type="button"
                          disabled={prewarmAllPending || prewarmPending || pending || Boolean(runtimeActionPending)}
                          onClick={() => void handleRuntimeAction("restart")}
                          className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                        >
                          {runtimeActionPending === "restart" ? uiText.restartingGateway : uiText.restartGateway}
                        </button>
                        <button
                          type="button"
                          disabled={prewarmAllPending || prewarmPending || pending || Boolean(runtimeActionPending)}
                          onClick={() => void handleRuntimeAction("read_log")}
                          className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
                        >
                          {runtimeActionPending === "read_log" ? uiText.loadingRuntimeLog : uiText.viewRuntimeLog}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm leading-6 text-slate-400">{dictionary.agent.checking}</p>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
