import crypto from "crypto";
import { appendConnectionCheckLog } from "@/lib/agent/log-store";
import { getServerAgentTarget } from "@/lib/agent/server-targets";
import { clearProviderEnvCache, resolveTarget } from "@/lib/agent/providers";
import type { AgentConnectionCheckResponse, AgentConnectionCheckStage } from "@/lib/agent/types";

export type RemoteConnectionCheckMode = "quick" | "full";

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

export function buildConnectionCheckDocsUrl(targetId: string) {
  if (targetId === "anthropic-claude") {
    return "https://docs.anthropic.com";
  }
  if (targetId === "deepseek-api") {
    return "https://api-docs.deepseek.com/zh-cn/";
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

export async function runRemoteConnectionCheck(
  targetId: string,
  options?: {
    mode?: RemoteConnectionCheckMode;
    log?: boolean;
  }
): Promise<AgentConnectionCheckResponse> {
  const mode = options?.mode || "full";
  const shouldLog = options?.log ?? true;
  clearProviderEnvCache();

  const target = getServerAgentTarget(targetId);
  if (!target) {
    throw new Error(`Unknown target: ${targetId}`);
  }
  if (target.execution !== "remote") {
    throw new Error("Connection checks only apply to remote API targets.");
  }
  if (target.transport !== "openai-compatible") {
    throw new Error(
      `Connection checks currently support only openai-compatible targets. ${target.label} uses ${target.transport}.`
    );
  }

  const resolvedTarget = resolveTarget(targetId);
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(resolvedTarget.resolvedApiKey ? { Authorization: `Bearer ${resolvedTarget.resolvedApiKey}` } : {})
  };
  const stages: AgentConnectionCheckStage[] = [];

  try {
    const { response, latencyMs } = await timedFetch(`${resolvedTarget.resolvedBaseUrl}/models`, {
      method: "GET",
      headers
    });
    const httpStatus = response.status;

    if (!response.ok) {
      const errorText = await response.text();
      stages.push(buildErrorStage("models", `HTTP ${httpStatus}: ${errorText.slice(0, 180)}`, latencyMs, httpStatus));
    } else {
      const data = (await response.json()) as { data?: Array<{ id?: string }> };
      const models = Array.isArray(data.data) ? data.data : [];
      const modelFound = models.some((model) => model.id === resolvedTarget.resolvedModel);
      stages.push({
        id: "models",
        ok: true,
        latencyMs,
        httpStatus,
        summary: modelFound
          ? `Model list reachable. Found ${resolvedTarget.resolvedModel} in ${models.length} advertised models.`
          : `Model list reachable. ${resolvedTarget.resolvedModel} was not explicitly listed in ${models.length} models.`
      });
    }
  } catch (error) {
    stages.push(buildErrorStage("models", error instanceof Error ? error.message : "Models request failed."));
  }

  try {
    const { response, latencyMs } = await timedFetch(`${resolvedTarget.resolvedBaseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: resolvedTarget.resolvedModel,
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

  if (mode === "full") {
    try {
      const { response, latencyMs } = await timedFetch(`${resolvedTarget.resolvedBaseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: resolvedTarget.resolvedModel,
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
  }

  const payload: AgentConnectionCheckResponse = {
    ok: stages.every((stage) => stage.ok),
    targetId,
    targetLabel: target.label,
    providerLabel: target.providerLabel,
    resolvedBaseUrl: resolvedTarget.resolvedBaseUrl,
    resolvedModel: resolvedTarget.resolvedModel,
    checkedAt: new Date().toISOString(),
    docsUrl: buildConnectionCheckDocsUrl(targetId),
    stages
  };

  if (shouldLog) {
    appendConnectionCheckLog({
      kind: "connection-check",
      id: crypto.randomUUID(),
      ...payload
    });
  }

  return payload;
}
