import { NextResponse } from "next/server";
import { readCompareProgress, touchCompareLaneProgress } from "@/lib/agent/compare-progress-store";
import type { AgentCompareLaneProgressPhase, AgentCompareProgress } from "@/lib/agent/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestId = searchParams.get("requestId");

  if (!requestId) {
    return NextResponse.json({ error: "requestId is required." }, { status: 400 });
  }

  const progress = readCompareProgress(requestId);
  if (!progress) {
    return NextResponse.json({ error: `No compare progress found for ${requestId}.` }, { status: 404 });
  }

  return NextResponse.json(progress);
}

type CompareProgressPatchBody = {
  requestId?: string;
  targetId?: string;
  phase?: AgentCompareLaneProgressPhase;
  detail?: string;
  loadingElapsedMs?: number | null;
  recoveryThresholdMs?: number | null;
  recoveryAction?: string;
  recoveryTriggeredAt?: string | null;
  recoveryTriggerElapsedMs?: number | null;
  warning?: string;
  recordTimeline?: boolean;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CompareProgressPatchBody;
    if (!body.requestId || typeof body.requestId !== "string") {
      return NextResponse.json({ error: "requestId is required." }, { status: 400 });
    }
    if (!body.targetId || typeof body.targetId !== "string") {
      return NextResponse.json({ error: "targetId is required." }, { status: 400 });
    }
    if (!body.phase || typeof body.phase !== "string") {
      return NextResponse.json({ error: "phase is required." }, { status: 400 });
    }
    if (!body.detail || typeof body.detail !== "string") {
      return NextResponse.json({ error: "detail is required." }, { status: 400 });
    }

    const current = readCompareProgress(body.requestId);
    if (!current) {
      return NextResponse.json({ error: `No compare progress found for ${body.requestId}.` }, { status: 404 });
    }
    if (!current.lanes.some((lane) => lane.targetId === body.targetId)) {
      return NextResponse.json({ error: `Target ${body.targetId} is not part of this compare run.` }, { status: 404 });
    }

    const updated = touchCompareLaneProgress(body.requestId, body.targetId, {
      phase: body.phase,
      detail: body.detail,
      loadingElapsedMs: body.loadingElapsedMs,
      recoveryThresholdMs: body.recoveryThresholdMs,
      recoveryAction: body.recoveryAction,
      recoveryTriggeredAt: body.recoveryTriggeredAt,
      recoveryTriggerElapsedMs: body.recoveryTriggerElapsedMs,
      warning: body.warning,
      recordTimeline: body.recordTimeline
    });

    if (!updated) {
      return NextResponse.json({ error: `Failed to update compare progress for ${body.requestId}.` }, { status: 500 });
    }

    return NextResponse.json(updated satisfies AgentCompareProgress);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update compare progress." },
      { status: 500 }
    );
  }
}
