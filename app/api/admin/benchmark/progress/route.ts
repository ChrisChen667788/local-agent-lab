import { NextResponse } from "next/server";
import { readBenchmarkProgress } from "@/lib/agent/benchmark-progress-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = (searchParams.get("runId") || "").trim();

  if (!runId) {
    return NextResponse.json({ error: "runId is required." }, { status: 400 });
  }

  const progress = readBenchmarkProgress(runId);
  if (!progress) {
    return NextResponse.json({ error: "Progress record not found." }, { status: 404 });
  }

  return NextResponse.json(progress);
}
