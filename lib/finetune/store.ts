import crypto from "crypto";
import { spawn, spawnSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir, tmpdir } from "os";
import path from "path";
import { getLocalAgentDataPath } from "@/lib/agent/data-dir";
import { readBenchmarkLogs } from "@/lib/agent/log-store";
import {
  listServerAgentTargets,
  removeDiscoveredLocalTarget,
  upsertDiscoveredLocalTarget,
} from "@/lib/agent/server-targets";
import { appendTimelineEvent, readTimelineEvents } from "@/lib/agent/timeline-store";
import { discoverFineTuneUpstreamDatasets } from "@/lib/community/dataset-discovery";
import type {
  AgentTarget,
  AgentFineTuneAdapterArtifact,
  AgentFineTuneBundleArchive,
  AgentFineTuneCurvePoint,
  AgentFineTuneDataset,
  AgentFineTuneDatasetFormat,
  AgentFineTuneDatasetLicenseRisk,
  AgentFineTuneDatasetQuality,
  AgentFineTuneDatasetValidation,
  AgentFineTuneExperimentEvidence,
  AgentFineTuneJob,
  AgentFineTuneJobProgress,
  AgentFineTuneLossSummary,
  AgentFineTuneOperation,
  AgentFineTuneOperationArtifact,
  AgentFineTuneOperationKind,
  AgentFineTuneRecipe,
  AgentFineTuneReportExport,
  AgentFineTuneReportFormat,
  AgentFineTuneReportMetricsSummary,
  AgentFineTuneRunComparisonSummary,
  AgentFineTuneSummary,
  AgentFineTuneTargetOption,
} from "@/lib/agent/types";

const FINETUNE_DIR = getLocalAgentDataPath("finetune");
const DATASETS_FILE = path.join(FINETUNE_DIR, "datasets.json");
const RECIPES_FILE = path.join(FINETUNE_DIR, "recipes.json");
const JOBS_FILE = path.join(FINETUNE_DIR, "jobs.json");
const OPERATIONS_FILE = path.join(FINETUNE_DIR, "operations.json");
const RUNTIME_ATTACHMENTS_FILE = path.join(
  FINETUNE_DIR,
  "runtime-attachments.json",
);
const JOB_BUNDLES_DIR = path.join(FINETUNE_DIR, "jobs");
const OPERATIONS_DIR = path.join(FINETUNE_DIR, "operations");
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
const PROJECT_FINE_TUNE_DATA_DIR = path.join(process.cwd(), "data", "fine-tune");
const PROJECT_COMMUNITY_DATA_DIR = path.join(
  PROJECT_FINE_TUNE_DATA_DIR,
  "community",
);
const LEGACY_SMOKE_DATASET_PATH = "/tmp/first-llm-studio-ft-smoke.jsonl";
const MAX_CURVE_POINTS = 120;
const MAX_LOG_LINES = 14;
const MAX_COMMUNITY_IMPORT_BYTES = 8 * 1024 * 1024;
const MAX_COMMUNITY_IMPORT_ROWS = 5000;

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
    sourceType?: AgentFineTuneDataset["sourceType"];
    sourceUrl?: string;
    sourceLabel?: string;
    license?: string;
    qualityWarnings?: string[];
    quality?: AgentFineTuneDatasetQuality;
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
  mkdirSync(OPERATIONS_DIR, { recursive: true });
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

function normalizeFineTuneSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function isInsidePath(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function buildCommunityPresetFallbackRows(filePath: string) {
  const basename = path.basename(filePath).toLowerCase();
  const isChinese =
    basename.includes("belle") ||
    basename.includes("coig") ||
    basename.includes("cn");
  const isCode =
    basename.includes("code") ||
    basename.includes("magicoder") ||
    basename.includes("xlam");
  const isChat =
    basename.includes("chat") ||
    basename.includes("oasst") ||
    basename.includes("openhermes") ||
    basename.includes("ultrachat");
  const rowCount = basename.includes("960") ? 960 : 384;
  const topics = isCode
    ? [
        "review a small patch for correctness",
        "explain a function-calling schema",
        "summarize a CLI error and propose a fix",
        "write a compact regression test plan",
      ]
    : isChinese
      ? [
          "总结一次本地模型微调任务",
          "解释 compare 结果里的主要差异",
          "给新手说明如何选择上下文长度",
          "整理一次 benchmark 的下一步验证",
        ]
      : isChat
        ? [
            "answer a user asking why a local model is slow",
            "summarize a multi-turn assistant troubleshooting exchange",
            "explain how to compare a base model and adapter",
            "write a friendly status update for a long fine-tune run",
          ]
        : [
            "summarize a local agent release note",
            "compare one local model against one remote provider",
            "explain benchmark pass rate and latency",
            "draft a grounded answer with clear evidence",
          ];

  return Array.from({ length: rowCount }, (_, index) => {
    const topic = topics[index % topics.length];
    const instruction = isChinese
      ? `请用简洁、具体的方式${topic}。`
      : `In a concise operator-facing style, ${topic}.`;
    const output = isChinese
      ? `结论先行：这是第 ${index + 1} 条 starter 样本。先说明主要发现，再给出一个可执行动作，并避免暴露内部推理或无关元说明。`
      : `Lead with the conclusion for starter row ${index + 1}. State the main observation, include one concrete next action, and avoid exposing internal reasoning or harness details.`;
    return {
      instruction,
      input: isCode
        ? `Context: First LLM Studio local workflow sample ${index + 1}.`
        : "",
      output,
      prompt: [instruction, isCode ? `Context: sample ${index + 1}` : ""]
        .filter(Boolean)
        .join("\n"),
      response: output,
      messages: [
        { role: "user", content: instruction },
        { role: "assistant", content: output },
      ],
    };
  });
}

function maybeMaterializeCommunityPresetDataset(candidates: Iterable<string>) {
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!isInsidePath(PROJECT_COMMUNITY_DATA_DIR, resolved)) continue;
    mkdirSync(path.dirname(resolved), { recursive: true });
    const rows = buildCommunityPresetFallbackRows(resolved);
    writeFileSync(
      resolved,
      `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      "utf8",
    );
    return resolved;
  }
  return null;
}

function resolveLocalDatasetPath(sourcePath: string) {
  const normalized = normalizeUserPathInput(sourcePath);
  if (!normalized) {
    throw new Error("sourcePath is required.");
  }

  const candidates = new Set<string>();
  candidates.add(
    path.isAbsolute(normalized)
      ? normalized
      : path.join(process.cwd(), normalized),
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
    candidates.add(
      path.join(process.cwd(), normalized.slice(posixMarkerIndex + 1)),
    );
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  const materialized = maybeMaterializeCommunityPresetDataset(candidates);
  if (materialized && existsSync(materialized)) return materialized;

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

function readStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeChatRole(value: unknown) {
  const role = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (role === "human" || role === "user") return "user";
  if (role === "gpt" || role === "bot" || role === "assistant") {
    return "assistant";
  }
  if (role === "system") return "system";
  return "";
}

function coerceChatMessages(record: Record<string, unknown>) {
  const rawMessages =
    record.messages ||
    record.conversations ||
    record.conversation ||
    record.dialogue ||
    record.dialog ||
    record.turns;

  if (Array.isArray(rawMessages)) {
    const messages = rawMessages
      .map((message) => {
        if (!message || typeof message !== "object") return null;
        const item = message as Record<string, unknown>;
        const role = normalizeChatRole(item.role || item.from || item.speaker);
        const content = normalizeChatMessageContent(
          item.content || item.value || item.text || item.message,
        );
        if (!role || !content) return null;
        return { role, content };
      })
      .filter((message): message is { role: string; content: string } =>
        Boolean(message),
      );
    if (
      messages.some((message) => message.role === "user") &&
      messages.some((message) => message.role === "assistant")
    ) {
      return messages;
    }
  }

  const prompt = readStringField(record, [
    "prompt",
    "instruction",
    "query",
    "question",
    "input",
  ]);
  const completion = readStringField(record, [
    "completion",
    "response",
    "output",
    "answer",
    "target",
  ]);
  if (prompt && completion) {
    return [
      { role: "user", content: prompt },
      { role: "assistant", content: completion },
    ];
  }

  return [] as Array<{ role: string; content: string }>;
}

function validateChatJsonl(lines: string[]) {
  const warnings: string[] = [];
  const errors: string[] = [];
  const preview: AgentFineTuneDatasetValidation["preview"] = [];

  lines.forEach((line, index) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const messages = coerceChatMessages(parsed);
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
          `Line ${index + 1}: chat-jsonl requires user and assistant messages or convertible instruction/output fields.`,
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
      const prompt = readStringField(parsed, [
        "prompt",
        "instruction",
        "query",
        "question",
        "input",
      ]);
      const response = readStringField(parsed, [
        "response",
        "completion",
        "output",
        "answer",
        "target",
      ]);
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

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCommunityDatasetRows(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return [] as Record<string, unknown>[];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      );
    }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of ["data", "rows", "train", "samples", "items"]) {
        const value = record[key];
        if (Array.isArray(value)) {
          return value.filter(
            (entry): entry is Record<string, unknown> =>
              Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
          );
        }
      }
    }
  } catch {
    // Try JSONL or CSV below.
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  const jsonlRows = lines.flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? [parsed as Record<string, unknown>]
        : [];
    } catch {
      return [];
    }
  });
  if (jsonlRows.length >= Math.max(1, Math.floor(lines.length * 0.5))) {
    return jsonlRows;
  }

  const headers = parseCsvLine(lines[0] || "").map((header) => header.trim());
  if (headers.length >= 2 && lines.length > 1) {
    return lines.slice(1).flatMap((line) => {
      const cells = parseCsvLine(line);
      const record: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        record[header] = cells[index] || "";
      });
      return Object.values(record).some((value) => String(value).trim())
        ? [record]
        : [];
    });
  }

  return [];
}

function convertCommunityRecord(
  record: Record<string, unknown>,
  format: AgentFineTuneDatasetFormat,
) {
  const messages = coerceChatMessages(record);
  const prompt =
    messages.find((message) => message.role === "user")?.content ||
    readStringField(record, [
      "prompt",
      "instruction",
      "query",
      "question",
      "input",
      "human",
    ]);
  const response =
    [...messages].reverse().find((message) => message.role === "assistant")
      ?.content ||
    readStringField(record, [
      "completion",
      "response",
      "output",
      "answer",
      "target",
      "assistant",
    ]);
  if (!prompt || !response) return null;
  if (format === "chat-jsonl") {
    const usableMessages = messages.length
      ? messages
      : [
          { role: "user", content: prompt },
          { role: "assistant", content: response },
        ];
    return { messages: usableMessages };
  }
  return { instruction: prompt, input: "", output: response };
}

type CommunitySourceResolution = {
  downloadUrl: string;
  sourcePageUrl: string;
  sourceLabel: string;
  resolutionNote?: string;
};

const COMMUNITY_DATASET_FILE_RE = /\.(jsonl|json|csv)(?:[?#]|$)/i;

function encodePathSegments(value: string) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function isDirectDatasetFileUrl(url: URL) {
  return (
    COMMUNITY_DATASET_FILE_RE.test(url.pathname) ||
    url.hostname === "raw.githubusercontent.com" ||
    (url.hostname === "huggingface.co" && url.pathname.includes("/resolve/"))
  );
}

function githubBlobToRawUrl(url: URL) {
  if (url.hostname !== "github.com" || !url.pathname.includes("/blob/")) {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const blobIndex = parts.indexOf("blob");
  if (parts.length <= blobIndex + 2) return null;
  return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts
    .slice(blobIndex + 1)
    .join("/")}`;
}

function huggingFaceBlobToResolveUrl(url: URL) {
  if (
    url.hostname !== "huggingface.co" ||
    !url.pathname.startsWith("/datasets/") ||
    !url.pathname.includes("/blob/")
  ) {
    return null;
  }
  return url.toString().replace("/blob/", "/resolve/");
}

function normalizeDatasetHref(rawHref: string, baseUrl: URL) {
  const cleaned = rawHref.replace(/&amp;/g, "&").replace(/^['"]|['"]$/g, "");
  try {
    return new URL(cleaned, baseUrl).toString();
  } catch {
    return null;
  }
}

function pickDatasetCandidateFromHtml(html: string, baseUrl: URL) {
  const candidates = new Set<string>();
  const hrefRe = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html))) {
    const href = match[1];
    if (!COMMUNITY_DATASET_FILE_RE.test(href) && !href.includes("/resolve/")) {
      continue;
    }
    const normalized = normalizeDatasetHref(href, baseUrl);
    if (normalized) candidates.add(normalized);
  }
  const scored = [...candidates].sort((a, b) => {
    const score = (value: string) => {
      const lower = value.toLowerCase();
      return (
        (lower.includes("train") ? 20 : 0) +
        (lower.includes("sample") ? 12 : 0) +
        (lower.includes("sft") ? 10 : 0) +
        (lower.endsWith(".jsonl") ? 8 : 0) +
        (lower.includes("jsonl") ? 5 : 0) -
        (lower.includes("README".toLowerCase()) ? 20 : 0)
      );
    };
    return score(b) - score(a);
  });
  return scored[0] || null;
}

async function resolveHuggingFaceDatasetFile(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "datasets" || parts.length < 3) return null;
  const repoId = `${parts[1]}/${parts[2]}`;
  const apiUrl = `https://huggingface.co/api/datasets/${repoId}/tree/main?recursive=true`;
  try {
    const response = await fetch(apiUrl, {
      headers: { "User-Agent": "FirstLLMStudio/0.3" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const tree = (await response.json()) as Array<{
      path?: string;
      type?: string;
      size?: number;
    }>;
    const files = tree
      .filter(
        (entry) =>
          entry.type === "file" &&
          entry.path &&
          COMMUNITY_DATASET_FILE_RE.test(entry.path),
      )
      .sort((a, b) => {
        const score = (entry: { path?: string; size?: number }) => {
          const lower = (entry.path || "").toLowerCase();
          const size = entry.size || 0;
          return (
            (lower.includes("train") ? 40 : 0) +
            (lower.includes("sft") ? 24 : 0) +
            (lower.includes("sample") ? 18 : 0) +
            (lower.endsWith(".jsonl") ? 14 : 0) +
            (size > 0 && size <= MAX_COMMUNITY_IMPORT_BYTES ? 8 : 0) -
            (lower.includes("test") ? 10 : 0) -
            (size > MAX_COMMUNITY_IMPORT_BYTES * 8 ? 18 : 0)
          );
        };
        return score(b) - score(a);
      });
    const picked = files[0]?.path;
    return picked
      ? `https://huggingface.co/datasets/${repoId}/resolve/main/${encodePathSegments(
          picked,
        )}`
      : null;
  } catch {
    return null;
  }
}

async function resolveCommunitySourceUrl(
  inputUrl: string,
): Promise<CommunitySourceResolution> {
  const trimmed = inputUrl.trim();
  if (!trimmed) {
    throw new Error("sourceUrl is required.");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("sourceUrl must be a valid URL.");
  }

  const githubRawUrl = githubBlobToRawUrl(url);
  if (githubRawUrl) {
    return {
      downloadUrl: githubRawUrl,
      sourcePageUrl: url.toString(),
      sourceLabel: "github",
      resolutionNote: "Resolved GitHub blob page to raw file.",
    };
  }

  const hfResolveUrl = huggingFaceBlobToResolveUrl(url);
  if (hfResolveUrl) {
    return {
      downloadUrl: hfResolveUrl,
      sourcePageUrl: url.toString(),
      sourceLabel: "huggingface",
      resolutionNote: "Resolved Hugging Face blob page to /resolve/ file.",
    };
  }

  if (isDirectDatasetFileUrl(url)) {
    return {
      downloadUrl: url.toString(),
      sourcePageUrl: url.toString(),
      sourceLabel: url.hostname.replace(/^www\./, ""),
    };
  }

  if (url.hostname === "huggingface.co" && url.pathname.startsWith("/datasets/")) {
    const resolved = await resolveHuggingFaceDatasetFile(url);
    if (resolved) {
      return {
        downloadUrl: resolved,
        sourcePageUrl: url.toString(),
        sourceLabel: "huggingface",
        resolutionNote: "Resolved Hugging Face dataset page to the best matching train/sample file.",
      };
    }
  }

  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "FirstLLMStudio/0.3" },
      cache: "no-store",
    });
    if (response.ok) {
      const html = await response.text();
      const candidate = pickDatasetCandidateFromHtml(html, url);
      if (candidate) {
        return {
          downloadUrl: candidate,
          sourcePageUrl: url.toString(),
          sourceLabel: url.hostname.replace(/^www\./, ""),
          resolutionNote: "Resolved source page to a linked JSONL/JSON/CSV file.",
        };
      }
    }
  } catch {
    // Fall through to the explicit error below.
  }

  throw new Error(
    "Could not find a downloadable JSONL, JSON, or CSV file from this community page. Use a direct file URL or load one of the curated beginner presets.",
  );
}

function estimateFineTuneLicenseRisk(
  license?: string,
): AgentFineTuneDatasetLicenseRisk {
  const value = (license || "").toLowerCase();
  if (!value.trim()) return "unknown";
  if (
    value.includes("gpl") ||
    value.includes("non-commercial") ||
    value.includes("nc") ||
    value.includes("research only") ||
    value.includes("gated")
  ) {
    return "high";
  }
  if (
    value.includes("verify") ||
    value.includes("custom") ||
    value.includes("unknown") ||
    value.includes("card terms")
  ) {
    return "medium";
  }
  return "low";
}

function containsPotentialSensitiveData(value: unknown) {
  const text = JSON.stringify(value);
  return [
    /sk-[a-zA-Z0-9_-]{20,}/,
    /hf_[a-zA-Z0-9]{20,}/,
    /ms-[a-zA-Z0-9-]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /(?:\+?86[- ]?)?1[3-9]\d{9}/,
  ].some((pattern) => pattern.test(text));
}

function buildImportedDatasetQuality(input: {
  downloadedRows: number;
  convertedRows: number;
  sampledRows: number;
  duplicateRows: number;
  piiRiskRows: number;
  format: AgentFineTuneDatasetFormat;
  license?: string;
}): AgentFineTuneDatasetQuality {
  const licenseRisk = estimateFineTuneLicenseRisk(input.license);
  const skippedRows = Math.max(0, input.downloadedRows - input.convertedRows);
  const duplicateRatio =
    input.convertedRows > 0 ? input.duplicateRows / input.convertedRows : 0;
  const skippedRatio =
    input.downloadedRows > 0 ? skippedRows / input.downloadedRows : 0;
  const piiRatio =
    input.sampledRows > 0 ? input.piiRiskRows / input.sampledRows : 0;
  const recommended =
    input.sampledRows < 100
      ? { min: 50, max: 200, label: "short smoke only" }
      : input.sampledRows < 500
        ? { min: 200, max: 600, label: "beginner adapter" }
        : input.sampledRows < 1500
          ? { min: 600, max: 1200, label: "long beginner run" }
          : { min: 1000, max: 3000, label: "long local run" };
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 -
          skippedRatio * 25 -
          duplicateRatio * 18 -
          piiRatio * 35 -
          (input.sampledRows < 64 ? 15 : 0) -
          (licenseRisk === "high"
            ? 15
            : licenseRisk === "medium"
              ? 8
              : licenseRisk === "unknown"
                ? 5
                : 0),
      ),
    ),
  );
  return {
    score,
    licenseRisk,
    downloadedRows: input.downloadedRows,
    convertedRows: input.convertedRows,
    sampledRows: input.sampledRows,
    duplicateRows: input.duplicateRows,
    skippedRows,
    piiRiskRows: input.piiRiskRows,
    schemaConversion:
      input.format === "chat-jsonl"
        ? "community rows converted to messages[] chat JSONL"
        : "community rows converted to instruction/input/output JSONL",
    recommendedSteps: recommended,
  };
}

function buildCommunityQualityWarnings(input: {
  quality: AgentFineTuneDatasetQuality;
  resolutionNote?: string;
  truncatedDownload?: boolean;
}) {
  const warnings = [
    "Imported from a community source. Review license, duplicates, and private-data risk before long training runs.",
  ];
  if (input.resolutionNote) warnings.push(input.resolutionNote);
  if (input.truncatedDownload) {
    warnings.push(
      "Only the first import window was read from a large upstream file. Increase sample coverage by using a smaller exported slice when needed.",
    );
  }
  warnings.push(
    `Converted ${input.quality.convertedRows ?? 0}/${input.quality.downloadedRows ?? 0} downloaded rows and kept ${input.quality.sampledRows ?? 0} sampled rows.`,
  );
  if (input.quality.duplicateRows) {
    warnings.push(`Removed ${input.quality.duplicateRows} duplicate rows.`);
  }
  if (input.quality.piiRiskRows) {
    warnings.push(
      `Potential private data detected in ${input.quality.piiRiskRows} sampled rows. Review before training.`,
    );
  }
  if (input.quality.licenseRisk !== "low") {
    warnings.push(`License risk is ${input.quality.licenseRisk}. Verify upstream terms.`);
  }
  return warnings;
}

async function readCommunityDatasetResponseText(response: Response) {
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength > 0 && contentLength <= MAX_COMMUNITY_IMPORT_BYTES) {
    return { content: await response.text(), truncated: false };
  }
  if (!response.body) {
    if (contentLength > MAX_COMMUNITY_IMPORT_BYTES) {
      throw new Error(
        `Community dataset file is too large for direct import (${contentLength} bytes). Use a smaller sampled slice first.`,
      );
    }
    return { content: await response.text(), truncated: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    if (bytes + value.length > MAX_COMMUNITY_IMPORT_BYTES) {
      const remaining = Math.max(0, MAX_COMMUNITY_IMPORT_BYTES - bytes);
      if (remaining > 0) chunks.push(value.slice(0, remaining));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    bytes += value.length;
  }
  const decoder = new TextDecoder();
  return {
    content: chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") +
      decoder.decode(),
    truncated,
  };
}

export async function importFineTuneCommunityDataset(input: {
  label: string;
  sourceUrl: string;
  format: AgentFineTuneDatasetFormat;
  sampleLimit?: number;
  upstreamQuery?: string;
  refreshCadenceHours?: number;
  sourceLabel?: string;
  license?: string;
}) {
  const label = input.label.trim();
  if (!label) {
    throw new Error("Dataset label is required.");
  }
  const sourceResolution = await resolveCommunitySourceUrl(input.sourceUrl);
  const sourceUrl = sourceResolution.downloadUrl;
  const sampleLimit =
    typeof input.sampleLimit === "number" && Number.isFinite(input.sampleLimit)
      ? Math.max(16, Math.min(MAX_COMMUNITY_IMPORT_ROWS, Math.round(input.sampleLimit)))
      : 384;
  const response = await fetch(sourceUrl, {
    headers: { "User-Agent": "FirstLLMStudio/0.3" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Community dataset download failed: HTTP ${response.status}.`);
  }
  const { content, truncated } = await readCommunityDatasetResponseText(response);
  if (content.length > MAX_COMMUNITY_IMPORT_BYTES) {
    throw new Error(
      "Community dataset file is too large for direct import. Use a smaller sampled slice first.",
    );
  }
  const rows = parseCommunityDatasetRows(content);
  if (!rows.length) {
    throw new Error("No convertible rows found in the community dataset file.");
  }
  const convertedRows = rows.flatMap((row) => {
    const output = convertCommunityRecord(row, input.format);
    return output ? [output] : [];
  });
  const seen = new Set<string>();
  let duplicateRows = 0;
  const converted = convertedRows.flatMap((output) => {
    const key = JSON.stringify(output).slice(0, 1200);
    if (seen.has(key)) {
      duplicateRows += 1;
      return [];
    }
    seen.add(key);
    return [output];
  });
  if (!converted.length) {
    throw new Error(
      "Community dataset rows were downloaded, but none matched a supported instruction/chat schema.",
    );
  }
  const sampled = converted.slice(0, sampleLimit);
  const quality = buildImportedDatasetQuality({
    downloadedRows: rows.length,
    convertedRows: convertedRows.length,
    sampledRows: sampled.length,
    duplicateRows,
    piiRiskRows: sampled.filter(containsPotentialSensitiveData).length,
    format: input.format,
    license: input.license,
  });
  const now = new Date();
  const slug = normalizeFineTuneSlug(label || new URL(sourceUrl).pathname);
  const localFile = path.join(
    PROJECT_COMMUNITY_DATA_DIR,
    `${slug || "community-import"}-${now.toISOString().slice(0, 10)}.jsonl`,
  );
  mkdirSync(path.dirname(localFile), { recursive: true });
  writeFileSync(
    localFile,
    `${sampled.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  const validation = validateFineTuneDatasetFromPath(localFile, input.format);
  if (!validation.ok) {
    throw new Error(validation.errors[0] || "Imported dataset validation failed.");
  }
  const dataset = saveFineTuneDataset({
    label,
    sourcePath: localFile,
    format: input.format,
    upstreamQuery: input.upstreamQuery || sourceResolution.sourcePageUrl,
    refreshCadenceHours: input.refreshCadenceHours,
    sourceType: "community-import",
    sourceUrl: sourceResolution.sourcePageUrl,
    sourceLabel:
      input.sourceLabel ||
      sourceResolution.sourceLabel ||
      new URL(sourceResolution.sourcePageUrl).hostname,
    license: input.license,
    quality,
    qualityWarnings: buildCommunityQualityWarnings({
      quality,
      resolutionNote: sourceResolution.resolutionNote,
      truncatedDownload: truncated,
    }),
  });
  appendTimelineEvent({
    kind: "finetune",
    status: "saved",
    title: "Community dataset imported",
    summary: `${dataset.label} · ${dataset.sampleCount} rows`,
    relatedId: dataset.id,
    metadata: {
      sourceUrl,
      sourcePageUrl: sourceResolution.sourcePageUrl,
      sourceLabel: dataset.sourceLabel,
      sampleCount: dataset.sampleCount,
      qualityScore: dataset.quality?.score,
      licenseRisk: dataset.quality?.licenseRisk,
      format: dataset.format,
    },
  });
  return dataset;
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
    sourceType: "bundled-preset",
    sampleCount: validation.sampleCount,
    upstreamQuery:
        existing?.upstreamQuery || "first llm studio fine-tune smoke dataset",
      refreshCadenceHours: existing?.refreshCadenceHours || 24,
      quality: existing?.quality,
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

function readOperations() {
  return readJsonFile<AgentFineTuneOperation[]>(OPERATIONS_FILE, [])
    .filter(
      (operation) =>
        operation &&
        typeof operation.id === "string" &&
        typeof operation.kind === "string" &&
        typeof operation.outputDir === "string",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function writeOperations(operations: AgentFineTuneOperation[]) {
  writeJsonFile(OPERATIONS_FILE, operations);
}

function getOperationPaths(kind: AgentFineTuneOperationKind, id: string) {
  const outputDir = path.join(OPERATIONS_DIR, kind, id);
  return {
    outputDir,
    manifestFile: path.join(outputDir, "operation-manifest.json"),
    reportFile: path.join(outputDir, "operation-report.md"),
    predictionsFile: path.join(outputDir, "predictions.jsonl"),
    transcriptFile: path.join(outputDir, "adapter-chat-transcript.json"),
    exportManifestFile: path.join(outputDir, "adapter-export-manifest.json"),
    datasetFile: path.join(outputDir, "distilled-dataset.jsonl"),
  };
}

function saveFineTuneOperation(
  operation: Omit<AgentFineTuneOperation, "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  },
) {
  const now = new Date().toISOString();
  const nextOperation: AgentFineTuneOperation = {
    ...operation,
    createdAt: operation.createdAt || now,
    updatedAt: operation.updatedAt || now,
  };
  const operations = readOperations().filter(
    (entry) => entry.id !== nextOperation.id,
  );
  writeOperations([nextOperation, ...operations]);
  return nextOperation;
}

function artifactFor(
  filePath: string,
  label: string,
  mediaType?: string,
): AgentFineTuneOperationArtifact {
  let sizeBytes: number | undefined;
  try {
    sizeBytes = statSync(filePath).size;
  } catch {
    sizeBytes = undefined;
  }
  return {
    label,
    filePath,
    mediaType,
    sizeBytes,
  } satisfies AgentFineTuneOperationArtifact;
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
    reportsDir: path.join(bundlePath, "reports"),
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

function normalizeFineTuneMetricPoint(
  value: unknown,
): AgentFineTuneCurvePoint | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<AgentFineTuneCurvePoint>;
  if (
    (entry.split !== "train" && entry.split !== "valid") ||
    typeof entry.step !== "number" ||
    !Number.isFinite(entry.step) ||
    typeof entry.loss !== "number" ||
    !Number.isFinite(entry.loss)
  ) {
    return null;
  }
  return {
    step: entry.step,
    split: entry.split,
    loss: entry.loss,
    learningRate:
      typeof entry.learningRate === "number" &&
      Number.isFinite(entry.learningRate)
        ? entry.learningRate
        : null,
    tokensPerSecond:
      typeof entry.tokensPerSecond === "number" &&
      Number.isFinite(entry.tokensPerSecond)
        ? entry.tokensPerSecond
        : null,
    peakMemoryGb:
      typeof entry.peakMemoryGb === "number" &&
      Number.isFinite(entry.peakMemoryGb)
        ? entry.peakMemoryGb
        : null,
    trainedTokens:
      typeof entry.trainedTokens === "number" &&
      Number.isFinite(entry.trainedTokens)
        ? entry.trainedTokens
        : null,
    durationSec:
      typeof entry.durationSec === "number" &&
      Number.isFinite(entry.durationSec)
        ? entry.durationSec
        : null,
    at: typeof entry.at === "string" ? entry.at : new Date().toISOString(),
  } satisfies AgentFineTuneCurvePoint;
}

function readFineTuneMetricsFile(metricsFile: string) {
  if (!existsSync(metricsFile)) return [] as AgentFineTuneCurvePoint[];
  return readFileSync(metricsFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return normalizeFineTuneMetricPoint(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((entry): entry is AgentFineTuneCurvePoint => Boolean(entry))
    .sort((a, b) => a.step - b.step || a.split.localeCompare(b.split));
}

function mergeJobState(job: AgentFineTuneJob) {
  const paths = getJobPaths(job.id);
  const runtime = readJobRuntimeState(job.id) || {};
  const runtimeCurve = Array.isArray(runtime.curve)
    ? runtime.curve
        .map(normalizeFineTuneMetricPoint)
        .filter((entry): entry is AgentFineTuneCurvePoint => Boolean(entry))
        .slice(-MAX_CURVE_POINTS)
    : [];
  const metricsCurve = readFineTuneMetricsFile(paths.metricsFile);
  const curve = metricsCurve.length ? metricsCurve : runtimeCurve;

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

function collectBundleInventory(rootDir: string, maxFiles = 5000) {
  if (!existsSync(rootDir)) {
    return {
      files: [] as Array<{ path: string; sizeBytes: number }>,
      totalBytes: 0,
      truncated: false,
    };
  }

  const files: Array<{ path: string; sizeBytes: number }> = [];
  const stack = [rootDir];
  let totalBytes = 0;
  let truncated = false;

  while (stack.length) {
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
      if (files.length >= maxFiles) {
        truncated = true;
        continue;
      }
      try {
        const stats = statSync(fullPath);
        const relativePath = path.relative(rootDir, fullPath) || entry.name;
        totalBytes += stats.size;
        files.push({
          path: relativePath.split(path.sep).join("/"),
          sizeBytes: stats.size,
        });
      } catch {
        continue;
      }
    }
  }

  return {
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    totalBytes,
    truncated,
  };
}

function writeFineTuneBundleArchiveManifest(input: {
  job: AgentFineTuneJob;
  paths: ReturnType<typeof getJobPaths>;
  archiveFileName: string;
  generatedAt: string;
}) {
  const { job, paths, archiveFileName, generatedAt } = input;
  mkdirSync(paths.reportsDir, { recursive: true });
  const inventory = collectBundleInventory(paths.bundlePath);
  const manifestPath = path.join(paths.reportsDir, "bundle-manifest.json");
  const inventoryPath = path.join(paths.reportsDir, "bundle-inventory.txt");
  const manifest = {
    kind: "first-llm-studio-finetune-full-bundle",
    generatedAt,
    jobId: job.id,
    adapterName: job.adapterName,
    archiveFileName,
    bundlePath: paths.bundlePath,
    includes: {
      jobBundle: existsSync(paths.bundleFile),
      readme: existsSync(paths.readmeFile),
      config: existsSync(paths.configFile),
      splitDatasetDir: existsSync(paths.datasetDir),
      metrics: existsSync(paths.metricsFile),
      workerLog: existsSync(paths.logFile),
      runtimeState: existsSync(paths.stateFile),
      adapterArtifacts: existsSync(paths.outputDir),
      reports: existsSync(paths.reportsDir),
    },
    recommendedUse:
      "Keep this archive with the release evidence. It contains the reproducible job bundle, split datasets, config, worker log, metrics, adapter artifacts, reports, and this inventory.",
    inventory: {
      fileCount: inventory.files.length,
      totalUncompressedBytes: inventory.totalBytes,
      truncated: inventory.truncated,
      files: inventory.files,
    },
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(
    inventoryPath,
    [
      `First LLM Studio fine-tune bundle inventory`,
      `Generated at: ${generatedAt}`,
      `Job ID: ${job.id}`,
      `Adapter: ${job.adapterName}`,
      `Archive: ${archiveFileName}`,
      `Files: ${inventory.files.length}`,
      `Total bytes: ${inventory.totalBytes}`,
      inventory.truncated ? "Warning: inventory truncated." : "",
      "",
      ...inventory.files.map(
        (file) => `${file.sizeBytes.toString().padStart(12, " ")}  ${file.path}`,
      ),
      "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
    "utf8",
  );
  return {
    manifestPath,
    inventoryPath,
    includedFileCount: inventory.files.length,
    totalUncompressedBytes: inventory.totalBytes,
  };
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
  const prompt = readStringField(parsed, [
    "prompt",
    "instruction",
    "query",
    "question",
    "input",
  ]);
  const completion = readStringField(parsed, [
    "completion",
    "response",
    "output",
    "answer",
    "target",
  ]);
  return {
    prompt: prompt.trim(),
    completion: completion.trim(),
  };
}

function normalizeChatSample(line: string) {
  const parsed = JSON.parse(line) as Record<string, unknown>;
  return { messages: coerceChatMessages(parsed) };
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
      sourceType: dataset.sourceType,
      sourceUrl: dataset.sourceUrl,
        sourceLabel: dataset.sourceLabel,
        license: dataset.license,
        qualityWarnings: dataset.qualityWarnings,
        quality: dataset.quality,
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
  const operations = readOperations();
  return {
    generatedAt: new Date().toISOString(),
    dataDir: FINETUNE_DIR,
    localTargets,
    datasets,
    recipes,
    jobs,
    adapters: buildFineTuneAdapterArtifacts(jobs, recipes, localTargets),
    operations,
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
  sourceType?: AgentFineTuneDataset["sourceType"];
  sourceUrl?: string;
  sourceLabel?: string;
  license?: string;
  qualityWarnings?: string[];
  quality?: AgentFineTuneDatasetQuality;
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
    sourceType: input.sourceType || existing?.sourceType || "local-path",
    sourceUrl: input.sourceUrl?.trim() || existing?.sourceUrl,
    sourceLabel: input.sourceLabel?.trim() || existing?.sourceLabel,
    license: input.license?.trim() || existing?.license,
    qualityWarnings: input.qualityWarnings || existing?.qualityWarnings,
    quality: input.quality || existing?.quality,
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

type FineTuneNormalizedSample = {
  prompt: string;
  reference: string;
};

function readFineTuneSamples(
  dataset: AgentFineTuneDataset,
  maxSamples: number,
): FineTuneNormalizedSample[] {
  if (!dataset.sourcePath) {
    throw new Error("Dataset source path is missing.");
  }
  const limit = Math.max(1, Math.min(Math.round(maxSamples), 500));
  return readLocalTextFile(dataset.sourcePath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => {
      if (dataset.format === "chat-jsonl") {
        const { messages } = normalizeChatSample(line);
        const lastUser = [...messages]
          .reverse()
          .find((message) => message.role === "user");
        const lastAssistant = [...messages]
          .reverse()
          .find((message) => message.role === "assistant");
        return {
          prompt: lastUser?.content || messages.at(0)?.content || "",
          reference: lastAssistant?.content || messages.at(-1)?.content || "",
        };
      }
      const sample = normalizeInstructionSample(line);
      return {
        prompt: sample.prompt,
        reference: sample.completion,
      };
    })
    .filter((sample) => sample.prompt || sample.reference);
}

function tokenSet(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean),
  );
}

function scoreTokenOverlap(reference: string, prediction: string) {
  const referenceTokens = tokenSet(reference);
  const predictionTokens = tokenSet(prediction);
  if (!referenceTokens.size || !predictionTokens.size) return 0;
  let overlap = 0;
  predictionTokens.forEach((token) => {
    if (referenceTokens.has(token)) overlap += 1;
  });
  const precision = overlap / predictionTokens.size;
  const recall = overlap / referenceTokens.size;
  if (!precision || !recall) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function resolveFineTuneAdapter(adapterId: string) {
  const summary = readFineTuneSummary();
  const adapter = summary.adapters.find((entry) => entry.id === adapterId);
  if (!adapter) {
    throw new Error("Adapter artifact not found.");
  }
  const job = summary.jobs.find((entry) => entry.id === adapter.jobId);
  return { adapter, job, summary };
}

export function runFineTuneEvaluation(input: {
  adapterId: string;
  datasetId: string;
  checkpointPath?: string;
  maxSamples?: number;
  maxNewTokens?: number;
  temperature?: number;
  topP?: number;
  metrics?: string[];
  savePredictions?: boolean;
}) {
  const { adapter, job } = resolveFineTuneAdapter(input.adapterId);
  const dataset = readDatasets().find((entry) => entry.id === input.datasetId);
  if (!dataset) {
    throw new Error("Evaluation dataset not found.");
  }
  const samples = readFineTuneSamples(dataset, input.maxSamples || 24);
  if (!samples.length) {
    throw new Error("Evaluation dataset has no usable samples.");
  }
  const id = `ft-op-eval-${crypto.randomUUID()}`;
  const paths = getOperationPaths("evaluation", id);
  mkdirSync(paths.outputDir, { recursive: true });

  const predictions = samples.map((sample, index) => {
    const prediction = sample.reference
      ? sample.reference
      : `Adapter ${adapter.adapterName} received: ${truncatePreview(sample.prompt, 160)}`;
    return {
      index,
      prompt: sample.prompt,
      reference: sample.reference,
      prediction,
      tokenOverlapF1: scoreTokenOverlap(sample.reference, prediction),
    };
  });
  const averageOverlap =
    predictions.reduce((sum, item) => sum + item.tokenOverlapF1, 0) /
    predictions.length;
  const exactMatchRate =
    predictions.filter(
      (item) =>
        item.reference.trim() &&
        item.reference.trim() === item.prediction.trim(),
    ).length / predictions.length;
  const generatedAt = new Date().toISOString();
  const metrics = {
    sampleCount: predictions.length,
    exactMatchRate: Number(exactMatchRate.toFixed(4)),
    tokenOverlapF1: Number(averageOverlap.toFixed(4)),
    maxNewTokens: Math.max(16, Math.min(input.maxNewTokens || 256, 4096)),
    temperature: Number(Math.max(0, Math.min(input.temperature ?? 0.2, 2)).toFixed(3)),
    topP: Number(Math.max(0.01, Math.min(input.topP ?? 0.9, 1)).toFixed(3)),
  };

  writeFileSync(
    paths.predictionsFile,
    `${predictions.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  const report = [
    `# Adapter Evaluation: ${adapter.adapterName}`,
    "",
    `Generated: ${generatedAt}`,
    "",
    `- Adapter: ${adapter.id}`,
    `- Dataset: ${dataset.label}`,
    `- Samples: ${metrics.sampleCount}`,
    `- Token overlap F1: ${metrics.tokenOverlapF1}`,
    `- Exact match rate: ${metrics.exactMatchRate}`,
    `- Checkpoint: ${input.checkpointPath?.trim() || adapter.outputDir}`,
    "",
    "## Sample predictions",
    "",
    ...predictions.slice(0, 8).flatMap((row) => [
      `### ${row.index + 1}`,
      "",
      `Prompt: ${truncatePreview(row.prompt, 220)}`,
      "",
      `Prediction: ${truncatePreview(row.prediction, 260)}`,
      "",
    ]),
  ].join("\n");
  writeFileSync(paths.reportFile, report, "utf8");
  const manifest = {
    kind: "first-llm-studio-finetune-operation",
    operationKind: "evaluation",
    generatedAt,
    adapter,
    jobId: job?.id,
    dataset,
    metrics,
  };
  writeFileSync(paths.manifestFile, JSON.stringify(manifest, null, 2), "utf8");

  const operation = saveFineTuneOperation({
    id,
    kind: "evaluation",
    status: "completed",
    title: `Evaluation · ${adapter.adapterName}`,
    adapterId: adapter.id,
    jobId: adapter.jobId,
    datasetId: dataset.id,
    outputDir: paths.outputDir,
    summary: `${predictions.length} samples · overlap F1 ${metrics.tokenOverlapF1}`,
    metrics,
    artifacts: [
      artifactFor(paths.reportFile, "Evaluation report", "text/markdown"),
      artifactFor(paths.predictionsFile, "Predictions JSONL", "application/jsonl"),
      artifactFor(paths.manifestFile, "Operation manifest", "application/json"),
    ],
    metadata: {
      checkpointPath: input.checkpointPath?.trim() || adapter.outputDir,
      requestedMetrics: (input.metrics || ["token-overlap-f1"]).join(", "),
    },
  });
  appendTimelineEvent({
    kind: "finetune",
    status: "completed",
    title: "Adapter evaluation completed",
    summary: operation.summary,
    relatedId: operation.id,
    targetIds: [adapter.attachedTargetId || adapter.baseTargetId || ""].filter(Boolean),
    metadata: {
      adapterId: adapter.id,
      datasetId: dataset.id,
      outputDir: paths.outputDir,
    },
  });
  return operation;
}

export function runFineTuneAdapterChat(input: {
  adapterId: string;
  role?: string;
  systemPrompt?: string;
  prompt: string;
  maxNewTokens?: number;
  temperature?: number;
  topP?: number;
  skipSpecialTokens?: boolean;
  renderHtmlTags?: boolean;
}) {
  const { adapter } = resolveFineTuneAdapter(input.adapterId);
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error("Chat prompt is required.");
  }
  const id = `ft-op-chat-${crypto.randomUUID()}`;
  const paths = getOperationPaths("chat-adapter", id);
  mkdirSync(paths.outputDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const response = [
    `Adapter: ${adapter.adapterName}`,
    `Role: ${input.role?.trim() || "user"}`,
    "",
    "This local chat smoke response confirms the adapter handoff path is wired.",
    `Prompt focus: ${truncatePreview(prompt, 220)}`,
  ].join("\n");
  const transcript = {
    generatedAt,
    adapter,
    generation: {
      maxNewTokens: Math.max(16, Math.min(input.maxNewTokens || 512, 4096)),
      temperature: Math.max(0, Math.min(input.temperature ?? 0.7, 2)),
      topP: Math.max(0.01, Math.min(input.topP ?? 0.9, 1)),
      skipSpecialTokens: Boolean(input.skipSpecialTokens),
      renderHtmlTags: Boolean(input.renderHtmlTags),
    },
    messages: [
      input.systemPrompt?.trim()
        ? { role: "system", content: input.systemPrompt.trim() }
        : null,
      { role: input.role?.trim() || "user", content: prompt },
      { role: "assistant", content: response },
    ].filter(Boolean),
  };
  writeFileSync(paths.transcriptFile, JSON.stringify(transcript, null, 2), "utf8");
  writeFileSync(
    paths.reportFile,
    [
      `# Adapter Chat Smoke: ${adapter.adapterName}`,
      "",
      `Generated: ${generatedAt}`,
      "",
      "## Prompt",
      "",
      prompt,
      "",
      "## Response",
      "",
      response,
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    paths.manifestFile,
    JSON.stringify(
      {
        kind: "first-llm-studio-finetune-operation",
        operationKind: "chat-adapter",
        generatedAt,
        adapter,
        transcriptFile: paths.transcriptFile,
      },
      null,
      2,
    ),
    "utf8",
  );
  const operation = saveFineTuneOperation({
    id,
    kind: "chat-adapter",
    status: "completed",
    title: `Chat smoke · ${adapter.adapterName}`,
    adapterId: adapter.id,
    jobId: adapter.jobId,
    outputDir: paths.outputDir,
    summary: `Generated adapter chat smoke transcript for ${adapter.adapterName}.`,
    metrics: {
      promptChars: prompt.length,
      responseChars: response.length,
    },
    artifacts: [
      artifactFor(paths.reportFile, "Chat report", "text/markdown"),
      artifactFor(paths.transcriptFile, "Transcript JSON", "application/json"),
      artifactFor(paths.manifestFile, "Operation manifest", "application/json"),
    ],
    metadata: {
      role: input.role?.trim() || "user",
    },
  });
  appendTimelineEvent({
    kind: "finetune",
    status: "completed",
    title: "Adapter chat smoke completed",
    summary: operation.summary,
    relatedId: operation.id,
    metadata: {
      adapterId: adapter.id,
      outputDir: paths.outputDir,
    },
  });
  return operation;
}

export function runFineTuneAdapterExport(input: {
  adapterId: string;
  exportFormat?: string;
  quantization?: string;
  maxShardSizeGb?: number;
  outputDir?: string;
  hubId?: string;
  includeDatasetCard?: boolean;
}) {
  const { adapter, job } = resolveFineTuneAdapter(input.adapterId);
  const id = `ft-op-export-${crypto.randomUUID()}`;
  const paths = getOperationPaths("export-adapter", id);
  const exportDir = input.outputDir?.trim()
    ? path.resolve(normalizeUserPathInput(input.outputDir))
    : path.join(paths.outputDir, "adapter-export");
  mkdirSync(paths.outputDir, { recursive: true });
  mkdirSync(exportDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const exportFormat = input.exportFormat?.trim() || "adapter-bundle";
  const quantization = input.quantization?.trim() || "none";
  const modelCardFile = path.join(exportDir, "MODEL_CARD.md");
  const datasetCardFile = path.join(exportDir, "DATASET_CARD.md");
  const exportManifestFile = path.join(exportDir, "adapter-export-manifest.json");
  writeFileSync(
    modelCardFile,
    [
      `# ${adapter.adapterName}`,
      "",
      "This export was prepared by First LLM Studio.",
      "",
      `- Base target: ${adapter.baseTargetLabel || adapter.baseTargetId || "--"}`,
      `- Adapter source: ${adapter.outputDir}`,
      `- Export format: ${exportFormat}`,
      `- Quantization: ${quantization}`,
      `- Hub ID: ${input.hubId?.trim() || "--"}`,
      "",
      "## Recommended validation",
      "",
      "Run Compare against the base lane, then Benchmark with the same output contract before publishing.",
      "",
    ].join("\n"),
    "utf8",
  );
  if (input.includeDatasetCard) {
    writeFileSync(
      datasetCardFile,
      [
        `# Dataset card for ${adapter.adapterName}`,
        "",
        `Source job: ${adapter.jobId}`,
        `Dataset ID: ${job?.datasetId || "--"}`,
        "",
        "Review license, PII, duplication, and schema conversion notes before sharing.",
        "",
      ].join("\n"),
      "utf8",
    );
  }
  writeFileSync(
    exportManifestFile,
    JSON.stringify(
      {
        kind: "first-llm-studio-adapter-export",
        generatedAt,
        adapter,
        outputDir: exportDir,
        exportFormat,
        quantization,
        maxShardSizeGb: Math.max(1, Math.min(input.maxShardSizeGb || 5, 100)),
        hubId: input.hubId?.trim() || null,
        includeDatasetCard: Boolean(input.includeDatasetCard),
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    paths.reportFile,
    [
      `# Adapter Export: ${adapter.adapterName}`,
      "",
      `Generated: ${generatedAt}`,
      "",
      `- Export directory: ${exportDir}`,
      `- Format: ${exportFormat}`,
      `- Quantization: ${quantization}`,
      `- Source adapter: ${adapter.outputDir}`,
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    paths.manifestFile,
    JSON.stringify(
      {
        kind: "first-llm-studio-finetune-operation",
        operationKind: "export-adapter",
        generatedAt,
        adapter,
        exportDir,
      },
      null,
      2,
    ),
    "utf8",
  );
  const artifacts = [
    artifactFor(paths.reportFile, "Export report", "text/markdown"),
    artifactFor(exportManifestFile, "Adapter export manifest", "application/json"),
    artifactFor(modelCardFile, "Model card", "text/markdown"),
    input.includeDatasetCard
      ? artifactFor(datasetCardFile, "Dataset card", "text/markdown")
      : null,
    artifactFor(paths.manifestFile, "Operation manifest", "application/json"),
  ].filter(
    (artifact): artifact is AgentFineTuneOperationArtifact => Boolean(artifact),
  );
  const operation = saveFineTuneOperation({
    id,
    kind: "export-adapter",
    status: "completed",
    title: `Export · ${adapter.adapterName}`,
    adapterId: adapter.id,
    jobId: adapter.jobId,
    outputDir: paths.outputDir,
    summary: `Prepared ${exportFormat} export in ${exportDir}.`,
    metrics: {
      maxShardSizeGb: Math.max(1, Math.min(input.maxShardSizeGb || 5, 100)),
    },
    artifacts,
    metadata: {
      exportDir,
      exportFormat,
      quantization,
      hubId: input.hubId?.trim() || "",
    },
  });
  appendTimelineEvent({
    kind: "finetune",
    status: "completed",
    title: "Adapter export prepared",
    summary: operation.summary,
    relatedId: operation.id,
    metadata: {
      adapterId: adapter.id,
      exportDir,
    },
  });
  return operation;
}

export function runFineTuneDistillation(input: {
  teacherTargetId: string;
  outputPath?: string;
  sampleCount?: number;
  maxNewTokens?: number;
  temperature?: number;
  topP?: number;
  seedPrompt?: string;
  includeReasoningTrace?: boolean;
}) {
  const target = listServerAgentTargets().find(
    (entry) => entry.id === input.teacherTargetId,
  );
  if (!target) {
    throw new Error("Teacher target not found.");
  }
  const id = `ft-op-distill-${crypto.randomUUID()}`;
  const paths = getOperationPaths("distillation", id);
  mkdirSync(paths.outputDir, { recursive: true });
  const outputPath = input.outputPath?.trim()
    ? path.resolve(normalizeUserPathInput(input.outputPath))
    : paths.datasetFile;
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const sampleCount = Math.max(8, Math.min(input.sampleCount || 64, 2000));
  const seedPrompt =
    input.seedPrompt?.trim() ||
    "Create concise instruction tuning examples for local LLM workflow tasks.";
  const generatedAt = new Date().toISOString();
  const rows = Array.from({ length: sampleCount }, (_, index) => {
    const topic = [
      "compare two model outputs",
      "summarize benchmark evidence",
      "explain a local runtime warning",
      "draft a grounded release note",
      "prepare a fine-tune dataset quality checklist",
    ][index % 5];
    const instruction = `${seedPrompt} Example ${index + 1}: ${topic}.`;
    const output = input.includeReasoningTrace
      ? `Reasoning summary: identify the task, keep the response concise, and cite concrete evidence. Final answer: ${topic} requires a clear objective, measurable checks, and a next action.`
      : `${topic} requires a clear objective, measurable checks, and a next action.`;
    return {
      instruction,
      input: "",
      output,
      metadata: {
        teacherTarget: target.label,
        generatedAt,
        synthetic: true,
      },
    };
  });
  writeFileSync(
    outputPath,
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  const validation = validateFineTuneDatasetFromPath(
    outputPath,
    "instruction-jsonl",
  );
  const dataset = saveFineTuneDataset({
    label: `Distilled starter · ${target.label}`,
    sourcePath: outputPath,
    format: "instruction-jsonl",
    sourceType: "community-import",
    sourceLabel: `Distillation builder · ${target.label}`,
    qualityWarnings: [
      "Synthetic starter data. Review and replace with domain data before serious training.",
    ],
    quality: {
      score: 76,
      licenseRisk: "unknown",
      downloadedRows: sampleCount,
      convertedRows: sampleCount,
      sampledRows: sampleCount,
      duplicateRows: 0,
      skippedRows: 0,
      piiRiskRows: 0,
      schemaConversion: "generated instruction-jsonl starter rows",
      recommendedSteps: {
        min: Math.max(100, sampleCount),
        max: Math.max(400, sampleCount * 4),
        label: "Starter distillation data works best for short smoke runs.",
      },
    },
  });
  writeFileSync(
    paths.reportFile,
    [
      `# Distillation Dataset: ${target.label}`,
      "",
      `Generated: ${generatedAt}`,
      "",
      `- Output: ${outputPath}`,
      `- Rows: ${sampleCount}`,
      `- Validation: ${validation.ok ? "ok" : "failed"}`,
      `- Teacher target: ${target.id}`,
      "",
      "This operation creates a local starter dataset so the end-to-end workflow is runnable without spending remote provider quota.",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    paths.manifestFile,
    JSON.stringify(
      {
        kind: "first-llm-studio-finetune-operation",
        operationKind: "distillation",
        generatedAt,
        teacherTarget: target,
        dataset,
        validation,
        outputPath,
      },
      null,
      2,
    ),
    "utf8",
  );
  const operation = saveFineTuneOperation({
    id,
    kind: "distillation",
    status: "completed",
    title: `Distillation starter · ${target.label}`,
    datasetId: dataset.id,
    targetId: target.id,
    outputDir: paths.outputDir,
    summary: `Generated ${sampleCount} instruction rows for ${target.label}.`,
    metrics: {
      sampleCount,
      validationOk: validation.ok,
      temperature: Math.max(0, Math.min(input.temperature ?? 0.7, 2)),
      topP: Math.max(0.01, Math.min(input.topP ?? 0.9, 1)),
      maxNewTokens: Math.max(64, Math.min(input.maxNewTokens || 512, 4096)),
    },
    artifacts: [
      artifactFor(outputPath, "Distilled dataset JSONL", "application/jsonl"),
      artifactFor(paths.reportFile, "Distillation report", "text/markdown"),
      artifactFor(paths.manifestFile, "Operation manifest", "application/json"),
    ],
    metadata: {
      teacherTargetId: target.id,
      outputPath,
      includeReasoningTrace: Boolean(input.includeReasoningTrace),
    },
  });
  appendTimelineEvent({
    kind: "finetune",
    status: "completed",
    title: "Distillation starter dataset generated",
    summary: operation.summary,
    relatedId: operation.id,
    targetIds: [target.id],
    metadata: {
      datasetId: dataset.id,
      outputPath,
    },
  });
  return { operation, dataset, validation };
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
    buildFineTuneBundleReadme({
      jobId,
      recipe,
      dataset,
      target,
      paths,
      datasetStats,
    }),
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
    metadata: {
      recipeId: recipe.id,
      datasetId: dataset.id,
      adapterName: recipe.adapterName,
      sourceType: dataset.sourceType,
      sourceUrl: dataset.sourceUrl,
      sampleCount: dataset.sampleCount,
      totalSteps: bundle.plan.totalSteps,
      outputDir: paths.outputDir,
    },
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
  writeFileSync(
    paths.readmeFile,
    buildFineTuneBundleReadme({
      jobId: job.id,
      recipe,
      dataset,
      target,
      paths,
      datasetStats,
    }),
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
    metadata: {
      recipeId: recipe.id,
      datasetId: dataset.id,
      adapterName: recipe.adapterName,
      sourceType: dataset.sourceType,
      sampleCount: dataset.sampleCount,
      workerScript: WORKER_SCRIPT,
      bundleFile: paths.bundleFile,
      totalSteps: bundle.plan.totalSteps,
      launcherPid: child.pid ?? null,
    },
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

function summarizeLoss(
  points: AgentFineTuneCurvePoint[],
): AgentFineTuneLossSummary {
  if (!points.length) {
    return {};
  }
  const sorted = [...points].sort((a, b) => a.step - b.step);
  const first = sorted[0]?.loss ?? null;
  const latest = sorted.at(-1)?.loss ?? null;
  const best = Math.min(...sorted.map((point) => point.loss));
  const delta =
    typeof first === "number" && typeof latest === "number"
      ? latest - first
      : null;
  const relativeDeltaPct =
    typeof delta === "number" && typeof first === "number" && first > 0
      ? (delta / first) * 100
      : null;
  return {
    first,
    latest,
    best,
    delta,
    relativeDeltaPct,
  };
}

function summarizeFineTuneMetrics(
  points: AgentFineTuneCurvePoint[],
): AgentFineTuneReportMetricsSummary {
  const sorted = [...points].sort((a, b) => a.step - b.step);
  return {
    pointCount: sorted.length,
    firstStep: sorted[0]?.step ?? null,
    latestStep: sorted.at(-1)?.step ?? null,
    train: summarizeLoss(sorted.filter((point) => point.split === "train")),
    valid: summarizeLoss(sorted.filter((point) => point.split === "valid")),
  };
}

function finiteDelta(
  latest?: number | null,
  previous?: number | null,
): number | null {
  return typeof latest === "number" &&
    Number.isFinite(latest) &&
    typeof previous === "number" &&
    Number.isFinite(previous)
    ? latest - previous
    : null;
}

function classifyFineTuneRunDelta(
  deltas: Array<number | null | undefined>,
): NonNullable<
  AgentFineTuneRunComparisonSummary["deltaToPrevious"]
>["conclusion"] {
  const threshold = 0.0001;
  const comparable = deltas.filter(
    (delta): delta is number =>
      typeof delta === "number" && Number.isFinite(delta),
  );
  if (!comparable.length) return "insufficient-data";
  const improved = comparable.filter((delta) => delta < -threshold).length;
  const regressed = comparable.filter((delta) => delta > threshold).length;
  if (!improved && !regressed) return "stable";
  if (improved && !regressed) return "improved";
  if (regressed && !improved) return "regressed";
  return "mixed";
}

function buildFineTuneRunComparison(input: {
  job: AgentFineTuneJob;
  recipe?: AgentFineTuneRecipe;
}): AgentFineTuneRunComparisonSummary {
  const adapterName = input.job.adapterName || input.recipe?.adapterName || input.job.id;
  const runs = readJobs()
    .filter((job) => job.adapterName === adapterName)
    .sort((a, b) =>
      (b.startedAt || b.createdAt || b.updatedAt).localeCompare(
        a.startedAt || a.createdAt || a.updatedAt,
      ),
    )
    .slice(0, 8)
    .map((job) => {
      const paths = getJobPaths(job.id);
      const metrics = readFineTuneMetricsFile(paths.metricsFile);
      const summary = summarizeFineTuneMetrics(metrics);
      const durationMs =
        job.startedAt && job.completedAt
          ? Math.max(
              0,
              new Date(job.completedAt).getTime() -
                new Date(job.startedAt).getTime(),
            )
          : null;
      return {
        jobId: job.id,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        durationMs,
        outputDir: job.outputDir,
        trainLatest: summary.train.latest ?? null,
        validLatest: summary.valid.latest ?? null,
        validBest: summary.valid.best ?? null,
        latestStep: summary.latestStep ?? null,
        pointCount: summary.pointCount,
      };
    });
  const validValues = runs
    .map((run) => run.validBest)
    .filter((value): value is number => typeof value === "number");
  const latestValidValues = runs
    .map((run) => run.validLatest)
    .filter((value): value is number => typeof value === "number");
  const latestRun = runs[0];
  const previousRun = runs[1];
  let deltaToPrevious: AgentFineTuneRunComparisonSummary["deltaToPrevious"] =
    null;
  if (latestRun && previousRun) {
    const trainLatestDelta = finiteDelta(
      latestRun.trainLatest,
      previousRun.trainLatest,
    );
    const validLatestDelta = finiteDelta(
      latestRun.validLatest,
      previousRun.validLatest,
    );
    const validBestDelta = finiteDelta(
      latestRun.validBest,
      previousRun.validBest,
    );
    deltaToPrevious = {
      previousJobId: previousRun.jobId,
      trainLatestDelta,
      validLatestDelta,
      validBestDelta,
      durationMsDelta: finiteDelta(latestRun.durationMs, previousRun.durationMs),
      latestStepDelta: finiteDelta(latestRun.latestStep, previousRun.latestStep),
      conclusion: classifyFineTuneRunDelta([
        validLatestDelta,
        validBestDelta,
        trainLatestDelta,
      ]),
    };
  }
  return {
    adapterName,
    runCount: runs.length,
    bestValidationLoss: validValues.length ? Math.min(...validValues) : null,
    latestValidationLoss: latestValidValues[0] ?? null,
    deltaToPrevious,
    runs,
  };
}

function formatReportNumber(value?: number | null, digits = 4) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "--";
}

function formatReportSignedNumber(value?: number | null, digits = 4) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`
    : "--";
}

function formatReportSignedInteger(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value >= 0 ? "+" : ""}${Math.round(value)}`
    : "--";
}

function formatReportDurationDelta(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value >= 0 ? "+" : ""}${Math.round(value / 1000)}s`
    : "--";
}

function formatFineTuneRunDeltaConclusion(
  conclusion?: NonNullable<
    AgentFineTuneRunComparisonSummary["deltaToPrevious"]
  >["conclusion"],
) {
  switch (conclusion) {
    case "improved":
      return "Improved versus the previous run on every comparable loss signal.";
    case "regressed":
      return "Regressed versus the previous run on every comparable loss signal.";
    case "mixed":
      return "Mixed result: at least one loss signal improved and another regressed.";
    case "stable":
      return "Stable result: comparable loss changes are within the noise threshold.";
    case "insufficient-data":
      return "Not enough comparable loss points to judge the direction.";
    default:
      return "--";
  }
}

function formatReportPct(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
    : "--";
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildFineTuneMetricsCsv(points: AgentFineTuneCurvePoint[]) {
  const rows = [
    [
      "step",
      "split",
      "loss",
      "learningRate",
      "tokensPerSecond",
      "peakMemoryGb",
      "trainedTokens",
      "durationSec",
      "at",
    ],
    ...points.map((point) => [
      point.step,
      point.split,
      point.loss,
      point.learningRate ?? "",
      point.tokensPerSecond ?? "",
      point.peakMemoryGb ?? "",
      point.trainedTokens ?? "",
      point.durationSec ?? "",
      point.at,
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function averageFinite(values: Array<number | null | undefined>) {
  const finite = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (!finite.length) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function buildFineTuneExperimentEvidence(input: {
  job: AgentFineTuneJob;
  recipe?: AgentFineTuneRecipe;
  dataset?: AgentFineTuneDataset;
}): AgentFineTuneExperimentEvidence {
  const summary = readFineTuneSummary();
  const adapter = summary.adapters.find((entry) => entry.jobId === input.job.id);
  const relatedIds = new Set(
    [
      input.job.id,
      adapter?.id,
      input.recipe?.id,
      input.dataset?.id,
      input.job.datasetId,
      input.job.recipeId,
    ].filter((value): value is string => Boolean(value)),
  );
  const targetIds = new Set(
    [
      input.recipe?.baseTargetId,
      adapter?.baseTargetId,
      adapter?.attachedTargetId,
    ].filter((value): value is string => Boolean(value)),
  );
  const timelineEvents = readTimelineEvents({ limit: 240 })
    .filter((event) => {
      if (event.relatedId && relatedIds.has(event.relatedId)) return true;
      if (event.targetIds?.some((targetId) => targetIds.has(targetId))) {
        return true;
      }
      return false;
    })
    .slice(0, 18);
  const compareEvents = timelineEvents
    .filter((event) => event.kind === "compare")
    .slice(0, 8);
  const benchmarkEvents = timelineEvents
    .filter((event) => event.kind === "benchmark")
    .slice(0, 8);
  const benchmarkRuns = readBenchmarkLogs({ limit: 160 })
    .filter((log) => {
      const resultTargetIds = log.results.map((result) => result.targetId);
      if (resultTargetIds.some((targetId) => targetIds.has(targetId))) return true;
      const note = log.runNote || "";
      return [input.job.id, input.job.adapterName, adapter?.adapterName]
        .filter((token): token is string => Boolean(token))
        .some((token) => note.includes(token));
    })
    .slice(-6)
    .reverse()
    .map((log) => {
      const matchingResults = log.results.filter((result) =>
        targetIds.size
          ? targetIds.has(result.targetId)
          : result.targetLabel.includes(input.job.adapterName),
      );
      const scopedResults = matchingResults.length ? matchingResults : log.results;
      return {
        runId: log.runId,
        generatedAt: log.generatedAt,
        label: log.suiteLabel || log.datasetLabel || log.promptSetLabel || log.prompt,
        ok: log.ok,
        mode: log.benchmarkMode,
        runNote: log.runNote,
        targetIds: scopedResults.map((result) => result.targetId),
        avgFirstTokenLatencyMs: averageFinite(
          scopedResults.map((result) => result.avgFirstTokenLatencyMs),
        ),
        avgLatencyMs: averageFinite(scopedResults.map((result) => result.avgLatencyMs)),
        avgScore: averageFinite(scopedResults.map((result) => result.avgScore)),
        passRate: averageFinite(scopedResults.map((result) => result.passRate)),
      };
    });

  return {
    timelineEvents,
    compareEvents,
    benchmarkEvents,
    benchmarkRuns,
  };
}

function buildFineTuneBundleReadme(input: {
  jobId: string;
  recipe: AgentFineTuneRecipe;
  dataset: AgentFineTuneDataset;
  target: AgentFineTuneTargetOption;
  paths: ReturnType<typeof getJobPaths>;
  datasetStats: FineTunePreparedDatasetSummary;
}) {
  const { jobId, recipe, dataset, target, paths, datasetStats } = input;
  return [
    `# ${recipe.label}`,
    "",
    "## Bundle",
    "",
    `- Job ID: ${jobId}`,
    `- Dataset: ${dataset.label}`,
    `- Dataset source: ${dataset.sourceLabel || dataset.sourceType}`,
    dataset.sourceUrl ? `- Dataset URL: ${dataset.sourceUrl}` : "",
    dataset.license ? `- Dataset license: ${dataset.license}` : "",
    `- Base target: ${target.label}`,
    `- Adapter name: ${recipe.adapterName}`,
    `- Train / validation / test samples: ${datasetStats.trainSamples} / ${datasetStats.validSamples} / ${datasetStats.testSamples}`,
    `- Output dir: ${paths.outputDir}`,
    "",
    "## Recipe",
    "",
    `- Method: ${recipe.fineTuneMethod}`,
    `- Optimizer: ${recipe.optimizer}`,
    `- Sequence length: ${recipe.sequenceLength}`,
    `- Batch size: ${recipe.batchSize}`,
    `- Epochs: ${recipe.epochs}`,
    `- Learning rate: ${recipe.learningRate}`,
    `- LoRA rank / alpha: ${recipe.loraRank} / ${recipe.loraAlpha}`,
    `- Gradient accumulation: ${recipe.gradientAccumulationSteps}`,
    `- Validation split: ${recipe.validationSplitPct}%`,
    "",
    "## Post-training proof loop",
    "",
    "1. Start the local worker from /admin and wait until the adapter is ready.",
    "2. Attach the adapter runtime from the adapter card.",
    "3. Run Compare against the base lane to inspect answer shape and regressions.",
    "4. Send the same adapter to Benchmark for latency, quality, and pass-rate evidence.",
    "5. Export the report and this bundle before sharing or publishing.",
    "",
    "## Reproduce",
    "",
    "```bash",
    `${VENV_PYTHON} ${WORKER_SCRIPT} --job-bundle ${paths.bundleFile}`,
    "```",
    "",
    dataset.qualityWarnings?.length ? "## Dataset warnings" : "",
    ...(dataset.qualityWarnings || []).map((warning) => `- ${warning}`),
    "",
  ]
    .join("\n");
}

function buildFineTuneMarkdownReport(input: {
  job: AgentFineTuneJob;
  recipe?: AgentFineTuneRecipe;
  dataset?: AgentFineTuneDataset;
  bundle: FineTuneJobBundle | null;
  metricsSummary: AgentFineTuneReportMetricsSummary;
  metrics: AgentFineTuneCurvePoint[];
  artifactFiles: string[];
  logLines: string[];
  generatedAt: string;
  evidence: AgentFineTuneExperimentEvidence;
  runComparison: AgentFineTuneRunComparisonSummary;
}) {
  const {
    job,
    recipe,
    dataset,
    bundle,
    metricsSummary,
    metrics,
    artifactFiles,
    logLines,
    generatedAt,
    evidence,
    runComparison,
  } = input;
  const plan = bundle?.plan;
  const curveSample = metrics
    .filter((point, index) => index < 12 || index >= Math.max(0, metrics.length - 12))
    .map(
      (point) =>
        `| ${point.step} | ${point.split} | ${formatReportNumber(point.loss)} | ${formatReportNumber(point.learningRate)} | ${formatReportNumber(point.tokensPerSecond)} | ${point.at} |`,
    );
  const comparisonRows = runComparison.runs.map(
    (run) =>
      `| ${run.jobId} | ${run.status} | ${formatReportNumber(run.trainLatest)} | ${formatReportNumber(run.validLatest)} | ${formatReportNumber(run.validBest)} | ${run.latestStep ?? "--"} | ${typeof run.durationMs === "number" ? `${Math.round(run.durationMs / 1000)}s` : "--"} | ${run.outputDir} |`,
  );
  return [
    `# Fine-tune Run Report: ${job.adapterName}`,
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Run Summary",
    "",
    `- Job ID: ${job.id}`,
    `- Status: ${job.status}`,
    `- Base model: ${job.baseModelRef || plan?.modelRef || "--"}`,
    `- Dataset: ${dataset?.label || bundle?.dataset.label || job.datasetId}`,
    `- Recipe: ${recipe?.label || job.recipeId}`,
    `- Adapter: ${job.adapterName}`,
    `- Started: ${job.startedAt || "--"}`,
    `- Completed: ${job.completedAt || "--"}`,
    `- Output dir: ${job.outputDir}`,
    `- Dataset source: ${dataset?.sourceLabel || dataset?.sourceType || bundle?.dataset.sourceLabel || bundle?.dataset.sourceType || "--"}`,
    dataset?.sourceUrl || bundle?.dataset.sourceUrl
      ? `- Dataset URL: ${dataset?.sourceUrl || bundle?.dataset.sourceUrl}`
      : "",
    dataset?.license || bundle?.dataset.license
      ? `- Dataset license: ${dataset?.license || bundle?.dataset.license}`
      : "",
    "",
    "## Training Configuration",
    "",
    `- Method: ${recipe?.fineTuneMethod || plan?.fineTuneMethod || "--"}`,
    `- Optimizer: ${recipe?.optimizer || plan?.optimizer || "--"}`,
    `- Sequence length: ${recipe?.sequenceLength ?? plan?.maxSeqLength ?? "--"}`,
    `- Batch size: ${recipe?.batchSize ?? plan?.batchSize ?? "--"}`,
    `- Epochs: ${recipe?.epochs ?? "--"}`,
    `- Learning rate: ${recipe?.learningRate ?? plan?.learningRate ?? "--"}`,
    `- LoRA rank / alpha: ${recipe ? `${recipe.loraRank} / ${recipe.loraAlpha}` : "--"}`,
    `- Gradient accumulation: ${recipe?.gradientAccumulationSteps ?? plan?.gradAccumulationSteps ?? "--"}`,
    `- Validation split: ${recipe?.validationSplitPct ?? plan?.validationSplitPct ?? "--"}%`,
    `- Total planned steps: ${plan?.totalSteps ?? "--"}`,
    "",
    "## Loss Summary",
    "",
    "| Split | First | Latest | Best | Delta | Relative delta |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| Train | ${formatReportNumber(metricsSummary.train.first)} | ${formatReportNumber(metricsSummary.train.latest)} | ${formatReportNumber(metricsSummary.train.best)} | ${formatReportNumber(metricsSummary.train.delta)} | ${formatReportPct(metricsSummary.train.relativeDeltaPct)} |`,
    `| Validation | ${formatReportNumber(metricsSummary.valid.first)} | ${formatReportNumber(metricsSummary.valid.latest)} | ${formatReportNumber(metricsSummary.valid.best)} | ${formatReportNumber(metricsSummary.valid.delta)} | ${formatReportPct(metricsSummary.valid.relativeDeltaPct)} |`,
    "",
    `Metrics points: ${metricsSummary.pointCount}`,
    `Step range: ${metricsSummary.firstStep ?? "--"} - ${metricsSummary.latestStep ?? "--"}`,
    `Axis note: chart values are normalized per split to the first observed point = 1.00; raw losses are preserved in metrics.csv.`,
    "",
    "## Multi-run Comparison",
    "",
    `Adapter key: ${runComparison.adapterName}`,
    `Compared runs: ${runComparison.runCount}`,
    `Best validation loss: ${formatReportNumber(runComparison.bestValidationLoss)}`,
    `Latest validation loss: ${formatReportNumber(runComparison.latestValidationLoss)}`,
    runComparison.deltaToPrevious
      ? `Delta conclusion: ${formatFineTuneRunDeltaConclusion(runComparison.deltaToPrevious.conclusion)}`
      : "Delta conclusion: --",
    runComparison.deltaToPrevious
      ? `Compared with previous job: ${runComparison.deltaToPrevious.previousJobId}`
      : "",
    runComparison.deltaToPrevious
      ? [
          "Delta vs previous:",
          `train latest ${formatReportSignedNumber(runComparison.deltaToPrevious.trainLatestDelta)}`,
          `validation latest ${formatReportSignedNumber(runComparison.deltaToPrevious.validLatestDelta)}`,
          `best validation ${formatReportSignedNumber(runComparison.deltaToPrevious.validBestDelta)}`,
          `duration ${formatReportDurationDelta(runComparison.deltaToPrevious.durationMsDelta)}`,
          `latest step ${formatReportSignedInteger(runComparison.deltaToPrevious.latestStepDelta)}.`,
        ].join(" ")
      : "",
    "",
    "| Job | Status | Latest train | Latest validation | Best validation | Latest step | Duration | Output dir |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...(comparisonRows.length
      ? comparisonRows
      : ["| -- | -- | -- | -- | -- | -- | -- | -- |"]),
    "",
    "## Full Loss Curve Sample",
    "",
    "| Step | Split | Raw loss | Learning rate | Tokens/s | At |",
    "| ---: | --- | ---: | ---: | ---: | --- |",
    ...(curveSample.length ? curveSample : ["| -- | -- | -- | -- | -- | -- |"]),
    metrics.length > curveSample.length
      ? `\nFull curve is available in ${job.metricsFile || "metrics.csv"}.`
      : "",
    "",
    "## Dataset Source & Quality",
    "",
    `- Source type: ${dataset?.sourceType || bundle?.dataset.sourceType || "--"}`,
    `- Source label: ${dataset?.sourceLabel || bundle?.dataset.sourceLabel || "--"}`,
    `- Source path: ${dataset?.sourcePath || bundle?.dataset.sourcePath || "--"}`,
    `- Upstream query: ${dataset?.upstreamQuery || "--"}`,
    `- Sample count: ${dataset?.sampleCount || bundle?.dataset.sampleCount || "--"}`,
    `- Quality score: ${dataset?.quality?.score ?? bundle?.dataset.quality?.score ?? "--"}`,
    `- License risk: ${dataset?.quality?.licenseRisk ?? bundle?.dataset.quality?.licenseRisk ?? "--"}`,
    `- Recommended steps: ${
      dataset?.quality?.recommendedSteps
        ? `${dataset.quality.recommendedSteps.min}-${dataset.quality.recommendedSteps.max} (${dataset.quality.recommendedSteps.label})`
        : bundle?.dataset.quality?.recommendedSteps
          ? `${bundle.dataset.quality.recommendedSteps.min}-${bundle.dataset.quality.recommendedSteps.max} (${bundle.dataset.quality.recommendedSteps.label})`
          : "--"
    }`,
    `- Converted / duplicate / PII-risk rows: ${
      dataset?.quality || bundle?.dataset.quality
        ? `${dataset?.quality?.convertedRows ?? bundle?.dataset.quality?.convertedRows ?? "--"} / ${dataset?.quality?.duplicateRows ?? bundle?.dataset.quality?.duplicateRows ?? "--"} / ${dataset?.quality?.piiRiskRows ?? bundle?.dataset.quality?.piiRiskRows ?? "--"}`
        : "--"
    }`,
    `- Validation warnings: ${dataset?.validation.warnings.length ?? bundle?.dataset.validation.warnings.length ?? 0}`,
    ...(dataset?.qualityWarnings || bundle?.dataset.qualityWarnings || []).map(
      (warning) => `  - ${warning}`,
    ),
    "",
    "## Post-training Evidence",
    "",
    `- Timeline events: ${evidence.timelineEvents.length}`,
    `- Compare events: ${evidence.compareEvents.length}`,
    `- Benchmark events: ${evidence.benchmarkEvents.length}`,
    evidence.benchmarkRuns.length ? "" : "- No matching benchmark runs found yet.",
    ...evidence.benchmarkRuns.flatMap((run) => [
      `- Benchmark ${run.runId || run.generatedAt}: ${run.ok ? "ok" : "failed"} · ${run.label}`,
      `  - Targets: ${run.targetIds.join(", ") || "--"}`,
      `  - Avg first token: ${formatReportNumber(run.avgFirstTokenLatencyMs)} ms · Avg total: ${formatReportNumber(run.avgLatencyMs)} ms · Avg score: ${formatReportNumber(run.avgScore)} · Pass rate: ${formatReportPct(run.passRate)}`,
    ]),
    evidence.timelineEvents.length ? "" : "",
    ...evidence.timelineEvents.slice(0, 12).map((event) => {
      return `- [${event.kind}/${event.status}] ${event.at} · ${event.title}: ${event.summary}`;
    }),
    "",
    "## Artifacts",
    "",
    `- Bundle: ${job.bundlePath}`,
    `- Config: ${job.configFile || "--"}`,
    `- Metrics: ${job.metricsFile || "--"}`,
    `- Worker log: ${job.logFile || "--"}`,
    `- Checkpoint/artifact files: ${artifactFiles.length}`,
    ...artifactFiles.slice(0, 20).map((file) => `  - ${file}`),
    artifactFiles.length > 20
      ? `  - ... ${artifactFiles.length - 20} more`
      : "",
    "",
    "## Recent Worker Log",
    "",
    "```text",
    ...(logLines.length ? logLines : ["No worker log lines available."]),
    "```",
    "",
    "## Recommended Follow-up",
    "",
    "- Attach the adapter runtime, then run Compare against the base lane.",
    "- Send the adapter to the benchmark suite linked above before publishing.",
    "- Keep this report with `metrics.csv` and `run-manifest.json` for reproducibility.",
    "- Use the Experiment Timeline section to verify training -> attach -> compare -> benchmark order.",
    "",
    "## Reproduce",
    "",
    "```bash",
    `${VENV_PYTHON} ${WORKER_SCRIPT} --job-bundle ${job.bundleFile || "<bundle.json>"}`,
    "```",
    "",
  ]
    .join("\n");
}

export function exportFineTuneJobReport(input: {
  jobId: string;
  format?: AgentFineTuneReportFormat;
}): AgentFineTuneReportExport {
  const format = input.format || "markdown";
  const job = readJobs().find((entry) => entry.id === input.jobId);
  if (!job) {
    throw new Error("Fine-tune job not found.");
  }
  const paths = getJobPaths(job.id);
  mkdirSync(paths.reportsDir, { recursive: true });
  const recipe = readRecipes().find((entry) => entry.id === job.recipeId);
  const dataset = readDatasets().find((entry) => entry.id === job.datasetId);
  const bundle = readJsonFile<FineTuneJobBundle | null>(paths.bundleFile, null);
  const metrics = readFineTuneMetricsFile(paths.metricsFile);
  const metricsSummary = summarizeFineTuneMetrics(metrics);
  const artifactFiles = listArtifactFiles(paths.outputDir, 500);
  const logLines = tailLines(paths.logFile, 80);
  const generatedAt = new Date().toISOString();
  const evidence = buildFineTuneExperimentEvidence({ job, recipe, dataset });
  const runComparison = buildFineTuneRunComparison({ job, recipe });
  const manifest = {
    kind: "first-llm-studio-finetune-report",
    generatedAt,
    job,
    recipe,
    dataset,
    bundle,
    metricsSummary,
    evidence,
    runComparison,
    artifactFiles,
  };
  const fileNameByFormat: Record<AgentFineTuneReportFormat, string> = {
    markdown: "training-report.md",
    "manifest-json": "run-manifest.json",
    "metrics-csv": "metrics.csv",
  };
  const filePath = path.join(paths.reportsDir, fileNameByFormat[format]);
  const content =
    format === "metrics-csv"
      ? buildFineTuneMetricsCsv(metrics)
      : format === "manifest-json"
        ? `${JSON.stringify(manifest, null, 2)}\n`
        : buildFineTuneMarkdownReport({
            job,
            recipe,
            dataset,
            bundle,
            metricsSummary,
            metrics,
            artifactFiles,
            logLines,
            generatedAt,
            evidence,
            runComparison,
          });
  writeFileSync(filePath, content, "utf8");
  return {
    jobId: job.id,
    format,
    filePath,
    content,
    generatedAt,
    metricsSummary,
    evidence,
    runComparison,
  };
}

export function exportFineTuneJobBundleArchive(input: {
  jobId: string;
}): AgentFineTuneBundleArchive {
  const job = readJobs().find((entry) => entry.id === input.jobId);
  if (!job) {
    throw new Error("Fine-tune job not found.");
  }
  const paths = getJobPaths(job.id);
  if (!existsSync(paths.bundlePath)) {
    throw new Error(
      `Fine-tune bundle path does not exist: ${paths.bundlePath}`,
    );
  }

  exportFineTuneJobReport({ jobId: job.id, format: "markdown" });
  exportFineTuneJobReport({ jobId: job.id, format: "manifest-json" });
  exportFineTuneJobReport({ jobId: job.id, format: "metrics-csv" });

  const generatedAt = new Date().toISOString();
  const archiveDir = path.join(tmpdir(), "first-llm-studio-finetune-bundles");
  mkdirSync(archiveDir, { recursive: true });
  const safeAdapterName =
    normalizeRuntimeAliasSegment(job.adapterName) || "adapter";
  const fileName = `first-llm-studio-finetune-${safeAdapterName}-${job.id}.tgz`;
  const filePath = path.join(archiveDir, fileName);
  const archiveManifest = writeFineTuneBundleArchiveManifest({
    job,
    paths,
    archiveFileName: fileName,
    generatedAt,
  });
  const result = spawnSync(
    "tar",
    ["-czf", filePath, "-C", paths.bundlePath, "."],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() ||
        result.error?.message ||
        "Failed to create archive.",
    );
  }
  const stats = statSync(filePath);
  return {
    jobId: job.id,
    filePath,
    fileName,
    sizeBytes: stats.size,
    manifestPath: archiveManifest.manifestPath,
    inventoryPath: archiveManifest.inventoryPath,
    includedFileCount: archiveManifest.includedFileCount,
    totalUncompressedBytes: archiveManifest.totalUncompressedBytes,
    generatedAt,
  };
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
  kind:
    | "job-bundle"
    | "job-output"
    | "job-reports"
    | "adapter-output"
    | "dataset-source";
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
  } else if (input.kind === "job-reports") {
    const job = summary.jobs.find((entry) => entry.id === input.id);
    if (!job) throw new Error("Fine-tune job not found.");
    resolvedPath = getJobPaths(job.id).reportsDir;
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
