import { NextResponse } from "next/server";
import {
  readConnectionCheckLogs,
  serializeConnectionChecksAsMarkdown
} from "@/lib/agent/log-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const format = (searchParams.get("format") || "markdown").toLowerCase();
  const targetId = searchParams.get("targetId") || undefined;
  const logs = readConnectionCheckLogs({ targetId, limit: 500 });

  if (format === "json") {
    return new NextResponse(JSON.stringify(logs, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"connection-checks${targetId ? `-${targetId}` : ""}.json\"`
      }
    });
  }

  const markdown = serializeConnectionChecksAsMarkdown(logs);
  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"connection-checks${targetId ? `-${targetId}` : ""}.md\"`
    }
  });
}
