import { NextResponse } from "next/server";
import crypto from "crypto";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "@/lib/agent/prompts";
import {
  clampContextWindowForTarget,
  normalizeContextWindow
} from "@/lib/agent/metrics";
import {
  normalizeProviderProfile,
  normalizeThinkingMode,
  resolveEffectiveProviderProfile,
  runAgentRequest
} from "@/lib/agent/providers";
import { getAgentTarget } from "@/lib/agent/catalog";
import {
  applyGroundedResponsePolicy,
  applyRetrievalBypassStrategy,
  buildGroundedSystemPrompt,
  searchKnowledgeBase
} from "@/lib/agent/retrieval-store";
import { buildSessionMemory, buildTaskPlan, composeOperationalSystemPrompt } from "@/lib/agent/session-intelligence";
import { buildWorkspaceScoutEvidence } from "@/lib/agent/workspace-scout";
import { beginTrackedRequest, finishTrackedRequest } from "@/lib/agent/runtime-state";
import type {
  AgentChatRequest,
  AgentCompareIntent,
  AgentCompareOutputShape,
  AgentCompareRequest,
  AgentCompareResponse,
  AgentCompareLaneResult,
  AgentMessage
} from "@/lib/agent/types";

export const runtime = "nodejs";

function isValidMessageArray(value: unknown): value is AgentMessage[] {
  return (
    Array.isArray(value) &&
    value.every(
      (message) =>
        message &&
        typeof message === "object" &&
        typeof (message as { role?: unknown }).role === "string" &&
        typeof (message as { content?: unknown }).content === "string" &&
        (((message as { role?: unknown }).role === "user") ||
          ((message as { role?: unknown }).role === "assistant"))
    )
  );
}

function normalizeCompareIntent(value: unknown): AgentCompareIntent {
  return value === "preset-vs-preset" ||
    value === "template-vs-template" ||
    value === "before-vs-after"
    ? value
    : "model-vs-model";
}

function normalizeCompareOutputShape(value: unknown): AgentCompareOutputShape {
  return value === "bullet-list" || value === "strict-json" ? value : "freeform";
}

function buildCompareOutputInstructions(shape: AgentCompareOutputShape) {
  if (shape === "bullet-list") {
    return {
      systemPrompt: [
        "Compare lab output contract:",
        "- Answer using 4 to 6 concise bullet points.",
        "- Avoid long preambles.",
        "- Keep each bullet grounded in the user's task."
      ].join("\n"),
      inputSuffix: ""
    };
  }

  if (shape === "strict-json") {
    return {
      systemPrompt: [
        "Compare lab output contract:",
        "- Return valid JSON only.",
        "- Do not wrap the JSON in markdown fences.",
        '- Use the schema: {"answer": string, "key_points": string[], "warnings": string[]}.',
        "- Ensure all keys are always present."
      ].join("\n"),
      inputSuffix:
        '\n\nStrict output requirement: return valid JSON only using {"answer": string, "key_points": string[], "warnings": string[]}.'
    };
  }

  return {
    systemPrompt: "",
    inputSuffix: ""
  };
}

function buildFairnessFingerprint(params: {
  compareOutputShape: AgentCompareOutputShape;
  contextWindow: number;
  providerProfile: AgentChatRequest["providerProfile"];
  thinkingMode: AgentChatRequest["thinkingMode"];
  enableTools: boolean;
  enableRetrieval: boolean;
  targetIds: string[];
}) {
  return [
    `targets:${params.targetIds.join(",")}`,
    `context:${params.contextWindow}`,
    `profile:${params.providerProfile || "balanced"}`,
    `thinking:${params.thinkingMode || "standard"}`,
    `tools:${params.enableTools ? "on" : "off"}`,
    `retrieval:${params.enableRetrieval ? "on" : "off"}`,
    `shape:${params.compareOutputShape}`
  ].join(" | ");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AgentCompareRequest>;

    if (!Array.isArray(body.targetIds) || body.targetIds.length < 2) {
      return NextResponse.json({ error: "targetIds must contain at least two targets." }, { status: 400 });
    }
    if (!body.input || typeof body.input !== "string") {
      return NextResponse.json({ error: "input is required." }, { status: 400 });
    }
    if (!isValidMessageArray(body.messages)) {
      return NextResponse.json({ error: "messages must be a valid history array." }, { status: 400 });
    }

    const targetIds = Array.from(new Set(body.targetIds.filter((value): value is string => typeof value === "string"))).slice(0, 4);
    if (targetIds.length < 2) {
      return NextResponse.json({ error: "Need at least two valid targetIds." }, { status: 400 });
    }

    for (const targetId of targetIds) {
      if (!getAgentTarget(targetId)) {
        return NextResponse.json({ error: `Unknown target: ${targetId}` }, { status: 404 });
      }
    }

    const compareIntent = normalizeCompareIntent(body.compareIntent);
    const compareOutputShape = normalizeCompareOutputShape(body.compareOutputShape);
    const thinkingMode = normalizeThinkingMode(body.thinkingMode);
    const requestedProviderProfile = normalizeProviderProfile(body.providerProfile);
    const providerProfile = resolveEffectiveProviderProfile(
      requestedProviderProfile,
      thinkingMode,
      body.input,
      body.messages
    );
    const requestedContextWindow = normalizeContextWindow(body.contextWindow, 32768);
    const enableTools = Boolean(body.enableTools);
    const enableRetrieval = Boolean(body.enableRetrieval);
    const retrieval = enableRetrieval
      ? applyRetrievalBypassStrategy(body.input, searchKnowledgeBase(body.input, 4))
      : null;
    const memorySummary =
      typeof body.memorySummary === "string" && body.memorySummary.trim()
        ? body.memorySummary.trim()
        : buildSessionMemory(body.messages);
    const plannerSteps = body.plannerEnabled === false
      ? []
      : buildTaskPlan(body.input, { enableTools, enableRetrieval });
    const workspaceScoutEvidence = await buildWorkspaceScoutEvidence(body.input);
    const baseSystemPrompt =
      typeof body.systemPrompt === "string" && body.systemPrompt.trim()
        ? body.systemPrompt
        : DEFAULT_AGENT_SYSTEM_PROMPT;
    const shapeInstructions = buildCompareOutputInstructions(compareOutputShape);
    const systemPrompt = composeOperationalSystemPrompt(
      buildGroundedSystemPrompt(
        [baseSystemPrompt, shapeInstructions.systemPrompt].filter(Boolean).join("\n\n"),
        retrieval
      ),
      memorySummary,
      plannerSteps,
      {
        input: body.input,
        enableTools,
        enableRetrieval,
        workspaceScoutEvidence
      }
    );
    const effectiveInput = `${body.input}${shapeInstructions.inputSuffix}`;

    const localLaneContexts = targetIds
      .filter((targetId) => getAgentTarget(targetId)?.execution === "local")
      .map((targetId) =>
        clampContextWindowForTarget(targetId, requestedContextWindow, {
          enableTools,
          enableRetrieval
        })
      );
    const alignedRemoteContextWindow = localLaneContexts.length
      ? Math.min(...localLaneContexts)
      : requestedContextWindow;

    const results: AgentCompareLaneResult[] = [];
    for (const targetId of targetIds) {
      const target = getAgentTarget(targetId)!;
      const laneContextWindow = clampContextWindowForTarget(
        targetId,
        target.execution === "remote" ? alignedRemoteContextWindow : requestedContextWindow,
        {
          enableTools,
          enableRetrieval
        }
      );

      const laneStartedAt = Date.now();
      beginTrackedRequest(targetId);
      try {
        const response = await runAgentRequest(
          {
            targetId,
            input: effectiveInput,
            messages: body.messages,
            systemPrompt,
            enableTools,
            enableRetrieval,
            contextWindow: laneContextWindow,
            providerProfile,
            thinkingMode,
            plannerEnabled: body.plannerEnabled,
            memorySummary
          },
          systemPrompt
        );
        const grounded = enableRetrieval
          ? applyGroundedResponsePolicy(response.content || response.warning || "", retrieval)
          : null;
        results.push({
          targetId,
          targetLabel: response.targetLabel,
          providerLabel: response.providerLabel,
          execution: response.execution || target.execution,
          resolvedModel: response.resolvedModel,
          resolvedBaseUrl: response.resolvedBaseUrl,
          providerProfile: response.providerProfile || providerProfile,
          thinkingMode: response.thinkingMode || thinkingMode,
          contextWindow: laneContextWindow,
          content: grounded?.content || response.content,
          warning: response.warning,
          retrieval: retrieval || undefined,
          verification: grounded?.verification,
          toolRuns: response.toolRuns,
          usage: response.usage,
          latencyMs: Date.now() - laneStartedAt,
          ok: true
        });
        finishTrackedRequest(targetId, true);
      } catch (error) {
        results.push({
          targetId,
          targetLabel: target.label,
          providerLabel: target.providerLabel,
          execution: target.execution,
          resolvedModel: target.modelDefault,
          resolvedBaseUrl: target.baseUrlDefault,
          providerProfile,
          thinkingMode,
          contextWindow: laneContextWindow,
          content: "",
          warning: error instanceof Error ? error.message : "Unknown compare lane failure.",
          toolRuns: [],
          latencyMs: Date.now() - laneStartedAt,
          ok: false
        });
        finishTrackedRequest(targetId, false);
      }
    }

    const response: AgentCompareResponse = {
      ok: results.every((lane) => lane.ok),
      runId: crypto.randomUUID(),
      generatedAt: new Date().toISOString(),
      compareIntent,
      compareOutputShape,
      fairnessFingerprint: buildFairnessFingerprint({
        compareOutputShape,
        contextWindow: requestedContextWindow,
        providerProfile,
        thinkingMode,
        enableTools,
        enableRetrieval,
        targetIds
      }),
      warning:
        compareIntent === "model-vs-model"
          ? undefined
          : "Compare v1 currently executes shared locked controls across lanes. Preset and template lane overrides land in the next slice.",
      results
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown compare error."
      },
      { status: 500 }
    );
  }
}
