import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { NextResponse } from "next/server";
import { getLocalAgentDataDir, getLocalAgentDataPath } from "@/lib/agent/data-dir";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_SNAPSHOT_FILE = getLocalAgentDataPath("agent-sessions.json");

type SessionSnapshotPayload = {
  sessions: unknown[];
};

function ensureSessionDir() {
  mkdirSync(getLocalAgentDataDir(), { recursive: true });
}

function readSessionSnapshot() {
  try {
    const source = readFileSync(SESSION_SNAPSHOT_FILE, "utf8");
    const parsed = JSON.parse(source) as SessionSnapshotPayload;
    return Array.isArray(parsed.sessions) ? parsed.sessions : [];
  } catch {
    return [];
  }
}

function writeSessionSnapshot(sessions: unknown[]) {
  ensureSessionDir();
  writeFileSync(
    SESSION_SNAPSHOT_FILE,
    `${JSON.stringify({ schemaVersion: "0.2.1", updatedAt: new Date().toISOString(), sessions }, null, 2)}\n`,
    "utf8"
  );
}

export async function GET() {
  return NextResponse.json({
    sessions: readSessionSnapshot(),
    path: SESSION_SNAPSHOT_FILE
  });
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { sessions?: unknown[] };
    const sessions = Array.isArray(body.sessions) ? body.sessions : [];
    writeSessionSnapshot(sessions);
    return NextResponse.json({
      ok: true,
      count: sessions.length,
      path: SESSION_SNAPSHOT_FILE
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync sessions." },
      { status: 400 }
    );
  }
}
