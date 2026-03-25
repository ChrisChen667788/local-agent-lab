import { NextResponse } from "next/server";
import { searchKnowledgeBase } from "@/lib/agent/retrieval-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      query?: string;
      topK?: number;
    };

    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return NextResponse.json({ error: "query is required." }, { status: 400 });
    }

    const topK =
      typeof body.topK === "number" && Number.isFinite(body.topK)
        ? Math.max(1, Math.min(body.topK, 12))
        : 4;

    return NextResponse.json({
      ok: true,
      retrieval: searchKnowledgeBase(query, topK)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Knowledge query failed." },
      { status: 500 }
    );
  }
}
