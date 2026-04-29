import { NextResponse } from "next/server";
import { getTimelineFilePath, readTimelineEvents } from "@/lib/agent/timeline-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") || "30");
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 200)) : 30;
  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    path: getTimelineFilePath(),
    events: readTimelineEvents({ limit })
  });
}
