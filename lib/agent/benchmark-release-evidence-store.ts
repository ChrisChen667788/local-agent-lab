import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { getLocalAgentDataDir, getLocalAgentDataPath } from "@/lib/agent/data-dir";

export type StoredBenchmarkReleaseEvidence = {
  id: string;
  kind: "benchmark-release-evidence";
  runId: string;
  title?: string;
  note?: string;
  pinnedAt: string;
};

const EVIDENCE_FILE = getLocalAgentDataPath("benchmark-release-evidence.json");

function ensureEvidenceDir() {
  mkdirSync(getLocalAgentDataDir(), { recursive: true });
}

function normalizeEntries(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Partial<StoredBenchmarkReleaseEvidence>;
      if (candidate.kind !== "benchmark-release-evidence") return [];
      if (typeof candidate.id !== "string" || typeof candidate.runId !== "string" || typeof candidate.pinnedAt !== "string") {
        return [];
      }
      return [{
        id: candidate.id,
        kind: "benchmark-release-evidence" as const,
        runId: candidate.runId,
        title: typeof candidate.title === "string" ? candidate.title : undefined,
        note: typeof candidate.note === "string" ? candidate.note : undefined,
        pinnedAt: candidate.pinnedAt
      }];
    })
    .sort((left, right) => right.pinnedAt.localeCompare(left.pinnedAt));
}

export function readBenchmarkReleaseEvidence() {
  try {
    const source = readFileSync(EVIDENCE_FILE, "utf8");
    const parsed = JSON.parse(source) as { entries?: unknown };
    return normalizeEntries(parsed.entries);
  } catch {
    return [];
  }
}

function writeBenchmarkReleaseEvidence(entries: StoredBenchmarkReleaseEvidence[]) {
  ensureEvidenceDir();
  writeFileSync(
    EVIDENCE_FILE,
    `${JSON.stringify(
      {
        schemaVersion: "0.3.0",
        updatedAt: new Date().toISOString(),
        entries
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export function upsertBenchmarkReleaseEvidence(input: {
  runId: string;
  title?: string;
  note?: string;
}) {
  const entries = readBenchmarkReleaseEvidence();
  const existing = entries.find((entry) => entry.runId === input.runId) || null;
  const nextEntry: StoredBenchmarkReleaseEvidence = existing
    ? {
        ...existing,
        title: input.title ?? existing.title,
        note: input.note ?? existing.note,
        pinnedAt: new Date().toISOString()
      }
    : {
        id: crypto.randomUUID(),
        kind: "benchmark-release-evidence",
        runId: input.runId,
        title: input.title,
        note: input.note,
        pinnedAt: new Date().toISOString()
      };
  const nextEntries = [nextEntry, ...entries.filter((entry) => entry.runId !== input.runId)].slice(0, 20);
  writeBenchmarkReleaseEvidence(nextEntries);
  return nextEntry;
}

export function removeBenchmarkReleaseEvidence(runId: string) {
  const entries = readBenchmarkReleaseEvidence();
  const nextEntries = entries.filter((entry) => entry.runId !== runId);
  writeBenchmarkReleaseEvidence(nextEntries);
  return nextEntries.length !== entries.length;
}

