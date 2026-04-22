import { NextResponse } from "next/server";
import {
  DEFAULT_RUNTIME_RESOURCE_GUARDRAIL_STRATEGY,
  getRuntimeResourceGuardrailPolicyFile,
  readPersistedRuntimeResourceGuardrailStrategy,
  resetRuntimeResourceGuardrailStrategy,
  saveRuntimeResourceGuardrailStrategy,
  type RuntimeResourceGuardrailStrategy
} from "@/lib/agent/runtime-guardrail-policy";
import { readRuntimeResourceGuardrailStrategy } from "@/lib/agent/runtime-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RuntimeGuardrailBody = {
  action?: "save" | "reset";
  strategy?: Partial<RuntimeResourceGuardrailStrategy>;
};

function buildPayload(message?: string) {
  return {
    ok: true,
    message,
    strategy: readRuntimeResourceGuardrailStrategy(),
    savedStrategy: readPersistedRuntimeResourceGuardrailStrategy(),
    defaults: DEFAULT_RUNTIME_RESOURCE_GUARDRAIL_STRATEGY,
    policyFile: getRuntimeResourceGuardrailPolicyFile()
  };
}

export async function GET() {
  return NextResponse.json(buildPayload());
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RuntimeGuardrailBody;
    if (body.action === "reset") {
      resetRuntimeResourceGuardrailStrategy();
      return NextResponse.json(buildPayload("Runtime guardrail policy reset to defaults."));
    }

    if (!body.strategy || typeof body.strategy !== "object") {
      return NextResponse.json({ error: "strategy is required." }, { status: 400 });
    }

    saveRuntimeResourceGuardrailStrategy(body.strategy);
    return NextResponse.json(buildPayload("Runtime guardrail policy saved."));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update runtime guardrail policy." },
      { status: 400 }
    );
  }
}
