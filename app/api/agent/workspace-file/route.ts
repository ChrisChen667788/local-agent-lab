import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_PREVIEW_CHARS = 12000;

function resolveWorkspaceFile(inputPath: string) {
  const workspaceRoot = process.cwd();
  const resolvedPath = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(workspaceRoot, inputPath);
  const relativePath = path.relative(workspaceRoot, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Path escapes the current workspace.");
  }
  return {
    workspaceRoot,
    resolvedPath,
    relativePath
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const inputPath = searchParams.get("path")?.trim();
    if (!inputPath) {
      return NextResponse.json({ error: "path is required." }, { status: 400 });
    }

    const { workspaceRoot, resolvedPath, relativePath } = resolveWorkspaceFile(inputPath);
    if (!existsSync(resolvedPath)) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }

    const stats = statSync(resolvedPath);
    if (!stats.isFile()) {
      return NextResponse.json({ error: "Only files can be opened." }, { status: 400 });
    }

    const source = readFileSync(resolvedPath, "utf8");
    const truncated = source.length > MAX_FILE_PREVIEW_CHARS;

    return NextResponse.json({
      ok: true,
      workspaceRoot,
      path: relativePath,
      absolutePath: resolvedPath,
      truncated,
      content: truncated ? `${source.slice(0, MAX_FILE_PREVIEW_CHARS)}\n…` : source
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to open workspace file." },
      { status: 400 }
    );
  }
}
