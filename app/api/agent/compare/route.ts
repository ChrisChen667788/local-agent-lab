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
  resolveTargetWithMode,
  runAgentRequest
} from "@/lib/agent/providers";
import { getAgentTarget } from "@/lib/agent/catalog";
import { restartLocalGateway } from "@/lib/agent/local-gateway";
import {
  applyGroundedResponsePolicy,
  applyRetrievalBypassStrategy,
  buildGroundedSystemPrompt,
  searchKnowledgeBase
} from "@/lib/agent/retrieval-store";
import { prewarmLocalTargetWithRecovery } from "../runtime/prewarm-utils";
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
const COMPARE_LOCAL_PREWARM_WAIT_MS = 120000;
const COMPARE_LOCAL_PREWARM_POLL_MS = 1500;
const COMPARE_LOCAL_LOADING_STALL_MS = 90000;

type LocalGatewayHealthPayload = {
  loaded_alias?: string | null;
  loading_alias?: string | null;
  loading_elapsed_ms?: number | null;
  loading_error?: string | null;
  busy?: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function healthUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/v1$/, "")}/health`;
}

async function fetchLocalGatewayHealth(baseUrl: string, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(healthUrl(baseUrl), {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as LocalGatewayHealthPayload;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureCompareLocalLaneReady(params: {
  baseUrl: string;
  model: string;
  targetId: string;
  targetLabel: string;
}) {
  const { baseUrl, model, targetId, targetLabel } = params;
  let recoveryNote = "";
  let restarted = false;

  const runPrewarm = async (allowRetry = true) =>
    prewarmLocalTargetWithRecovery({
      baseUrl,
      model,
      targetId,
      targetLabel,
      allowRetry
    });

  let prewarm = await runPrewarm(true);
  if (!prewarm.ok) {
    return { ok: false as const, message: prewarm.message };
  }
  if (prewarm.status === "ready") {
    return { ok: true as const, warning: undefined };
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < COMPARE_LOCAL_PREWARM_WAIT_MS) {
    const health = await fetchLocalGatewayHealth(baseUrl);
    if (health?.loaded_alias === model && !health.loading_alias) {
      return {
        ok: true as const,
        warning: recoveryNote || (prewarm.status !== "ready" ? prewarm.message : undefined)
      };
    }

    const loadingCurrentTarget = health?.loading_alias === model;
    const loadingStalled =
      loadingCurrentTarget &&
      typeof health?.loading_elapsed_ms === "number" &&
      health.loading_elapsed_ms >= COMPARE_LOCAL_LOADING_STALL_MS;

    if ((health?.loading_error || loadingStalled) && !restarted) {
      const restartedOk = await restartLocalGateway(baseUrl, { waitMs: 180000, autoPrewarmModel: "false" });
      if (!restartedOk) {
        return {
          ok: false as const,
          message: health?.loading_error || `${targetLabel} load recovery timed out after restart.`
        };
      }
      restarted = true;
      recoveryNote = health?.loading_error
        ? `Recovered after restarting the local gateway because ${targetLabel} reported a loading error.`
        : `Recovered after restarting the local gateway because ${targetLabel} exceeded the compare loading budget.`;
      const retryPrewarm = await runPrewarm(false);
      if (!retryPrewarm.ok) {
        return { ok: false as const, message: retryPrewarm.message };
      }
      prewarm = retryPrewarm;
      if (retryPrewarm.status === "ready") {
        return { ok: true as const, warning: recoveryNote };
      }
    }

    await sleep(COMPARE_LOCAL_PREWARM_POLL_MS);
  }

  return {
    ok: false as const,
    message: `${targetLabel} did not finish loading within the compare window (${Math.round(
      COMPARE_LOCAL_PREWARM_WAIT_MS / 1000
    )}s).`
  };
}

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

    if (!Array.isArray(body.targetIds) || body.targetIds.length < 1) {
      return NextResponse.json({ error: "targetIds must contain at least one target." }, { status: 400 });
    }
    if (!body.input || typeof body.input !== "string") {
      return NextResponse.json({ error: "input is required." }, { status: 400 });
    }
    if (!isValidMessageArray(body.messages)) {
      return NextResponse.json({ error: "messages must be a valid history array." }, { status: 400 });
    }

    const targetIds = Array.from(new Set(body.targetIds.filter((value): value is string => typeof value === "string"))).slice(0, 4);
    if (!targetIds.length) {
      return NextResponse.json({ error: "Need at least one valid targetId." }, { status: 400 });
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
      const resolvedTarget = resolveTargetWithMode(targetId, thinkingMode);
      const laneContextWindow = clampContextWindowForTarget(
        targetId,
        target.execution === "remote" ? alignedRemoteContextWindow : requestedContextWindow,
        {
          enableTools,
          enableRetrieval
        }
      );

      const laneStartedAt = Date.now();
      let laneWarning: string | undefined;
      if (target.execution === "local") {
        const localReady = await ensureCompareLocalLaneReady({
          baseUrl: resolvedTarget.resolvedBaseUrl,
          model: resolvedTarget.resolvedModel,
          targetId,
          targetLabel: target.label
        });
        if (!localReady.ok) {
          results.push({
            targetId,
            targetLabel: target.label,
            providerLabel: target.providerLabel,
            execution: target.execution,
            resolvedModel: resolvedTarget.resolvedModel,
            resolvedBaseUrl: resolvedTarget.resolvedBaseUrl,
            providerProfile,
            thinkingMode,
            contextWindow: laneContextWindow,
            content: "",
            warning: localReady.message,
            toolRuns: [],
            latencyMs: Date.now() - laneStartedAt,
            ok: false
          });
          continue;
        }
        laneWarning = localReady.warning;
      }
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
            memorySummary,
            disableLocalFallback: true
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
          warning: [laneWarning, response.warning].filter(Boolean).join(" ").trim() || undefined,
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
      ok: results.some((lane) => lane.ok),
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
