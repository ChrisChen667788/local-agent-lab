import { NextResponse } from "next/server";
import { listServerAgentTargets, syncDiscoveredLocalTargetsFromGateway } from "@/lib/agent/server-targets";
import { runRemoteConnectionCheck } from "@/lib/agent/connection-check";
import { clearProviderEnvCache } from "@/lib/agent/providers";
import type { AgentConnectionCheckResponse, AgentTarget } from "@/lib/agent/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const targets = await syncDiscoveredLocalTargetsFromGateway();
    return NextResponse.json({
      ok: true,
      targets
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to load agent targets.",
      targets: listServerAgentTargets()
    });
  }
}

type ScanTargetsResponse = {
  ok: boolean;
  targets: AgentTarget[];
  remoteChecks: Record<string, AgentConnectionCheckResponse>;
  summary: {
    scannedAt: string;
    localNewTargetIds: string[];
    localRemovedTargetIds: string[];
    remoteConfiguredCount: number;
    remoteHealthyCount: number;
    remoteSkippedTargetIds: string[];
  };
  error?: string;
};

export async function POST() {
  const beforeTargets = listServerAgentTargets();
  const beforeIds = new Set(beforeTargets.map((target) => target.id));
  clearProviderEnvCache();

  try {
    const targets = await syncDiscoveredLocalTargetsFromGateway();
    const targetIds = new Set(targets.map((target) => target.id));
    const localNewTargetIds = targets
      .filter((target) => target.execution === "local" && !beforeIds.has(target.id))
      .map((target) => target.id);
    const localRemovedTargetIds = beforeTargets
      .filter((target) => target.execution === "local" && !targetIds.has(target.id))
      .map((target) => target.id);

    const remoteTargets = targets.filter(
      (target) => target.execution === "remote" && target.transport === "openai-compatible" && Boolean(target.apiKeyEnv)
    );
    const remoteChecks: Record<string, AgentConnectionCheckResponse> = {};
    const remoteSkippedTargetIds: string[] = [];
    let remoteConfiguredCount = 0;
    let remoteHealthyCount = 0;

    for (const target of remoteTargets) {
      try {
        const result = await runRemoteConnectionCheck(target.id, {
          mode: "quick",
          log: false
        });
        remoteChecks[target.id] = result;
        remoteConfiguredCount += 1;
        if (result.ok) {
          remoteHealthyCount += 1;
        }
      } catch {
        remoteSkippedTargetIds.push(target.id);
      }
    }

    return NextResponse.json({
      ok: true,
      targets,
      remoteChecks,
      summary: {
        scannedAt: new Date().toISOString(),
        localNewTargetIds,
        localRemovedTargetIds,
        remoteConfiguredCount,
        remoteHealthyCount,
        remoteSkippedTargetIds
      }
    } satisfies ScanTargetsResponse);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to scan agent targets.",
      targets: listServerAgentTargets(),
      remoteChecks: {},
      summary: {
        scannedAt: new Date().toISOString(),
        localNewTargetIds: [],
        localRemovedTargetIds: [],
        remoteConfiguredCount: 0,
        remoteHealthyCount: 0,
        remoteSkippedTargetIds: []
      }
    } satisfies ScanTargetsResponse);
  }
}
