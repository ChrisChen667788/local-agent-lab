import { NextResponse } from "next/server";
import { getObservabilityPaths, readConnectionCheckLogs } from "@/lib/agent/log-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetId = searchParams.get("targetId") || undefined;
  const limitValue = Number(searchParams.get("limit") || "50");
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? Math.min(limitValue, 200) : 50;

  const logs = readConnectionCheckLogs({ targetId, limit });
  return NextResponse.json({
    count: logs.length,
    paths: getObservabilityPaths(),
    logs
  });
}
