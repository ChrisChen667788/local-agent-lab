import { NextResponse } from "next/server";
import { readBenchmarkProgress, readLatestBenchmarkProgress } from "@/lib/agent/benchmark-progress-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = (searchParams.get("runId") || "").trim();
  const latest = searchParams.get("latest") === "1";
  const unfinishedOnly = searchParams.get("unfinishedOnly") === "1";

  if (!runId && !latest) {
    return NextResponse.json({ error: "runId is required." }, { status: 400 });
  }

  const progress = runId
    ? readBenchmarkProgress(runId)
    : readLatestBenchmarkProgress({ unfinishedOnly });
  if (!progress) {
    return NextResponse.json({ error: "Progress record not found." }, { status: 404 });
  }

  return NextResponse.json(progress);
}
