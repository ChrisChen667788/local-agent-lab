import { NextResponse } from "next/server";
import crypto from "crypto";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "@/lib/agent/prompts";
import {
  calculateTokenThroughputTps,
  clampContextWindowForTarget,
  normalizeContextWindow
} from "@/lib/agent/metrics";
import { ensureLocalGatewayAvailable } from "@/lib/agent/local-gateway";
import { lookupPromptCache, savePromptCache } from "@/lib/agent/cache-store";
import {
  buildProviderMessages,
  isThinkingModelConfigured,
  normalizeProviderProfile,
  normalizeThinkingMode,
  resolveEffectiveProviderProfile,
  runAgentRequest,
  resolveTargetWithMode,
  sanitizeAssistantContent,
  suggestMaxTokens,
  shouldUseToolLoop
} from "@/lib/agent/providers";
import { appendChatLog } from "@/lib/agent/log-store";
import {
  applyRetrievalBypassStrategy,
  applyGroundedResponsePolicy,
  buildGroundedSystemPrompt,
  searchKnowledgeBase
} from "@/lib/agent/retrieval-store";
import { buildSessionMemory, buildTaskPlan, composeOperationalSystemPrompt } from "@/lib/agent/session-intelligence";
import { buildWorkspaceScoutEvidence } from "@/lib/agent/workspace-scout";
import { beginTrackedRequest, finishTrackedRequest } from "@/lib/agent/runtime-state";
import type {
  AgentChatRequest,
  AgentGroundedVerification,
  AgentMessage,
  AgentRetrievalSummary,
  AgentUsage
} from "@/lib/agent/types";

export const runtime = "nodejs";
const LOCAL_STREAM_CONNECT_TIMEOUT_MS = 300000;
const LOCAL_STREAM_WARMUP_WAIT_MS = 300000;
const LOCAL_COMPARISON_4B_TARGET_IDS = new Set(["local-qwen3-4b-4bit", "local-qwen35-4b-4bit"]);

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

function projectVisibleContent(raw: string) {
  const tags: Array<{ open: string; close: string }> = [
    { open: "<think>", close: "</think>" },
    { open: "<thinking>", close: "</thinking>" }
  ];

  let cursor = 0;
  let visible = "";

  while (cursor < raw.length) {
    let earliest: { start: number; open: string; close: string } | null = null;

    for (const tag of tags) {
      const start = raw.indexOf(tag.open, cursor);
      if (start === -1) continue;
      if (!earliest || start < earliest.start) {
        earliest = { start, open: tag.open, close: tag.close };
      }
    }

    if (!earliest) {
      visible += raw.slice(cursor);
      break;
    }

    visible += raw.slice(cursor, earliest.start);
    const closeIndex = raw.indexOf(earliest.close, earliest.start + earliest.open.length);
    if (closeIndex === -1) {
      break;
    }
    cursor = closeIndex + earliest.close.length;
  }

  return visible;
}

function createVisibleProjector() {
  let raw = "";
  let sent = "";

  return {
    push(segment: string) {
      raw += segment;
      const visible = projectVisibleContent(raw);
      const delta = visible.slice(sent.length);
      sent = visible;
      return { delta, visible };
    },
    finish() {
      const visible = sanitizeAssistantContent(projectVisibleContent(raw));
      const delta = visible.slice(sent.length);
      sent = visible;
      return { delta, visible };
    }
  };
}

function streamEvent(payload: Record<string, unknown>) {
  return `${JSON.stringify(payload)}\n`;
}

async function fetchWithAbortTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function combineWarnings(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ").trim() || undefined;
}

function buildLocalChatTemplateExtraBody(
  targetId: string,
  thinkingMode: "standard" | "thinking"
) {
  if (targetId !== "local-qwen35-4b-4bit") {
    return undefined;
  }
  return {
    chat_template_kwargs: {
      enable_thinking: thinkingMode === "thinking"
    }
  };
}

function withRetrieval(
  payload: Record<string, unknown>,
  retrieval: AgentRetrievalSummary | null
) {
  return retrieval ? { ...payload, retrieval } : payload;
}

function withGroundedPayload(
  payload: Record<string, unknown>,
  retrieval: AgentRetrievalSummary | null,
  verification?: AgentGroundedVerification
) {
  return {
    ...withRetrieval(payload, retrieval),
    ...(verification ? { verification } : {})
  };
}

function buildStreamMeta(
  targetId: string,
  targetLabel: string,
  providerLabel: string,
  resolvedModel: string,
  resolvedBaseUrl: string,
  execution: "local" | "remote",
  providerProfile: "speed" | "balanced" | "tool-first",
  thinkingMode: "standard" | "thinking",
  thinkingFallbackToStandard = false,
  localFallbackUsed = false,
  localFallbackTargetId?: string,
  localFallbackTargetLabel?: string,
  localFallbackReason?: string
) {
  return {
    type: "meta",
    targetId,
    targetLabel,
    providerLabel,
    resolvedModel,
    resolvedBaseUrl,
    execution,
    providerProfile,
    thinkingMode,
    thinkingFallbackToStandard,
    localFallbackUsed,
    localFallbackTargetId,
    localFallbackTargetLabel,
    localFallbackReason
  };
}

async function readNdjsonStream(
  response: Response,
  onObject: (value: Record<string, unknown>) => void | Promise<void>
) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Upstream stream body is missing.");
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
        await onObject(JSON.parse(line) as Record<string, unknown>);
      }
      lineBreak = buffer.indexOf("\n");
    }
  }

  const tail = buffer.trim();
  if (tail) {
    await onObject(JSON.parse(tail) as Record<string, unknown>);
  }
}

async function readOpenAISseStream(
  response: Response,
  onObject: (value: Record<string, unknown>) => void | Promise<void>
) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Upstream stream body is missing.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const event of events) {
      const lines = event
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"));

      for (const line of lines) {
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        await onObject(JSON.parse(data) as Record<string, unknown>);
      }
    }
  }
}

export async function POST(request: Request) {
  let targetId = "";
  let requestStartedAt = Date.now();
  let trackingStarted = false;

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

    const thinkingMode = normalizeThinkingMode(body.thinkingMode);
    const target = resolveTargetWithMode(body.targetId, thinkingMode);
    const baseSystemPrompt =
      typeof body.systemPrompt === "string" && body.systemPrompt.trim()
        ? body.systemPrompt
        : DEFAULT_AGENT_SYSTEM_PROMPT;
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
    const requestedTools = Boolean(body.enableTools);
    const workspaceScoutEvidence = await buildWorkspaceScoutEvidence(body.input);
    const systemPrompt = composeOperationalSystemPrompt(
      buildGroundedSystemPrompt(baseSystemPrompt, retrieval),
      memorySummary,
      plannerSteps,
      {
        input: body.input,
        enableTools: requestedTools,
        enableRetrieval: body.enableRetrieval,
        workspaceScoutEvidence
      }
    );
    const providerProfile = resolveEffectiveProviderProfile(
      normalizeProviderProfile(body.providerProfile),
      thinkingMode,
      body.input,
      body.messages
    );
    const enableTools =
      requestedTools &&
      target.supportsTools &&
      shouldUseToolLoop(body.input, body.messages, providerProfile);
    const contextWindow = clampContextWindowForTarget(
      body.targetId,
      normalizeContextWindow(body.contextWindow, 32768),
      {
        enableTools,
        enableRetrieval: body.enableRetrieval
      }
    );

    requestStartedAt = Date.now();
    beginTrackedRequest(body.targetId);
    trackingStarted = true;

    const encoder = new TextEncoder();
    const meta = buildStreamMeta(
      body.targetId,
      target.label,
      target.providerLabel,
      target.resolvedModel,
      target.resolvedBaseUrl,
      target.execution,
      providerProfile,
      thinkingMode,
      thinkingMode === "thinking" && !isThinkingModelConfigured(body.targetId)
    );

    const cacheLookup =
      target.execution === "remote" &&
      !enableTools &&
      !body.enableRetrieval &&
      thinkingMode === "standard"
        ? lookupPromptCache({
            targetId: body.targetId,
            resolvedModel: target.resolvedModel,
            providerProfile,
            thinkingMode,
            contextWindow,
            retrievalEnabled: false,
            input: body.input
          })
        : null;

    if (cacheLookup) {
      const cachedContent = sanitizeAssistantContent(cacheLookup.entry.content);
      const totalLatencyMs = Date.now() - requestStartedAt;
      appendChatLog({
        kind: "chat",
        id: crypto.randomUUID(),
        targetId: body.targetId,
        targetLabel: target.label,
        providerLabel: target.providerLabel,
        execution: target.execution,
        resolvedModel: cacheLookup.entry.resolvedModel,
        resolvedBaseUrl: target.resolvedBaseUrl,
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
        cacheHit: true,
        cacheMode: cacheLookup.mode,
        plannerStepCount: plannerSteps.length,
        memorySummaryLength: memorySummary.length || undefined,
        startedAt: new Date(requestStartedAt).toISOString(),
        completedAt: new Date().toISOString(),
        latencyMs: totalLatencyMs,
        firstTokenLatencyMs: 0,
        tokenThroughputTps: calculateTokenThroughputTps(cacheLookup.entry.usage?.completionTokens, totalLatencyMs, 0),
        ok: true,
        inputPreview: body.input.slice(0, 400),
        outputPreview: cachedContent.slice(0, 600),
        toolRunsCount: 0,
        usage: cacheLookup.entry.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      });
      finishTrackedRequest(body.targetId, true);
      trackingStarted = false;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(streamEvent(meta)));
          controller.enqueue(
            encoder.encode(
              streamEvent({
                type: "done",
                content: cachedContent,
                providerProfile,
                thinkingMode,
                thinkingFallbackToStandard: false,
                cacheHit: true,
                cacheMode: cacheLookup.mode,
                plannerSteps,
                memorySummary,
                usage: cacheLookup.entry.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
              })
            )
          );
          controller.close();
        }
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform"
        }
      });
    }

    if (enableTools || target.transport === "anthropic") {
      const response = await runAgentRequest(
        {
          targetId: body.targetId,
          input: body.input,
          messages: body.messages,
          systemPrompt: body.systemPrompt,
          enableTools: body.enableTools,
          contextWindow,
          providerProfile,
          thinkingMode
        },
        systemPrompt
      );

      const grounded = body.enableRetrieval
        ? applyGroundedResponsePolicy(response.content || response.warning || "", retrieval)
        : null;
      const content = sanitizeAssistantContent(grounded?.content || response.content || response.warning || "");
      const completedAtIso = new Date().toISOString();
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
        cacheHit: false,
        plannerStepCount: plannerSteps.length,
        memorySummaryLength: memorySummary.length || undefined,
        startedAt: new Date(requestStartedAt).toISOString(),
        completedAt: completedAtIso,
        latencyMs: totalLatencyMs,
        firstTokenLatencyMs: undefined,
        tokenThroughputTps: calculateTokenThroughputTps(
          response.usage?.completionTokens,
          totalLatencyMs,
          undefined
        ),
        ok: true,
        inputPreview: body.input.slice(0, 400),
        outputPreview: content.slice(0, 600),
        toolRunsCount: response.toolRuns.length,
        warning: response.warning,
        usage: response.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      });
      finishTrackedRequest(body.targetId, true);

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(streamEvent(meta)));
          controller.enqueue(
            encoder.encode(
              streamEvent(withGroundedPayload({
                type: "done",
                content,
                toolRuns: response.toolRuns,
                providerProfile: response.providerProfile,
                thinkingMode: response.thinkingMode,
                thinkingFallbackToStandard: response.thinkingFallbackToStandard,
                localFallbackUsed: response.localFallbackUsed,
                localFallbackTargetId: response.localFallbackTargetId,
                localFallbackTargetLabel: response.localFallbackTargetLabel,
                localFallbackReason: response.localFallbackReason,
                warning: response.warning,
                usage: response.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                cacheHit: false,
                plannerSteps,
                memorySummary
              }, retrieval, grounded?.verification))
            )
          );
          controller.close();
        }
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform"
        }
      });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const projector = createVisibleProjector();
        let finalContent = "";
        let usage: AgentUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        let warning: string | undefined;
        let firstVisibleDeltaAt: number | null = null;
        let localFallbackUsed = false;
        let localFallbackTargetId: string | undefined;
        let localFallbackTargetLabel: string | undefined;
        let localFallbackReason: string | undefined;

        const write = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(streamEvent(payload)));
        };

        write(meta);

        try {
          if (target.execution === "local") {
            try {
              const ready = await ensureLocalGatewayAvailable(target.resolvedBaseUrl, {
                waitMs: LOCAL_STREAM_WARMUP_WAIT_MS
              });
              if (!ready) {
                throw new Error("Local gateway did not become ready in time.");
              }
              const upstream = await fetchWithAbortTimeout(`${target.resolvedBaseUrl.replace(/\/v1$/, "")}/v1/chat/completions/stream`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: target.resolvedModel,
                  messages: [
                    { role: "system", content: systemPrompt },
                    ...buildProviderMessages(body.messages!, body.input!, contextWindow)
                  ],
                  max_tokens: 192,
                  extra_body: buildLocalChatTemplateExtraBody(body.targetId!, thinkingMode)
                })
              }, LOCAL_STREAM_CONNECT_TIMEOUT_MS);

              if (!upstream.ok) {
                throw new Error(await upstream.text());
              }

              await readNdjsonStream(upstream, async (payload) => {
                if (payload.type === "delta" && typeof payload.delta === "string") {
                  const next = projector.push(payload.delta);
                  if (next.delta) {
                    if (firstVisibleDeltaAt === null) {
                      firstVisibleDeltaAt = Date.now();
                    }
                    write({ type: "delta", delta: next.delta });
                  }
                }

                if (payload.type === "done") {
                  const final = projector.finish();
                  if (final.delta) {
                    if (firstVisibleDeltaAt === null) {
                      firstVisibleDeltaAt = Date.now();
                    }
                    write({ type: "delta", delta: final.delta });
                  }
                  finalContent = final.visible || "";
                  const upstreamUsage = payload.usage as Record<string, unknown> | undefined;
                  usage = {
                    promptTokens: typeof upstreamUsage?.prompt_tokens === "number" ? upstreamUsage.prompt_tokens : 0,
                    completionTokens: typeof upstreamUsage?.completion_tokens === "number" ? upstreamUsage.completion_tokens : 0,
                    totalTokens: typeof upstreamUsage?.total_tokens === "number" ? upstreamUsage.total_tokens : 0
                  };
                  if (typeof payload.warning === "string" && payload.warning.trim()) {
                    warning = combineWarnings(warning, payload.warning);
                  }
                }
              });

              if (!sanitizeAssistantContent(finalContent).trim() && LOCAL_COMPARISON_4B_TARGET_IDS.has(target.id)) {
                throw new Error("Primary local 4B-class stream completed without a visible answer.");
              }
            } catch (localStreamError) {
              if (!LOCAL_COMPARISON_4B_TARGET_IDS.has(target.id)) {
                throw localStreamError;
              }

              const recovered = await runAgentRequest(
                {
                  targetId: body.targetId!,
                  input: body.input!,
                  messages: body.messages!,
                  systemPrompt: body.systemPrompt,
                  enableTools: false,
                  enableRetrieval: body.enableRetrieval,
                  contextWindow,
                  providerProfile,
                  thinkingMode
                },
                systemPrompt
              );

              warning = combineWarnings(
                warning,
                recovered.warning,
                `Stream recovered via local downgrade after 4B failure: ${
                  localStreamError instanceof Error ? localStreamError.message : String(localStreamError)
                }`
              );
              finalContent = recovered.content;
              usage = recovered.usage || usage;
              if (recovered.localFallbackUsed) {
                localFallbackUsed = true;
                localFallbackTargetId = recovered.localFallbackTargetId;
                localFallbackTargetLabel = recovered.localFallbackTargetLabel;
                localFallbackReason = recovered.localFallbackReason;
                write(
                  buildStreamMeta(
                    body.targetId!,
                    recovered.targetLabel,
                    recovered.providerLabel,
                    recovered.resolvedModel,
                    recovered.resolvedBaseUrl,
                    recovered.execution || target.execution,
                    recovered.providerProfile || providerProfile,
                    recovered.thinkingMode || thinkingMode,
                    recovered.thinkingFallbackToStandard || false,
                    recovered.localFallbackUsed || false,
                    recovered.localFallbackTargetId,
                    recovered.localFallbackTargetLabel,
                    recovered.localFallbackReason
                  )
                );
              }
              if (finalContent.trim()) {
                if (firstVisibleDeltaAt === null) {
                  firstVisibleDeltaAt = Date.now();
                }
                write({ type: "delta", delta: finalContent });
              }
            }
          } else {
            const upstream = await fetch(`${target.resolvedBaseUrl}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(target.resolvedApiKey ? { Authorization: `Bearer ${target.resolvedApiKey}` } : {})
              },
              body: JSON.stringify({
                model: target.resolvedModel,
                messages: [
                  { role: "system", content: systemPrompt },
                  ...buildProviderMessages(body.messages!, body.input!, contextWindow)
                ],
                max_tokens: suggestMaxTokens(target.execution, false, body.input!, providerProfile),
                stream: true,
                stream_options: { include_usage: true }
              })
            });

            if (!upstream.ok) {
              throw new Error(await upstream.text());
            }

            await readOpenAISseStream(upstream, async (payload) => {
              const choices = Array.isArray(payload.choices) ? payload.choices : [];
              const choice = choices[0] as { delta?: { content?: string }; finish_reason?: string | null } | undefined;
              const delta = choice?.delta?.content;
              if (typeof delta === "string" && delta) {
                const next = projector.push(delta);
                if (next.delta) {
                  if (firstVisibleDeltaAt === null) {
                    firstVisibleDeltaAt = Date.now();
                  }
                  write({ type: "delta", delta: next.delta });
                }
              }

              const upstreamUsage = payload.usage as Record<string, unknown> | undefined;
              if (upstreamUsage) {
                usage = {
                  promptTokens: typeof upstreamUsage.prompt_tokens === "number" ? upstreamUsage.prompt_tokens : usage.promptTokens,
                  completionTokens:
                    typeof upstreamUsage.completion_tokens === "number"
                      ? upstreamUsage.completion_tokens
                      : usage.completionTokens,
                  totalTokens: typeof upstreamUsage.total_tokens === "number" ? upstreamUsage.total_tokens : usage.totalTokens
                };
              }
            });

            const final = projector.finish();
            if (final.delta) {
              if (firstVisibleDeltaAt === null) {
                firstVisibleDeltaAt = Date.now();
              }
              write({ type: "delta", delta: final.delta });
            }
            finalContent = final.visible || "";
          }

          const cleaned = sanitizeAssistantContent(finalContent);
          const grounded = body.enableRetrieval
            ? applyGroundedResponsePolicy(cleaned, retrieval)
            : null;
          const finalResponseContent = grounded?.content || cleaned;
          const completedAtIso = new Date().toISOString();
          const totalLatencyMs = Date.now() - requestStartedAt;
          const firstTokenLatencyMs = firstVisibleDeltaAt ? firstVisibleDeltaAt - requestStartedAt : undefined;
          appendChatLog({
            kind: "chat",
            id: crypto.randomUUID(),
            targetId: body.targetId!,
            targetLabel: target.label,
            providerLabel: target.providerLabel,
            execution: target.execution,
            resolvedModel: target.resolvedModel,
            resolvedBaseUrl: target.resolvedBaseUrl,
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
            cacheHit: false,
            plannerStepCount: plannerSteps.length,
            memorySummaryLength: memorySummary.length || undefined,
            startedAt: new Date(requestStartedAt).toISOString(),
            completedAt: completedAtIso,
            latencyMs: totalLatencyMs,
            firstTokenLatencyMs,
            tokenThroughputTps: calculateTokenThroughputTps(
              usage.completionTokens,
              totalLatencyMs,
              firstTokenLatencyMs
            ),
            ok: true,
            inputPreview: body.input!.slice(0, 400),
            outputPreview: finalResponseContent.slice(0, 600),
            toolRunsCount: 0,
            warning,
            usage
          });
          if (target.execution === "remote" && !enableTools && !body.enableRetrieval && thinkingMode === "standard" && finalResponseContent.trim()) {
            savePromptCache({
              targetId: body.targetId!,
              resolvedModel: target.resolvedModel,
              providerProfile,
              thinkingMode,
              contextWindow,
              retrievalEnabled: false,
              input: body.input!,
              content: finalResponseContent,
              usage
            });
          }
          finishTrackedRequest(body.targetId!, true);
          write(withGroundedPayload({
            type: "done",
            content: finalResponseContent,
            toolRuns: [],
            providerProfile,
            thinkingMode,
            thinkingFallbackToStandard: thinkingMode === "thinking" && !isThinkingModelConfigured(body.targetId!),
            localFallbackUsed,
            localFallbackTargetId,
            localFallbackTargetLabel,
            localFallbackReason,
            warning,
            usage,
            cacheHit: false,
            plannerSteps,
            memorySummary
          }, retrieval, grounded?.verification));
          controller.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          finishTrackedRequest(body.targetId!, false);
          appendChatLog({
            kind: "chat",
            id: crypto.randomUUID(),
            targetId: body.targetId!,
            targetLabel: target.label,
            providerLabel: target.providerLabel,
            execution: target.execution,
            resolvedModel: target.resolvedModel,
            resolvedBaseUrl: target.resolvedBaseUrl,
            contextWindow,
            providerProfile,
            thinkingMode,
            retrievalEnabled: Boolean(body.enableRetrieval),
            retrievalHitCount: retrieval?.hitCount || 0,
            retrievalLowConfidence: retrieval?.lowConfidence || false,
            groundedVerdict: undefined,
            groundedFallbackApplied: false,
            groundedCitationCount: 0,
            groundedUnsupportedCitationCount: 0,
            cacheHit: false,
            plannerStepCount: plannerSteps.length,
            memorySummaryLength: memorySummary.length || undefined,
            startedAt: new Date(requestStartedAt).toISOString(),
            completedAt: new Date().toISOString(),
            latencyMs: Date.now() - requestStartedAt,
            firstTokenLatencyMs: undefined,
            tokenThroughputTps: undefined,
            ok: false,
            inputPreview: body.input!.slice(0, 400),
            outputPreview: message.slice(0, 600),
            toolRunsCount: 0,
            warning: message,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
          });
          write({ type: "error", error: message });
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (targetId && trackingStarted) {
      finishTrackedRequest(targetId, false);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
