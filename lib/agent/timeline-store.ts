import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import crypto from "crypto";
import { getLocalAgentDataDir, getLocalAgentDataPath } from "@/lib/agent/data-dir";
import type { AgentTimelineEvent, AgentTimelineEventStatus } from "@/lib/agent/types";

const TIMELINE_FILE = getLocalAgentDataPath("activity-timeline.jsonl");

function ensureTimelineDir() {
  mkdirSync(getLocalAgentDataDir(), { recursive: true });
}

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

export function appendTimelineEvent(
  input: Omit<AgentTimelineEvent, "id" | "at"> & {
    id?: string;
    at?: string;
  }
) {
  ensureTimelineDir();
  const event: AgentTimelineEvent = {
    id: input.id || `timeline-${crypto.randomUUID()}`,
    at: input.at || new Date().toISOString(),
    ...input
  };
  appendFileSync(TIMELINE_FILE, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export function readTimelineEvents(options?: {
  limit?: number;
  kinds?: AgentTimelineEvent["kind"][];
  statuses?: AgentTimelineEventStatus[];
}) {
  const rows = readJsonl<AgentTimelineEvent>(TIMELINE_FILE)
    .filter((row) => (options?.kinds?.length ? options.kinds.includes(row.kind) : true))
    .filter((row) => (options?.statuses?.length ? options.statuses.includes(row.status) : true))
    .sort((a, b) => b.at.localeCompare(a.at));

  if (options?.limit && options.limit > 0) {
    return rows.slice(0, options.limit);
  }
  return rows;
}

export function getTimelineFilePath() {
  ensureTimelineDir();
  return TIMELINE_FILE;
}
