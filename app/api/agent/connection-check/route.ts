import { NextResponse } from "next/server";
import crypto from "crypto";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { getAgentTarget } from "@/lib/agent/catalog";
import { appendConnectionCheckLog } from "@/lib/agent/log-store";
import type { AgentConnectionCheckResponse, AgentConnectionCheckStage } from "@/lib/agent/types";

function loadLocalEnv() {
  const values: Record<string, string> = {};
  for (const filename of [".env.local", ".env"]) {
    const filePath = path.join(process.cwd(), filename);
    if (!existsSync(filePath)) continue;

    const source = readFileSync(filePath, "utf8");
    for (const rawLine of source.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) continue;

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      values[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  }
  return values;
}

function readEnv(localEnv: Record<string, string>, name: string | undefined, fallback: string) {
  if (!name) return fallback;
  return localEnv[name] || process.env[name] || fallback;
}

function extractTextContent(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const value = (entry as { text?: unknown }).text;
      return typeof value === "string" ? value : "";
    })
    .filter(Boolean)
    .join("\n");
}

function buildDocsUrl(targetId: string) {
  if (targetId === "anthropic-claude") {
    return "https://docs.anthropic.com";
  }
  return undefined;
}

async function timedFetch(
  url: string,
  init?: RequestInit
): Promise<{ response: Response; latencyMs: number }> {
  const startedAt = Date.now();
  const response = await fetch(url, { ...init, cache: "no-store" });
  return {
    response,
    latencyMs: Date.now() - startedAt
  };
}

function buildErrorStage(
  id: AgentConnectionCheckStage["id"],
  summary: string,
  latencyMs = 0,
  httpStatus?: number
): AgentConnectionCheckStage {
  return { id, ok: false, summary, latencyMs, httpStatus };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetId = searchParams.get("targetId");

  if (!targetId) {
    return NextResponse.json({ error: "targetId is required." }, { status: 400 });
  }

  const target = getAgentTarget(targetId);
  if (!target) {
    return NextResponse.json({ error: `Unknown target: ${targetId}` }, { status: 404 });
  }

  if (target.execution !== "remote") {
    return NextResponse.json({ error: "Connection checks only apply to remote API targets." }, { status: 400 });
  }

  if (target.transport !== "openai-compatible") {
    return NextResponse.json(
      { error: `Connection checks currently support only openai-compatible targets. ${target.label} uses ${target.transport}.` },
      { status: 400 }
    );
  }

  const localEnv = loadLocalEnv();
  const resolvedBaseUrl = readEnv(localEnv, target.baseUrlEnv, target.baseUrlDefault).replace(/\/$/, "");
  const resolvedModel = readEnv(localEnv, target.modelEnv, target.modelDefault);
  const resolvedApiKey = target.apiKeyEnv ? readEnv(localEnv, target.apiKeyEnv, "") : "";

  if (target.apiKeyEnv && !resolvedApiKey) {
    return NextResponse.json(
      { error: `Missing ${target.apiKeyEnv}. Add it to .env.local before running the connection check.` },
      { status: 400 }
    );
  }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(resolvedApiKey ? { Authorization: `Bearer ${resolvedApiKey}` } : {})
  };
  const stages: AgentConnectionCheckStage[] = [];

  try {
    const { response, latencyMs } = await timedFetch(`${resolvedBaseUrl}/models`, {
      method: "GET",
      headers
    });
    const httpStatus = response.status;

    if (!response.ok) {
      const errorText = await response.text();
      stages.push(buildErrorStage("models", `HTTP ${httpStatus}: ${errorText.slice(0, 180)}`, latencyMs, httpStatus));
    } else {
      const data = (await response.json()) as {
        data?: Array<{ id?: string }>;
      };
      const models = Array.isArray(data.data) ? data.data : [];
      const modelFound = models.some((model) => model.id === resolvedModel);
      stages.push({
        id: "models",
        ok: true,
        latencyMs,
        httpStatus,
        summary: modelFound
          ? `Model list reachable. Found ${resolvedModel} in ${models.length} advertised models.`
          : `Model list reachable. ${resolvedModel} was not explicitly listed in ${models.length} models.`
      });
    }
  } catch (error) {
    stages.push(buildErrorStage("models", error instanceof Error ? error.message : "Models request failed."));
  }

  try {
    const { response, latencyMs } = await timedFetch(`${resolvedBaseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: resolvedModel,
        messages: [{ role: "user", content: "Reply with exactly CHAT_OK." }],
        max_tokens: 32
      })
    });
    const httpStatus = response.status;

    if (!response.ok) {
      const errorText = await response.text();
      stages.push(buildErrorStage("chat", `HTTP ${httpStatus}: ${errorText.slice(0, 180)}`, latencyMs, httpStatus));
    } else {
      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: unknown;
          };
        }>;
      };
      const content = extractTextContent(data.choices?.[0]?.message?.content).trim();
      stages.push({
        id: "chat",
        ok: content.includes("CHAT_OK"),
        latencyMs,
        httpStatus,
        summary: content
          ? `Chat round-trip succeeded. Sample response: ${content.slice(0, 120)}`
          : "Chat request returned no visible assistant text."
      });
    }
  } catch (error) {
    stages.push(buildErrorStage("chat", error instanceof Error ? error.message : "Chat request failed."));
  }

  try {
    const { response, latencyMs } = await timedFetch(`${resolvedBaseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: resolvedModel,
        messages: [
          {
            role: "user",
            content: 'Call the "list_files" tool once with path "." and limit 5. Do not answer normally.'
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "list_files",
              description: "List files inside the current workspace.",
              parameters: {
                type: "object",
                properties: {
                  path: {
                    type: "string"
                  },
                  limit: {
                    type: "integer"
                  }
                },
                required: ["path", "limit"]
              }
            }
          }
        ],
        tool_choice: "auto",
        max_tokens: 128
      })
    });
    const httpStatus = response.status;

    if (!response.ok) {
      const errorText = await response.text();
      stages.push(
        buildErrorStage("tool_calls", `HTTP ${httpStatus}: ${errorText.slice(0, 180)}`, latencyMs, httpStatus)
      );
    } else {
      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: unknown;
            tool_calls?: Array<{
              function?: {
                name?: string;
              };
            }>;
          };
        }>;
      };
      const message = data.choices?.[0]?.message;
      const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
      const content = extractTextContent(message?.content).trim();

      stages.push({
        id: "tool_calls",
        ok: toolCalls.length > 0,
        latencyMs,
        httpStatus,
        summary:
          toolCalls.length > 0
            ? `Tool calling is healthy. Provider returned ${toolCalls.length} tool call(s); first tool: ${
                toolCalls[0]?.function?.name || "unknown"
              }.`
            : content
              ? `Provider replied with text instead of tool_calls: ${content.slice(0, 120)}`
              : "Provider returned neither tool_calls nor assistant text."
      });
    }
  } catch (error) {
    stages.push(
      buildErrorStage("tool_calls", error instanceof Error ? error.message : "Tool-calls request failed.")
    );
  }

  const payload: AgentConnectionCheckResponse = {
    ok: stages.every((stage) => stage.ok),
    targetId,
    targetLabel: target.label,
    providerLabel: target.providerLabel,
    resolvedBaseUrl,
    resolvedModel,
    checkedAt: new Date().toISOString(),
    docsUrl: buildDocsUrl(targetId),
    stages
  };

  appendConnectionCheckLog({
    kind: "connection-check",
    id: crypto.randomUUID(),
    ...payload
  });

  return NextResponse.json(payload);
}
