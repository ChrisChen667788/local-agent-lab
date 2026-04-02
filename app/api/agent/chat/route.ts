import { NextResponse } from "next/server";
import crypto from "crypto";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "@/lib/agent/prompts";
import {
  calculateTokenThroughputTps,
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
import { appendChatLog } from "@/lib/agent/log-store";
import { lookupPromptCache, savePromptCache } from "@/lib/agent/cache-store";
import {
  applyRetrievalBypassStrategy,
  applyGroundedResponsePolicy,
  buildGroundedSystemPrompt,
  searchKnowledgeBase
} from "@/lib/agent/retrieval-store";
import { buildSessionMemory, buildTaskPlan, composeOperationalSystemPrompt } from "@/lib/agent/session-intelligence";
import { beginTrackedRequest, finishTrackedRequest } from "@/lib/agent/runtime-state";
import type { AgentChatRequest, AgentChatResponse, AgentMessage } from "@/lib/agent/types";

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
        ((message as { role?: unknown }).role === "user" ||
          (message as { role?: unknown }).role === "assistant")
    )
  );
}

export async function POST(request: Request) {
  let targetId = "";
  let requestStartedAt = Date.now();
  let contextWindow = 8192;
  let providerProfile = normalizeProviderProfile(undefined);
  let thinkingMode = normalizeThinkingMode(undefined);
  try {
    const body = (await request.json()) as Partial<AgentChatRequest>;

    if (!body.targetId || typeof body.targetId !== "string") {
      return NextResponse.json({ error: "targetId is required." }, { status: 400 });
    }
    targetId = body.targetId;

    if (!body.input || typeof body.input !== "string") {
      return NextResponse.json({ error: "input is required." }, { status: 400 });
    }

    if (!isValidMessageArray(body.messages)) {
      return NextResponse.json({ error: "messages must be a valid history array." }, { status: 400 });
    }

    const target = getAgentTarget(body.targetId);
    if (!target) {
      return NextResponse.json({ error: `Unknown target: ${body.targetId}` }, { status: 404 });
    }

    requestStartedAt = Date.now();
    contextWindow = clampContextWindowForTarget(
      body.targetId,
      normalizeContextWindow(body.contextWindow, 8192),
      {
        enableTools: body.enableTools,
        enableRetrieval: body.enableRetrieval
      }
    );
    const retrieval = body.enableRetrieval
      ? applyRetrievalBypassStrategy(body.input, searchKnowledgeBase(body.input, 4))
      : null;
    const memorySummary = typeof body.memorySummary === "string" && body.memorySummary.trim()
      ? body.memorySummary.trim()
      : buildSessionMemory(body.messages);
    const plannerSteps = body.plannerEnabled === false ? [] : buildTaskPlan(body.input, {
      enableTools: body.enableTools,
      enableRetrieval: body.enableRetrieval
    });
    providerProfile = resolveEffectiveProviderProfile(
      normalizeProviderProfile(body.providerProfile),
      normalizeThinkingMode(body.thinkingMode),
      body.input,
      body.messages
    );
    thinkingMode = normalizeThinkingMode(body.thinkingMode);
    const groundedPrompt = buildGroundedSystemPrompt(
      typeof body.systemPrompt === "string" && body.systemPrompt.trim()
        ? body.systemPrompt
        : DEFAULT_AGENT_SYSTEM_PROMPT,
      retrieval
    );
    const systemPrompt = composeOperationalSystemPrompt(groundedPrompt, memorySummary, plannerSteps, {
      input: body.input,
      enableTools: body.enableTools,
      enableRetrieval: body.enableRetrieval
    });
    beginTrackedRequest(body.targetId);

    const cacheLookup =
      target.execution === "remote" &&
      !body.enableTools &&
      !body.enableRetrieval &&
      thinkingMode === "standard"
        ? lookupPromptCache({
            targetId: body.targetId,
            resolvedModel: target.modelDefault,
            providerProfile,
            thinkingMode,
            contextWindow,
            retrievalEnabled: false,
            input: body.input
          })
        : null;

    const response: AgentChatResponse = cacheLookup
      ? {
          content: cacheLookup.entry.content,
          providerLabel: target.providerLabel,
          targetLabel: target.label,
          resolvedModel: cacheLookup.entry.resolvedModel,
          resolvedBaseUrl: target.baseUrlDefault,
          providerProfile,
          thinkingMode,
          thinkingFallbackToStandard: false,
          toolRuns: [],
          execution: target.execution,
          usage: cacheLookup.entry.usage,
          warning: undefined,
          cacheHit: true,
          cacheMode: cacheLookup.mode,
          plannerSteps,
          memorySummary
        }
      : await runAgentRequest(
          {
            targetId: body.targetId,
            input: body.input,
            messages: body.messages,
            systemPrompt,
            enableTools: body.enableTools,
            enableRetrieval: body.enableRetrieval,
            contextWindow,
            providerProfile,
            thinkingMode,
            plannerEnabled: body.plannerEnabled,
            memorySummary
          },
          systemPrompt
        );

    const grounded = body.enableRetrieval
      ? applyGroundedResponsePolicy(response.content || response.warning || "", retrieval)
      : null;
    const finalContent = grounded?.content || response.content;
    const completedAt = new Date().toISOString();
    const totalLatencyMs = Date.now() - requestStartedAt;
    appendChatLog({
      kind: "chat",
      id: crypto.randomUUID(),
      targetId: body.targetId,
      targetLabel: response.targetLabel,
      providerLabel: response.providerLabel,
      execution: response.execution || target.execution,
      resolvedModel: response.resolvedModel,
      resolvedBaseUrl: response.resolvedBaseUrl,
      contextWindow,
      providerProfile,
      thinkingMode,
      retrievalEnabled: Boolean(body.enableRetrieval),
      retrievalHitCount: retrieval?.hitCount || 0,
      retrievalLowConfidence: retrieval?.lowConfidence || false,
      groundedVerdict: grounded?.verification.verdict,
      groundedFallbackApplied: grounded?.verification.fallbackApplied,
      groundedCitationCount: grounded?.verification.citedLabels.length,
      groundedUnsupportedCitationCount: grounded?.verification.unsupportedLabels.length,
      cacheHit: response.cacheHit,
      cacheMode: response.cacheMode,
      plannerStepCount: response.plannerSteps?.length || plannerSteps.length,
      memorySummaryLength: memorySummary.length || undefined,
      startedAt: new Date(requestStartedAt).toISOString(),
      completedAt,
      latencyMs: totalLatencyMs,
      firstTokenLatencyMs: undefined,
      tokenThroughputTps: calculateTokenThroughputTps(
        response.usage?.completionTokens,
        totalLatencyMs,
        undefined
      ),
      ok: true,
      inputPreview: body.input.slice(0, 400),
      outputPreview: (finalContent || response.warning || "").slice(0, 600),
      toolRunsCount: response.toolRuns.length,
      warning: response.warning,
      usage: response.usage || {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      }
    });
    if (!cacheLookup && target.execution === "remote" && !body.enableTools && !body.enableRetrieval && thinkingMode === "standard" && finalContent?.trim()) {
      savePromptCache({
        targetId: body.targetId,
        resolvedModel: response.resolvedModel,
        providerProfile,
        thinkingMode,
        contextWindow,
        retrievalEnabled: false,
        input: body.input,
        content: finalContent,
        usage: response.usage
      });
    }
    finishTrackedRequest(body.targetId, true);

    return NextResponse.json({
      ...response,
      content: finalContent,
      retrieval: retrieval || undefined,
      verification: grounded?.verification,
      plannerSteps: response.plannerSteps || plannerSteps,
      memorySummary
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (targetId) {
      finishTrackedRequest(targetId, false);
      const target = getAgentTarget(targetId);
      appendChatLog({
        kind: "chat",
        id: crypto.randomUUID(),
        targetId,
        targetLabel: target?.label || targetId,
        providerLabel: target?.providerLabel || "unknown",
        execution: target?.execution || "remote",
        resolvedModel: target?.modelDefault || "unknown",
        resolvedBaseUrl: target?.baseUrlDefault || "unknown",
        contextWindow,
        providerProfile,
        thinkingMode,
        retrievalEnabled: false,
        retrievalHitCount: 0,
        retrievalLowConfidence: false,
        groundedVerdict: undefined,
        groundedFallbackApplied: false,
        groundedCitationCount: 0,
        groundedUnsupportedCitationCount: 0,
        startedAt: new Date(requestStartedAt).toISOString(),
        completedAt: new Date().toISOString(),
        latencyMs: Date.now() - requestStartedAt,
        firstTokenLatencyMs: undefined,
        tokenThroughputTps: undefined,
        ok: false,
        inputPreview: "",
        outputPreview: message.slice(0, 600),
        toolRunsCount: 0,
        warning: message,
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0
        }
      });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
