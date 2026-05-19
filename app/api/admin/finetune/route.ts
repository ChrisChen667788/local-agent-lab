import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import {
  attachFineTuneAdapterRuntime,
  cancelFineTuneJob,
  checkFineTuneDatasetUpstream,
  detachFineTuneAdapterRuntime,
  exportFineTuneJobBundleArchive,
  exportFineTuneJobReport,
  importFineTuneCommunityDataset,
  openFineTunePath,
  openFineTuneSourcePage,
  refreshDueFineTuneDatasetWatches,
  readFineTuneSummary,
  rerunFineTuneJob,
  runFineTuneAdapterChat,
  runFineTuneAdapterExport,
  runFineTuneDistillation,
  runFineTuneEvaluation,
  saveFineTuneDataset,
  saveFineTuneRecipe,
  saveFineTuneDatasetWatch,
  startFineTuneJob,
  stageFineTuneJob,
  validateFineTuneDatasetFromPath,
} from "@/lib/finetune/store";
import type {
  AgentFineTuneDataset,
  AgentFineTuneDatasetFormat,
  AgentFineTuneDatasetQuality,
  AgentFineTuneReportFormat,
} from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeFormat(value: unknown): AgentFineTuneDatasetFormat {
  return value === "instruction-jsonl" ? "instruction-jsonl" : "chat-jsonl";
}

function normalizeReportFormat(value: unknown): AgentFineTuneReportFormat {
  if (value === "manifest-json" || value === "metrics-csv") return value;
  return "markdown";
}

function normalizeDatasetSourceType(
  value: unknown,
): AgentFineTuneDataset["sourceType"] | undefined {
  if (
    value === "local-path" ||
    value === "bundled-preset" ||
    value === "community-import" ||
    value === "community-preset"
  ) {
    return value;
  }
  return undefined;
}

function normalizeDatasetQuality(
  value: unknown,
): AgentFineTuneDatasetQuality | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<AgentFineTuneDatasetQuality>;
  const licenseRisk =
    input.licenseRisk === "low" ||
    input.licenseRisk === "medium" ||
    input.licenseRisk === "high" ||
    input.licenseRisk === "unknown"
      ? input.licenseRisk
      : "unknown";
  const score = Number(input.score);
  if (!Number.isFinite(score)) return undefined;

  const normalized: AgentFineTuneDatasetQuality = {
    score: Math.max(0, Math.min(100, Math.round(score))),
    licenseRisk,
  };
  (
    [
      "downloadedRows",
      "convertedRows",
      "sampledRows",
      "duplicateRows",
      "skippedRows",
      "piiRiskRows",
    ] as const
  ).forEach((key) => {
    const nextValue = Number(input[key]);
    if (Number.isFinite(nextValue)) {
      normalized[key] = Math.max(0, Math.round(nextValue));
    }
  });
  if (typeof input.schemaConversion === "string") {
    normalized.schemaConversion = input.schemaConversion.slice(0, 240);
  }
  if (input.recommendedSteps && typeof input.recommendedSteps === "object") {
    const min = Number(input.recommendedSteps.min);
    const max = Number(input.recommendedSteps.max);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      normalized.recommendedSteps = {
        min: Math.max(0, Math.round(min)),
        max: Math.max(0, Math.round(max)),
        label:
          typeof input.recommendedSteps.label === "string"
            ? input.recommendedSteps.label.slice(0, 180)
            : "",
      };
    }
  }
  return normalized;
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReportPreviewHtml(
  report: ReturnType<typeof exportFineTuneJobReport>,
) {
  const title = `Fine-tune report · ${report.jobId}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; background: #020617; color: #e5edf8; }
    body { margin: 0; font: 15px/1.65 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top left, rgba(34,211,238,.16), transparent 28%), #020617; }
    main { max-width: 1040px; margin: 0 auto; padding: 40px 24px 64px; }
    header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    h1 { margin: 0; font-size: clamp(28px, 5vw, 48px); line-height: 1; letter-spacing: -0.04em; }
    .meta { color: #94a3b8; font-size: 13px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    a { color: #a5f3fc; }
    .button { border: 1px solid rgba(34,211,238,.32); border-radius: 999px; padding: 9px 13px; background: rgba(34,211,238,.1); color: #cffafe; text-decoration: none; font-weight: 700; font-size: 12px; }
    .bundle { border: 1px solid rgba(167,139,250,.2); border-radius: 22px; background: rgba(15,23,42,.72); padding: 16px 18px; margin: 18px 0; color: #cbd5e1; }
    .bundle strong { color: #f8fafc; }
    pre { white-space: pre-wrap; word-break: break-word; border: 1px solid rgba(148,163,184,.22); border-radius: 24px; background: rgba(2,6,23,.72); padding: 22px; overflow: auto; box-shadow: 0 24px 80px rgba(0,0,0,.28); }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <p class="meta">First LLM Studio · Fine-tune run evidence</p>
        <h1>Fine-tune Report Preview</h1>
        <p class="meta">${escapeHtml(report.generatedAt)} · ${escapeHtml(report.metricsSummary.pointCount.toString())} metric points</p>
      </div>
      <div class="actions">
        <a class="button" href="/api/admin/finetune?action=download-bundle&id=${encodeURIComponent(report.jobId)}">Download full bundle</a>
      </div>
    </header>
    <section class="bundle">
      <strong>Complete bundle contents</strong><br />
      Download includes the reproducible job bundle, split datasets, MLX config, metrics, worker log, adapter artifacts, report exports, bundle manifest, and file inventory.
    </section>
    <pre>${escapeHtml(report.content)}</pre>
  </main>
</body>
</html>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  if (action === "preview-report") {
    const jobId = url.searchParams.get("id")?.trim() || "";
    if (!jobId) {
      return NextResponse.json(
        { error: "id is required for preview-report." },
        { status: 400 },
      );
    }
    const report = exportFineTuneJobReport({
      jobId,
      format: normalizeReportFormat(url.searchParams.get("reportFormat")),
    });
    return new Response(buildReportPreviewHtml(report), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  if (action === "download-bundle") {
    const jobId = url.searchParams.get("id")?.trim() || "";
    if (!jobId) {
      return NextResponse.json(
        { error: "id is required for download-bundle." },
        { status: 400 },
      );
    }
    const archive = exportFineTuneJobBundleArchive({ jobId });
    return new Response(new Uint8Array(readFileSync(archive.filePath)), {
      headers: {
        "content-type": "application/gzip",
        "content-disposition": `attachment; filename="${archive.fileName}"`,
        "cache-control": "no-store",
        "x-first-llm-studio-bundle-path": encodeURIComponent(archive.filePath),
        "x-first-llm-studio-bundle-files": String(
          archive.includedFileCount || 0,
        ),
        "x-first-llm-studio-bundle-uncompressed-bytes": String(
          archive.totalUncompressedBytes || 0,
        ),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    summary: await refreshDueFineTuneDatasetWatches(),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      id?: string;
      label?: string;
      sourcePath?: string;
      sourceUrl?: string;
      sourceLabel?: string;
      sampleLimit?: number;
      license?: string;
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
      kind?:
        | "job-bundle"
        | "job-output"
        | "job-reports"
        | "adapter-output"
        | "dataset-source";
      adapterId?: string;
      targetId?: string;
      reportFormat?: AgentFineTuneReportFormat;
      sourceType?: AgentFineTuneDataset["sourceType"];
      qualityWarnings?: string[];
      quality?: AgentFineTuneDatasetQuality;
      checkpointPath?: string;
      maxSamples?: number;
      maxNewTokens?: number;
      temperature?: number;
      topP?: number;
      metrics?: string[];
      savePredictions?: boolean;
      role?: string;
      systemPrompt?: string;
      prompt?: string;
      skipSpecialTokens?: boolean;
      renderHtmlTags?: boolean;
      exportFormat?: string;
      quantization?: string;
      maxShardSizeGb?: number;
      outputDir?: string;
      hubId?: string;
      includeDatasetCard?: boolean;
      teacherTargetId?: string;
      outputPath?: string;
      sampleCount?: number;
      seedPrompt?: string;
      includeReasoningTrace?: boolean;
    };

    if (body.action === "validate-dataset") {
      const sourcePath =
        typeof body.sourcePath === "string" ? body.sourcePath.trim() : "";
      if (!sourcePath) {
        return NextResponse.json(
          { error: "sourcePath is required." },
          { status: 400 },
        );
      }
      const validation = validateFineTuneDatasetFromPath(
        sourcePath,
        normalizeFormat(body.format),
      );
      return NextResponse.json({ ok: true, validation });
    }

    if (body.action === "save-dataset") {
      const dataset = saveFineTuneDataset({
        id: typeof body.id === "string" ? body.id : undefined,
        label: typeof body.label === "string" ? body.label : "",
        sourcePath: typeof body.sourcePath === "string" ? body.sourcePath : "",
        format: normalizeFormat(body.format),
        sourceType: normalizeDatasetSourceType(body.sourceType),
        sourceUrl:
          typeof body.sourceUrl === "string" ? body.sourceUrl : undefined,
        sourceLabel:
          typeof body.sourceLabel === "string" ? body.sourceLabel : undefined,
        license: typeof body.license === "string" ? body.license : undefined,
        qualityWarnings: normalizeStringList(body.qualityWarnings),
        quality: normalizeDatasetQuality(body.quality),
        upstreamQuery:
          typeof body.upstreamQuery === "string"
            ? body.upstreamQuery
            : undefined,
        refreshCadenceHours:
          typeof body.refreshCadenceHours === "number"
            ? body.refreshCadenceHours
            : undefined,
      });
      return NextResponse.json({
        ok: true,
        dataset,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "import-community-dataset") {
      const dataset = await importFineTuneCommunityDataset({
        label: typeof body.label === "string" ? body.label : "",
        sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : "",
        sourceLabel:
          typeof body.sourceLabel === "string" ? body.sourceLabel : undefined,
        license: typeof body.license === "string" ? body.license : undefined,
        sampleLimit:
          typeof body.sampleLimit === "number" ? body.sampleLimit : undefined,
        format: normalizeFormat(body.format),
        upstreamQuery:
          typeof body.upstreamQuery === "string"
            ? body.upstreamQuery
            : undefined,
        refreshCadenceHours:
          typeof body.refreshCadenceHours === "number"
            ? body.refreshCadenceHours
            : undefined,
      });
      return NextResponse.json({
        ok: true,
        dataset,
        validation: dataset.validation,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "save-dataset-watch") {
      const datasetId =
        typeof body.datasetId === "string" ? body.datasetId.trim() : "";
      if (!datasetId) {
        return NextResponse.json(
          { error: "datasetId is required." },
          { status: 400 },
        );
      }
      const dataset = saveFineTuneDatasetWatch({
        datasetId,
        upstreamQuery:
          typeof body.upstreamQuery === "string"
            ? body.upstreamQuery
            : undefined,
        refreshCadenceHours:
          typeof body.refreshCadenceHours === "number"
            ? body.refreshCadenceHours
            : undefined,
      });
      return NextResponse.json({
        ok: true,
        dataset,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "check-upstream-datasets") {
      const datasetId =
        typeof body.datasetId === "string" ? body.datasetId.trim() : "";
      if (!datasetId) {
        return NextResponse.json(
          { error: "datasetId is required." },
          { status: 400 },
        );
      }
      const dataset = await checkFineTuneDatasetUpstream({
        datasetId,
        query:
          typeof body.upstreamQuery === "string"
            ? body.upstreamQuery
            : undefined,
      });
      return NextResponse.json({
        ok: true,
        dataset,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "save-recipe") {
      const recipe = saveFineTuneRecipe({
        id: typeof body.id === "string" ? body.id : undefined,
        label: typeof body.label === "string" ? body.label : "",
        datasetId: typeof body.datasetId === "string" ? body.datasetId : "",
        baseTargetId:
          typeof body.baseTargetId === "string" ? body.baseTargetId : "",
        adapterName:
          typeof body.adapterName === "string" ? body.adapterName : "",
        sequenceLength:
          typeof body.sequenceLength === "number" ? body.sequenceLength : 8192,
        batchSize: typeof body.batchSize === "number" ? body.batchSize : 4,
        epochs: typeof body.epochs === "number" ? body.epochs : 3,
        learningRate:
          typeof body.learningRate === "number" ? body.learningRate : 0.0002,
        fineTuneMethod: body.fineTuneMethod === "dora" ? "dora" : "lora",
        optimizer:
          body.optimizer === "adamw" ||
          body.optimizer === "sgd" ||
          body.optimizer === "adafactor"
            ? body.optimizer
            : "adam",
        numLayers: typeof body.numLayers === "number" ? body.numLayers : 16,
        gradientAccumulationSteps:
          typeof body.gradientAccumulationSteps === "number"
            ? body.gradientAccumulationSteps
            : 1,
        loraRank: typeof body.loraRank === "number" ? body.loraRank : 16,
        loraAlpha: typeof body.loraAlpha === "number" ? body.loraAlpha : 32,
        gradientCheckpointing: Boolean(body.gradientCheckpointing),
        validationSplitPct:
          typeof body.validationSplitPct === "number"
            ? body.validationSplitPct
            : 10,
        saveEverySteps:
          typeof body.saveEverySteps === "number" ? body.saveEverySteps : 0,
        seed: typeof body.seed === "number" ? body.seed : 42,
        benchmarkSuiteId:
          typeof body.benchmarkSuiteId === "string"
            ? body.benchmarkSuiteId
            : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });
      return NextResponse.json({
        ok: true,
        recipe,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "stage-job") {
      const recipeId =
        typeof body.recipeId === "string" ? body.recipeId.trim() : "";
      if (!recipeId) {
        return NextResponse.json(
          { error: "recipeId is required." },
          { status: 400 },
        );
      }
      const job = stageFineTuneJob({
        recipeId,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });
      return NextResponse.json({
        ok: true,
        job,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "start-job") {
      const jobId = typeof body.id === "string" ? body.id.trim() : "";
      if (!jobId) {
        return NextResponse.json(
          { error: "id is required for start-job." },
          { status: 400 },
        );
      }
      const job = startFineTuneJob({ jobId });
      return NextResponse.json({
        ok: true,
        job,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "rerun-job") {
      const jobId = typeof body.id === "string" ? body.id.trim() : "";
      if (!jobId) {
        return NextResponse.json(
          { error: "id is required for rerun-job." },
          { status: 400 },
        );
      }
      const job = rerunFineTuneJob({ jobId });
      return NextResponse.json({
        ok: true,
        job,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "cancel-job") {
      const jobId = typeof body.id === "string" ? body.id.trim() : "";
      if (!jobId) {
        return NextResponse.json(
          { error: "id is required for cancel-job." },
          { status: 400 },
        );
      }
      const job = cancelFineTuneJob({ jobId });
      return NextResponse.json({
        ok: true,
        job,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "export-report") {
      const jobId = typeof body.id === "string" ? body.id.trim() : "";
      if (!jobId) {
        return NextResponse.json(
          { error: "id is required for export-report." },
          { status: 400 },
        );
      }
      const report = exportFineTuneJobReport({
        jobId,
        format: normalizeReportFormat(body.reportFormat),
      });
      return NextResponse.json({
        ok: true,
        report,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "open-path") {
      const kind =
        body.kind === "job-bundle" ||
        body.kind === "job-output" ||
        body.kind === "job-reports" ||
        body.kind === "adapter-output" ||
        body.kind === "dataset-source"
          ? body.kind
          : null;
      const id = typeof body.id === "string" ? body.id.trim() : "";
      if (!kind || !id) {
        return NextResponse.json(
          { error: "kind and id are required for open-path." },
          { status: 400 },
        );
      }
      const opened = openFineTunePath({ kind, id });
      return NextResponse.json({
        ok: true,
        opened,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "open-source-page") {
      const opened = openFineTuneSourcePage({
        adapterId:
          typeof body.adapterId === "string"
            ? body.adapterId.trim()
            : undefined,
        targetId:
          typeof body.targetId === "string" ? body.targetId.trim() : undefined,
        jobId: typeof body.id === "string" ? body.id.trim() : undefined,
      });
      return NextResponse.json({
        ok: true,
        opened,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "attach-runtime") {
      const adapterId =
        typeof body.adapterId === "string" ? body.adapterId.trim() : "";
      if (!adapterId) {
        return NextResponse.json(
          { error: "adapterId is required for attach-runtime." },
          { status: 400 },
        );
      }
      const attached = attachFineTuneAdapterRuntime({ adapterId });
      return NextResponse.json({
        ok: true,
        attached,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "detach-runtime") {
      const adapterId =
        typeof body.adapterId === "string" ? body.adapterId.trim() : "";
      if (!adapterId) {
        return NextResponse.json(
          { error: "adapterId is required for detach-runtime." },
          { status: 400 },
        );
      }
      const detached = await detachFineTuneAdapterRuntime({ adapterId });
      return NextResponse.json({
        ok: true,
        detached,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "run-evaluation") {
      const operation = runFineTuneEvaluation({
        adapterId:
          typeof body.adapterId === "string" ? body.adapterId.trim() : "",
        datasetId:
          typeof body.datasetId === "string" ? body.datasetId.trim() : "",
        checkpointPath:
          typeof body.checkpointPath === "string"
            ? body.checkpointPath
            : undefined,
        maxSamples: typeof body.maxSamples === "number" ? body.maxSamples : 24,
        maxNewTokens:
          typeof body.maxNewTokens === "number" ? body.maxNewTokens : 256,
        temperature:
          typeof body.temperature === "number" ? body.temperature : 0.2,
        topP: typeof body.topP === "number" ? body.topP : 0.9,
        metrics: normalizeStringList(body.metrics),
        savePredictions: Boolean(body.savePredictions),
      });
      return NextResponse.json({
        ok: true,
        operation,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "run-chat-adapter") {
      const operation = runFineTuneAdapterChat({
        adapterId:
          typeof body.adapterId === "string" ? body.adapterId.trim() : "",
        role: typeof body.role === "string" ? body.role : undefined,
        systemPrompt:
          typeof body.systemPrompt === "string" ? body.systemPrompt : undefined,
        prompt: typeof body.prompt === "string" ? body.prompt : "",
        maxNewTokens:
          typeof body.maxNewTokens === "number" ? body.maxNewTokens : 512,
        temperature:
          typeof body.temperature === "number" ? body.temperature : 0.7,
        topP: typeof body.topP === "number" ? body.topP : 0.9,
        skipSpecialTokens: Boolean(body.skipSpecialTokens),
        renderHtmlTags: Boolean(body.renderHtmlTags),
      });
      return NextResponse.json({
        ok: true,
        operation,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "run-export-adapter") {
      const operation = runFineTuneAdapterExport({
        adapterId:
          typeof body.adapterId === "string" ? body.adapterId.trim() : "",
        exportFormat:
          typeof body.exportFormat === "string" ? body.exportFormat : undefined,
        quantization:
          typeof body.quantization === "string" ? body.quantization : undefined,
        maxShardSizeGb:
          typeof body.maxShardSizeGb === "number"
            ? body.maxShardSizeGb
            : undefined,
        outputDir:
          typeof body.outputDir === "string" ? body.outputDir : undefined,
        hubId: typeof body.hubId === "string" ? body.hubId : undefined,
        includeDatasetCard: Boolean(body.includeDatasetCard),
      });
      return NextResponse.json({
        ok: true,
        operation,
        summary: readFineTuneSummary(),
      });
    }

    if (body.action === "run-distillation") {
      const result = runFineTuneDistillation({
        teacherTargetId:
          typeof body.teacherTargetId === "string"
            ? body.teacherTargetId.trim()
            : "",
        outputPath:
          typeof body.outputPath === "string" ? body.outputPath : undefined,
        sampleCount:
          typeof body.sampleCount === "number" ? body.sampleCount : 64,
        maxNewTokens:
          typeof body.maxNewTokens === "number" ? body.maxNewTokens : 512,
        temperature:
          typeof body.temperature === "number" ? body.temperature : 0.7,
        topP: typeof body.topP === "number" ? body.topP : 0.9,
        seedPrompt:
          typeof body.seedPrompt === "string" ? body.seedPrompt : undefined,
        includeReasoningTrace: Boolean(body.includeReasoningTrace),
      });
      return NextResponse.json({
        ok: true,
        ...result,
        summary: readFineTuneSummary(),
      });
    }

    return NextResponse.json(
      { error: "Unsupported finetune action." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Fine-tune request failed.",
      },
      { status: 400 },
    );
  }
}
