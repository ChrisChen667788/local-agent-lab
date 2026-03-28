import { NextResponse } from "next/server";
import {
  finalizeBenchmarkProgressControl,
  readBenchmarkProgress,
  readLatestBenchmarkProgress,
  requestBenchmarkProgressControl
} from "@/lib/agent/benchmark-progress-store";
import { abortBenchmarkRun } from "@/lib/agent/benchmark-run-control";

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

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    runId?: string;
    action?: "stop" | "abandon";
  };
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  const action = body.action;

  if (!runId) {
    return NextResponse.json({ error: "runId is required." }, { status: 400 });
  }
  const current = readBenchmarkProgress(runId);
  if (!current) {
    return NextResponse.json({ error: "Progress record not found." }, { status: 404 });
  }
  if (action !== "stop" && action !== "abandon") {
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  }

  const next =
    current.status === "pending" || current.status === "running"
      ? (() => {
          const updated = requestBenchmarkProgressControl(runId, action);
          abortBenchmarkRun(runId);
          return updated;
        })()
      : finalizeBenchmarkProgressControl(runId, action, action === "stop" ? "Benchmark run stopped." : "Benchmark run abandoned.");

  if (!next) {
    return NextResponse.json({ error: "Failed to update progress record." }, { status: 500 });
  }

  return NextResponse.json(next);
}
