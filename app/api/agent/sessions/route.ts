import { NextResponse } from "next/server";
import {
  getSessionServerState,
  syncSessionSnapshot
} from "@/lib/agent/session-store";
import type { AgentWorkbenchStoredPreferences } from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = getSessionServerState();
  return NextResponse.json({
    ...state.snapshot,
    versions: state.versions,
    path: state.path
  });
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      sessions?: unknown[];
      preferences?: AgentWorkbenchStoredPreferences | null;
      activeSessionId?: string | null;
      baseUpdatedAt?: string | null;
      force?: boolean;
    };

    const result = syncSessionSnapshot({
      sessions: body.sessions,
      preferences:
        body.preferences && typeof body.preferences === "object"
          ? body.preferences
          : null,
      activeSessionId:
        typeof body.activeSessionId === "string"
          ? body.activeSessionId
          : body.activeSessionId === null
            ? null
            : undefined,
      baseUpdatedAt:
        typeof body.baseUpdatedAt === "string" ? body.baseUpdatedAt : null,
      force: Boolean(body.force)
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.conflict.summary,
          conflict: result.conflict,
          ...result.snapshot,
          versions: result.versions
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      count: result.snapshot.sessions.length,
      updatedAt: result.snapshot.updatedAt,
      versions: result.versions,
      path: getSessionServerState().path
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync sessions." },
      { status: 400 }
    );
  }
}
