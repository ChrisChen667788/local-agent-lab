import { NextResponse } from "next/server";
import { agentTargets } from "@/lib/agent/catalog";
import { resolveTarget } from "@/lib/agent/providers";
import type {
  AgentRuntimePrewarmAllResponse,
  AgentRuntimePrewarmResponse
} from "@/lib/agent/types";
import { prewarmLocalTargetWithRecovery } from "../prewarm-utils";

export const runtime = "nodejs";

export async function POST() {
  try {
    const localTargets = agentTargets.filter((target) => target.execution === "local");
    const results: AgentRuntimePrewarmResponse[] = [];

    for (const target of localTargets) {
      const resolvedTarget = resolveTarget(target.id);
      try {
        const prewarmResult = await prewarmLocalTargetWithRecovery({
          baseUrl: resolvedTarget.resolvedBaseUrl,
          model: resolvedTarget.resolvedModel,
          targetId: target.id,
          targetLabel: target.label
        });
        results.push(prewarmResult);
      } catch (error) {
        results.push({
          ok: false,
          status: "failed",
          targetId: target.id,
          targetLabel: target.label,
          loadedAlias: null,
          message: error instanceof Error ? error.message : `Prewarm failed for ${target.label}.`
        });
      }
    }

    const response: AgentRuntimePrewarmAllResponse = {
      ok: results.every((result) => result.ok),
      completed: results.filter((result) => result.status === "ready").length,
      total: localTargets.length,
      results,
      message: `Prewarm finished for ${
        results.filter((result) => result.status === "ready").length
      } of ${localTargets.length} local targets.`
    };

    return NextResponse.json(response, { status: response.ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Prewarm-all failed." },
      { status: 500 }
    );
  }
}
