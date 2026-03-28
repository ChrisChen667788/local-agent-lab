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

function inspectImportPath(inputPath: string, recursive: boolean) {
  const stats = statSync(inputPath);
  const normalizedPath = path.resolve(inputPath);

  if (stats.isFile()) {
    const importable = IMPORTABLE_EXTENSIONS.has(path.extname(normalizedPath).toLowerCase());
    return {
      path: normalizedPath,
      kind: "file" as const,
      recursive: false,
      totalFiles: 1,
      importableCount: importable ? 1 : 0,
      skippedCount: importable ? 0 : 1,
      previewFiles: importable ? [normalizedPath] : []
    };
  }

  if (!stats.isDirectory()) {
    return {
      path: normalizedPath,
      kind: "other" as const,
      recursive,
      totalFiles: 0,
      importableCount: 0,
      skippedCount: 0,
      previewFiles: []
    };
  }

  const queue = [normalizedPath];
  const importableFiles: string[] = [];
  let totalFiles = 0;
  let skippedCount = 0;

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
      if (!entry.isFile()) continue;
      totalFiles += 1;
      if (IMPORTABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        importableFiles.push(nextPath);
      } else {
        skippedCount += 1;
      }
    }
  }

  importableFiles.sort((left, right) => left.localeCompare(right));
  return {
    path: normalizedPath,
    kind: "directory" as const,
    recursive,
    totalFiles,
    importableCount: importableFiles.length,
    skippedCount,
    previewFiles: importableFiles.slice(0, 6)
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const documentId = searchParams.get("documentId") || undefined;
  const snapshot = getKnowledgeBaseSnapshot();
  const workspaceRoot = process.cwd();

  return NextResponse.json({
    ...snapshot,
    chunks: documentId ? listKnowledgeChunks(documentId) : [],
    workspaceRoot,
    recommendedImportPaths: [path.join(workspaceRoot, "docs"), workspaceRoot]
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      importMode?: "path" | "path-probe";
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

    if (body.importMode === "path" || body.importMode === "path-probe") {
      const importPath = typeof body.path === "string" ? body.path.trim() : "";
      if (!importPath) {
        throw new Error("path is required.");
      }
      if (!existsSync(importPath)) {
        throw new Error(`Path not found: ${importPath}`);
      }

      const inspection = inspectImportPath(importPath, body.recursive !== false);
      if (body.importMode === "path-probe") {
        return NextResponse.json({
          ok: true,
          inspection,
          supportedExtensions: [...IMPORTABLE_EXTENSIONS].sort()
        });
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
        importedDocuments: imported,
        inspection,
        supportedExtensions: [...IMPORTABLE_EXTENSIONS].sort()
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
