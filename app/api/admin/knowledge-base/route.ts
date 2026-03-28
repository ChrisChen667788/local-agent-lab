import { NextResponse } from "next/server";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import {
  deleteKnowledgeDocument,
  getKnowledgeBaseSnapshot,
  listKnowledgeChunks,
  upsertKnowledgeDocument
} from "@/lib/agent/retrieval-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMPORTABLE_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".rst",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py"
]);

function collectImportFiles(inputPath: string, recursive: boolean) {
  const stats = statSync(inputPath);
  if (stats.isFile()) {
    return IMPORTABLE_EXTENSIONS.has(path.extname(inputPath).toLowerCase()) ? [inputPath] : [];
  }
  if (!stats.isDirectory()) return [];

  const queue = [inputPath];
  const files: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive) {
          queue.push(nextPath);
        }
        continue;
      }
      if (IMPORTABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(nextPath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

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
      importMode?: "path";
      path?: string;
      recursive?: boolean;
      id?: string;
      title?: string;
      source?: string;
      tags?: string[] | string;
      content?: string;
    };

    const normalizedTags = Array.isArray(body.tags)
      ? body.tags
      : typeof body.tags === "string"
        ? body.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
        : [];

    if (body.importMode === "path") {
      const importPath = typeof body.path === "string" ? body.path.trim() : "";
      if (!importPath) {
        throw new Error("path is required.");
      }
      if (!existsSync(importPath)) {
        throw new Error(`Path not found: ${importPath}`);
      }

      const files = collectImportFiles(importPath, body.recursive !== false);
      if (!files.length) {
        throw new Error("No importable files found in the specified path.");
      }

      const imported = files.map((filePath) => {
        const content = readFileSync(filePath, "utf8");
        return upsertKnowledgeDocument({
          title: path.basename(filePath),
          source: filePath,
          tags: normalizedTags,
          content
        }).document;
      });

      return NextResponse.json({
        ok: true,
        importedCount: imported.length,
        importedDocuments: imported
      });
    }

    const result = upsertKnowledgeDocument({
      id: body.id,
      title: typeof body.title === "string" ? body.title : "",
      source: typeof body.source === "string" ? body.source : "",
      tags: normalizedTags,
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
