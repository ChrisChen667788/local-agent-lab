import { NextResponse } from "next/server";
import { listServerAgentTargets } from "@/lib/agent/server-targets";
import { resolveTarget } from "@/lib/agent/providers";
import type {
  AgentRuntimePrewarmAllResponse,
  AgentRuntimePrewarmResponse
} from "@/lib/agent/types";
import { prewarmLocalTargetWithRecovery } from "../prewarm-utils";

export const runtime = "nodejs";

export async function POST() {
  try {
    const localTargets = listServerAgentTargets().filter((target) => target.execution === "local");
    const results: AgentRuntimePrewarmResponse[] = [];

    for (const target of localTargets) {
      const resolvedTarget = resolveTarget(target.id);
      try {
        const prewarmResult = await prewarmLocalTargetWithRecovery({
          baseUrl: resolvedTarget.resolvedBaseUrl,
          model: resolvedTarget.resolvedModel,
          targetId: target.id,
          targetLabel: target.label,
          blockedStatus: "skipped"
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

    const completed = results.filter((result) => result.status === "ready").length;
    const skipped = results.filter((result) => result.status === "skipped").length;
    const failed = results.filter((result) => result.status === "failed").length;
    const response: AgentRuntimePrewarmAllResponse = {
      ok: failed === 0,
      completed,
      skipped,
      failed,
      total: localTargets.length,
      results,
      message:
        skipped > 0
          ? `Prewarm finished for ${completed} of ${localTargets.length} local targets and skipped ${skipped} high-risk target${skipped === 1 ? "" : "s"}.`
          : `Prewarm finished for ${completed} of ${localTargets.length} local targets.`
    };

    return NextResponse.json(response, { status: response.ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Prewarm-all failed." },
      { status: 500 }
    );
  }
}
