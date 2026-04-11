import { basename, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { agentTargets as builtinAgentTargets } from "@/lib/agent/catalog";
import { getLocalAgentDataPath } from "@/lib/agent/data-dir";
import type { AgentTarget } from "@/lib/agent/types";

const DISCOVERED_LOCAL_TARGETS_FILE = getLocalAgentDataPath("discovered-local-targets.json");
const LOCAL_GATEWAY_BASE_URL = (process.env.LOCAL_AGENT_BASE_URL || "http://127.0.0.1:4000/v1").replace(/\/$/, "");

type LocalGatewayModelRecord = {
  id?: string;
  repo?: string;
  repo_id?: string;
  source_path?: string;
  source_kind?: string;
  discovery_root?: string;
};

const BUILTIN_TARGET_IDS = new Set(builtinAgentTargets.map((target) => target.id));
const BUILTIN_TARGET_FINGERPRINTS = new Set(builtinAgentTargets.map((target) => normalizeAliasFingerprint(target.id)));

function ensureRegistryDirectory() {
  mkdirSync(dirname(DISCOVERED_LOCAL_TARGETS_FILE), { recursive: true });
}

function normalizeAliasFingerprint(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeAlias(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toEnvKey(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function looksLikeFilesystemPath(value?: string) {
  if (!value) return false;
  return value.startsWith("/") || value.startsWith("~") || value.startsWith(".");
}

function humanizeLocalModelName(alias: string, modelDescriptor?: string) {
  const source = (modelDescriptor?.split("/").pop() || alias)
    .replace(/[-_]+/g, " ")
    .replace(/\bmlx\b/gi, "MLX")
    .replace(/\bqwen\b/gi, "Qwen")
    .replace(/\bgemma\b/gi, "Gemma")
    .replace(/\bllama\b/gi, "Llama")
    .replace(/\bmistral\b/gi, "Mistral")
    .replace(/\bphi\b/gi, "Phi")
    .replace(/\b4bit\b/gi, "4-bit")
    .replace(/\b8bit\b/gi, "8-bit")
    .replace(/\b(\d+(?:\.\d+)?)b\b/gi, (_, size: string) => `${size}B`)
    .trim();

  const title = source
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (/^[A-Z0-9.-]+$/.test(token)) return token;
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ");

  return title.startsWith("Local ") ? title : `Local ${title}`;
}

function inferParameterScale(alias: string, modelDescriptor?: string) {
  const sizeMatch = `${alias} ${modelDescriptor || ""}`.match(/(\d+(?:\.\d+)?)b/i);
  if (!sizeMatch) return undefined;
  return `${sizeMatch[1]}B`;
}

function inferQuantizationLabel(alias: string, modelDescriptor?: string) {
  const source = `${alias} ${modelDescriptor || ""}`.toLowerCase();
  const parts: string[] = [];
  const bitMatch = source.match(/(\d+)\s*bit|\b(\d+)bit\b/);
  const bitValue = bitMatch?.[1] || bitMatch?.[2];
  if (bitValue) parts.push(`${bitValue}-bit`);
  if (/\bqat\b/.test(source)) parts.push("QAT");
  if (/\bmlx\b/.test(source) && !parts.length) parts.push("MLX");
  return parts.length ? parts.join(" · ") : undefined;
}

function inferRecommendedContextWindow(alias: string, modelDescriptor?: string) {
  const sizeMatch = `${alias} ${modelDescriptor || ""}`.match(/(\d+(?:\.\d+)?)b/i);
  const size = sizeMatch ? Number(sizeMatch[1]) : null;
  if (typeof size === "number" && Number.isFinite(size)) {
    if (size <= 1) return 8192;
    if (size <= 4) return 16384;
    return 32768;
  }
  return null;
}

function inferContextRecommendation(alias: string, modelDescriptor?: string) {
  const recommendedContextWindow = inferRecommendedContextWindow(alias, modelDescriptor);
  if (recommendedContextWindow === 8192) return "4K-8K";
  if (recommendedContextWindow === 16384) return "8K-16K";
  if (recommendedContextWindow === 32768) return "8K-32K";
  return "Depends on model";
}

function inferMemoryProfile(alias: string, modelDescriptor?: string) {
  const sizeMatch = `${alias} ${modelDescriptor || ""}`.match(/(\d+(?:\.\d+)?)b/i);
  const size = sizeMatch ? Number(sizeMatch[1]) : null;
  if (typeof size === "number" && Number.isFinite(size)) {
    if (size <= 1) return "Low memory pressure. Good fit for always-on local use.";
    if (size <= 4) return "Moderate memory pressure. Best used with a cleaner desktop session.";
    return "Higher memory pressure. Prefer loading this when the machine is otherwise quiet.";
  }
  return "Auto-discovered local profile. Check live runtime metrics before keeping it loaded.";
}

function normalizeSourceKind(value?: string): AgentTarget["sourceKind"] | undefined {
  if (value === "configured" || value === "huggingface-cache" || value === "lm-studio" || value === "custom-directory") {
    return value;
  }
  return undefined;
}

function inferSourceLabel(sourceKind?: string) {
  switch (sourceKind) {
    case "configured":
      return "Configured gateway target";
    case "huggingface-cache":
      return "Hugging Face cache";
    case "lm-studio":
      return "LM Studio library";
    case "custom-directory":
      return "Custom model directory";
    default:
      return undefined;
  }
}

function buildSourceNotes(entry: LocalGatewayModelRecord, sourceLabel?: string) {
  const notes: string[] = ["This target was auto-discovered from the local gateway model registry."];
  if (entry.repo_id) {
    notes.push(`Detected repo id: ${entry.repo_id}`);
  }
  if (entry.source_path) {
    notes.push(`Source path: ${entry.source_path}`);
  } else if (sourceLabel) {
    notes.push(`Discovery source: ${sourceLabel}`);
  } else if (entry.repo) {
    notes.push(`Gateway source: ${entry.repo}`);
  } else {
    notes.push("Gateway did not expose a source location for this model.");
  }
  notes.push("If the model stays unloaded, use prewarm or send a chat request to activate it.");
  return notes;
}

function extractLegacySourcePath(notes: string[]) {
  for (const note of notes) {
    const matched = note.match(/^(?:Source path|Gateway repo):\s+(.+)$/i);
    if (matched && looksLikeFilesystemPath(matched[1].trim())) {
      return matched[1].trim();
    }
  }
  return undefined;
}

function extractLegacyRepoId(notes: string[]) {
  for (const note of notes) {
    const matched = note.match(/^(?:Detected repo id|Gateway repo):\s+(.+)$/i);
    if (matched && !looksLikeFilesystemPath(matched[1].trim())) {
      return matched[1].trim();
    }
  }
  return undefined;
}

function inferSourceKindFromLegacyPath(sourcePath?: string): AgentTarget["sourceKind"] | undefined {
  if (!sourcePath) return undefined;
  const normalized = sourcePath.toLowerCase();
  if (normalized.includes(".lmstudio") || normalized.includes("lm studio")) {
    return "lm-studio";
  }
  return "custom-directory";
}

function enrichStoredDiscoveredTarget(target: AgentTarget): AgentTarget {
  const sourcePath = target.sourcePath || extractLegacySourcePath(target.notes || []);
  const sourceRepoId = target.sourceRepoId || extractLegacyRepoId(target.notes || []);
  const sourceKind = target.sourceKind || inferSourceKindFromLegacyPath(sourcePath);
  const sourceLabel = target.sourceLabel || inferSourceLabel(sourceKind);
  const modelDescriptor =
    sourceRepoId || (sourcePath ? basename(sourcePath) : undefined) || target.modelDefault || target.id;
  return {
    ...target,
    recommendedContextWindow:
      typeof target.recommendedContextWindow === "number"
        ? target.recommendedContextWindow
        : inferRecommendedContextWindow(target.id, modelDescriptor),
    parameterScale: target.parameterScale || inferParameterScale(target.id, modelDescriptor),
    quantizationLabel: target.quantizationLabel || inferQuantizationLabel(target.id, modelDescriptor),
    sourceKind,
    sourceLabel,
    sourcePath,
    sourceRepoId,
    notes: buildSourceNotes(
      {
        id: target.id,
        repo: sourcePath || sourceRepoId || target.modelDefault,
        repo_id: sourceRepoId,
        source_path: sourcePath,
        source_kind: sourceKind
      },
      sourceLabel
    )
  };
}

function buildDiscoveredLocalTarget(entry: LocalGatewayModelRecord): AgentTarget {
  const alias = entry.id!.trim();
  const normalizedAlias = alias.trim().toLowerCase();
  const targetId = normalizedAlias.startsWith("local-") ? normalizedAlias : normalizeAlias(normalizedAlias);
  const envKeyBase = toEnvKey(targetId);
  const modelDescriptor = entry.repo_id || (looksLikeFilesystemPath(entry.repo) ? basename(entry.repo!) : entry.repo) || targetId;
  const sourceKind = normalizeSourceKind(entry.source_kind);
  const sourceLabel = inferSourceLabel(sourceKind);
  return {
    id: targetId,
    label: humanizeLocalModelName(targetId, modelDescriptor),
    providerLabel: "Local MLX Gateway",
    transport: "openai-compatible",
    execution: "local",
    description:
      "Auto-discovered local model from the MLX gateway registry. It can be used anywhere the current local targets already work: chat, compare, runtime ops, and benchmark runs.",
    modelEnv: `LOCAL_${envKeyBase}_MODEL`,
    modelDefault: targetId,
    baseUrlEnv: "LOCAL_AGENT_BASE_URL",
    baseUrlDefault: LOCAL_GATEWAY_BASE_URL,
    supportsTools: true,
    recommendedContext: inferContextRecommendation(targetId, modelDescriptor),
    recommendedContextWindow: inferRecommendedContextWindow(targetId, modelDescriptor),
    memoryProfile: inferMemoryProfile(targetId, modelDescriptor),
    parameterScale: inferParameterScale(targetId, modelDescriptor),
    quantizationLabel: inferQuantizationLabel(targetId, modelDescriptor),
    sourceKind,
    sourceLabel,
    sourcePath: entry.source_path,
    sourceRepoId: entry.repo_id,
    notes: buildSourceNotes(entry, sourceLabel),
    launchHints: [
      "Drop a compatible MLX model into the local gateway registry or Hugging Face cache.",
      "Refresh /agent or /admin to rescan the gateway model list."
    ]
  };
}

function readDiscoveredLocalTargets() {
  if (!existsSync(DISCOVERED_LOCAL_TARGETS_FILE)) return [] as AgentTarget[];
  try {
    const parsed = JSON.parse(readFileSync(DISCOVERED_LOCAL_TARGETS_FILE, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((target): target is AgentTarget => {
      return Boolean(
        target &&
          typeof target === "object" &&
          typeof (target as AgentTarget).id === "string" &&
          typeof (target as AgentTarget).label === "string" &&
          (target as AgentTarget).execution === "local"
      );
    }).filter((target) => {
      if (BUILTIN_TARGET_IDS.has(target.id)) return false;
      return !BUILTIN_TARGET_FINGERPRINTS.has(normalizeAliasFingerprint(target.id));
    }).map((target) => enrichStoredDiscoveredTarget(target));
  } catch {
    return [];
  }
}

function writeDiscoveredLocalTargets(targets: AgentTarget[]) {
  ensureRegistryDirectory();
  writeFileSync(DISCOVERED_LOCAL_TARGETS_FILE, JSON.stringify(targets, null, 2), "utf8");
}

export function listServerAgentTargets() {
  const discovered = readDiscoveredLocalTargets().filter((target) => !BUILTIN_TARGET_IDS.has(target.id));
  return [...builtinAgentTargets, ...discovered];
}

export function getServerAgentTarget(targetId: string) {
  return listServerAgentTargets().find((target) => target.id === targetId);
}

export async function syncDiscoveredLocalTargetsFromGateway() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`${LOCAL_GATEWAY_BASE_URL.replace(/\/v1$/, "")}/v1/models`, {
      cache: "no-store",
      signal: controller.signal
    }).finally(() => clearTimeout(timer));
    if (!response.ok) {
      return listServerAgentTargets();
    }
    const payload = (await response.json()) as { data?: LocalGatewayModelRecord[] };
    const models = Array.isArray(payload.data) ? payload.data : [];
    const discoveredTargets = models
      .filter((entry) => typeof entry.id === "string" && entry.id.trim())
      .filter((entry) => !BUILTIN_TARGET_IDS.has(entry.id!.trim().toLowerCase()))
      .map((entry) => buildDiscoveredLocalTarget(entry))
      .filter((target) => !BUILTIN_TARGET_IDS.has(target.id));
    writeDiscoveredLocalTargets(discoveredTargets);
  } catch {
    // keep the last successful registry on disk
  }
  return listServerAgentTargets();
}
