"use client";

import type { AgentToolRun } from "@/lib/agent/types";

type ParsedToolOutput = Record<string, unknown>;

export type ToolReviewItem = {
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

export type FocusedFileExcerpt = {
  startLine: number;
  endLine: number;
  content: string;
};

export type ReplayComparison = {
  sourceLabel: string;
  replayModeLabel: string;
  targetModeLabel: string;
  summary: string;
  responseDelta: number;
  keyDiffs: string[];
};

type ReplayTurnLike = {
  targetId: string;
  response: string;
  replaySource?: {
    targetId: string;
    targetLabel: string;
    resolvedModel: string;
    response: string;
    includeHistory: boolean;
    targetMode: "original" | "current";
  };
};

type ToolReviewTurnLike = {
  id: string;
  toolRuns: AgentToolRun[];
};

export function parseToolOutput(output: string): ParsedToolOutput | null {
  try {
    const parsed = JSON.parse(output) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ParsedToolOutput)
      : null;
  } catch {
    return null;
  }
}

export function readStringField(source: ParsedToolOutput | null, key: string) {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value : "";
}

export function readBooleanField(source: ParsedToolOutput | null, key: string) {
  return typeof source?.[key] === "boolean" ? Boolean(source[key]) : null;
}

export function readArrayField(source: ParsedToolOutput | null, key: string) {
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

export function readNewFileLineAnchorsFromDiff(diffPreview: string) {
  if (!diffPreview.trim()) return [];
  const matches = [...diffPreview.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm)];
  return matches
    .map((match) => Number(match[1]))
    .filter((value, index, list) => Number.isFinite(value) && value > 0 && list.indexOf(value) === index);
}

export function buildFocusedFileExcerpt(content: string, lineNumber: number, radius = 16): FocusedFileExcerpt {
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

export function buildReplayComparison(turn: ReplayTurnLike, locale: string): ReplayComparison | null {
  if (!turn.replaySource) return null;
  const originalResponse = turn.replaySource.response.trim();
  const replayResponse = turn.response.trim();
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

export function buildReplayComparisonSummaryText(comparison: ReplayComparison | null, locale: string) {
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

export function collectToolReviewItems(turn: ToolReviewTurnLike): ToolReviewItem[] {
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
