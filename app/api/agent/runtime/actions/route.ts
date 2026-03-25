import { NextResponse } from "next/server";
import { getAgentTarget } from "@/lib/agent/catalog";
import {
  ensureLocalGatewayAvailableDetailed,
  getLocalGatewaySupervisorInfo,
  readLocalGatewayRecentLog,
  restartLocalGateway
} from "@/lib/agent/local-gateway";
import { resolveTarget } from "@/lib/agent/providers";
import type { AgentRuntimeAction, AgentRuntimeActionResponse, AgentRuntimeStatus } from "@/lib/agent/types";

export const runtime = "nodejs";

type RuntimeActionBody = {
  targetId?: string;
  action?: AgentRuntimeAction;
};

function buildRuntimeStatus(
  targetId: string,
  targetLabel: string,
  execution: "local" | "remote",
  payload: Record<string, unknown> | null,
  message?: string
): AgentRuntimeStatus {
  const supervisor = getLocalGatewaySupervisorInfo();
  return {
    targetId,
    targetLabel,
    execution,
    available: Boolean(payload),
    busy: Boolean(payload?.busy),
    queueDepth: typeof payload?.queue_depth === "number" ? payload.queue_depth : 0,
    activeRequests: typeof payload?.active_requests === "number" ? payload.active_requests : 0,
    loadedAlias:
      typeof payload?.loaded_alias === "string" || payload?.loaded_alias === null
        ? (payload.loaded_alias as string | null)
        : null,
    workspaceRoot: typeof payload?.workspace_root === "string" ? payload.workspace_root : undefined,
    supervisorPid: supervisor.supervisorPid ?? null,
    supervisorAlive: supervisor.supervisorAlive,
    gatewayPid: supervisor.gatewayPid ?? null,
    gatewayAlive: supervisor.gatewayAlive,
    restartCount: supervisor.restartCount,
    lastStartAt: supervisor.lastStartAt,
    lastExitAt: supervisor.lastExitAt,
    lastExitCode: supervisor.lastExitCode,
    lastEvent: supervisor.lastEvent,
    logFile: supervisor.logFile,
    lastEnsureReason: message,
    message
  };
}

async function fetchHealth(resolvedBaseUrl: string) {
  const response = await fetch(`${resolvedBaseUrl.replace(/\/v1$/, "")}/health`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Health request failed with ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RuntimeActionBody;
    if (!body.targetId || typeof body.targetId !== "string") {
      return NextResponse.json({ error: "targetId is required." }, { status: 400 });
    }
    if (!body.action || !["release", "restart", "read_log"].includes(body.action)) {
      return NextResponse.json({ error: "action must be release, restart, or read_log." }, { status: 400 });
    }

    const target = getAgentTarget(body.targetId);
    if (!target) {
      return NextResponse.json({ error: `Unknown target: ${body.targetId}` }, { status: 404 });
    }
    if (target.execution !== "local") {
      return NextResponse.json({ error: "Runtime actions are available only for local targets." }, { status: 400 });
    }

    const resolvedTarget = resolveTarget(body.targetId);
    const baseUrl = resolvedTarget.resolvedBaseUrl;

    if (body.action === "read_log") {
      const logExcerpt = readLocalGatewayRecentLog(80);
      const ensureResult = await ensureLocalGatewayAvailableDetailed(baseUrl, { waitMs: 5000 }).catch(() => ({
        ok: false,
        reason: "Gateway ensure check failed.",
        attempts: 0
      }));
      const runtime = ensureResult.ok
        ? buildRuntimeStatus(body.targetId, target.label, target.execution, await fetchHealth(baseUrl), "Loaded recent gateway log.")
        : buildRuntimeStatus(
            body.targetId,
            target.label,
            target.execution,
            null,
            `Gateway is unavailable. ${ensureResult.reason}`
          );
      return NextResponse.json({
        ok: true,
        action: body.action,
        targetId: body.targetId,
        targetLabel: target.label,
        message: "Loaded recent gateway log.",
        logExcerpt,
        runtime
      } satisfies AgentRuntimeActionResponse);
    }

    if (body.action === "restart") {
      const restarted = await restartLocalGateway(baseUrl, { waitMs: 30000 });
      if (!restarted) {
        return NextResponse.json(
          {
            ok: false,
            action: body.action,
            targetId: body.targetId,
            targetLabel: target.label,
            message: "Local gateway did not become ready in time after restart.",
            runtime: buildRuntimeStatus(
              body.targetId,
              target.label,
              target.execution,
              null,
              "Gateway restart timed out."
            )
          } satisfies AgentRuntimeActionResponse,
          { status: 503 }
        );
      }

      const health = await fetchHealth(baseUrl);
      return NextResponse.json({
        ok: true,
        action: body.action,
        targetId: body.targetId,
        targetLabel: target.label,
        message: "Local gateway restarted successfully.",
        runtime: buildRuntimeStatus(body.targetId, target.label, target.execution, health, "Gateway restarted successfully.")
      } satisfies AgentRuntimeActionResponse);
    }

    const ensureResult = await ensureLocalGatewayAvailableDetailed(baseUrl, { waitMs: 25000 });
    if (!ensureResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          action: body.action,
          targetId: body.targetId,
          targetLabel: target.label,
          message: ensureResult.reason,
          runtime: buildRuntimeStatus(body.targetId, target.label, target.execution, null, ensureResult.reason)
        } satisfies AgentRuntimeActionResponse,
        { status: 503 }
      );
    }

    const upstream = await fetch(`${baseUrl.replace(/\/v1$/, "")}/v1/models/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const payload = (await upstream.json()) as { released_alias?: string | null; detail?: string; message?: string };
    if (!upstream.ok) {
      return NextResponse.json(
        {
          ok: false,
          action: body.action,
          targetId: body.targetId,
          targetLabel: target.label,
          message: payload.detail || payload.message || "Failed to release the loaded model."
        } satisfies AgentRuntimeActionResponse,
        { status: upstream.status }
      );
    }

    const health = await fetchHealth(baseUrl);
    return NextResponse.json({
      ok: true,
      action: body.action,
      targetId: body.targetId,
      targetLabel: target.label,
      message: payload.message || "Released the currently loaded model.",
      releasedAlias: payload.released_alias ?? null,
      runtime: buildRuntimeStatus(body.targetId, target.label, target.execution, health, payload.message || "Released the currently loaded model.")
    } satisfies AgentRuntimeActionResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Runtime action failed." },
      { status: 500 }
    );
  }
}
