import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { AgentCacheMode, AgentProviderProfile, AgentThinkingMode, AgentUsage } from "@/lib/agent/types";
import { getObservabilityPaths } from "@/lib/agent/log-store";

type PromptCacheEntry = {
  id: string;
  createdAt: string;
  targetId: string;
  resolvedModel: string;
  providerProfile: AgentProviderProfile;
  thinkingMode: AgentThinkingMode;
  contextWindow: number;
  retrievalEnabled: boolean;
  input: string;
  normalizedInput: string;
  content: string;
  usage?: AgentUsage;
};

const CACHE_FILE = path.join(getObservabilityPaths().dataDir, "prompt-cache.json");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 400;

function ensureDataDir() {
  mkdirSync(getObservabilityPaths().dataDir, { recursive: true });
}

function readCache(): PromptCacheEntry[] {
  if (!existsSync(CACHE_FILE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as PromptCacheEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCache(entries: PromptCacheEntry[]) {
  ensureDataDir();
  writeFileSync(CACHE_FILE, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

function normalizeInput(input: string) {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return new Set(
    normalizeInput(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap / Math.max(a.size + b.size - overlap, 1);
}

function currentEntries() {
  const now = Date.now();
  return readCache().filter((entry) => {
    const createdAt = new Date(entry.createdAt).getTime();
    return Number.isFinite(createdAt) && now - createdAt <= CACHE_TTL_MS;
  });
}

type CacheLookupOptions = {
  targetId: string;
  resolvedModel: string;
  providerProfile: AgentProviderProfile;
  thinkingMode: AgentThinkingMode;
  contextWindow: number;
  retrievalEnabled: boolean;
  input: string;
};

export function lookupPromptCache(options: CacheLookupOptions) {
  const normalizedInput = normalizeInput(options.input);
  if (!normalizedInput) return null;

  const candidates = currentEntries().filter((entry) => {
    return (
      entry.targetId === options.targetId &&
      entry.resolvedModel === options.resolvedModel &&
      entry.providerProfile === options.providerProfile &&
      entry.thinkingMode === options.thinkingMode &&
      entry.contextWindow === options.contextWindow &&
      entry.retrievalEnabled === options.retrievalEnabled
    );
  });

  const exact = candidates.find((entry) => entry.normalizedInput === normalizedInput);
  if (exact) {
    return { mode: "exact" as AgentCacheMode, entry: exact };
  }

  const queryTokens = tokenize(options.input);
  let best: PromptCacheEntry | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = jaccardSimilarity(queryTokens, tokenize(candidate.input));
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  if (best && bestScore >= 0.88) {
    return { mode: "semantic" as AgentCacheMode, entry: best, score: Number(bestScore.toFixed(3)) };
  }

  return null;
}

type CacheWriteOptions = CacheLookupOptions & {
  content: string;
  usage?: AgentUsage;
};

export function savePromptCache(options: CacheWriteOptions) {
  const normalizedInput = normalizeInput(options.input);
  if (!normalizedInput || !options.content.trim()) return;

  const nextEntry: PromptCacheEntry = {
    id: `${options.targetId}:${Date.now()}`,
    createdAt: new Date().toISOString(),
    targetId: options.targetId,
    resolvedModel: options.resolvedModel,
    providerProfile: options.providerProfile,
    thinkingMode: options.thinkingMode,
    contextWindow: options.contextWindow,
    retrievalEnabled: options.retrievalEnabled,
    input: options.input,
    normalizedInput,
    content: options.content,
    usage: options.usage
  };

  const existing = currentEntries().filter((entry) => {
    return !(
      entry.targetId === nextEntry.targetId &&
      entry.resolvedModel === nextEntry.resolvedModel &&
      entry.providerProfile === nextEntry.providerProfile &&
      entry.thinkingMode === nextEntry.thinkingMode &&
      entry.contextWindow === nextEntry.contextWindow &&
      entry.retrievalEnabled === nextEntry.retrievalEnabled &&
      entry.normalizedInput === nextEntry.normalizedInput
    );
  });

  const next = [nextEntry, ...existing].slice(0, MAX_CACHE_ENTRIES);
  writeCache(next);
}
