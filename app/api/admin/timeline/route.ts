import { NextResponse } from "next/server";
import { getTimelineFilePath, readTimelineEvents } from "@/lib/agent/timeline-store";
import type { AgentTimelineEventKind, AgentTimelineEventStatus } from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMELINE_KINDS: AgentTimelineEventKind[] = [
  "session",
  "compare",
  "benchmark",
  "finetune",
];
const TIMELINE_STATUSES: AgentTimelineEventStatus[] = [
  "started",
  "saved",
  "completed",
  "failed",
  "cancelled",
  "conflict",
];

function parseMultiValue<T extends string>(value: string | null, allowed: T[]) {
  if (!value) return undefined;
  const normalized = value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is T => allowed.includes(item as T));
  return normalized.length ? normalized : undefined;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") || "30");
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 200)) : 30;
  const kinds = parseMultiValue(searchParams.get("kind"), TIMELINE_KINDS);
  const statuses = parseMultiValue(searchParams.get("status"), TIMELINE_STATUSES);
  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    path: getTimelineFilePath(),
    events: readTimelineEvents({ limit, kinds, statuses })
  });
}
