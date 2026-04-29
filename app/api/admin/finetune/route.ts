import { NextResponse } from "next/server";
import {
  attachFineTuneAdapterRuntime,
  cancelFineTuneJob,
  checkFineTuneDatasetUpstream,
  detachFineTuneAdapterRuntime,
  openFineTunePath,
  openFineTuneSourcePage,
  refreshDueFineTuneDatasetWatches,
  readFineTuneSummary,
  rerunFineTuneJob,
  saveFineTuneDataset,
  saveFineTuneRecipe,
  saveFineTuneDatasetWatch,
  startFineTuneJob,
  stageFineTuneJob,
  validateFineTuneDatasetFromPath
} from "@/lib/finetune/store";
import type { AgentFineTuneDatasetFormat } from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeFormat(value: unknown): AgentFineTuneDatasetFormat {
  return value === "instruction-jsonl" ? "instruction-jsonl" : "chat-jsonl";
}

export async function GET() {
  return NextResponse.json({ ok: true, summary: await refreshDueFineTuneDatasetWatches() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      id?: string;
      label?: string;
      sourcePath?: string;
      format?: AgentFineTuneDatasetFormat;
      upstreamQuery?: string;
      refreshCadenceHours?: number;
      datasetId?: string;
      baseTargetId?: string;
      adapterName?: string;
      sequenceLength?: number;
      batchSize?: number;
      epochs?: number;
      learningRate?: number;
      fineTuneMethod?: "lora" | "dora";
      optimizer?: "adam" | "adamw" | "sgd" | "adafactor";
      numLayers?: number;
      gradientAccumulationSteps?: number;
      loraRank?: number;
      loraAlpha?: number;
      gradientCheckpointing?: boolean;
      validationSplitPct?: number;
      saveEverySteps?: number;
      seed?: number;
      benchmarkSuiteId?: string;
      notes?: string;
      recipeId?: string;
      kind?: "job-bundle" | "job-output" | "adapter-output" | "dataset-source";
      adapterId?: string;
      targetId?: string;
    };

    if (body.action === "validate-dataset") {
      const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath.trim() : "";
      if (!sourcePath) {
        return NextResponse.json({ error: "sourcePath is required." }, { status: 400 });
      }
      const validation = validateFineTuneDatasetFromPath(sourcePath, normalizeFormat(body.format));
      return NextResponse.json({ ok: true, validation });
    }

    if (body.action === "save-dataset") {
      const dataset = saveFineTuneDataset({
        id: typeof body.id === "string" ? body.id : undefined,
        label: typeof body.label === "string" ? body.label : "",
        sourcePath: typeof body.sourcePath === "string" ? body.sourcePath : "",
        format: normalizeFormat(body.format),
        upstreamQuery: typeof body.upstreamQuery === "string" ? body.upstreamQuery : undefined,
        refreshCadenceHours: typeof body.refreshCadenceHours === "number" ? body.refreshCadenceHours : undefined
      });
      return NextResponse.json({ ok: true, dataset, summary: readFineTuneSummary() });
    }

    if (body.action === "save-dataset-watch") {
      const datasetId = typeof body.datasetId === "string" ? body.datasetId.trim() : "";
      if (!datasetId) {
        return NextResponse.json({ error: "datasetId is required." }, { status: 400 });
      }
      const dataset = saveFineTuneDatasetWatch({
        datasetId,
        upstreamQuery: typeof body.upstreamQuery === "string" ? body.upstreamQuery : undefined,
        refreshCadenceHours: typeof body.refreshCadenceHours === "number" ? body.refreshCadenceHours : undefined
      });
      return NextResponse.json({ ok: true, dataset, summary: readFineTuneSummary() });
    }

    if (body.action === "check-upstream-datasets") {
      const datasetId = typeof body.datasetId === "string" ? body.datasetId.trim() : "";
      if (!datasetId) {
        return NextResponse.json({ error: "datasetId is required." }, { status: 400 });
      }
      const dataset = await checkFineTuneDatasetUpstream({
        datasetId,
        query: typeof body.upstreamQuery === "string" ? body.upstreamQuery : undefined
      });
      return NextResponse.json({ ok: true, dataset, summary: readFineTuneSummary() });
    }

    if (body.action === "save-recipe") {
      const recipe = saveFineTuneRecipe({
        id: typeof body.id === "string" ? body.id : undefined,
        label: typeof body.label === "string" ? body.label : "",
        datasetId: typeof body.datasetId === "string" ? body.datasetId : "",
        baseTargetId: typeof body.baseTargetId === "string" ? body.baseTargetId : "",
        adapterName: typeof body.adapterName === "string" ? body.adapterName : "",
        sequenceLength: typeof body.sequenceLength === "number" ? body.sequenceLength : 8192,
        batchSize: typeof body.batchSize === "number" ? body.batchSize : 4,
        epochs: typeof body.epochs === "number" ? body.epochs : 3,
        learningRate: typeof body.learningRate === "number" ? body.learningRate : 0.0002,
        fineTuneMethod: body.fineTuneMethod === "dora" ? "dora" : "lora",
        optimizer:
          body.optimizer === "adamw" || body.optimizer === "sgd" || body.optimizer === "adafactor"
            ? body.optimizer
            : "adam",
        numLayers: typeof body.numLayers === "number" ? body.numLayers : 16,
        gradientAccumulationSteps:
          typeof body.gradientAccumulationSteps === "number" ? body.gradientAccumulationSteps : 1,
        loraRank: typeof body.loraRank === "number" ? body.loraRank : 16,
        loraAlpha: typeof body.loraAlpha === "number" ? body.loraAlpha : 32,
        gradientCheckpointing: Boolean(body.gradientCheckpointing),
        validationSplitPct: typeof body.validationSplitPct === "number" ? body.validationSplitPct : 10,
        saveEverySteps: typeof body.saveEverySteps === "number" ? body.saveEverySteps : 0,
        seed: typeof body.seed === "number" ? body.seed : 42,
        benchmarkSuiteId: typeof body.benchmarkSuiteId === "string" ? body.benchmarkSuiteId : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined
      });
      return NextResponse.json({ ok: true, recipe, summary: readFineTuneSummary() });
    }

    if (body.action === "stage-job") {
      const recipeId = typeof body.recipeId === "string" ? body.recipeId.trim() : "";
      if (!recipeId) {
        return NextResponse.json({ error: "recipeId is required." }, { status: 400 });
      }
      const job = stageFineTuneJob({ recipeId, notes: typeof body.notes === "string" ? body.notes : undefined });
      return NextResponse.json({ ok: true, job, summary: readFineTuneSummary() });
    }

    if (body.action === "start-job") {
      const jobId = typeof body.id === "string" ? body.id.trim() : "";
      if (!jobId) {
        return NextResponse.json({ error: "id is required for start-job." }, { status: 400 });
      }
      const job = startFineTuneJob({ jobId });
      return NextResponse.json({ ok: true, job, summary: readFineTuneSummary() });
    }

    if (body.action === "rerun-job") {
      const jobId = typeof body.id === "string" ? body.id.trim() : "";
      if (!jobId) {
        return NextResponse.json({ error: "id is required for rerun-job." }, { status: 400 });
      }
      const job = rerunFineTuneJob({ jobId });
      return NextResponse.json({ ok: true, job, summary: readFineTuneSummary() });
    }

    if (body.action === "cancel-job") {
      const jobId = typeof body.id === "string" ? body.id.trim() : "";
      if (!jobId) {
        return NextResponse.json({ error: "id is required for cancel-job." }, { status: 400 });
      }
      const job = cancelFineTuneJob({ jobId });
      return NextResponse.json({ ok: true, job, summary: readFineTuneSummary() });
    }

    if (body.action === "open-path") {
      const kind =
        body.kind === "job-bundle" ||
        body.kind === "job-output" ||
        body.kind === "adapter-output" ||
        body.kind === "dataset-source"
          ? body.kind
          : null;
      const id = typeof body.id === "string" ? body.id.trim() : "";
      if (!kind || !id) {
        return NextResponse.json({ error: "kind and id are required for open-path." }, { status: 400 });
      }
      const opened = openFineTunePath({ kind, id });
      return NextResponse.json({ ok: true, opened, summary: readFineTuneSummary() });
    }

    if (body.action === "open-source-page") {
      const opened = openFineTuneSourcePage({
        adapterId: typeof body.adapterId === "string" ? body.adapterId.trim() : undefined,
        targetId: typeof body.targetId === "string" ? body.targetId.trim() : undefined,
        jobId: typeof body.id === "string" ? body.id.trim() : undefined
      });
      return NextResponse.json({ ok: true, opened, summary: readFineTuneSummary() });
    }

    if (body.action === "attach-runtime") {
      const adapterId = typeof body.adapterId === "string" ? body.adapterId.trim() : "";
      if (!adapterId) {
        return NextResponse.json({ error: "adapterId is required for attach-runtime." }, { status: 400 });
      }
      const attached = attachFineTuneAdapterRuntime({ adapterId });
      return NextResponse.json({ ok: true, attached, summary: readFineTuneSummary() });
    }

    if (body.action === "detach-runtime") {
      const adapterId = typeof body.adapterId === "string" ? body.adapterId.trim() : "";
      if (!adapterId) {
        return NextResponse.json({ error: "adapterId is required for detach-runtime." }, { status: 400 });
      }
      const detached = await detachFineTuneAdapterRuntime({ adapterId });
      return NextResponse.json({ ok: true, detached, summary: readFineTuneSummary() });
    }

    return NextResponse.json({ error: "Unsupported finetune action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fine-tune request failed." },
      { status: 400 }
    );
  }
}
