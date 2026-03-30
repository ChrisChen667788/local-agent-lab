import { NextResponse } from "next/server";
import { getAgentTarget } from "@/lib/agent/catalog";
import { resolveTarget } from "@/lib/agent/providers";
import type { AgentRuntimePrewarmResponse } from "@/lib/agent/types";
import { prewarmLocalTargetWithRecovery } from "../prewarm-utils";

export const runtime = "nodejs";

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
    const response: AgentRuntimePrewarmResponse = await prewarmLocalTargetWithRecovery({
      baseUrl: resolvedTarget.resolvedBaseUrl,
      model: resolvedTarget.resolvedModel,
      targetId: body.targetId,
      targetLabel: target.label
    });

    return NextResponse.json(response, { status: response.ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Prewarm failed." },
      { status: 500 }
    );
  }
}
