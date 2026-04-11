import { NextResponse } from "next/server";
import { runRemoteConnectionCheck } from "@/lib/agent/connection-check";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetId = searchParams.get("targetId");

  if (!targetId) {
    return NextResponse.json({ error: "targetId is required." }, { status: 400 });
  }

  try {
    const payload = await runRemoteConnectionCheck(targetId, {
      mode: "full",
      log: true
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Connection check failed."
      },
      { status: 400 }
    );
  }
}
