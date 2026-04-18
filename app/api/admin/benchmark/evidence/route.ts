import { NextResponse } from "next/server";
import {
  readBenchmarkReleaseEvidence,
  removeBenchmarkReleaseEvidence,
  upsertBenchmarkReleaseEvidence
} from "@/lib/agent/benchmark-release-evidence-store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    entries: readBenchmarkReleaseEvidence()
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      runId?: string;
      title?: string;
      note?: string;
    };
    const runId = typeof body.runId === "string" ? body.runId.trim() : "";
    if (!runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const entry = upsertBenchmarkReleaseEvidence({
      runId,
      title: typeof body.title === "string" ? body.title.trim() : undefined,
      note: typeof body.note === "string" ? body.note.trim() : undefined
    });
    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update release evidence." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = (searchParams.get("runId") || "").trim();
  if (!runId) {
    return NextResponse.json({ error: "runId is required." }, { status: 400 });
  }
  const removed = removeBenchmarkReleaseEvidence(runId);
  return NextResponse.json({ ok: removed });
}

