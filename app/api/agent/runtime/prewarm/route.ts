import { NextResponse } from "next/server";
import { getAgentTarget } from "@/lib/agent/catalog";
import { ensureLocalGatewayAvailableDetailed, restartLocalGateway } from "@/lib/agent/local-gateway";
import { resolveTarget } from "@/lib/agent/providers";
import type { AgentRuntimePrewarmResponse } from "@/lib/agent/types";

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { targetId?: string };
    if (!body.targetId || typeof body.targetId !== "string") {
      return NextResponse.json({ error: "targetId is required." }, { status: 400 });
    }

    const target = getAgentTarget(body.targetId);
    if (!target) {
      return NextResponse.json({ error: `Unknown target: ${body.targetId}` }, { status: 404 });
    }

    if (target.execution !== "local") {
      return NextResponse.json({ error: "Only local targets support prewarm." }, { status: 400 });
    }

    const resolvedTarget = resolveTarget(body.targetId);
    const ensureResult = await ensureGatewayReady(resolvedTarget.resolvedBaseUrl);
    if (!ensureResult.ok) {
      return NextResponse.json({ error: ensureResult.reason }, { status: 503 });
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
      return NextResponse.json(
        { error: ("detail" in payload && payload.detail) || ("error" in payload && payload.error) || "Prewarm failed." },
        { status: upstream.status }
      );
    }

    const response: AgentRuntimePrewarmResponse = {
      ok: Boolean("ok" in payload ? payload.ok : true),
      targetId: body.targetId,
      targetLabel: target.label,
      loadedAlias: "loaded_alias" in payload ? (payload.loaded_alias ?? null) : null,
      loadMs: "load_ms" in payload && typeof payload.load_ms === "number" ? payload.load_ms : undefined,
      warmupMs: "warmup_ms" in payload && typeof payload.warmup_ms === "number" ? payload.warmup_ms : undefined,
      message: `Prewarm finished for ${target.label}.`
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Prewarm failed." },
      { status: 500 }
    );
  }
}
