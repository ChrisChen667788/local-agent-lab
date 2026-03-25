import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { getAgentTarget } from "@/lib/agent/catalog";
import { cancelWorkspaceConfirmation, runWorkspaceTool } from "@/lib/agent/server-tools";
import type { AgentToolDecisionRequest, AgentToolDecisionResponse } from "@/lib/agent/types";

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AgentToolDecisionRequest>;
    if (!body.targetId || typeof body.targetId !== "string") {
      return NextResponse.json({ error: "targetId is required." }, { status: 400 });
    }
    if (!body.toolName || typeof body.toolName !== "string") {
      return NextResponse.json({ error: "toolName is required." }, { status: 400 });
    }
    if (!body.input || typeof body.input !== "object" || Array.isArray(body.input)) {
      return NextResponse.json({ error: "input must be a tool argument object." }, { status: 400 });
    }
    if (!body.confirmationToken || typeof body.confirmationToken !== "string") {
      return NextResponse.json({ error: "confirmationToken is required." }, { status: 400 });
    }
    if (body.action !== "approve" && body.action !== "reject") {
      return NextResponse.json({ error: "action must be approve or reject." }, { status: 400 });
    }

    const target = getAgentTarget(body.targetId);
    if (!target) {
      return NextResponse.json({ error: `Unknown target: ${body.targetId}` }, { status: 404 });
    }

    if (target.execution === "local") {
      const localEnv = loadLocalEnv();
      const resolvedBaseUrl = readEnv(localEnv, target.baseUrlEnv, target.baseUrlDefault).replace(/\/$/, "");
      const gatewayBaseUrl = resolvedBaseUrl.replace(/\/v1$/, "");
      const endpoint =
        body.action === "approve"
          ? `${gatewayBaseUrl}/v1/tools/run`
          : `${gatewayBaseUrl}/v1/tools/confirmations/reject`;
      const payload =
        body.action === "approve"
          ? {
              tool_name: body.toolName,
              arguments: {
                ...body.input,
                confirmationToken: body.confirmationToken
              }
            }
          : {
              confirmation_token: body.confirmationToken
            };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Local tool decision failed (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as AgentToolDecisionResponse["toolRun"];
      const toolRun =
        body.action === "approve"
          ? data
          : {
              name: body.toolName,
              input: {
                ...body.input,
                confirmationToken: body.confirmationToken,
                userDecision: "reject"
              },
              output: data.output
            };

      return NextResponse.json({ toolRun } satisfies AgentToolDecisionResponse);
    }

    if (body.action === "reject") {
      const cancelled = cancelWorkspaceConfirmation(body.confirmationToken);
      return NextResponse.json({
        toolRun: {
          name: body.toolName,
          input: {
            ...body.input,
            confirmationToken: body.confirmationToken,
            userDecision: "reject"
          },
          output: JSON.stringify(
            {
              status: "rejected_by_user",
              confirmationToken: body.confirmationToken,
              cancelled,
              message: "Pending confirmation was rejected and will not be executed."
            },
            null,
            2
          )
        }
      } satisfies AgentToolDecisionResponse);
    }

    const toolRun = await runWorkspaceTool(body.toolName, {
      ...body.input,
      confirmationToken: body.confirmationToken
    });
    return NextResponse.json({ toolRun } satisfies AgentToolDecisionResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
