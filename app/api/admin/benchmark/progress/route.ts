import { NextResponse } from "next/server";
import {
  failBenchmarkProgress,
  finalizeBenchmarkProgressControl,
  readBenchmarkProgress,
  readLatestBenchmarkProgress,
  requestBenchmarkProgressControl,
  updateBenchmarkProgress
} from "@/lib/agent/benchmark-progress-store";
import { abortBenchmarkRun, hasActiveBenchmarkRunController } from "@/lib/agent/benchmark-run-control";

export const runtime = "nodejs";

const STALE_WORKER_ERROR =
  "Benchmark worker is no longer active. The run was likely interrupted by a server restart or crash.";
const STALE_PROGRESS_GRACE_MS = 60_000;
const STALE_WORKER_HEARTBEAT_GRACE_MS = 180_000;

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getProgressFreshnessMs(progress: NonNullable<ReturnType<typeof readBenchmarkProgress>>) {
  const references = [
    progress.workerHeartbeatAt,
    progress.localPrewarm?.updatedAt,
    progress.updatedAt,
    progress.controlRequestedAt,
    progress.startedAt
  ].filter((value): value is string => Boolean(value));
  const reference = references
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left)[0];
  if (!Number.isFinite(reference)) return Number.POSITIVE_INFINITY;
  return Date.now() - reference;
}

function getWorkerHeartbeatFreshnessMs(progress: NonNullable<ReturnType<typeof readBenchmarkProgress>>) {
  const parsed = Date.parse(progress.workerHeartbeatAt || "");
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY;
  return Date.now() - parsed;
}

function resolveStaleProgress(progress: ReturnType<typeof readBenchmarkProgress>) {
  if (!progress) return null;
  if (!(progress.status === "pending" || progress.status === "running")) {
    if (progress.status === "completed" && progress.error === STALE_WORKER_ERROR) {
      return updateBenchmarkProgress(progress.runId, (current) => ({
        ...current,
        error: undefined,
        updatedAt: new Date().toISOString()
      }));
    }
    return progress;
  }
  if (hasActiveBenchmarkRunController(progress.runId)) return progress;
  if (progress.controlAction) {
    const action = progress.controlAction === "stop-requested" ? "stop" : "abandon";
    return finalizeBenchmarkProgressControl(
      progress.runId,
      action,
      action === "stop" ? "Benchmark run stopped." : "Benchmark run abandoned."
    );
  }
  if (
    getWorkerHeartbeatFreshnessMs(progress) < STALE_WORKER_HEARTBEAT_GRACE_MS &&
    typeof progress.workerPid === "number" &&
    isPidAlive(progress.workerPid)
  ) {
    return progress;
  }
  if (getProgressFreshnessMs(progress) < STALE_PROGRESS_GRACE_MS) {
    return progress;
  }
  return failBenchmarkProgress(
    progress.runId,
    STALE_WORKER_ERROR
  );
}

function readResolvedLatestBenchmarkProgress(unfinishedOnly: boolean) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const progress = readLatestBenchmarkProgress({ unfinishedOnly });
    const resolved = resolveStaleProgress(progress);
    if (!resolved) return null;
    if (!unfinishedOnly || resolved.status === "pending" || resolved.status === "running") {
      return resolved;
    }
  }
  return null;
}

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
    : readResolvedLatestBenchmarkProgress(unfinishedOnly);
  const resolvedProgress = runId ? resolveStaleProgress(progress) : progress;
  if (!resolvedProgress) {
    return NextResponse.json({ error: "Progress record not found." }, { status: 404 });
  }

  return NextResponse.json(resolvedProgress);
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
          const aborted = abortBenchmarkRun(runId);
          if (aborted) return updated;
          return finalizeBenchmarkProgressControl(
            runId,
            action,
            action === "stop" ? "Benchmark run stopped." : "Benchmark run abandoned."
          );
        })()
      : finalizeBenchmarkProgressControl(runId, action, action === "stop" ? "Benchmark run stopped." : "Benchmark run abandoned.");

  if (!next) {
    return NextResponse.json({ error: "Failed to update progress record." }, { status: 500 });
  }

  return NextResponse.json(next);
}
