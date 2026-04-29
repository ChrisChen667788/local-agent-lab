import crypto from "crypto";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statfsSync, writeFileSync } from "fs";
import { getLocalAgentDataPath } from "@/lib/agent/data-dir";
import { listServerAgentTargets, syncDiscoveredLocalTargetsFromGateway } from "@/lib/agent/server-targets";
import type {
  CommunityHardwareProfile,
  CommunityModelArtifactKind,
  CommunityModelCandidate,
  CommunityModelDiscoverySummary,
  CommunityModelInstallCheck,
  CommunityModelInstallJob,
  CommunityModelInstallPreflight,
  CommunityModelInstallSupport,
  CommunityModelInstallVerification,
  CommunityModelRecommendation,
  CommunityModelSource
} from "@/lib/community/types";

const COMMUNITY_DIR = getLocalAgentDataPath("community");
const SCAN_CACHE_FILE = path.join(COMMUNITY_DIR, "model-discovery-cache.json");
const JOBS_FILE = path.join(COMMUNITY_DIR, "model-install-jobs.json");
const JOBS_DIR = path.join(COMMUNITY_DIR, "model-install-jobs");
const INSTALL_ROOT = process.env.COMMUNITY_MODEL_INSTALL_ROOT?.trim() || path.join(os.homedir(), ".lmstudio", "models");
const INSTALLER_SCRIPT = path.join(process.cwd(), "scripts", "community_model_installer.py");
const VENV_PYTHON = path.join(process.cwd(), ".venv", "bin", "python");
const MAX_SCAN_CANDIDATES = 18;
const MODEL_SCOPE_PAGE_SIZE = 8;
const HUGGING_FACE_PAGE_SIZE = 8;
const GITHUB_PAGE_SIZE = 6;

type CommunityScanCache = {
  generatedAt: string;
  query: string;
  installRoot: string;
  hardware: CommunityHardwareProfile;
  candidates: Array<Omit<CommunityModelCandidate, "preflight"> & { preflight?: CommunityModelInstallPreflight | null }>;
};

type CommunityModelInstallRuntimeState = Partial<CommunityModelInstallJob> & {
  launcherPid?: number | null;
};

type ModelScopeModelRecord = {
  Path?: string;
  Name?: string;
  ChineseName?: string;
  Description?: string;
  ReadMeContent?: string;
  LastUpdatedTime?: number;
  Tags?: string[];
  Libraries?: string[];
  Frameworks?: string[];
  StorageSize?: number;
  Downloads?: number;
  Stars?: number;
  Likes?: number;
  RelatedArxivId?: string[];
};

type HuggingFaceModelRecord = {
  id?: string;
  modelId?: string;
  description?: string;
  lastModified?: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  pipeline_tag?: string;
  library_name?: string;
  cardData?: {
    summary?: string;
    papers?: Array<{ url?: string; paper_url?: string }>;
    paper?: { url?: string; paper_url?: string };
  };
};

type GitHubRepoRecord = {
  full_name?: string;
  name?: string;
  description?: string;
  html_url?: string;
  homepage?: string | null;
  updated_at?: string;
  stargazers_count?: number;
  topics?: string[];
  archived?: boolean;
  size?: number;
};

function ensureCommunityDir() {
  mkdirSync(COMMUNITY_DIR, { recursive: true });
  mkdirSync(JOBS_DIR, { recursive: true });
  mkdirSync(INSTALL_ROOT, { recursive: true });
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
  ensureCommunityDir();
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function truncateText(value: string | undefined, maxLength = 180) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function extractParameterScale(...values: Array<string | undefined>) {
  const joined = values.filter(Boolean).join(" ");
  const matched = joined.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  if (!matched) return undefined;
  return `${matched[1]}B`;
}

function parseScaleValue(scale?: string) {
  if (!scale) return null;
  const matched = scale.match(/(\d+(?:\.\d+)?)/);
  if (!matched) return null;
  const value = Number(matched[1]);
  return Number.isFinite(value) ? value : null;
}

function extractQuantizationLabel(...values: Array<string | undefined | string[]>) {
  const parts = values
    .flatMap((value) => (Array.isArray(value) ? value : typeof value === "string" ? [value] : []))
    .join(" ")
    .toLowerCase();
  const bitMatch = parts.match(/\b(q?)(\d+)\s*bit\b|\b(q?)(\d+)bit\b/);
  const bitValue = bitMatch?.[2] || bitMatch?.[4];
  const labels: string[] = [];
  if (bitValue) labels.push(`${bitValue}-bit`);
  if (/\bqat\b/.test(parts)) labels.push("QAT");
  if (/\bgguf\b/.test(parts) && !labels.includes("GGUF")) labels.push("GGUF");
  if (/\bmlx\b/.test(parts) && !labels.includes("MLX")) labels.push("MLX");
  return labels.length ? labels.join(" · ") : undefined;
}

function inferRecommendedContextWindow(scale?: string) {
  const value = parseScaleValue(scale);
  if (value === null) return null;
  if (value <= 1) return 8192;
  if (value <= 4) return 16384;
  if (value <= 8) return 32768;
  return 65536;
}

function parseQuantBits(quantizationLabel?: string) {
  if (!quantizationLabel) return null;
  const matched = quantizationLabel.match(/(\d+)-bit/i);
  if (!matched) return null;
  const value = Number(matched[1]);
  return Number.isFinite(value) ? value : null;
}

function estimateFootprintGb(scale?: string, quantizationLabel?: string, storageSizeBytes?: number | null) {
  if (typeof storageSizeBytes === "number" && Number.isFinite(storageSizeBytes) && storageSizeBytes > 0) {
    return storageSizeBytes / (1024 ** 3);
  }
  const scaleValue = parseScaleValue(scale);
  if (scaleValue === null) return null;
  const quantBits = parseQuantBits(quantizationLabel) || (scaleValue <= 4 ? 8 : 16);
  const bytes = scaleValue * 1_000_000_000 * (quantBits / 8) * 1.12;
  return bytes / (1024 ** 3);
}

function isAppleSilicon(hardware: CommunityHardwareProfile) {
  return hardware.platform === "darwin" && hardware.arch === "arm64";
}

function computeHardwareProfile(): CommunityHardwareProfile {
  ensureCommunityDir();
  return {
    platform: os.platform(),
    arch: os.arch(),
    cpuCount: os.cpus().length,
    totalMemoryGb: Number((os.totalmem() / (1024 ** 3)).toFixed(1)),
    installRoot: INSTALL_ROOT
  };
}

function looksLocalFriendly(candidate: {
  source: CommunityModelSource;
  repoId: string;
  tags: string[];
  quantizationLabel?: string;
}) {
  const joined = `${candidate.repoId} ${candidate.tags.join(" ")} ${candidate.quantizationLabel || ""}`.toLowerCase();
  return /mlx|gguf|4-bit|8-bit|awq|gptq|quant|qat|apple-silicon/.test(joined);
}

function buildRecommendation(input: {
  hardware: CommunityHardwareProfile;
  source: CommunityModelSource;
  repoId: string;
  tags: string[];
  installSupport: CommunityModelInstallSupport;
  parameterScale?: string;
  quantizationLabel?: string;
  estimatedFootprintGb?: number | null;
}) {
  const localFriendly = looksLocalFriendly(input);
  const footprint = input.estimatedFootprintGb ?? null;
  const recommendedBudgetGb = input.hardware.totalMemoryGb * 0.42;
  const riskyBudgetGb = input.hardware.totalMemoryGb * 0.7;

  if (input.installSupport === "source-only") {
    return {
      recommendation: "not-recommended" as CommunityModelRecommendation,
      reason: "This source only exposes a reference page right now, not a reliable one-click local install."
    };
  }

  if (input.source === "github" && !localFriendly) {
    return {
      recommendation: "risky" as CommunityModelRecommendation,
      reason: "GitHub repos often bundle code or conversion scripts instead of ready-to-load local weights."
    };
  }

  if (footprint !== null) {
    if (footprint > riskyBudgetGb) {
      return {
        recommendation: "not-recommended" as CommunityModelRecommendation,
        reason: `Estimated footprint ${footprint.toFixed(1)} GB is too close to or beyond this machine's safe local budget.`
      };
    }
    if (!localFriendly || footprint > recommendedBudgetGb) {
      return {
        recommendation: "risky" as CommunityModelRecommendation,
        reason: `Installable, but ${footprint.toFixed(1)} GB likely needs a quieter desktop session or extra setup.`
      };
    }
    return {
      recommendation: "recommended" as CommunityModelRecommendation,
      reason: `Looks aligned with this machine's ${input.hardware.totalMemoryGb.toFixed(1)} GB memory budget and local-friendly weight formats.`
    };
  }

  if (localFriendly) {
    return {
      recommendation: "risky" as CommunityModelRecommendation,
      reason: "The format looks locally compatible, but the upstream page does not expose enough size metadata yet."
    };
  }

  if (isAppleSilicon(input.hardware) && input.source !== "github") {
    return {
      recommendation: "risky" as CommunityModelRecommendation,
      reason: "This may still work locally, but it does not clearly advertise MLX, GGUF, or quantized weights."
    };
  }

  return {
    recommendation: "not-recommended" as CommunityModelRecommendation,
    reason: "Not enough evidence that this source is a smooth fit for the current local runtime."
  };
}

function buildInstallDir(source: CommunityModelSource, repoId: string) {
  const [owner, name] = repoId.includes("/") ? repoId.split("/", 2) : [source, repoId];
  return path.join(INSTALL_ROOT, slugify(owner), slugify(name));
}

function inferArtifactKind(input: {
  source: CommunityModelSource;
  repoId: string;
  label: string;
  summary: string;
  tags: string[];
  installSupport: CommunityModelInstallSupport;
}) {
  const haystack = [
    input.repoId,
    input.label,
    input.summary,
    input.tags.join(" "),
    input.installSupport
  ]
    .join(" ")
    .toLowerCase();

  if (/\b(dataset|corpus|jsonl|parquet|sft|dpo|preference|instruction[-\s]?data|sharegpt)\b/.test(haystack)) {
    return "dataset" as CommunityModelArtifactKind;
  }

  if (input.source === "github") {
    if (/\b(server|runtime|framework|tool|trainer|cli|app|agent|benchmark|convert|quantiz|deploy|rag|lab|studio|worker|inference)\b/.test(haystack)) {
      return "code" as CommunityModelArtifactKind;
    }
    return input.installSupport === "best-effort" ? "code" as CommunityModelArtifactKind : "weights" as CommunityModelArtifactKind;
  }

  return "weights" as CommunityModelArtifactKind;
}

function inferArtifactKindLabel(kind: CommunityModelArtifactKind) {
  switch (kind) {
    case "weights":
      return "Weight repo";
    case "code":
      return "Code repo";
    case "dataset":
      return "Dataset repo";
    default:
      return "Repo";
  }
}

function directoryHasFiles(dirPath: string) {
  if (!existsSync(dirPath)) return false;
  try {
    return readdirSync(dirPath).length > 0;
  } catch {
    return false;
  }
}

function countFilesRecursive(dirPath: string, limit = 5000) {
  if (!existsSync(dirPath)) return 0;
  let count = 0;
  const stack = [dirPath];
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
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      } else {
        count += 1;
        if (count >= limit) {
          return count;
        }
      }
    }
  }
  return count;
}

function getAvailableDiskBytes(rootPath: string) {
  try {
    const stats = statfsSync(rootPath);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

function buildInstallPreflight(input: {
  hardware: CommunityHardwareProfile;
  candidate: Omit<CommunityModelCandidate, "preflight">;
}): CommunityModelInstallPreflight {
  const { hardware, candidate } = input;
  const checks: CommunityModelInstallCheck[] = [];
  const existingDir = directoryHasFiles(candidate.installDir);
  const availableDiskBytes = getAvailableDiskBytes(INSTALL_ROOT);
  const requiredDiskBytes =
    typeof candidate.storageSizeBytes === "number" && Number.isFinite(candidate.storageSizeBytes)
      ? candidate.storageSizeBytes
      : typeof candidate.estimatedFootprintGb === "number" && Number.isFinite(candidate.estimatedFootprintGb)
        ? Math.round(candidate.estimatedFootprintGb * 1024 ** 3)
        : null;

  checks.push({
    key: "install-support",
    label: "Install support",
    status:
      candidate.installSupport === "source-only"
        ? "fail"
        : candidate.installSupport === "best-effort"
          ? "warn"
          : "pass",
    summary:
      candidate.installSupport === "direct"
        ? "Direct installer path is available."
        : candidate.installSupport === "best-effort"
          ? "Installer can fetch the repo, but local weight readiness may still need manual follow-up."
          : "Only a source page is available right now."
  });

  checks.push({
    key: "install-dir",
    label: "Install directory",
    status: existingDir ? "fail" : "pass",
    summary: existingDir
      ? `Install directory already contains files: ${candidate.installDir}`
      : `Install directory is clear: ${candidate.installDir}`
  });

  checks.push({
    key: "memory-fit",
    label: "Memory fit",
    status:
      candidate.recommendation === "not-recommended"
        ? "warn"
        : candidate.recommendation === "risky"
          ? "warn"
          : "pass",
    summary: candidate.recommendationReason
  });

  if (requiredDiskBytes !== null && availableDiskBytes !== null) {
    checks.push({
      key: "disk-budget",
      label: "Disk budget",
      status: requiredDiskBytes > availableDiskBytes * 0.92 ? "fail" : requiredDiskBytes > availableDiskBytes * 0.6 ? "warn" : "pass",
      summary: `Needs about ${(requiredDiskBytes / (1024 ** 3)).toFixed(1)} GB, with ${(availableDiskBytes / (1024 ** 3)).toFixed(1)} GB currently free.`
    });
  } else {
    checks.push({
      key: "disk-budget",
      label: "Disk budget",
      status: "warn",
      summary: "Could not read a reliable disk estimate, so install size should be reviewed manually."
    });
  }

  const failCount = checks.filter((check) => check.status === "fail").length;
  const warnCount = checks.filter((check) => check.status === "warn").length;
  return {
    checkedAt: new Date().toISOString(),
    status: failCount ? "blocked" : warnCount ? "risky" : "ready",
    summary: failCount
      ? "Install is blocked until the failing checks are resolved."
      : warnCount
        ? "Install can proceed, but one or more checks still need attention."
        : "Install looks safe for this machine and target directory.",
    requiredDiskBytes,
    availableDiskBytes,
    checks
  };
}

function buildInstallVerification(job: CommunityModelInstallJob) {
  const localTargets = listServerAgentTargets().filter((target) => target.execution === "local");
  const discoveredTargetIds = localTargets
    .filter((target) => {
      const sourcePath = target.sourcePath?.trim();
      return Boolean(
        target.sourceRepoId === job.repoId ||
          (sourcePath && sourcePath.startsWith(job.installDir))
      );
    })
    .map((target) => target.id);
  const installDirExists = existsSync(job.installDir);
  const installedFileCount = installDirExists ? countFilesRecursive(job.installDir) : 0;
  const status: CommunityModelInstallVerification["status"] =
    discoveredTargetIds.length > 0
      ? "verified"
      : installDirExists && installedFileCount > 0
        ? "partial"
        : "missing";
  const artifactLabel = inferArtifactKindLabel(job.artifactKind);
  return {
    checkedAt: new Date().toISOString(),
    status,
    summary:
      status === "verified"
        ? `Install was verified and exposed ${discoveredTargetIds.length} local target(s).`
        : status === "partial"
          ? job.artifactKind === "code"
            ? `${artifactLabel} files are present. This is expected for code repos until they fetch or produce runnable weights and register a local target.`
            : job.artifactKind === "dataset"
              ? `${artifactLabel} files are present. Dataset repos are not expected to appear as local inference targets.`
              : `${artifactLabel} files are present, but the local gateway has not exposed this model as a usable target yet.`
          : job.artifactKind === "dataset"
            ? `${artifactLabel} files are missing, so the dataset install should be treated as incomplete.`
            : `Expected ${artifactLabel.toLowerCase()} files are missing, so the install should be treated as incomplete.`,
    installDirExists,
    installedFileCount,
    discoveredTargetIds
  } satisfies CommunityModelInstallVerification;
}

function uniqueTags(...groups: Array<string[] | undefined>) {
  return Array.from(
    new Set(
      groups
        .flatMap((group) => group || [])
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).slice(0, 10);
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function buildCandidateId(source: CommunityModelSource, repoId: string) {
  return `${source}:${repoId.toLowerCase()}`;
}

function buildCandidate(input: {
  hardware: CommunityHardwareProfile;
  source: CommunityModelSource;
  label: string;
  repoId: string;
  repoUrl: string;
  docsUrl?: string;
  paperUrl?: string;
  summary: string;
  updatedAt?: string;
  parameterScale?: string;
  quantizationLabel?: string;
  tags: string[];
  downloads?: number | null;
  likes?: number | null;
  stars?: number | null;
  storageSizeBytes?: number | null;
  installSupport: CommunityModelInstallSupport;
}): CommunityModelCandidate {
  const estimatedFootprintGb = estimateFootprintGb(
    input.parameterScale,
    input.quantizationLabel,
    input.storageSizeBytes
  );
  const recommendation = buildRecommendation({
    hardware: input.hardware,
    source: input.source,
    repoId: input.repoId,
    tags: input.tags,
    installSupport: input.installSupport,
    parameterScale: input.parameterScale,
    quantizationLabel: input.quantizationLabel,
    estimatedFootprintGb
  });
  const baseCandidate = {
    id: buildCandidateId(input.source, input.repoId),
    source: input.source,
    artifactKind: inferArtifactKind({
      source: input.source,
      repoId: input.repoId,
      label: input.label,
      summary: input.summary,
      tags: input.tags,
      installSupport: input.installSupport
    }),
    label: input.label,
    repoId: input.repoId,
    repoUrl: input.repoUrl,
    docsUrl: input.docsUrl,
    paperUrl: input.paperUrl,
    summary: truncateText(input.summary, 220) || "Upstream page available. Review the source card before local install.",
    updatedAt: input.updatedAt,
    parameterScale: input.parameterScale,
    quantizationLabel: input.quantizationLabel,
    recommendedContextWindow: inferRecommendedContextWindow(input.parameterScale),
    installSupport: input.installSupport,
    recommendation: recommendation.recommendation,
    recommendationReason: recommendation.reason,
    tags: input.tags,
    downloads: input.downloads ?? null,
    likes: input.likes ?? null,
    stars: input.stars ?? null,
    storageSizeBytes: input.storageSizeBytes ?? null,
    estimatedFootprintGb,
    installDir: buildInstallDir(input.source, input.repoId)
  } satisfies Omit<CommunityModelCandidate, "preflight">;
  return {
    ...baseCandidate,
    preflight: buildInstallPreflight({
      hardware: input.hardware,
      candidate: baseCandidate
    })
  } satisfies CommunityModelCandidate;
}

function normalizeCachedCandidate(
  hardware: CommunityHardwareProfile,
  candidate: Omit<CommunityModelCandidate, "preflight"> & { preflight?: CommunityModelInstallPreflight | null }
): CommunityModelCandidate {
  const normalizedCandidate = {
    ...candidate,
    artifactKind:
      candidate.artifactKind ||
      inferArtifactKind({
        source: candidate.source,
        repoId: candidate.repoId,
        label: candidate.label,
        summary: candidate.summary,
        tags: candidate.tags,
        installSupport: candidate.installSupport
      }),
    installDir: buildInstallDir(candidate.source, candidate.repoId)
  } satisfies Omit<CommunityModelCandidate, "preflight">;
  return {
    ...normalizedCandidate,
    preflight: buildInstallPreflight({
      hardware,
      candidate: normalizedCandidate
    })
  } satisfies CommunityModelCandidate;
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function scanHuggingFace(query: string, hardware: CommunityHardwareProfile) {
  const url = new URL("https://huggingface.co/api/models");
  url.searchParams.set("search", query || "mlx");
  url.searchParams.set("limit", String(HUGGING_FACE_PAGE_SIZE));
  url.searchParams.set("sort", "lastModified");
  url.searchParams.set("direction", "-1");
  const payload = await fetchJson<HuggingFaceModelRecord[]>(url.toString(), {
    headers: {
      "User-Agent": "FirstLLMStudio/0.3"
    },
    cache: "no-store"
  });
  return payload
    .map((entry) => {
      const repoId = entry.id || entry.modelId;
      if (!repoId) return null;
      const label = repoId.split("/").pop() || repoId;
      const tags = uniqueTags(entry.tags, entry.library_name ? [entry.library_name] : undefined, entry.pipeline_tag ? [entry.pipeline_tag] : undefined);
      return buildCandidate({
        hardware,
        source: "huggingface",
        label,
        repoId,
        repoUrl: `https://huggingface.co/${repoId}`,
        docsUrl: `https://huggingface.co/${repoId}`,
        paperUrl:
          entry.cardData?.paper?.url ||
          entry.cardData?.paper?.paper_url ||
          entry.cardData?.papers?.[0]?.url ||
          entry.cardData?.papers?.[0]?.paper_url,
        summary: entry.description || entry.cardData?.summary || `${label} · ${tags.join(" · ")}`,
        updatedAt: entry.lastModified,
        parameterScale: extractParameterScale(repoId, entry.description, tags.join(" ")),
        quantizationLabel: extractQuantizationLabel(repoId, entry.description, tags),
        tags,
        downloads: typeof entry.downloads === "number" ? entry.downloads : null,
        likes: typeof entry.likes === "number" ? entry.likes : null,
        installSupport: "direct"
      });
    })
    .filter(isDefined);
}

async function scanGitHub(query: string, hardware: CommunityHardwareProfile) {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `${query || "mlx"} llm model in:name,description,topics`);
  url.searchParams.set("sort", "updated");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(GITHUB_PAGE_SIZE));
  const payload = await fetchJson<{ items?: GitHubRepoRecord[] }>(url.toString(), {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "FirstLLMStudio/0.3"
    },
    cache: "no-store"
  });
  return (payload.items || [])
    .map((entry) => {
      if (!entry.full_name || !entry.html_url) return null;
      const tags = uniqueTags(entry.topics, entry.archived ? ["archived"] : undefined);
      return buildCandidate({
        hardware,
        source: "github",
        label: entry.name || entry.full_name.split("/").pop() || entry.full_name,
        repoId: entry.full_name,
        repoUrl: entry.html_url,
        docsUrl: entry.homepage || entry.html_url,
        summary: entry.description || `${entry.full_name} · ${tags.join(" · ")}`,
        updatedAt: entry.updated_at,
        parameterScale: extractParameterScale(entry.full_name, entry.description, tags.join(" ")),
        quantizationLabel: extractQuantizationLabel(entry.full_name, entry.description, tags),
        tags,
        stars: typeof entry.stargazers_count === "number" ? entry.stargazers_count : null,
        storageSizeBytes:
          typeof entry.size === "number" && Number.isFinite(entry.size) ? entry.size * 1024 : null,
        installSupport: "best-effort"
      });
    })
    .filter(isDefined);
}

async function scanModelScope(query: string, hardware: CommunityHardwareProfile) {
  const payload = await fetchJson<{
    Data?: { Models?: ModelScopeModelRecord[] };
  }>("https://www.modelscope.cn/api/v1/models/", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "FirstLLMStudio/0.3"
    },
    body: JSON.stringify({
      Path: query || "mlx",
      PageNumber: 1,
      PageSize: MODEL_SCOPE_PAGE_SIZE
    }),
    cache: "no-store"
  });
  return (payload.Data?.Models || [])
    .map((entry) => {
      if (!entry.Path || !entry.Name) return null;
      const repoId = `${entry.Path}/${entry.Name}`;
      const tags = uniqueTags(entry.Tags, entry.Libraries, entry.Frameworks);
      const label = entry.ChineseName?.trim() || entry.Name;
      const paperId = Array.isArray(entry.RelatedArxivId) ? entry.RelatedArxivId.find(Boolean) : undefined;
      return buildCandidate({
        hardware,
        source: "modelscope",
        label,
        repoId,
        repoUrl: `https://www.modelscope.cn/models/${repoId}`,
        docsUrl: `https://www.modelscope.cn/models/${repoId}`,
        paperUrl: paperId ? `https://arxiv.org/abs/${paperId}` : undefined,
        summary: entry.Description || entry.ReadMeContent || `${label} · ${tags.join(" · ")}`,
        updatedAt:
          typeof entry.LastUpdatedTime === "number"
            ? new Date(entry.LastUpdatedTime * 1000).toISOString()
            : undefined,
        parameterScale: extractParameterScale(repoId, entry.ChineseName, entry.Description, tags.join(" ")),
        quantizationLabel: extractQuantizationLabel(repoId, entry.ChineseName, entry.Description, tags),
        tags,
        downloads: typeof entry.Downloads === "number" ? entry.Downloads : null,
        likes: typeof entry.Likes === "number" ? entry.Likes : null,
        stars: typeof entry.Stars === "number" ? entry.Stars : null,
        storageSizeBytes: typeof entry.StorageSize === "number" ? entry.StorageSize : null,
        installSupport: "direct"
      });
    })
    .filter(isDefined);
}

function rankCandidate(candidate: CommunityModelCandidate) {
  const recommendationWeight =
    candidate.recommendation === "recommended" ? 300 : candidate.recommendation === "risky" ? 180 : 80;
  const supportWeight =
    candidate.installSupport === "direct" ? 80 : candidate.installSupport === "best-effort" ? 35 : 0;
  const localFriendlyWeight = looksLocalFriendly(candidate) ? 45 : 0;
  const socialWeight =
    (candidate.downloads || 0) / 5000 + (candidate.likes || 0) / 100 + (candidate.stars || 0) / 100;
  const freshnessWeight = candidate.updatedAt ? Date.parse(candidate.updatedAt) / 1_000_000_000_000 : 0;
  return recommendationWeight + supportWeight + localFriendlyWeight + socialWeight + freshnessWeight;
}

function dedupeAndRankCandidates(candidates: CommunityModelCandidate[]) {
  const byId = new Map<string, CommunityModelCandidate>();
  for (const candidate of candidates) {
    const current = byId.get(candidate.id);
    if (!current || rankCandidate(candidate) > rankCandidate(current)) {
      byId.set(candidate.id, candidate);
    }
  }
  return [...byId.values()]
    .sort((left, right) => rankCandidate(right) - rankCandidate(left))
    .slice(0, MAX_SCAN_CANDIDATES);
}

function expandModelQueries(queryInput: string) {
  const query = queryInput.trim() || "mlx";
  const queries = [query];
  if (!/\b(mlx|gguf|4bit|8bit|quant|qat)\b/i.test(query)) {
    queries.push(`${query} mlx`, `${query} 4bit`, `${query} gguf`);
  }
  return Array.from(new Set(queries.map((item) => item.trim()).filter(Boolean))).slice(0, 4);
}

function readScanCache() {
  return readJsonFile<CommunityScanCache | null>(SCAN_CACHE_FILE, null);
}

function writeScanCache(cache: CommunityScanCache) {
  writeJsonFile(SCAN_CACHE_FILE, cache);
}

function getInstallJobPaths(jobId: string) {
  const jobDir = path.join(JOBS_DIR, jobId);
  return {
    jobDir,
    jobFile: path.join(jobDir, "job.json"),
    stateFile: path.join(jobDir, "state.json"),
    logFile: path.join(jobDir, "install.log")
  };
}

function readStoredJobs() {
  return readJsonFile<CommunityModelInstallJob[]>(JOBS_FILE, []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function writeStoredJobs(jobs: CommunityModelInstallJob[]) {
  writeJsonFile(JOBS_FILE, jobs);
}

function readInstallRuntimeState(jobId: string) {
  const { stateFile } = getInstallJobPaths(jobId);
  return readJsonFile<CommunityModelInstallRuntimeState | null>(stateFile, null);
}

function writeInstallRuntimeState(jobId: string, patch: CommunityModelInstallRuntimeState) {
  const { stateFile } = getInstallJobPaths(jobId);
  const current = readInstallRuntimeState(jobId) || {};
  writeJsonFile(stateFile, {
    ...current,
    ...patch,
    updatedAt: patch.updatedAt || new Date().toISOString()
  });
}

function mergeInstallJobState(job: CommunityModelInstallJob) {
  const paths = getInstallJobPaths(job.id);
  const runtime = readInstallRuntimeState(job.id) || {};
  const artifactKind =
    job.artifactKind ||
    inferArtifactKind({
      source: job.source,
      repoId: job.repoId,
      label: job.label,
      summary: job.latestMessage || job.errorMessage || job.label,
      tags: [],
      installSupport: job.source === "github" ? "best-effort" : "direct"
    });
  return {
    ...job,
    artifactKind,
    logFile: paths.logFile,
    stateFile: paths.stateFile,
    status: runtime.status || job.status,
    updatedAt: runtime.updatedAt || job.updatedAt,
    startedAt: runtime.startedAt || job.startedAt,
    completedAt: runtime.completedAt || job.completedAt,
    latestMessage: runtime.latestMessage || job.latestMessage,
    errorMessage: runtime.errorMessage || job.errorMessage,
    launcherPid: typeof runtime.launcherPid === "number" ? runtime.launcherPid : job.launcherPid,
    discoveredTargetIds: Array.isArray(runtime.discoveredTargetIds) ? runtime.discoveredTargetIds : job.discoveredTargetIds,
    rollbackPerformed:
      typeof runtime.rollbackPerformed === "boolean" ? runtime.rollbackPerformed : job.rollbackPerformed,
    preflight: runtime.preflight && typeof runtime.preflight === "object" ? runtime.preflight as CommunityModelInstallPreflight : job.preflight,
    verification:
      runtime.verification && typeof runtime.verification === "object"
        ? runtime.verification as CommunityModelInstallVerification
        : job.verification
  } satisfies CommunityModelInstallJob;
}

function readInstallJobs() {
  return readStoredJobs().map(mergeInstallJobState).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function reconcileInstallJobs() {
  const jobs = readInstallJobs();
  const needsVerification = jobs.filter(
    (job) =>
      job.status === "completed" &&
      (!job.verification ||
        job.verification.status !== "verified" ||
        !Array.isArray(job.discoveredTargetIds))
  );
  if (!needsVerification.length) return jobs;
  await syncDiscoveredLocalTargetsFromGateway();
  const nextJobs = jobs.map((job) => {
    if (!needsVerification.some((entry) => entry.id === job.id)) return job;
    const verification = buildInstallVerification(job);
    return {
      ...job,
      discoveredTargetIds: verification.discoveredTargetIds,
      verification,
      updatedAt: new Date().toISOString()
    };
  });
  writeStoredJobs(nextJobs);
  needsVerification.forEach((job) => {
    const verification = buildInstallVerification(job);
    writeInstallRuntimeState(job.id, {
      discoveredTargetIds: verification.discoveredTargetIds,
      verification,
      latestMessage: verification.summary
    });
  });
  return readInstallJobs();
}

export async function readCommunityModelDiscoverySummary() {
  ensureCommunityDir();
  const cache = readScanCache();
  if (!cache) {
    return scanCommunityModels("mlx");
  }
  const jobs = await reconcileInstallJobs();
  const hardware = computeHardwareProfile();
  const candidates = (cache?.candidates || []).map((candidate) =>
    normalizeCachedCandidate(hardware, candidate)
  );
  if (
    candidates.length !== (cache?.candidates.length || 0) ||
    candidates.some((candidate, index) => cache?.candidates[index]?.preflight == null)
  ) {
    writeScanCache({
      ...cache,
      hardware,
      installRoot: INSTALL_ROOT,
      candidates
    });
  }
  return {
    generatedAt: cache?.generatedAt || new Date().toISOString(),
    query: cache?.query || "mlx",
    hardware,
    installRoot: INSTALL_ROOT,
    candidates,
    jobs
  } satisfies CommunityModelDiscoverySummary;
}

export async function scanCommunityModels(queryInput?: string) {
  ensureCommunityDir();
  const hardware = computeHardwareProfile();
  const query = queryInput?.trim() || "mlx";
  const queries = expandModelQueries(query);
  const settled = await Promise.allSettled([
    ...queries.map((item) => scanHuggingFace(item, hardware)),
    ...queries.slice(0, 3).map((item) => scanGitHub(item, hardware)),
    ...queries.slice(0, 3).map((item) => scanModelScope(item, hardware))
  ]);
  const candidates = dedupeAndRankCandidates([
    ...settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
  ]);
  const cache = {
    generatedAt: new Date().toISOString(),
    query,
    installRoot: INSTALL_ROOT,
    hardware,
    candidates
  } satisfies CommunityScanCache;
  writeScanCache(cache);
  return {
    ...cache,
    jobs: readInstallJobs()
  } satisfies CommunityModelDiscoverySummary;
}

function queueCommunityModelInstall(
  candidate: CommunityModelCandidate,
  sourceScanQuery = "mlx"
) {
  if (!existsSync(VENV_PYTHON)) {
    throw new Error(`Missing Python runtime: ${VENV_PYTHON}`);
  }
  if (!existsSync(INSTALLER_SCRIPT)) {
    throw new Error(`Missing installer script: ${INSTALLER_SCRIPT}`);
  }
  const jobs = readStoredJobs();
  const runtimeJobs = readInstallJobs();
  const existingRunning = runtimeJobs.find(
    (job) => job.candidateId === candidate.id && (job.status === "queued" || job.status === "running")
  );
  if (existingRunning) {
    throw new Error("This model is already being installed.");
  }
  if (candidate.preflight.status === "blocked") {
    throw new Error(candidate.preflight.summary);
  }

  const now = new Date().toISOString();
  const jobId = `community-install-${crypto.randomUUID()}`;
  const paths = getInstallJobPaths(jobId);
  mkdirSync(paths.jobDir, { recursive: true });
  const job: CommunityModelInstallJob = {
    id: jobId,
    candidateId: candidate.id,
    source: candidate.source,
    artifactKind: candidate.artifactKind,
    label: candidate.label,
    repoId: candidate.repoId,
    repoUrl: candidate.repoUrl,
    installDir: candidate.installDir,
    createdAt: now,
    updatedAt: now,
    status: "queued",
    latestMessage: "Install queued.",
    logFile: paths.logFile,
    stateFile: paths.stateFile,
    preflight: candidate.preflight,
    sourceScanQuery
  };
  writeJsonFile(paths.jobFile, {
    jobId,
    candidate,
    installDir: candidate.installDir,
    logFile: paths.logFile,
    stateFile: paths.stateFile,
    rollbackInstallDirOnFailure: !existsSync(candidate.installDir)
  });
  writeInstallRuntimeState(jobId, {
    status: "queued",
    updatedAt: now,
    latestMessage: "Install queued.",
    preflight: candidate.preflight
  });
  writeStoredJobs([job, ...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));

  const child = spawn(VENV_PYTHON, [INSTALLER_SCRIPT, "--job-file", paths.jobFile], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1"
    },
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  writeInstallRuntimeState(jobId, {
    launcherPid: child.pid ?? null,
    latestMessage: "Installer worker started."
  });
  writeStoredJobs(
    readStoredJobs().map((entry) =>
      entry.id === jobId ? { ...entry, launcherPid: child.pid ?? null, updatedAt: new Date().toISOString() } : entry
    )
  );

  return mergeInstallJobState({
    ...job,
    launcherPid: child.pid ?? null
  });
}

function buildSyntheticCandidateFromJob(job: CommunityModelInstallJob) {
  const hardware = computeHardwareProfile();
  const installSupport: CommunityModelInstallSupport =
    job.source === "github" ? "best-effort" : "direct";
  const baseCandidate = {
    id: job.candidateId,
    source: job.source,
    artifactKind: job.artifactKind,
    label: job.label,
    repoId: job.repoId,
    repoUrl: job.repoUrl,
    summary: `${inferArtifactKindLabel(job.artifactKind)} recovered from install history.`,
    installSupport,
    recommendation: "risky" as CommunityModelRecommendation,
    recommendationReason: "Recovered from install history. Re-run the community scan if you want a fresher upstream card.",
    tags: [job.artifactKind, job.source],
    installDir: job.installDir,
    updatedAt: job.updatedAt
  } satisfies Omit<CommunityModelCandidate, "preflight">;

  return {
    ...baseCandidate,
    preflight: buildInstallPreflight({
      hardware,
      candidate: baseCandidate
    })
  } satisfies CommunityModelCandidate;
}

export function startCommunityModelInstall(input: { candidateId: string }) {
  ensureCommunityDir();
  const cache = readScanCache();
  const hardware = computeHardwareProfile();
  const candidateRecord = cache?.candidates.find((entry) => entry.id === input.candidateId);
  const candidate = candidateRecord ? normalizeCachedCandidate(hardware, candidateRecord) : null;
  if (!candidate) {
    throw new Error("Model candidate not found. Refresh the discovery scan first.");
  }
  return queueCommunityModelInstall(candidate, cache?.query || "mlx");
}

export function retryCommunityModelInstall(input: { jobId: string }) {
  const jobs = readInstallJobs();
  const job = jobs.find((entry) => entry.id === input.jobId);
  if (!job) {
    throw new Error("Install job not found.");
  }
  if (job.status === "queued" || job.status === "running") {
    throw new Error("Install job is still running.");
  }
  rmSync(job.installDir, { recursive: true, force: true });
  const cache = readScanCache();
  const candidateRecord = cache?.candidates.find((entry) => entry.id === job.candidateId);
  const hardware = computeHardwareProfile();
  const candidate = candidateRecord
    ? normalizeCachedCandidate(hardware, candidateRecord)
    : buildSyntheticCandidateFromJob(job);
  return queueCommunityModelInstall(candidate, job.sourceScanQuery || cache?.query || "mlx");
}

export async function cleanCommunityModelInstallDirectory(input: { jobId: string }) {
  const jobs = readInstallJobs();
  const job = jobs.find((entry) => entry.id === input.jobId);
  if (!job) {
    throw new Error("Install job not found.");
  }
  if (job.status === "queued" || job.status === "running") {
    throw new Error("Stop the install job before cleaning its directory.");
  }
  rmSync(job.installDir, { recursive: true, force: true });
  await syncDiscoveredLocalTargetsFromGateway();
  const now = new Date().toISOString();
  writeInstallRuntimeState(job.id, {
    updatedAt: now,
    latestMessage: "Install directory cleaned. Safe to retry.",
    verification: {
      checkedAt: now,
      status: "missing",
      summary: "Install directory was cleaned manually.",
      installDirExists: false,
      installedFileCount: 0,
      discoveredTargetIds: []
    },
    discoveredTargetIds: []
  });
  writeStoredJobs(
    readStoredJobs().map((entry) =>
      entry.id === job.id
        ? {
            ...entry,
            updatedAt: now,
            discoveredTargetIds: [],
            verification: {
              checkedAt: now,
              status: "missing",
              summary: "Install directory was cleaned manually.",
              installDirExists: false,
              installedFileCount: 0,
              discoveredTargetIds: []
            }
          }
        : entry
    )
  );
  return readInstallJobs().find((entry) => entry.id === job.id)!;
}

export function openCommunityModelInstallDirectory(input: { jobId: string }) {
  const job = readInstallJobs().find((entry) => entry.id === input.jobId);
  if (!job) {
    throw new Error("Install job not found.");
  }
  if (!existsSync(job.installDir)) {
    throw new Error("Install directory does not exist yet.");
  }
  const child = spawn("open", [job.installDir], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return {
    jobId: job.id,
    installDir: job.installDir,
    opened: true
  };
}

export async function verifyCommunityModelInstall(input: { jobId: string }) {
  const jobs = readInstallJobs();
  const job = jobs.find((entry) => entry.id === input.jobId);
  if (!job) {
    throw new Error("Install job not found.");
  }
  await syncDiscoveredLocalTargetsFromGateway();
  const verification = buildInstallVerification(job);
  const nextJobs = jobs.map((entry) =>
    entry.id === job.id
      ? {
          ...entry,
          verification,
          discoveredTargetIds: verification.discoveredTargetIds,
          updatedAt: new Date().toISOString()
        }
      : entry
  );
  writeStoredJobs(nextJobs);
  writeInstallRuntimeState(job.id, {
    verification,
    discoveredTargetIds: verification.discoveredTargetIds,
    latestMessage: verification.summary
  });
  return readInstallJobs().find((entry) => entry.id === job.id)!;
}
