import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { defaultBenchmarkPromptSets } from "@/lib/agent/benchmark-presets";
import { getLocalAgentDataDir, getLocalAgentDataPath } from "@/lib/agent/data-dir";
import type { AgentBenchmarkPromptSet } from "@/lib/agent/types";

const DATA_DIR = getLocalAgentDataDir();
const PROMPT_SET_FILE = getLocalAgentDataPath("benchmark-prompt-sets.json");

function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

function normalizePromptSet(input: AgentBenchmarkPromptSet): AgentBenchmarkPromptSet {
  return {
    id: input.id.trim(),
    label: input.label.trim(),
    description: input.description.trim(),
    prompts: [...new Set(input.prompts.map((entry) => entry.trim()).filter(Boolean))]
  };
}

function buildSlug(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "prompt-set";
}

function writePromptSets(rows: AgentBenchmarkPromptSet[]) {
  ensureDataDir();
  writeFileSync(PROMPT_SET_FILE, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

function getInitialPromptSets() {
  return defaultBenchmarkPromptSets.map((entry) => ({ ...entry, prompts: [...entry.prompts] }));
}

function mergePromptSets(userPromptSets: AgentBenchmarkPromptSet[]) {
  const merged = new Map<string, AgentBenchmarkPromptSet>();
  for (const entry of getInitialPromptSets()) {
    merged.set(entry.id, normalizePromptSet(entry));
  }
  for (const entry of userPromptSets.map((value) => normalizePromptSet(value))) {
    merged.set(entry.id, entry);
  }
  return [...merged.values()];
}

export function getBenchmarkPromptSetFilePath() {
  ensureDataDir();
  return PROMPT_SET_FILE;
}

export function readManagedBenchmarkPromptSets() {
  ensureDataDir();
  if (!existsSync(PROMPT_SET_FILE)) {
    const rows = getInitialPromptSets();
    writePromptSets(rows);
    return rows;
  }
  try {
    const payload = JSON.parse(readFileSync(PROMPT_SET_FILE, "utf8")) as AgentBenchmarkPromptSet[];
    if (!Array.isArray(payload)) {
      const rows = getInitialPromptSets();
      writePromptSets(rows);
      return rows;
    }
    const normalized = payload
      .map((entry) => normalizePromptSet(entry))
      .filter((entry) => entry.id && entry.label && entry.prompts.length > 0);
    const merged = mergePromptSets(normalized);
    if (JSON.stringify(merged) !== JSON.stringify(normalized)) {
      writePromptSets(merged);
    }
    return merged;
  } catch {
    const rows = getInitialPromptSets();
    writePromptSets(rows);
    return rows;
  }
}

export function getManagedBenchmarkPromptSet(id?: string | null) {
  if (!id) return null;
  return readManagedBenchmarkPromptSets().find((entry) => entry.id === id) || null;
}

export function createManagedBenchmarkPromptSet(input: {
  id?: string;
  label: string;
  description?: string;
  prompts: string[];
}) {
  const rows = readManagedBenchmarkPromptSets();
  const baseId = (input.id?.trim() || buildSlug(input.label)).slice(0, 64);
  let nextId = baseId;
  let counter = 2;
  while (rows.some((entry) => entry.id === nextId)) {
    nextId = `${baseId}-${counter}`.slice(0, 64);
    counter += 1;
  }
  const record = normalizePromptSet({
    id: nextId,
    label: input.label,
    description: input.description || "",
    prompts: input.prompts
  });
  rows.push(record);
  writePromptSets(rows);
  return record;
}

export function updateManagedBenchmarkPromptSet(
  id: string,
  input: {
    label: string;
    description?: string;
    prompts: string[];
  }
) {
  const rows = readManagedBenchmarkPromptSets();
  const index = rows.findIndex((entry) => entry.id === id);
  if (index === -1) return null;
  const updated = normalizePromptSet({
    id,
    label: input.label,
    description: input.description || "",
    prompts: input.prompts
  });
  rows[index] = updated;
  writePromptSets(rows);
  return updated;
}

export function deleteManagedBenchmarkPromptSet(id: string) {
  const rows = readManagedBenchmarkPromptSets();
  const nextRows = rows.filter((entry) => entry.id !== id);
  if (nextRows.length === rows.length) return false;
  writePromptSets(nextRows);
  return true;
}
