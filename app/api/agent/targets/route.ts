import { NextResponse } from "next/server";
import { listServerAgentTargets, syncDiscoveredLocalTargetsFromGateway } from "@/lib/agent/server-targets";

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
