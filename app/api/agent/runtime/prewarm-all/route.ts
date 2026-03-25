import { NextResponse } from "next/server";
import { agentTargets } from "@/lib/agent/catalog";
import { ensureLocalGatewayAvailableDetailed, restartLocalGateway } from "@/lib/agent/local-gateway";
import { resolveTarget } from "@/lib/agent/providers";
import type {
  AgentRuntimePrewarmAllResponse,
  AgentRuntimePrewarmResponse
} from "@/lib/agent/types";

export const runtime = "nodejs";

async function ensureGatewayReady(baseUrl: string) {
  const firstAttempt = await ensureLocalGatewayAvailableDetailed(baseUrl, { waitMs: 25000 });
  if (firstAttempt.ok) return firstAttempt;
  const restarted = await restartLocalGateway(baseUrl, { waitMs: 30000 });
  if (!restarted) {
    return {
      ok: false,
      reason: `Local gateway did not become ready, and restart timed out. ${firstAttempt.reason}`
    };
  }
  return ensureLocalGatewayAvailableDetailed(baseUrl, { waitMs: 10000 });
}

async function postPrewarm(baseUrl: string, model: string) {
  try {
    return await fetch(`${baseUrl.replace(/\/v1$/, "")}/v1/models/prewarm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model })
    });
  } catch {
    const restarted = await restartLocalGateway(baseUrl, { waitMs: 30000 });
    if (!restarted) {
      throw new Error("Gateway restart timed out before retrying prewarm.");
    }
    return fetch(`${baseUrl.replace(/\/v1$/, "")}/v1/models/prewarm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model })
    });
  }
}

export async function POST() {
  try {
    const localTargets = agentTargets.filter((target) => target.execution === "local");
    const results: AgentRuntimePrewarmResponse[] = [];

    for (const target of localTargets) {
      const resolvedTarget = resolveTarget(target.id);
      try {
        const ensureResult = await ensureGatewayReady(resolvedTarget.resolvedBaseUrl);
        if (!ensureResult.ok) {
          results.push({
            ok: false,
            targetId: target.id,
            targetLabel: target.label,
            loadedAlias: null,
            message: ensureResult.reason
          });
          continue;
        }
        const upstream = await postPrewarm(resolvedTarget.resolvedBaseUrl, resolvedTarget.resolvedModel);

        const payload = (await upstream.json()) as
          | {
              ok?: boolean;
              loaded_alias?: string | null;
              load_ms?: number;
              warmup_ms?: number;
              detail?: string;
            }
          | { error?: string };

        if (!upstream.ok) {
          results.push({
            ok: false,
            targetId: target.id,
            targetLabel: target.label,
            loadedAlias: null,
            message:
              ("detail" in payload && payload.detail) ||
              ("error" in payload && payload.error) ||
              `Prewarm failed for ${target.label}.`
          });
          continue;
        }

        results.push({
          ok: Boolean("ok" in payload ? payload.ok : true),
          targetId: target.id,
          targetLabel: target.label,
          loadedAlias: "loaded_alias" in payload ? (payload.loaded_alias ?? null) : null,
          loadMs: "load_ms" in payload && typeof payload.load_ms === "number" ? payload.load_ms : undefined,
          warmupMs: "warmup_ms" in payload && typeof payload.warmup_ms === "number" ? payload.warmup_ms : undefined,
          message: `Prewarm finished for ${target.label}.`
        });
      } catch (error) {
        results.push({
          ok: false,
          targetId: target.id,
          targetLabel: target.label,
          loadedAlias: null,
          message: error instanceof Error ? error.message : `Prewarm failed for ${target.label}.`
        });
      }
    }

    const response: AgentRuntimePrewarmAllResponse = {
      ok: results.every((result) => result.ok),
      completed: results.filter((result) => result.ok).length,
      total: localTargets.length,
      results,
      message: `Prewarm finished for ${results.filter((result) => result.ok).length} of ${localTargets.length} local targets.`
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Prewarm-all failed." },
      { status: 500 }
    );
  }
}
