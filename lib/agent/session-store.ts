import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import crypto from "crypto";
import { getLocalAgentDataDir, getLocalAgentDataPath } from "@/lib/agent/data-dir";
import { appendTimelineEvent } from "@/lib/agent/timeline-store";
import type {
  AgentWorkbenchSessionConflict,
  AgentWorkbenchSessionSnapshot,
  AgentWorkbenchSessionVersion,
  AgentWorkbenchStoredPreferences
} from "@/lib/agent/types";

const WORKBENCH_SCHEMA_VERSION = "0.3.0";
const SESSION_SNAPSHOT_FILE = getLocalAgentDataPath("agent-sessions.json");
const SESSION_HISTORY_FILE = getLocalAgentDataPath("agent-sessions-history.jsonl");

function ensureSessionDir() {
  mkdirSync(getLocalAgentDataDir(), { recursive: true });
}

function normalizeSnapshot(value: Partial<AgentWorkbenchSessionSnapshot> & {
  sessions?: unknown;
  preferences?: unknown;
}): AgentWorkbenchSessionSnapshot {
  const sessions = Array.isArray(value.sessions) ? value.sessions : [];
  const preferences =
    value.preferences && typeof value.preferences === "object"
      ? (value.preferences as AgentWorkbenchStoredPreferences)
      : null;
  return {
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt.trim()
        ? value.updatedAt
        : new Date(0).toISOString(),
    activeSessionId:
      typeof value.activeSessionId === "string"
        ? value.activeSessionId
        : value.activeSessionId === null
          ? null
          : undefined,
    preferences,
    sessions
  };
}

function summarizeSnapshot(snapshot: {
  sessions: unknown[];
  activeSessionId?: string | null;
  preferences?: AgentWorkbenchStoredPreferences | null;
}) {
  const sessionCount = Array.isArray(snapshot.sessions) ? snapshot.sessions.length : 0;
  const mode = snapshot.preferences?.workbenchMode || "chat";
  return `${sessionCount} session${sessionCount === 1 ? "" : "s"} · ${mode} · active ${snapshot.activeSessionId || "none"}`;
}

function stableSignature(snapshot: {
  sessions: unknown[];
  activeSessionId?: string | null;
  preferences?: AgentWorkbenchStoredPreferences | null;
}) {
  return JSON.stringify({
    activeSessionId: snapshot.activeSessionId ?? null,
    preferences: snapshot.preferences || null,
    sessions: Array.isArray(snapshot.sessions) ? snapshot.sessions : []
  });
}

export function getSessionSnapshotFilePath() {
  ensureSessionDir();
  return SESSION_SNAPSHOT_FILE;
}

export function readSessionSnapshot() {
  try {
    return normalizeSnapshot(JSON.parse(readFileSync(SESSION_SNAPSHOT_FILE, "utf8")) as Partial<AgentWorkbenchSessionSnapshot>);
  } catch {
    return normalizeSnapshot({
      updatedAt: new Date(0).toISOString(),
      activeSessionId: null,
      preferences: null,
      sessions: []
    });
  }
}

export function readSessionVersions(limit = 20) {
  if (!existsSync(SESSION_HISTORY_FILE)) return [] as AgentWorkbenchSessionVersion[];
  const rows = readFileSync(SESSION_HISTORY_FILE, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AgentWorkbenchSessionVersion];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return rows.slice(0, limit);
}

function appendSessionVersion(entry: AgentWorkbenchSessionVersion) {
  ensureSessionDir();
  appendFileSync(SESSION_HISTORY_FILE, `${JSON.stringify(entry)}\n`, "utf8");
}

function writeSessionSnapshot(snapshot: AgentWorkbenchSessionSnapshot) {
  ensureSessionDir();
  writeFileSync(SESSION_SNAPSHOT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export function getSessionServerState(limit = 20) {
  return {
    path: SESSION_SNAPSHOT_FILE,
    snapshot: readSessionSnapshot(),
    versions: readSessionVersions(limit)
  };
}

export function syncSessionSnapshot(input: {
  sessions?: unknown[];
  preferences?: AgentWorkbenchStoredPreferences | null;
  activeSessionId?: string | null;
  baseUpdatedAt?: string | null;
  force?: boolean;
}) {
  const current = readSessionSnapshot();
  const normalized = {
    sessions: Array.isArray(input.sessions) ? input.sessions : [],
    preferences:
      input.preferences && typeof input.preferences === "object"
        ? input.preferences
        : null,
    activeSessionId:
      typeof input.activeSessionId === "string"
        ? input.activeSessionId
        : input.activeSessionId === null
          ? null
          : undefined
  };

  const baseUpdatedAt =
    typeof input.baseUpdatedAt === "string" && input.baseUpdatedAt.trim()
      ? input.baseUpdatedAt
      : null;
  const serverHasAdvanced =
    baseUpdatedAt &&
    current.updatedAt !== new Date(0).toISOString() &&
    current.updatedAt !== baseUpdatedAt;
  const localDiffersFromServer = stableSignature(normalized) !== stableSignature(current);

  if (!input.force && serverHasAdvanced && localDiffersFromServer) {
    const conflict: AgentWorkbenchSessionConflict = {
      code: "snapshot-outdated",
      baseUpdatedAt,
      serverUpdatedAt: current.updatedAt,
      localSessionCount: normalized.sessions.length,
      serverSessionCount: current.sessions.length,
      summary:
        "The server snapshot changed after this browser tab loaded. Reload the server copy or force overwrite with the current local state."
    };
    appendTimelineEvent({
      kind: "session",
      status: "conflict",
      title: "Session sync conflict",
      summary: `${conflict.localSessionCount} local vs ${conflict.serverSessionCount} server sessions`,
      relatedId: current.activeSessionId || undefined,
      metadata: {
        baseUpdatedAt: conflict.baseUpdatedAt || null,
        serverUpdatedAt: conflict.serverUpdatedAt
      }
    });
    return {
      ok: false as const,
      conflict,
      snapshot: current,
      versions: readSessionVersions()
    };
  }

  const now = new Date().toISOString();
  const snapshot: AgentWorkbenchSessionSnapshot = {
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    updatedAt: now,
    activeSessionId: normalized.activeSessionId ?? null,
    preferences: normalized.preferences,
    sessions: normalized.sessions
  };
  writeSessionSnapshot(snapshot);

  const version: AgentWorkbenchSessionVersion = {
    id: `session-version-${crypto.randomUUID()}`,
    savedAt: now,
    source: input.force ? "force-overwrite" : "server-sync",
    summary: summarizeSnapshot(snapshot),
    activeSessionId: snapshot.activeSessionId ?? null,
    sessionCount: snapshot.sessions.length,
    conflictDetected: Boolean(serverHasAdvanced && input.force)
  };
  appendSessionVersion(version);
  appendTimelineEvent({
    kind: "session",
    status: "saved",
    title: input.force ? "Session snapshot force-overwritten" : "Session snapshot synced",
    summary: version.summary,
    relatedId: snapshot.activeSessionId || undefined,
    metadata: {
      sessionCount: snapshot.sessions.length,
      conflictDetected: version.conflictDetected || false
    }
  });

  return {
    ok: true as const,
    snapshot,
    version,
    versions: readSessionVersions()
  };
}
