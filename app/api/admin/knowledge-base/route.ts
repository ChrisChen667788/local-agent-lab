import { NextResponse } from "next/server";
import {
  deleteKnowledgeDocument,
  getKnowledgeBaseSnapshot,
  listKnowledgeChunks,
  upsertKnowledgeDocument
} from "@/lib/agent/retrieval-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const documentId = searchParams.get("documentId") || undefined;
  const snapshot = getKnowledgeBaseSnapshot();

  return NextResponse.json({
    ...snapshot,
    chunks: documentId ? listKnowledgeChunks(documentId) : []
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string;
      title?: string;
      source?: string;
      tags?: string[] | string;
      content?: string;
    };

    const result = upsertKnowledgeDocument({
      id: body.id,
      title: typeof body.title === "string" ? body.title : "",
      source: typeof body.source === "string" ? body.source : "",
      tags: Array.isArray(body.tags)
        ? body.tags
        : typeof body.tags === "string"
          ? body.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
          : [],
      content: typeof body.content === "string" ? body.content : ""
    });

    return NextResponse.json({
      ok: true,
      document: result.document,
      stats: result.stats
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save knowledge document." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const deleted = deleteKnowledgeDocument(id);
  if (!deleted) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    id
  });
}
