import crypto from "crypto";
import { NextResponse } from "next/server";
import {
  appendBenchmarkBaseline,
  deleteBenchmarkBaseline,
  readBenchmarkBaselines,
  replaceBenchmarkBaselines,
  updateBenchmarkBaseline
} from "@/lib/agent/log-store";
import type { AgentBenchmarkBaseline, AgentBenchmarkResponse } from "@/lib/agent/types";

export const runtime = "nodejs";

type SaveBaselineBody = {
  label?: string;
  benchmark?: AgentBenchmarkResponse;
};

type UpdateBaselineBody =
  | {
      action: "rename";
      id: string;
      label?: string;
    }
  | {
      action: "set_default";
      id: string;
    };

function parseWorkload(searchParams: URLSearchParams) {
  const targetIds = (searchParams.get("targetIds") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const benchmarkMode = (searchParams.get("benchmarkMode") || "prompt").trim();
  const contextWindowValue = Number(searchParams.get("contextWindow") || "");
  const contextWindow = Number.isFinite(contextWindowValue) ? contextWindowValue : undefined;
  const promptSetId = searchParams.get("promptSetId")?.trim() || "";
  const datasetId = searchParams.get("datasetId")?.trim() || "";
  const datasetSampleCountValue = Number(searchParams.get("datasetSampleCount") || "");
  const datasetSampleCount = Number.isFinite(datasetSampleCountValue) ? datasetSampleCountValue : undefined;
  const suiteId = searchParams.get("suiteId")?.trim() || "";
  const profileBatchScope = searchParams.get("profileBatchScope")?.trim() || "";
  const prompt = searchParams.get("prompt")?.trim() || "";

  return { targetIds, benchmarkMode, contextWindow, promptSetId, datasetId, datasetSampleCount, suiteId, profileBatchScope, prompt };
}

function matchesWorkload(
  entry: AgentBenchmarkBaseline,
  options: {
    targetIds: string[];
    benchmarkMode?: string;
    contextWindow?: number;
    promptSetId?: string;
    datasetId?: string;
    datasetSampleCount?: number;
    suiteId?: string;
    profileBatchScope?: string;
    prompt?: string;
  }
) {
  if ((entry.benchmarkMode || "prompt") !== (options.benchmarkMode || "prompt")) return false;
  if (typeof options.contextWindow === "number" && entry.contextWindow !== options.contextWindow) return false;
  if (options.profileBatchScope && (entry.profileBatchScope || "") !== options.profileBatchScope) return false;
  if (options.suiteId) {
    if (entry.suiteId !== options.suiteId) return false;
  } else if (options.datasetId) {
    if (entry.datasetId !== options.datasetId) return false;
    if (typeof options.datasetSampleCount === "number" && entry.datasetSampleCount !== options.datasetSampleCount) return false;
  } else
  if (options.promptSetId) {
    if (entry.promptSetId !== options.promptSetId) return false;
  } else if (options.prompt) {
    if (entry.promptSetId) return false;
    if (entry.datasetId) return false;
    if (entry.suiteId) return false;
    if (entry.prompt !== options.prompt) return false;
  }
  if (options.targetIds.length) {
    return options.targetIds.every((targetId) => entry.results.some((result) => result.targetId === targetId));
  }
  return true;
}

function sortBaselines(rows: AgentBenchmarkBaseline[]) {
  return [...rows].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workload = parseWorkload(searchParams);
  const matching = sortBaselines(
    readBenchmarkBaselines({ limit: 500 }).filter((entry) => matchesWorkload(entry, workload))
  );
  const baseline = matching.find((entry) => entry.isDefault) || matching[0] || null;

  return NextResponse.json({
    baseline,
    baselines: matching
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SaveBaselineBody;
    if (!body.benchmark || !Array.isArray(body.benchmark.results) || !body.benchmark.results.length) {
      return NextResponse.json({ error: "benchmark payload is required." }, { status: 400 });
    }

    const savedAt = new Date().toISOString();
    const record: AgentBenchmarkBaseline = {
      ...body.benchmark,
      kind: "benchmark-baseline",
      id: crypto.randomUUID(),
      savedAt,
      label: body.label?.trim() || undefined,
      isDefault: false
    };

    appendBenchmarkBaseline(record);

    return NextResponse.json({
      ok: true,
      savedAt,
      baseline: record
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save benchmark baseline." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as UpdateBaselineBody;
    if (!body?.id) {
      return NextResponse.json({ error: "Baseline id is required." }, { status: 400 });
    }

    if (body.action === "rename") {
      const updated = updateBenchmarkBaseline(body.id, (entry) => ({
        ...entry,
        label: body.label?.trim() || undefined
      }));
      if (!updated) {
        return NextResponse.json({ error: "Baseline not found." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, baseline: updated });
    }

    if (body.action === "set_default") {
      const baselines = readBenchmarkBaselines({ limit: 1000 });
      const current = baselines.find((entry) => entry.id === body.id);
      if (!current) {
        return NextResponse.json({ error: "Baseline not found." }, { status: 404 });
      }

      const workload = {
        targetIds: [],
        benchmarkMode: current.benchmarkMode || "prompt",
        contextWindow: current.contextWindow,
        promptSetId: current.promptSetId,
        datasetId: current.datasetId,
        datasetSampleCount: current.datasetSampleCount,
        suiteId: current.suiteId,
        profileBatchScope: current.profileBatchScope,
        prompt: current.promptSetId ? "" : current.prompt
      };

      const nextRows = baselines.map((entry) => {
        if (matchesWorkload(entry, workload)) {
          return {
            ...entry,
            isDefault: entry.id === body.id
          };
        }
        return entry;
      });
      replaceBenchmarkBaselines(nextRows);
      const updated = nextRows.find((entry) => entry.id === body.id) || null;
      return NextResponse.json({ ok: true, baseline: updated });
    }

    return NextResponse.json({ error: "Unsupported baseline action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update benchmark baseline." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id")?.trim() || "";
  if (!id) {
    return NextResponse.json({ error: "Baseline id is required." }, { status: 400 });
  }
  const deleted = deleteBenchmarkBaseline(id);
  if (!deleted) {
    return NextResponse.json({ error: "Baseline not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, deletedId: id });
}
