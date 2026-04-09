import { dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { agentTargets as builtinAgentTargets } from "@/lib/agent/catalog";
import { getLocalAgentDataPath } from "@/lib/agent/data-dir";
import type { AgentTarget } from "@/lib/agent/types";

const DISCOVERED_LOCAL_TARGETS_FILE = getLocalAgentDataPath("discovered-local-targets.json");
const LOCAL_GATEWAY_BASE_URL = (process.env.LOCAL_AGENT_BASE_URL || "http://127.0.0.1:4000/v1").replace(/\/$/, "");

type LocalGatewayModelRecord = {
  id?: string;
  repo?: string;
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

function humanizeLocalModelName(alias: string, repo?: string) {
  const source = (repo?.split("/").pop() || alias)
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

function inferContextRecommendation(alias: string, repo?: string) {
  const sizeMatch = `${alias} ${repo || ""}`.match(/(\d+(?:\.\d+)?)b/i);
  const size = sizeMatch ? Number(sizeMatch[1]) : null;
  if (typeof size === "number" && Number.isFinite(size)) {
    if (size <= 1) return "4K-8K";
    if (size <= 4) return "8K-16K";
    return "8K-32K";
  }
  return "Depends on model";
}

function inferMemoryProfile(alias: string, repo?: string) {
  const sizeMatch = `${alias} ${repo || ""}`.match(/(\d+(?:\.\d+)?)b/i);
  const size = sizeMatch ? Number(sizeMatch[1]) : null;
  if (typeof size === "number" && Number.isFinite(size)) {
    if (size <= 1) return "Low memory pressure. Good fit for always-on local use.";
    if (size <= 4) return "Moderate memory pressure. Best used with a cleaner desktop session.";
    return "Higher memory pressure. Prefer loading this when the machine is otherwise quiet.";
  }
  return "Auto-discovered local profile. Check live runtime metrics before keeping it loaded.";
}

function buildDiscoveredLocalTarget(alias: string, repo?: string): AgentTarget {
  const normalizedAlias = alias.trim().toLowerCase();
  const targetId = normalizedAlias.startsWith("local-") ? normalizedAlias : normalizeAlias(normalizedAlias);
  const envKeyBase = toEnvKey(targetId);
  return {
    id: targetId,
    label: humanizeLocalModelName(targetId, repo),
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
    recommendedContext: inferContextRecommendation(targetId, repo),
    memoryProfile: inferMemoryProfile(targetId, repo),
    notes: [
      "This target was auto-discovered from the local gateway model registry.",
      repo ? `Gateway repo: ${repo}` : "Gateway did not expose a source repo for this model.",
      "If the model stays unloaded, use prewarm or send a chat request to activate it."
    ],
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
    });
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
    const response = await fetch(`${LOCAL_GATEWAY_BASE_URL.replace(/\/v1$/, "")}/v1/models`, {
      cache: "no-store"
    });
    if (!response.ok) {
      return listServerAgentTargets();
    }
    const payload = (await response.json()) as { data?: LocalGatewayModelRecord[] };
    const models = Array.isArray(payload.data) ? payload.data : [];
    const discoveredTargets = models
      .filter((entry) => typeof entry.id === "string" && entry.id.trim())
      .filter((entry) => !BUILTIN_TARGET_IDS.has(entry.id!.trim().toLowerCase()))
      .map((entry) => buildDiscoveredLocalTarget(entry.id!.trim(), typeof entry.repo === "string" ? entry.repo : undefined))
      .filter((target) => !BUILTIN_TARGET_IDS.has(target.id));
    writeDiscoveredLocalTargets(discoveredTargets);
  } catch {
    // keep the last successful registry on disk
  }
  return listServerAgentTargets();
}
