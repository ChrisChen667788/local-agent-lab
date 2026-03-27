import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { getAgentTarget } from "@/lib/agent/catalog";
import {
  ensureLocalGatewayAvailableDetailed,
  getLocalGatewaySupervisorInfo,
  probeLocalGateway
} from "@/lib/agent/local-gateway";
import { normalizeThinkingMode, resolveTargetWithMode } from "@/lib/agent/providers";
import type { AgentRuntimeStatus } from "@/lib/agent/types";

function loadLocalEnv() {
  const values: Record<string, string> = {};
  for (const filename of [".env.local", ".env"]) {
    const filePath = path.join(process.cwd(), filename);
    if (!existsSync(filePath)) continue;

    const source = readFileSync(filePath, "utf8");
    for (const rawLine of source.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) continue;

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      values[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  }
  return values;
}

function readEnv(localEnv: Record<string, string>, name: string | undefined, fallback: string) {
  if (!name) return fallback;
  return localEnv[name] || process.env[name] || fallback;
}

async function readLocalHealth(healthUrl: string, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(healthUrl, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetId = searchParams.get("targetId");
  const thinkingMode = normalizeThinkingMode(searchParams.get("thinkingMode") || undefined);

  if (!targetId) {
    return NextResponse.json({ error: "targetId is required." }, { status: 400 });
  }

  const target = getAgentTarget(targetId);
  if (!target) {
    return NextResponse.json({ error: `Unknown target: ${targetId}` }, { status: 404 });
  }

  const resolvedTarget = resolveTargetWithMode(targetId, thinkingMode);
  const standardResolvedTarget = resolveTargetWithMode(targetId, "standard");
  const thinkingResolvedTarget = target.execution === "remote"
    ? resolveTargetWithMode(targetId, "thinking")
    : null;
  const thinkingModelConfigured =
    target.execution === "remote"
      ? Boolean(
          target.thinkingModelEnv &&
          (process.env[target.thinkingModelEnv] || loadLocalEnv()[target.thinkingModelEnv])
        )
      : false;

  if (target.execution !== "local") {
    const payload: AgentRuntimeStatus = {
      targetId,
      targetLabel: target.label,
      execution: target.execution,
      available: true,
      resolvedModel: resolvedTarget.resolvedModel,
      resolvedBaseUrl: resolvedTarget.resolvedBaseUrl,
      standardResolvedModel: standardResolvedTarget.resolvedModel,
      thinkingResolvedModel: thinkingResolvedTarget?.resolvedModel || null,
      activeThinkingMode: thinkingMode,
      thinkingModelConfigured,
      busy: false,
      queueDepth: 0,
      activeRequests: 0,
      loadedAlias: null,
      message: "Remote target. No local runtime queue."
    };
    return NextResponse.json(payload);
  }

  const localEnv = loadLocalEnv();
  const resolvedBaseUrl = readEnv(localEnv, target.baseUrlEnv, target.baseUrlDefault).replace(/\/$/, "");
  const healthUrl = `${resolvedBaseUrl.replace(/\/v1$/, "")}/health`;
  const supervisor = getLocalGatewaySupervisorInfo();

  try {
    let ensureReason: string | undefined;
    let data = await readLocalHealth(healthUrl);

    if (!data) {
      const gatewayReachable = await probeLocalGateway(resolvedBaseUrl, 1200);
      if (!gatewayReachable && !supervisor.supervisorAlive && !supervisor.gatewayAlive) {
        const ensureResult = await ensureLocalGatewayAvailableDetailed(resolvedBaseUrl, { waitMs: 6000 });
        ensureReason = ensureResult.reason;
        if (ensureResult.ok) {
          data = await readLocalHealth(healthUrl, 2000);
        } else {
          throw new Error(ensureResult.reason);
        }
      } else {
        const payload: AgentRuntimeStatus = {
          targetId,
          targetLabel: target.label,
          execution: target.execution,
          available: false,
          resolvedModel: resolvedTarget.resolvedModel,
          resolvedBaseUrl: resolvedTarget.resolvedBaseUrl,
          standardResolvedModel: standardResolvedTarget.resolvedModel,
          thinkingResolvedModel: thinkingResolvedTarget?.resolvedModel || null,
          activeThinkingMode: thinkingMode,
          thinkingModelConfigured,
          busy: true,
          queueDepth: 0,
          activeRequests: 0,
          loadedAlias: null,
          loadingAlias: null,
          loadingElapsedMs: null,
          loadingError: null,
          supervisorPid: supervisor.supervisorPid ?? null,
          supervisorAlive: supervisor.supervisorAlive,
          gatewayPid: supervisor.gatewayPid ?? null,
          gatewayAlive: supervisor.gatewayAlive,
          restartCount: supervisor.restartCount,
          lastStartAt: supervisor.lastStartAt,
          lastExitAt: supervisor.lastExitAt,
          lastExitCode: supervisor.lastExitCode,
          lastEvent: supervisor.lastEvent,
          lastEnsureReason: "Runtime probe timed out while the local gateway was already starting or busy.",
          logFile: supervisor.logFile,
          message: "Local runtime is starting, restarting, or temporarily busy. Retry shortly."
        };
        return NextResponse.json(payload);
      }
    }

    if (!data) {
      throw new Error(ensureReason || "Local runtime health endpoint is unavailable.");
    }
    const payload: AgentRuntimeStatus = {
      targetId,
      targetLabel: target.label,
      execution: target.execution,
      available: typeof data.loading_alias === "string" ? false : true,
      resolvedModel: resolvedTarget.resolvedModel,
      resolvedBaseUrl: resolvedTarget.resolvedBaseUrl,
      standardResolvedModel: standardResolvedTarget.resolvedModel,
      thinkingResolvedModel: thinkingResolvedTarget?.resolvedModel || null,
      activeThinkingMode: thinkingMode,
      thinkingModelConfigured,
      busy: Boolean(data.busy),
      queueDepth: typeof data.queue_depth === "number" ? data.queue_depth : 0,
      activeRequests: typeof data.active_requests === "number" ? data.active_requests : 0,
      loadedAlias: typeof data.loaded_alias === "string" || data.loaded_alias === null ? (data.loaded_alias as string | null) : null,
      loadingAlias:
        typeof data.loading_alias === "string" || data.loading_alias === null
          ? (data.loading_alias as string | null)
          : null,
      loadingElapsedMs: typeof data.loading_elapsed_ms === "number" ? data.loading_elapsed_ms : null,
      loadingError: typeof data.loading_error === "string" ? data.loading_error : null,
      workspaceRoot: typeof data.workspace_root === "string" ? data.workspace_root : undefined,
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
      message:
        typeof data.loading_alias === "string"
          ? `Loading ${data.loading_alias}${typeof data.loading_elapsed_ms === "number" ? ` · ${Math.round(data.loading_elapsed_ms / 1000)}s` : ""}`
          : typeof data.status === "string"
          ? supervisor.supervisorAlive
            ? `${data.status} · supervisor:${supervisor.supervisorPid}`
            : data.status
          : undefined
    };
    return NextResponse.json(payload);
  } catch (error) {
    const payload: AgentRuntimeStatus = {
      targetId,
      targetLabel: target.label,
      execution: target.execution,
      available: false,
      resolvedModel: resolvedTarget.resolvedModel,
      resolvedBaseUrl: resolvedTarget.resolvedBaseUrl,
      standardResolvedModel: standardResolvedTarget.resolvedModel,
      thinkingResolvedModel: thinkingResolvedTarget?.resolvedModel || null,
      activeThinkingMode: thinkingMode,
      thinkingModelConfigured,
      busy: false,
      queueDepth: 0,
      activeRequests: 0,
      loadedAlias: null,
      loadingAlias: null,
      loadingElapsedMs: null,
      loadingError: null,
      supervisorPid: supervisor.supervisorPid ?? null,
      supervisorAlive: supervisor.supervisorAlive,
      gatewayPid: supervisor.gatewayPid ?? null,
      gatewayAlive: supervisor.gatewayAlive,
      restartCount: supervisor.restartCount,
      lastStartAt: supervisor.lastStartAt,
      lastExitAt: supervisor.lastExitAt,
      lastExitCode: supervisor.lastExitCode,
      lastEvent: supervisor.lastEvent,
      lastEnsureReason: error instanceof Error ? error.message : "Local runtime unavailable.",
      logFile: supervisor.logFile,
      message: error instanceof Error ? error.message : "Local runtime unavailable."
    };
    return NextResponse.json(payload);
  }
}
