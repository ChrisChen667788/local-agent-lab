import crypto from "crypto";
import { spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import path from "path";
import { getLocalAgentDataPath } from "@/lib/agent/data-dir";
import {
  listServerAgentTargets,
  removeDiscoveredLocalTarget,
  upsertDiscoveredLocalTarget,
} from "@/lib/agent/server-targets";
import { appendTimelineEvent } from "@/lib/agent/timeline-store";
import { discoverFineTuneUpstreamDatasets } from "@/lib/community/dataset-discovery";
import type {
  AgentTarget,
  AgentFineTuneAdapterArtifact,
  AgentFineTuneCurvePoint,
  AgentFineTuneDataset,
  AgentFineTuneDatasetFormat,
  AgentFineTuneDatasetValidation,
  AgentFineTuneJob,
  AgentFineTuneJobProgress,
  AgentFineTuneRecipe,
  AgentFineTuneSummary,
  AgentFineTuneTargetOption,
} from "@/lib/agent/types";

const FINETUNE_DIR = getLocalAgentDataPath("finetune");
const DATASETS_FILE = path.join(FINETUNE_DIR, "datasets.json");
const RECIPES_FILE = path.join(FINETUNE_DIR, "recipes.json");
const JOBS_FILE = path.join(FINETUNE_DIR, "jobs.json");
const RUNTIME_ATTACHMENTS_FILE = path.join(
  FINETUNE_DIR,
  "runtime-attachments.json",
);
const JOB_BUNDLES_DIR = path.join(FINETUNE_DIR, "jobs");
const VENV_PYTHON = path.join(process.cwd(), ".venv", "bin", "python");
const WORKER_SCRIPT = path.join(process.cwd(), "scripts", "finetune_worker.py");
const LOCAL_GATEWAY_BASE_URL = (
  process.env.LOCAL_AGENT_BASE_URL || "http://127.0.0.1:4000/v1"
).replace(/\/$/, "");
const BUNDLED_SMOKE_DATASET_ID = "ft-dataset-first-llm-studio-smoke-v2";
const BUNDLED_SMOKE_DATASET_LABEL = "First LLM Studio smoke v2";
const BUNDLED_SMOKE_DATASET_PATH = path.join(
  process.cwd(),
  "data",
  "fine-tune",
  "first-llm-studio-smoke-v2.jsonl",
);
const LEGACY_SMOKE_DATASET_PATH = "/tmp/first-llm-studio-ft-smoke.jsonl";
const MAX_CURVE_POINTS = 120;
const MAX_LOG_LINES = 14;

type FineTunePreparedDatasetSummary = {
  trainSamples: number;
  validSamples: number;
  testSamples: number;
  validationDisabledReason?: string;
};

type FineTuneJobRuntimeState = Partial<AgentFineTuneJob> & {
  launcherPid?: number | null;
};

type FineTuneRuntimeAttachment = {
  adapterId: string;
  jobId: string;
  alias: string;
  label: string;
  baseTargetId: string;
  baseTargetLabel: string;
  baseModelRef: string;
  baseSourcePath?: string;
  baseSourceRepoId?: string;
  baseParameterScale?: string;
  baseQuantizationLabel?: string;
  baseRecommendedContextWindow?: number | null;
  baseRecommendedContext: string;
  baseMemoryProfile: string;
  adapterPath: string;
  attachedAt: string;
  updatedAt: string;
};

type FineTuneJobBundle = {
  kind: "first-llm-studio-finetune-job";
  generatedAt: string;
  recipe: AgentFineTuneRecipe;
  dataset: {
    id: string;
    label: string;
    format: AgentFineTuneDatasetFormat;
    sourcePath?: string;
    sampleCount: number;
    validation: AgentFineTuneDatasetValidation;
  };
  baseTarget: AgentFineTuneTargetOption;
  plan: {
    trainingBackend: "mlx-lm-lora";
    intendedRuntime: "apple-silicon-local";
    outputDir: string;
    datasetDir: string;
    configFile: string;
    stateFile: string;
    metricsFile: string;
    logFile: string;
    modelRef: string;
    totalSteps: number;
    trainSamples: number;
    validSamples: number;
    testSamples: number;
    stepsPerReport: number;
    stepsPerEval: number;
    saveEvery: number;
    maxSeqLength: number;
    batchSize: number;
    validationDisabledReason?: string;
    learningRate: number;
    fineTuneMethod: "lora" | "dora";
    optimizer: "adam" | "adamw" | "sgd" | "adafactor";
    numLayers: number;
    gradAccumulationSteps: number;
    gradCheckpoint: boolean;
    validationSplitPct: number;
    adapterPath: string;
    seed: number;
    nextStep: string;
  };
};

function ensureFineTuneDir() {
  mkdirSync(FINETUNE_DIR, { recursive: true });
  mkdirSync(JOB_BUNDLES_DIR, { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown) {
  ensureFineTuneDir();
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeRuntimeAliasSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function toEnvKey(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function truncatePreview(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeUserPathInput(sourcePath: string) {
  const trimmed = sourcePath.trim();
  if (trimmed.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return trimmed.replace(/^file:\/\//, "");
    }
  }
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) {
    return path.join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function resolveLocalDatasetPath(sourcePath: string) {
  const normalized = normalizeUserPathInput(sourcePath);
  if (!normalized) {
    throw new Error("sourcePath is required.");
  }

  const candidates = new Set<string>();
  candidates.add(
    path.isAbsolute(normalized) ? normalized : path.join(process.cwd(), normalized),
  );

  const fineTuneMarker = `${path.sep}data${path.sep}fine-tune${path.sep}`;
  const markerIndex = normalized.indexOf(fineTuneMarker);
  if (markerIndex >= 0) {
    const projectRelative = normalized.slice(markerIndex + 1);
    candidates.add(path.join(process.cwd(), projectRelative));
  }

  const posixMarker = "/data/fine-tune/";
  const posixMarkerIndex = normalized.indexOf(posixMarker);
  if (posixMarkerIndex >= 0) {
    candidates.add(path.join(process.cwd(), normalized.slice(posixMarkerIndex + 1)));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `Dataset path does not exist. Checked: ${Array.from(candidates).join(" | ")}`,
  );
}

function readLocalTextFile(sourcePath: string) {
  const resolvedPath = resolveLocalDatasetPath(sourcePath);
  return readFileSync(resolvedPath, "utf8");
}

function normalizeChatMessageContent(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function validateChatJsonl(lines: string[]) {
  const warnings: string[] = [];
  const errors: string[] = [];
  const preview: AgentFineTuneDatasetValidation["preview"] = [];

  lines.forEach((line, index) => {
    try {
      const parsed = JSON.parse(line) as {
        messages?: Array<{ role?: unknown; content?: unknown }>;
      };
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const userMessage = messages.find((message) => message?.role === "user");
      const assistantMessage = [...messages]
        .reverse()
        .find((message) => message?.role === "assistant");
      const inputPreview = truncatePreview(
        normalizeChatMessageContent(userMessage?.content),
      );
      const outputPreview = truncatePreview(
        normalizeChatMessageContent(assistantMessage?.content),
      );
      if (!messages.length || !inputPreview || !outputPreview) {
        errors.push(
          `Line ${index + 1}: chat-jsonl requires user and assistant messages.`,
        );
        return;
      }
      if (messages.length < 2) {
        warnings.push(`Line ${index + 1}: very short chat sample.`);
      }
      if (preview.length < 3) {
        preview.push({
          index: index + 1,
          inputPreview,
          outputPreview,
        });
      }
    } catch {
      errors.push(`Line ${index + 1}: invalid JSON.`);
    }
  });

  return { warnings, errors, preview };
}

function validateInstructionJsonl(lines: string[]) {
  const warnings: string[] = [];
  const errors: string[] = [];
  const preview: AgentFineTuneDatasetValidation["preview"] = [];

  lines.forEach((line, index) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const prompt =
        typeof parsed.prompt === "string"
          ? parsed.prompt
          : typeof parsed.instruction === "string"
            ? parsed.instruction
            : typeof parsed.input === "string"
              ? parsed.input
              : "";
      const response =
        typeof parsed.response === "string"
          ? parsed.response
          : typeof parsed.completion === "string"
            ? parsed.completion
            : typeof parsed.output === "string"
              ? parsed.output
              : typeof parsed.answer === "string"
                ? parsed.answer
                : "";
      if (!prompt.trim() || !response.trim()) {
        errors.push(
          `Line ${index + 1}: instruction-jsonl requires prompt/instruction and response/output.`,
        );
        return;
      }
      if (prompt.trim().length < 12) {
        warnings.push(`Line ${index + 1}: prompt is unusually short.`);
      }
      if (preview.length < 3) {
        preview.push({
          index: index + 1,
          inputPreview: truncatePreview(prompt),
          outputPreview: truncatePreview(response),
        });
      }
    } catch {
      errors.push(`Line ${index + 1}: invalid JSON.`);
    }
  });

  return { warnings, errors, preview };
}

export function validateFineTuneDatasetContent(
  content: string,
  format: AgentFineTuneDatasetFormat,
): AgentFineTuneDatasetValidation {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return {
      ok: false,
      format,
      sampleCount: 0,
      warnings: [],
      errors: ["Dataset file is empty."],
      preview: [],
    };
  }

  const base =
    format === "chat-jsonl"
      ? validateChatJsonl(lines)
      : validateInstructionJsonl(lines);
  const warnings = [...base.warnings];
  if (lines.length < 20) {
    warnings.push(
      "Sample count is still small. This is good for a smoke run, but not yet a stable adapter dataset.",
    );
  }

  return {
    ok: base.errors.length === 0,
    format,
    sampleCount: lines.length,
    warnings,
    errors: base.errors,
    preview: base.preview,
  };
}

function normalizeDatasetRecord(
  dataset: AgentFineTuneDataset,
): AgentFineTuneDataset {
  return {
    ...dataset,
    refreshCadenceHours:
      typeof dataset.refreshCadenceHours === "number" &&
      Number.isFinite(dataset.refreshCadenceHours)
        ? dataset.refreshCadenceHours
        : 24,
    latestUpstreamCandidates: Array.isArray(dataset.latestUpstreamCandidates)
      ? dataset.latestUpstreamCandidates
      : [],
  };
}

function isBundledSmokeDatasetCandidate(dataset: AgentFineTuneDataset) {
  return (
    dataset.id === BUNDLED_SMOKE_DATASET_ID ||
    dataset.sourcePath === BUNDLED_SMOKE_DATASET_PATH ||
    dataset.sourcePath === LEGACY_SMOKE_DATASET_PATH ||
    dataset.label === "ft-smoke-dataset" ||
    dataset.label === BUNDLED_SMOKE_DATASET_LABEL
  );
}

function reconcileBundledSmokeDatasets(datasets: AgentFineTuneDataset[]) {
  const normalized = datasets.map(normalizeDatasetRecord);
  if (!existsSync(BUNDLED_SMOKE_DATASET_PATH)) {
    return normalized;
  }

  const existing = normalized.find(isBundledSmokeDatasetCandidate);
  const validation = validateFineTuneDatasetFromPath(
    BUNDLED_SMOKE_DATASET_PATH,
    "instruction-jsonl",
  );
  const now = new Date().toISOString();
  const desired: AgentFineTuneDataset = {
    id: existing?.id || BUNDLED_SMOKE_DATASET_ID,
    label: existing?.label || BUNDLED_SMOKE_DATASET_LABEL,
    format: "instruction-jsonl",
    sourcePath: BUNDLED_SMOKE_DATASET_PATH,
    sourceType: "local-path",
    sampleCount: validation.sampleCount,
    upstreamQuery:
      existing?.upstreamQuery || "first llm studio fine-tune smoke dataset",
    refreshCadenceHours: existing?.refreshCadenceHours || 24,
    latestUpstreamCandidates: existing?.latestUpstreamCandidates || [],
    lastUpstreamCheckedAt: existing?.lastUpstreamCheckedAt || now,
    nextUpstreamCheckAt:
      existing?.nextUpstreamCheckAt ||
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: existing?.createdAt || now,
    updatedAt: existing?.updatedAt || now,
    validation,
  };

  const needsWrite =
    !existing ||
    existing.sourcePath !== desired.sourcePath ||
    existing.format !== desired.format ||
    existing.sampleCount !== desired.sampleCount ||
    JSON.stringify(existing.validation) !== JSON.stringify(desired.validation);

  if (!needsWrite) {
    return normalized;
  }

  desired.updatedAt = now;
  const next = [
    desired,
    ...normalized.filter((dataset) => !isBundledSmokeDatasetCandidate(dataset)),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  writeDatasets(next);
  return next;
}

function readDatasets() {
  return reconcileBundledSmokeDatasets(
    readJsonFile<AgentFineTuneDataset[]>(DATASETS_FILE, []),
  ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function writeDatasets(datasets: AgentFineTuneDataset[]) {
  writeJsonFile(DATASETS_FILE, datasets);
}

function readRecipes() {
  return readJsonFile<AgentFineTuneRecipe[]>(RECIPES_FILE, [])
    .map(normalizeRecipeRecord)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function writeRecipes(recipes: AgentFineTuneRecipe[]) {
  writeJsonFile(RECIPES_FILE, recipes);
}

function normalizeRecipeRecord(
  recipe: AgentFineTuneRecipe,
): AgentFineTuneRecipe {
  return {
    ...recipe,
    fineTuneMethod: recipe.fineTuneMethod === "dora" ? "dora" : "lora",
    optimizer:
      recipe.optimizer === "adamw" ||
      recipe.optimizer === "sgd" ||
      recipe.optimizer === "adafactor"
        ? recipe.optimizer
        : "adam",
    numLayers: typeof recipe.numLayers === "number" ? recipe.numLayers : 16,
    gradientAccumulationSteps:
      typeof recipe.gradientAccumulationSteps === "number" &&
      Number.isFinite(recipe.gradientAccumulationSteps)
        ? recipe.gradientAccumulationSteps
        : 1,
    validationSplitPct:
      typeof recipe.validationSplitPct === "number" &&
      Number.isFinite(recipe.validationSplitPct)
        ? recipe.validationSplitPct
        : 10,
    saveEverySteps:
      typeof recipe.saveEverySteps === "number" &&
      Number.isFinite(recipe.saveEverySteps)
        ? recipe.saveEverySteps
        : 0,
    seed:
      typeof recipe.seed === "number" && Number.isFinite(recipe.seed)
        ? recipe.seed
        : 42,
  };
}

function readStoredJobs() {
  return readJsonFile<AgentFineTuneJob[]>(JOBS_FILE, []).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

function writeStoredJobs(jobs: AgentFineTuneJob[]) {
  writeJsonFile(JOBS_FILE, jobs);
}

function getJobPaths(jobId: string) {
  const bundlePath = path.join(JOB_BUNDLES_DIR, jobId);
  return {
    bundlePath,
    outputDir: path.join(bundlePath, "artifacts"),
    datasetDir: path.join(bundlePath, "dataset"),
    bundleFile: path.join(bundlePath, "job-bundle.json"),
    configFile: path.join(bundlePath, "mlx-lora-config.yaml"),
    readmeFile: path.join(bundlePath, "README.md"),
    stateFile: path.join(bundlePath, "state.json"),
    metricsFile: path.join(bundlePath, "metrics.jsonl"),
    logFile: path.join(bundlePath, "worker.log"),
  };
}

function tailLines(filePath: string, limit = MAX_LOG_LINES) {
  if (!existsSync(filePath)) return [] as string[];
  const lines = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-limit);
}

function readJobRuntimeState(jobId: string): FineTuneJobRuntimeState | null {
  const { stateFile } = getJobPaths(jobId);
  return readJsonFile<FineTuneJobRuntimeState | null>(stateFile, null);
}

function writeJobRuntimeState(jobId: string, patch: FineTuneJobRuntimeState) {
  const { stateFile } = getJobPaths(jobId);
  const current = readJobRuntimeState(jobId) || {};
  writeJsonFile(stateFile, {
    ...current,
    ...patch,
    updatedAt: patch.updatedAt || new Date().toISOString(),
  });
}

function mergeJobState(job: AgentFineTuneJob) {
  const paths = getJobPaths(job.id);
  const runtime = readJobRuntimeState(job.id) || {};
  const curve = Array.isArray(runtime.curve)
    ? runtime.curve
        .filter((entry): entry is AgentFineTuneCurvePoint =>
          Boolean(entry && typeof entry.step === "number"),
        )
        .slice(-MAX_CURVE_POINTS)
    : [];

  return {
    ...job,
    bundlePath: paths.bundlePath,
    outputDir: paths.outputDir,
    bundleFile: paths.bundleFile,
    datasetDir: paths.datasetDir,
    configFile: paths.configFile,
    metricsFile: paths.metricsFile,
    logFile: paths.logFile,
    stateFile: paths.stateFile,
    status: runtime.status || job.status,
    updatedAt: runtime.updatedAt || job.updatedAt,
    launcherPid:
      typeof runtime.launcherPid === "number"
        ? runtime.launcherPid
        : job.launcherPid,
    workerHeartbeatAt: runtime.workerHeartbeatAt || job.workerHeartbeatAt,
    startedAt: runtime.startedAt || job.startedAt,
    completedAt: runtime.completedAt || job.completedAt,
    latestMessage: runtime.latestMessage || job.latestMessage,
    errorMessage: runtime.errorMessage || job.errorMessage,
    baseModelRef: runtime.baseModelRef || job.baseModelRef,
    progress: runtime.progress as AgentFineTuneJobProgress | undefined,
    curve,
    recentLogLines: tailLines(paths.logFile),
  } satisfies AgentFineTuneJob;
}

function readJobs() {
  return readStoredJobs()
    .map(mergeJobState)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function readRuntimeAttachments() {
  return readJsonFile<FineTuneRuntimeAttachment[]>(RUNTIME_ATTACHMENTS_FILE, [])
    .filter((entry) =>
      Boolean(
        entry &&
        typeof entry.adapterId === "string" &&
        typeof entry.alias === "string" &&
        typeof entry.adapterPath === "string" &&
        typeof entry.baseTargetId === "string",
      ),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function writeRuntimeAttachments(entries: FineTuneRuntimeAttachment[]) {
  writeJsonFile(RUNTIME_ATTACHMENTS_FILE, entries);
}

function buildFineTuneAdapterAlias(adapterName: string, jobId: string) {
  const suffix = jobId.replace(/^ft-job-/, "").slice(-8);
  const segment = normalizeRuntimeAliasSegment(adapterName) || "adapter";
  return `local-ft-${segment}-${suffix}`;
}

function buildAttachedAdapterTarget(
  entry: FineTuneRuntimeAttachment,
): AgentTarget {
  const envKeyBase = toEnvKey(entry.alias);
  const recommendedContextLabel =
    typeof entry.baseRecommendedContextWindow === "number" &&
    Number.isFinite(entry.baseRecommendedContextWindow)
      ? `${Math.max(1, Math.round(entry.baseRecommendedContextWindow / 1024))}K`
      : "Inherited";

  return {
    id: entry.alias,
    label: entry.label,
    providerLabel: "Local MLX Gateway",
    transport: "openai-compatible",
    execution: "local",
    description:
      "Fine-tune adapter mounted on the local MLX gateway. Use it directly in chat, compare, runtime ops, and benchmark without leaving the current workflow.",
    modelEnv: `LOCAL_${envKeyBase}_MODEL`,
    modelDefault: entry.alias,
    baseUrlEnv: "LOCAL_AGENT_BASE_URL",
    baseUrlDefault: (
      process.env.LOCAL_AGENT_BASE_URL || "http://127.0.0.1:4000/v1"
    ).replace(/\/$/, ""),
    supportsTools: true,
    recommendedContext:
      entry.baseRecommendedContext ||
      `Adapter inherits the base model context. Recommended: ${recommendedContextLabel}.`,
    memoryProfile: `${entry.baseMemoryProfile} Adapter weights still sit on top of the base model, so keep an eye on shared memory pressure.`,
    notes: [
      "This target was mounted from a fine-tune adapter artifact.",
      `Base target: ${entry.baseTargetLabel}`,
      `Adapter path: ${entry.adapterPath}`,
      `Base model ref: ${entry.baseModelRef}`,
    ],
    launchHints: [
      "Run compare to measure the adapter against its base lane immediately.",
      "Run benchmark to validate whether the adapter improves the intended behavior before keeping it mounted.",
    ],
    parameterScale: entry.baseParameterScale,
    quantizationLabel: entry.baseQuantizationLabel,
    sourceKind: "adapter-runtime",
    sourceLabel: "Fine-tune adapter runtime",
    sourcePath: entry.baseSourcePath,
    sourceRepoId: entry.baseSourceRepoId,
    recommendedContextWindow: entry.baseRecommendedContextWindow,
  };
}

function listArtifactFiles(rootDir: string, maxFiles = 24) {
  if (!existsSync(rootDir)) return [] as string[];
  const files: string[] = [];
  const stack = [rootDir];
  while (stack.length && files.length < maxFiles) {
    const current = stack.pop();
    if (!current) continue;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      const relativePath = path.relative(rootDir, fullPath) || entry.name;
      files.push(relativePath);
      if (files.length >= maxFiles) break;
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function countCheckpointFiles(rootDir: string) {
  return listArtifactFiles(rootDir, 200).filter(
    (file) =>
      /\.(safetensors|npz|bin|ckpt|pt)$/i.test(file) ||
      /adapter|checkpoint|weights/i.test(file),
  ).length;
}

function getLatestArtifactTimestamp(rootDir: string, files: string[]) {
  let latestMs = 0;
  for (const relativePath of files) {
    try {
      const stats = statSync(path.join(rootDir, relativePath));
      latestMs = Math.max(latestMs, stats.mtimeMs);
    } catch {
      // ignore missing artifact files
    }
  }
  return latestMs > 0 ? new Date(latestMs).toISOString() : undefined;
}

function buildFineTuneAdapterArtifacts(
  jobs: AgentFineTuneJob[],
  recipes: AgentFineTuneRecipe[],
  localTargets: AgentFineTuneTargetOption[],
) {
  const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const targetById = new Map(localTargets.map((target) => [target.id, target]));
  const attachmentByAdapterId = new Map(
    readRuntimeAttachments().map((entry) => [entry.adapterId, entry]),
  );

  return jobs
    .map((job) => {
      const files = listArtifactFiles(job.outputDir);
      const checkpointCount = countCheckpointFiles(job.outputDir);
      const recipe = recipeById.get(job.recipeId);
      const baseTarget = recipe
        ? targetById.get(recipe.baseTargetId)
        : undefined;
      const attachment = attachmentByAdapterId.get(`adapter:${job.id}`);
      const latestCheckpointAt = getLatestArtifactTimestamp(
        job.outputDir,
        files,
      );
      const status: AgentFineTuneAdapterArtifact["status"] =
        checkpointCount > 0
          ? job.status === "running" || job.status === "queued"
            ? "checkpointing"
            : "ready"
          : "incomplete";
      return {
        id: `adapter:${job.id}`,
        jobId: job.id,
        adapterName: job.adapterName,
        baseTargetId: baseTarget?.id,
        baseTargetLabel: baseTarget?.label,
        sourceUrl: baseTarget?.sourceUrl,
        outputDir: job.outputDir,
        configFile: job.configFile,
        metricsFile: job.metricsFile,
        status,
        checkpointCount,
        latestCheckpointAt,
        files,
        benchmarkSuiteId: job.benchmarkSuiteId,
        attachedTargetId: attachment?.alias,
        attachedTargetLabel: attachment?.label,
        attachedAt: attachment?.attachedAt,
        updatedAt: latestCheckpointAt || job.updatedAt,
      } satisfies AgentFineTuneAdapterArtifact;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function updateStoredJob(
  jobId: string,
  updater: (job: AgentFineTuneJob) => AgentFineTuneJob,
) {
  const jobs = readStoredJobs();
  const target = jobs.find((job) => job.id === jobId);
  if (!target) {
    throw new Error("Fine-tune job not found.");
  }
  const next = jobs
    .map((job) => (job.id === jobId ? updater(job) : job))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  writeStoredJobs(next);
  return next.find((job) => job.id === jobId)!;
}

function resolveBaseModelRef(target: AgentFineTuneTargetOption) {
  if (target.sourcePath?.trim()) return target.sourcePath.trim();
  if (target.sourceRepoId?.trim()) return target.sourceRepoId.trim();
  if (target.modelDefault?.trim()) return target.modelDefault.trim();
  throw new Error(`No usable model reference found for ${target.label}.`);
}

function normalizeInstructionSample(line: string) {
  const parsed = JSON.parse(line) as Record<string, unknown>;
  const prompt =
    typeof parsed.prompt === "string"
      ? parsed.prompt
      : typeof parsed.instruction === "string"
        ? parsed.instruction
        : typeof parsed.input === "string"
          ? parsed.input
          : "";
  const completion =
    typeof parsed.completion === "string"
      ? parsed.completion
      : typeof parsed.response === "string"
        ? parsed.response
        : typeof parsed.output === "string"
          ? parsed.output
          : typeof parsed.answer === "string"
            ? parsed.answer
            : "";
  return {
    prompt: prompt.trim(),
    completion: completion.trim(),
  };
}

function normalizeChatSample(line: string) {
  const parsed = JSON.parse(line) as { messages?: unknown };
  return {
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
  };
}

function prepareFineTuneDataset(
  dataset: AgentFineTuneDataset,
  datasetDir: string,
  options: {
    validationSplitPct?: number;
    minEvalBatchSize?: number;
  } = {},
) {
  const validationSplitPct = options.validationSplitPct ?? 10;
  const minEvalBatchSize = Math.max(
    1,
    Math.floor(options.minEvalBatchSize ?? 1),
  );
  if (!dataset.sourcePath) {
    throw new Error("Dataset source path is missing.");
  }
  mkdirSync(datasetDir, { recursive: true });
  const rawLines = readLocalTextFile(dataset.sourcePath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!rawLines.length) {
    throw new Error("Dataset file is empty.");
  }

  const normalizedSamples = rawLines.map((line) =>
    dataset.format === "chat-jsonl"
      ? normalizeChatSample(line)
      : normalizeInstructionSample(line),
  );
  const total = normalizedSamples.length;
  const validRatio = Math.max(0.02, Math.min(validationSplitPct / 100, 0.3));
  const validCount =
    total >= 10 ? Math.max(1, Math.round(total * validRatio)) : 0;
  const testCount = total >= 40 ? Math.max(1, Math.round(total * 0.05)) : 0;
  const trainCount = Math.max(1, total - validCount - testCount);
  let train = normalizedSamples.slice(0, trainCount);
  let valid = normalizedSamples.slice(trainCount, trainCount + validCount);
  const test = normalizedSamples.slice(trainCount + validCount);
  let validationDisabledReason: string | undefined;

  if (valid.length > 0 && valid.length < minEvalBatchSize) {
    train = [...train, ...valid];
    validationDisabledReason = `Validation split had ${valid.length} sample(s), below batch size ${minEvalBatchSize}; merged it back into training to avoid MLX eval startup failure.`;
    valid = [];
  }

  const writeJsonl = (filePath: string, values: unknown[]) => {
    writeFileSync(
      filePath,
      values.map((value) => JSON.stringify(value)).join("\n") +
        (values.length ? "\n" : ""),
      "utf8",
    );
  };

  const trainPath = path.join(datasetDir, "train.jsonl");
  const validPath = path.join(datasetDir, "valid.jsonl");
  const testPath = path.join(datasetDir, "test.jsonl");

  rmSync(validPath, { force: true });
  rmSync(testPath, { force: true });

  writeJsonl(trainPath, train);
  if (valid.length) {
    writeJsonl(validPath, valid);
  }
  if (test.length) {
    writeJsonl(testPath, test);
  }

  return {
    trainSamples: train.length,
    validSamples: valid.length,
    testSamples: test.length,
    validationDisabledReason,
  } satisfies FineTunePreparedDatasetSummary;
}

function deriveTrainingPlan(
  recipe: AgentFineTuneRecipe,
  datasetStats: FineTunePreparedDatasetSummary,
) {
  const effectiveBatchSize = Math.max(
    1,
    recipe.batchSize * Math.max(1, recipe.gradientAccumulationSteps),
  );
  const batchesPerEpoch = Math.max(
    1,
    Math.ceil(datasetStats.trainSamples / effectiveBatchSize),
  );
  const totalSteps = Math.max(1, batchesPerEpoch * Math.max(1, recipe.epochs));
  return {
    totalSteps,
    stepsPerReport: Math.max(1, Math.min(10, Math.ceil(totalSteps / 20))),
    stepsPerEval:
      datasetStats.validSamples > 0
        ? Math.max(
            1,
            Math.min(
              totalSteps,
              Math.ceil(totalSteps / Math.max(1, recipe.epochs)),
            ),
          )
        : totalSteps,
    saveEvery:
      recipe.saveEverySteps > 0
        ? Math.max(1, Math.min(totalSteps, recipe.saveEverySteps))
        : Math.max(1, Math.min(totalSteps, Math.ceil(totalSteps / 2))),
  };
}

function buildFineTuneTargetSourceUrl(
  target: Pick<AgentFineTuneTargetOption, "sourceRepoId" | "sourceKind">,
) {
  const repoId = target.sourceRepoId?.trim();
  if (!repoId || !repoId.includes("/")) return undefined;
  if (
    target.sourceKind === "lm-studio" ||
    target.sourceKind === "huggingface-cache"
  ) {
    return `https://huggingface.co/${repoId}`;
  }
  return `https://huggingface.co/${repoId}`;
}

function buildJobBundle(
  recipe: AgentFineTuneRecipe,
  dataset: AgentFineTuneDataset,
  target: AgentFineTuneTargetOption,
  paths: ReturnType<typeof getJobPaths>,
  datasetStats: FineTunePreparedDatasetSummary,
): FineTuneJobBundle {
  const trainingPlan = deriveTrainingPlan(recipe, datasetStats);
  const modelRef = resolveBaseModelRef(target);
  return {
    kind: "first-llm-studio-finetune-job",
    generatedAt: new Date().toISOString(),
    recipe,
    dataset: {
      id: dataset.id,
      label: dataset.label,
      format: dataset.format,
      sourcePath: dataset.sourcePath,
      sampleCount: dataset.sampleCount,
      validation: dataset.validation,
    },
    baseTarget: target,
    plan: {
      trainingBackend: "mlx-lm-lora",
      intendedRuntime: "apple-silicon-local",
      outputDir: paths.outputDir,
      datasetDir: paths.datasetDir,
      configFile: paths.configFile,
      stateFile: paths.stateFile,
      metricsFile: paths.metricsFile,
      logFile: paths.logFile,
      modelRef,
      totalSteps: trainingPlan.totalSteps,
      trainSamples: datasetStats.trainSamples,
      validSamples: datasetStats.validSamples,
      testSamples: datasetStats.testSamples,
      stepsPerReport: trainingPlan.stepsPerReport,
      stepsPerEval: trainingPlan.stepsPerEval,
      saveEvery: trainingPlan.saveEvery,
      maxSeqLength: recipe.sequenceLength,
      batchSize: recipe.batchSize,
      validationDisabledReason: datasetStats.validationDisabledReason,
      learningRate: recipe.learningRate,
      fineTuneMethod: recipe.fineTuneMethod,
      optimizer: recipe.optimizer,
      numLayers: recipe.numLayers,
      gradAccumulationSteps: recipe.gradientAccumulationSteps,
      gradCheckpoint: recipe.gradientCheckpointing,
      validationSplitPct: recipe.validationSplitPct,
      adapterPath: paths.outputDir,
      seed: recipe.seed,
      nextStep:
        "Run the local MLX fine-tune worker and stream logs/curves back into /admin.",
    },
  };
}

export function listFineTuneTargetOptions(): AgentFineTuneTargetOption[] {
  return listServerAgentTargets()
    .filter(
      (target) =>
        target.execution === "local" && target.sourceKind !== "adapter-runtime",
    )
    .map((target) => {
      const option = {
        id: target.id,
        label: target.label,
        providerLabel: target.providerLabel,
        modelDefault: target.modelDefault,
        parameterScale: target.parameterScale,
        quantizationLabel: target.quantizationLabel,
        recommendedContextWindow: target.recommendedContextWindow,
        sourceKind: target.sourceKind,
        sourceLabel: target.sourceLabel,
        sourcePath: target.sourcePath,
        sourceRepoId: target.sourceRepoId,
      } satisfies AgentFineTuneTargetOption;
      return {
        ...option,
        sourceUrl: buildFineTuneTargetSourceUrl(option),
      } satisfies AgentFineTuneTargetOption;
    });
}

export function readFineTuneSummary(): AgentFineTuneSummary {
  ensureFineTuneDir();
  const localTargets = listFineTuneTargetOptions();
  const datasets = readDatasets();
  const recipes = readRecipes();
  const jobs = readJobs();
  return {
    generatedAt: new Date().toISOString(),
    dataDir: FINETUNE_DIR,
    localTargets,
    datasets,
    recipes,
    jobs,
    adapters: buildFineTuneAdapterArtifacts(jobs, recipes, localTargets),
  };
}

export function validateFineTuneDatasetFromPath(
  sourcePath: string,
  format: AgentFineTuneDatasetFormat,
) {
  return validateFineTuneDatasetContent(readLocalTextFile(sourcePath), format);
}

export function saveFineTuneDataset(input: {
  id?: string;
  label: string;
  sourcePath: string;
  format: AgentFineTuneDatasetFormat;
  upstreamQuery?: string;
  refreshCadenceHours?: number;
}) {
  const label = input.label.trim();
  const sourcePath = input.sourcePath.trim();
  if (!label) {
    throw new Error("Dataset label is required.");
  }
  const validation = validateFineTuneDatasetFromPath(sourcePath, input.format);
  if (!validation.ok) {
    throw new Error(validation.errors[0] || "Dataset validation failed.");
  }
  const now = new Date().toISOString();
  const datasets = readDatasets();
  const existing = input.id
    ? datasets.find((dataset) => dataset.id === input.id)
    : datasets.find(
        (dataset) =>
          dataset.sourcePath === sourcePath && dataset.format === input.format,
      ) || datasets.find((dataset) => dataset.label === label);
  const dataset: AgentFineTuneDataset = {
    id: existing?.id || `ft-dataset-${crypto.randomUUID()}`,
    label,
    format: input.format,
    sourcePath,
    sourceType: "local-path",
    sampleCount: validation.sampleCount,
    upstreamQuery: input.upstreamQuery?.trim() || existing?.upstreamQuery,
    refreshCadenceHours:
      typeof input.refreshCadenceHours === "number" &&
      Number.isFinite(input.refreshCadenceHours)
        ? Math.max(6, Math.min(24 * 30, Math.round(input.refreshCadenceHours)))
        : existing?.refreshCadenceHours,
    lastUpstreamCheckedAt: existing?.lastUpstreamCheckedAt,
    nextUpstreamCheckAt: existing?.nextUpstreamCheckAt,
    latestUpstreamCandidates: existing?.latestUpstreamCandidates,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    validation,
  };
  const next = [
    dataset,
    ...datasets.filter((entry) => entry.id !== dataset.id),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  writeDatasets(next);
  return dataset;
}

export function saveFineTuneRecipe(input: {
  id?: string;
  label: string;
  datasetId: string;
  baseTargetId: string;
  adapterName: string;
  sequenceLength: number;
  batchSize: number;
  epochs: number;
  learningRate: number;
  fineTuneMethod: "lora" | "dora";
  optimizer: "adam" | "adamw" | "sgd" | "adafactor";
  numLayers: number;
  gradientAccumulationSteps: number;
  loraRank: number;
  loraAlpha: number;
  gradientCheckpointing: boolean;
  validationSplitPct: number;
  saveEverySteps: number;
  seed: number;
  benchmarkSuiteId?: string;
  notes?: string;
}) {
  const label = input.label.trim();
  const adapterName = input.adapterName.trim();
  if (!label) {
    throw new Error("Recipe label is required.");
  }
  if (!adapterName) {
    throw new Error("Adapter name is required.");
  }
  const dataset = readDatasets().find((entry) => entry.id === input.datasetId);
  if (!dataset) {
    throw new Error("Selected dataset no longer exists.");
  }
  const target = listFineTuneTargetOptions().find(
    (entry) => entry.id === input.baseTargetId,
  );
  if (!target) {
    throw new Error(
      "Selected base target is not available for local fine-tune planning.",
    );
  }
  const now = new Date().toISOString();
  const recipes = readRecipes();
  const existing = input.id
    ? recipes.find((recipe) => recipe.id === input.id)
    : recipes.find(
        (recipe) =>
          recipe.datasetId === dataset.id &&
          recipe.baseTargetId === target.id &&
          recipe.adapterName === adapterName,
      );
  const recipe: AgentFineTuneRecipe = {
    id: existing?.id || `ft-recipe-${crypto.randomUUID()}`,
    label,
    datasetId: dataset.id,
    baseTargetId: target.id,
    adapterName,
    sequenceLength: Math.max(1024, Math.min(input.sequenceLength, 32768)),
    batchSize: Math.max(1, Math.min(input.batchSize, 64)),
    epochs: Math.max(1, Math.min(input.epochs, 12)),
    learningRate: Math.max(0.000001, Math.min(input.learningRate, 0.01)),
    fineTuneMethod: input.fineTuneMethod === "dora" ? "dora" : "lora",
    optimizer:
      input.optimizer === "adamw" ||
      input.optimizer === "sgd" ||
      input.optimizer === "adafactor"
        ? input.optimizer
        : "adam",
    numLayers: Math.max(-1, Math.min(input.numLayers, 96)),
    gradientAccumulationSteps: Math.max(
      1,
      Math.min(input.gradientAccumulationSteps, 64),
    ),
    loraRank: Math.max(2, Math.min(input.loraRank, 128)),
    loraAlpha: Math.max(4, Math.min(input.loraAlpha, 256)),
    gradientCheckpointing: Boolean(input.gradientCheckpointing),
    validationSplitPct: Math.max(5, Math.min(input.validationSplitPct, 30)),
    saveEverySteps: Math.max(0, Math.min(input.saveEverySteps, 5000)),
    seed: Math.max(1, Math.min(input.seed, 999999)),
    benchmarkSuiteId: input.benchmarkSuiteId?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const next = [
    recipe,
    ...recipes.filter((entry) => entry.id !== recipe.id),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  writeRecipes(next);
  return recipe;
}

export function stageFineTuneJob(input: { recipeId: string; notes?: string }) {
  const recipe = readRecipes().find((entry) => entry.id === input.recipeId);
  if (!recipe) {
    throw new Error("Selected recipe no longer exists.");
  }
  const dataset = readDatasets().find((entry) => entry.id === recipe.datasetId);
  if (!dataset) {
    throw new Error("Recipe dataset no longer exists.");
  }
  const target = listFineTuneTargetOptions().find(
    (entry) => entry.id === recipe.baseTargetId,
  );
  if (!target) {
    throw new Error("Recipe base target is no longer available.");
  }

  const now = new Date().toISOString();
  const jobId = `ft-job-${crypto.randomUUID()}`;
  const paths = getJobPaths(jobId);
  mkdirSync(paths.bundlePath, { recursive: true });
  mkdirSync(paths.outputDir, { recursive: true });
  mkdirSync(paths.datasetDir, { recursive: true });

  const baseModelRef = resolveBaseModelRef(target);
  const datasetStats = prepareFineTuneDataset(dataset, paths.datasetDir, {
    validationSplitPct: recipe.validationSplitPct,
    minEvalBatchSize: recipe.batchSize,
  });
  writeFileSync(
    paths.configFile,
    [
      "lora_parameters:",
      `  rank: ${recipe.loraRank}`,
      "  dropout: 0.0",
      `  scale: ${recipe.loraAlpha}`,
    ].join("\n") + "\n",
    "utf8",
  );
  const bundle = buildJobBundle(recipe, dataset, target, paths, datasetStats);
  writeFileSync(
    paths.bundleFile,
    `${JSON.stringify(bundle, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    paths.readmeFile,
    [
      `# ${recipe.label}`,
      "",
      `- Job ID: ${jobId}`,
      `- Dataset: ${dataset.label}`,
      `- Base target: ${target.label}`,
      `- Adapter name: ${recipe.adapterName}`,
      `- Train samples: ${datasetStats.trainSamples}`,
      `- Validation samples: ${datasetStats.validSamples}`,
      `- Test samples: ${datasetStats.testSamples}`,
      `- Output dir: ${paths.outputDir}`,
      "",
      "This bundle is ready for the local MLX fine-tune worker.",
      "Use the admin panel to start training and stream logs plus loss curves.",
    ].join("\n"),
    "utf8",
  );

  writeJobRuntimeState(jobId, {
    status: "staged",
    updatedAt: now,
    latestMessage: datasetStats.validationDisabledReason
      ? `Job bundle staged. ${datasetStats.validationDisabledReason}`
      : "Job bundle staged. Start the local worker when ready.",
    baseModelRef,
    curve: [],
  });

  const job: AgentFineTuneJob = {
    id: jobId,
    recipeId: recipe.id,
    datasetId: dataset.id,
    status: "staged",
    createdAt: now,
    updatedAt: now,
    adapterName: recipe.adapterName,
    bundlePath: paths.bundlePath,
    outputDir: paths.outputDir,
    bundleFile: paths.bundleFile,
    datasetDir: paths.datasetDir,
    configFile: paths.configFile,
    metricsFile: paths.metricsFile,
    logFile: paths.logFile,
    stateFile: paths.stateFile,
    baseModelRef,
    benchmarkSuiteId: recipe.benchmarkSuiteId,
    notes: input.notes?.trim() || undefined,
  };

  const jobs = [job, ...readStoredJobs()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  writeStoredJobs(jobs);
  appendTimelineEvent({
    kind: "finetune",
    status: "saved",
    title: "Fine-tune job staged",
    summary: `${recipe.label} · ${dataset.label} · ${target.label}`,
    relatedId: jobId,
    targetIds: [target.id],
  });
  return mergeJobState(job);
}

export function startFineTuneJob(input: { jobId: string }) {
  const job = readJobs().find((entry) => entry.id === input.jobId);
  if (!job) {
    throw new Error("Fine-tune job not found.");
  }
  if (job.status === "running" || job.status === "queued") {
    throw new Error("Fine-tune job is already running.");
  }
  const recipe = readRecipes().find((entry) => entry.id === job.recipeId);
  const dataset = readDatasets().find((entry) => entry.id === job.datasetId);
  const target = listFineTuneTargetOptions().find(
    (entry) => entry.id === recipe?.baseTargetId,
  );
  if (!recipe || !dataset || !target) {
    throw new Error("Fine-tune job dependencies are no longer available.");
  }
  if (!existsSync(VENV_PYTHON)) {
    throw new Error(`Missing Python runtime: ${VENV_PYTHON}`);
  }
  if (!existsSync(WORKER_SCRIPT)) {
    throw new Error(`Missing worker script: ${WORKER_SCRIPT}`);
  }

  const paths = getJobPaths(job.id);
  mkdirSync(paths.bundlePath, { recursive: true });
  mkdirSync(paths.outputDir, { recursive: true });
  const datasetStats = prepareFineTuneDataset(dataset, paths.datasetDir, {
    validationSplitPct: recipe.validationSplitPct,
    minEvalBatchSize: recipe.batchSize,
  });
  writeFileSync(
    paths.configFile,
    [
      "lora_parameters:",
      `  rank: ${recipe.loraRank}`,
      "  dropout: 0.0",
      `  scale: ${recipe.loraAlpha}`,
    ].join("\n") + "\n",
    "utf8",
  );
  const bundle = buildJobBundle(recipe, dataset, target, paths, datasetStats);
  writeFileSync(
    paths.bundleFile,
    `${JSON.stringify(bundle, null, 2)}\n`,
    "utf8",
  );

  const now = new Date().toISOString();
  writeJobRuntimeState(job.id, {
    status: "queued",
    startedAt: now,
    updatedAt: now,
    latestMessage: datasetStats.validationDisabledReason
      ? `Queued local MLX fine-tune worker. ${datasetStats.validationDisabledReason}`
      : "Queued local MLX fine-tune worker.",
    errorMessage: undefined,
    progress: {
      currentStep: 0,
      totalSteps: bundle.plan.totalSteps,
      percent: 0,
    },
    curve: [],
    baseModelRef: bundle.plan.modelRef,
  });

  updateStoredJob(job.id, (current) => ({
    ...current,
    status: "queued",
    updatedAt: now,
    baseModelRef: bundle.plan.modelRef,
    bundleFile: paths.bundleFile,
    datasetDir: paths.datasetDir,
    configFile: paths.configFile,
    metricsFile: paths.metricsFile,
    logFile: paths.logFile,
    stateFile: paths.stateFile,
  }));

  const child = spawn(
    VENV_PYTHON,
    [WORKER_SCRIPT, "--job-bundle", paths.bundleFile],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();

  writeJobRuntimeState(job.id, {
    launcherPid: child.pid ?? null,
    status: "queued",
    latestMessage: datasetStats.validationDisabledReason
      ? `Local fine-tune worker started. ${datasetStats.validationDisabledReason}`
      : "Local fine-tune worker started.",
  });
  updateStoredJob(job.id, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    launcherPid: child.pid ?? null,
  }));

  appendTimelineEvent({
    kind: "finetune",
    status: "started",
    title: "Fine-tune worker started",
    summary: `${recipe.label} · ${target.label} · ${bundle.plan.totalSteps} steps`,
    relatedId: job.id,
    targetIds: [target.id],
  });

  return readJobs().find((entry) => entry.id === job.id)!;
}

export function rerunFineTuneJob(input: { jobId: string }) {
  const sourceJob = readJobs().find((entry) => entry.id === input.jobId);
  if (!sourceJob) {
    throw new Error("Fine-tune job not found.");
  }
  if (sourceJob.status === "queued" || sourceJob.status === "running") {
    throw new Error("Fine-tune job is already running.");
  }
  const stagedJob = stageFineTuneJob({
    recipeId: sourceJob.recipeId,
    notes: `Rerun from ${sourceJob.id} using the latest dataset preparation strategy.`,
  });
  return startFineTuneJob({ jobId: stagedJob.id });
}

export function cancelFineTuneJob(input: { jobId: string }) {
  const job = readJobs().find((entry) => entry.id === input.jobId);
  if (!job) {
    throw new Error("Fine-tune job not found.");
  }

  const pid = typeof job.launcherPid === "number" ? job.launcherPid : null;
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // ignore already exited workers
      }
    }
  }

  const now = new Date().toISOString();
  writeJobRuntimeState(job.id, {
    status: "cancelled",
    updatedAt: now,
    completedAt: now,
    latestMessage: "Fine-tune job cancelled.",
    errorMessage: undefined,
  });
  updateStoredJob(job.id, (current) => ({
    ...current,
    status: "cancelled",
    updatedAt: now,
  }));
  appendTimelineEvent({
    kind: "finetune",
    status: "cancelled",
    title: "Fine-tune job cancelled",
    summary: `${job.adapterName} stopped before completion`,
    relatedId: job.id,
  });
  return readJobs().find((entry) => entry.id === job.id)!;
}

function openExternalPath(targetPath: string) {
  const child = spawn("open", [targetPath], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export function openFineTunePath(input: {
  kind: "job-bundle" | "job-output" | "adapter-output" | "dataset-source";
  id: string;
}) {
  const summary = readFineTuneSummary();
  let resolvedPath = "";

  if (input.kind === "job-bundle") {
    const job = summary.jobs.find((entry) => entry.id === input.id);
    if (!job) throw new Error("Fine-tune job not found.");
    resolvedPath = job.bundlePath;
  } else if (input.kind === "job-output") {
    const job = summary.jobs.find((entry) => entry.id === input.id);
    if (!job) throw new Error("Fine-tune job not found.");
    resolvedPath = job.outputDir;
  } else if (input.kind === "adapter-output") {
    const adapter = summary.adapters.find((entry) => entry.id === input.id);
    if (!adapter) throw new Error("Fine-tune adapter not found.");
    resolvedPath = adapter.outputDir;
  } else {
    const dataset = summary.datasets.find((entry) => entry.id === input.id);
    if (!dataset?.sourcePath)
      throw new Error("Dataset source path is not available.");
    resolvedPath = resolveLocalDatasetPath(dataset.sourcePath);
  }

  if (!existsSync(resolvedPath)) {
    throw new Error(`Path does not exist: ${resolvedPath}`);
  }
  openExternalPath(resolvedPath);
  return {
    kind: input.kind,
    id: input.id,
    path: resolvedPath,
    opened: true,
  };
}

export function openFineTuneSourcePage(input: {
  adapterId?: string;
  targetId?: string;
  jobId?: string;
}) {
  const summary = readFineTuneSummary();
  const targets = summary.localTargets;
  const recipes = summary.recipes;

  let target = input.targetId
    ? targets.find((entry) => entry.id === input.targetId)
    : undefined;

  if (!target && input.adapterId) {
    const adapter = summary.adapters.find(
      (entry) => entry.id === input.adapterId,
    );
    target = adapter?.baseTargetId
      ? targets.find((entry) => entry.id === adapter.baseTargetId)
      : undefined;
  }

  if (!target && input.jobId) {
    const job = summary.jobs.find((entry) => entry.id === input.jobId);
    const recipe = job
      ? recipes.find((entry) => entry.id === job.recipeId)
      : undefined;
    target = recipe
      ? targets.find((entry) => entry.id === recipe.baseTargetId)
      : undefined;
  }

  if (!target?.sourceUrl) {
    throw new Error("This fine-tune target does not expose a source page yet.");
  }

  openExternalPath(target.sourceUrl);
  return {
    targetId: target.id,
    sourceUrl: target.sourceUrl,
    opened: true,
  };
}

export function attachFineTuneAdapterRuntime(input: { adapterId: string }) {
  const summary = readFineTuneSummary();
  const adapter = summary.adapters.find(
    (entry) => entry.id === input.adapterId,
  );
  if (!adapter) {
    throw new Error("Fine-tune adapter not found.");
  }
  if (adapter.status !== "ready" || adapter.checkpointCount <= 0) {
    throw new Error("Adapter is not ready for runtime attach yet.");
  }
  if (!existsSync(adapter.outputDir)) {
    throw new Error(`Adapter output dir does not exist: ${adapter.outputDir}`);
  }

  const job = summary.jobs.find((entry) => entry.id === adapter.jobId);
  const recipe = job
    ? summary.recipes.find((entry) => entry.id === job.recipeId)
    : null;
  const baseTargetOption = recipe
    ? summary.localTargets.find((entry) => entry.id === recipe.baseTargetId)
    : null;
  const baseTarget = recipe
    ? listServerAgentTargets().find((entry) => entry.id === recipe.baseTargetId)
    : null;
  if (!job || !recipe || !baseTargetOption || !baseTarget) {
    throw new Error("Adapter is missing its base target context.");
  }

  const current = readRuntimeAttachments();
  const existing = current.find((entry) => entry.adapterId === adapter.id);
  const now = new Date().toISOString();
  const alias =
    existing?.alias ||
    buildFineTuneAdapterAlias(adapter.adapterName, adapter.jobId);
  const label =
    existing?.label || `${baseTarget.label} · ${adapter.adapterName}`;
  const attachment: FineTuneRuntimeAttachment = {
    adapterId: adapter.id,
    jobId: adapter.jobId,
    alias,
    label,
    baseTargetId: baseTarget.id,
    baseTargetLabel: baseTarget.label,
    baseModelRef: job.baseModelRef || resolveBaseModelRef(baseTargetOption),
    baseSourcePath: baseTarget.sourcePath,
    baseSourceRepoId: baseTarget.sourceRepoId,
    baseParameterScale: baseTarget.parameterScale,
    baseQuantizationLabel: baseTarget.quantizationLabel,
    baseRecommendedContextWindow: baseTarget.recommendedContextWindow,
    baseRecommendedContext: baseTarget.recommendedContext,
    baseMemoryProfile: baseTarget.memoryProfile,
    adapterPath: adapter.outputDir,
    attachedAt: existing?.attachedAt || now,
    updatedAt: now,
  };

  writeRuntimeAttachments(
    [
      attachment,
      ...current.filter((entry) => entry.adapterId !== adapter.id),
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );

  const target = buildAttachedAdapterTarget(attachment);
  upsertDiscoveredLocalTarget(target);

  appendTimelineEvent({
    kind: "finetune",
    status: "saved",
    title: "Adapter mounted to local runtime",
    summary: `${adapter.adapterName} -> ${target.label}`,
    relatedId: adapter.id,
    targetIds: [baseTarget.id, target.id],
  });

  return {
    attachment,
    target,
  };
}

async function detachLoadedRuntimeAlias(alias: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const baseUrl = LOCAL_GATEWAY_BASE_URL.replace(/\/v1$/, "");
    const healthResponse = await fetch(`${baseUrl}/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!healthResponse.ok) {
      return { released: false, releasedAlias: null as string | null };
    }
    const health = (await healthResponse.json()) as {
      loaded_alias?: string | null;
    };
    if (health.loaded_alias !== alias) {
      return { released: false, releasedAlias: health.loaded_alias ?? null };
    }

    const releaseResponse = await fetch(`${baseUrl}/v1/models/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    if (!releaseResponse.ok) {
      return { released: false, releasedAlias: alias };
    }
    const payload = (await releaseResponse.json().catch(() => ({}))) as {
      released_alias?: string | null;
    };
    return {
      released: true,
      releasedAlias: payload.released_alias ?? null,
    };
  } catch {
    return { released: false, releasedAlias: null as string | null };
  } finally {
    clearTimeout(timer);
  }
}

export async function detachFineTuneAdapterRuntime(input: {
  adapterId: string;
}) {
  const current = readRuntimeAttachments();
  const existing = current.find((entry) => entry.adapterId === input.adapterId);
  if (!existing) {
    throw new Error("Adapter runtime is not attached.");
  }

  const releaseResult = await detachLoadedRuntimeAlias(existing.alias);
  writeRuntimeAttachments(
    current.filter((entry) => entry.adapterId !== input.adapterId),
  );
  removeDiscoveredLocalTarget(existing.alias);

  appendTimelineEvent({
    kind: "finetune",
    status: "saved",
    title: releaseResult.released
      ? "Adapter detached and runtime released"
      : "Adapter detached from local runtime",
    summary: releaseResult.released
      ? `${existing.label} was detached and the loaded local runtime was released.`
      : `${existing.label} was detached from the local target catalog.`,
    relatedId: input.adapterId,
    targetIds: [existing.baseTargetId, existing.alias],
  });

  return {
    attachment: existing,
    releasedRuntime: releaseResult.released,
    releasedAlias: releaseResult.releasedAlias,
  };
}

function updateDatasetEntry(
  datasetId: string,
  updater: (dataset: AgentFineTuneDataset) => AgentFineTuneDataset,
) {
  const datasets = readDatasets();
  const dataset = datasets.find((entry) => entry.id === datasetId);
  if (!dataset) {
    throw new Error("Dataset not found.");
  }
  const next = datasets
    .map((entry) => (entry.id === datasetId ? updater(entry) : entry))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  writeDatasets(next);
  return next.find((entry) => entry.id === datasetId)!;
}

export function saveFineTuneDatasetWatch(input: {
  datasetId: string;
  upstreamQuery?: string;
  refreshCadenceHours?: number;
}) {
  const now = new Date().toISOString();
  const cadenceHours =
    typeof input.refreshCadenceHours === "number" &&
    Number.isFinite(input.refreshCadenceHours)
      ? Math.max(6, Math.min(24 * 30, Math.round(input.refreshCadenceHours)))
      : undefined;
  return updateDatasetEntry(input.datasetId, (dataset) => ({
    ...dataset,
    upstreamQuery: input.upstreamQuery?.trim() || dataset.upstreamQuery,
    refreshCadenceHours: cadenceHours ?? dataset.refreshCadenceHours,
    nextUpstreamCheckAt:
      cadenceHours || dataset.refreshCadenceHours
        ? new Date(
            Date.now() +
              (cadenceHours ?? dataset.refreshCadenceHours ?? 24) *
                60 *
                60 *
                1000,
          ).toISOString()
        : dataset.nextUpstreamCheckAt,
    updatedAt: now,
  }));
}

export async function checkFineTuneDatasetUpstream(input: {
  datasetId: string;
  query?: string;
}) {
  const dataset = readDatasets().find((entry) => entry.id === input.datasetId);
  if (!dataset) {
    throw new Error("Dataset not found.");
  }
  const query =
    input.query?.trim() || dataset.upstreamQuery?.trim() || dataset.label;
  if (!query) {
    throw new Error("Upstream dataset query is required.");
  }
  const matches = await discoverFineTuneUpstreamDatasets(query);
  const checkedAt = new Date().toISOString();
  const refreshCadenceHours = dataset.refreshCadenceHours || 24;
  return updateDatasetEntry(dataset.id, (current) => ({
    ...current,
    upstreamQuery: query,
    lastUpstreamCheckedAt: checkedAt,
    nextUpstreamCheckAt: new Date(
      Date.now() + refreshCadenceHours * 60 * 60 * 1000,
    ).toISOString(),
    latestUpstreamCandidates: matches,
    updatedAt: checkedAt,
  }));
}

export async function refreshDueFineTuneDatasetWatches() {
  const datasets = readDatasets();
  const due = datasets.filter((dataset) => {
    if (!dataset.refreshCadenceHours || !dataset.upstreamQuery) return false;
    if (!dataset.nextUpstreamCheckAt) return true;
    return Date.parse(dataset.nextUpstreamCheckAt) <= Date.now();
  });
  for (const dataset of due) {
    try {
      await checkFineTuneDatasetUpstream({
        datasetId: dataset.id,
        query: dataset.upstreamQuery,
      });
    } catch {
      // keep the last successful upstream snapshot
    }
  }
  return readFineTuneSummary();
}
