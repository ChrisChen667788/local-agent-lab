import type { AgentTarget, AgentToolSpec } from "@/lib/agent/types";

export const agentTargets: AgentTarget[] = [
  {
    id: "local-qwen3-0.6b",
    label: "Local Qwen3 0.6B",
    providerLabel: "Local MLX Gateway",
    transport: "openai-compatible",
    execution: "local",
    description:
      "Fast local profile for prompt iteration, repo Q&A, and low-pressure agent flows on your M1 Max.",
    modelEnv: "LOCAL_QWEN_0_6B_MODEL",
    modelDefault: "local-qwen3-0.6b",
    baseUrlEnv: "LOCAL_AGENT_BASE_URL",
    baseUrlDefault: "http://127.0.0.1:4000/v1",
    supportsTools: true,
    recommendedContext: "4K-8K",
    memoryProfile: "Lowest pressure. Best fit for your normal workday state.",
    notes: [
      "Use this when PyCharm, WeChat, Safari tabs, and background apps are still open.",
      "Good for planning, summary, and small file reasoning.",
      "Native tool loop is enabled in the Python gateway, so file inspection happens inside one local process."
    ],
    launchHints: [
      "python3.12 -m venv .venv && source .venv/bin/activate",
      "pip install mlx mlx-lm fastapi uvicorn",
      "python scripts/local_model_gateway_supervisor.py"
    ]
  },
  {
    id: "local-qwen3-4b-4bit",
    label: "Local Qwen3 4B 4-bit",
    providerLabel: "Local MLX Gateway",
    transport: "openai-compatible",
    execution: "local",
    description:
      "Balanced local profile for richer answers and better coding quality. Intended for a 4-bit MLX model on Apple Silicon.",
    modelEnv: "LOCAL_QWEN_4B_4BIT_MODEL",
    modelDefault: "local-qwen3-4b-4bit",
    baseUrlEnv: "LOCAL_AGENT_BASE_URL",
    baseUrlDefault: "http://127.0.0.1:4000/v1",
    supportsTools: true,
    recommendedContext: "8K-16K",
    memoryProfile: "Requires a cleaner desktop session. Close heavy apps before use.",
    notes: [
      "This target is meant to map to mlx-community/Qwen3-4B-Instruct-2507-4bit in the Python gateway.",
      "If memory pressure is already yellow or swap is high, fall back to 0.6B.",
      "Use this when you want local file-aware reasoning without switching to a cloud model."
    ],
    launchHints: [
      "export LOCAL_QWEN_4B_4BIT_REPO=mlx-community/Qwen3-4B-Instruct-2507-4bit",
      "python scripts/local_model_gateway_supervisor.py"
    ]
  },
  {
    id: "openai-codex",
    label: "OpenAI Codex",
    providerLabel: "OpenAI",
    transport: "openai-compatible",
    execution: "remote",
    description:
      "Remote coding target for Codex-like agent loops. Tool calling stays enabled in this app for OpenAI-compatible providers.",
    modelEnv: "OPENAI_MODEL",
    modelDefault: "gpt-5.2-codex",
    thinkingModelEnv: "OPENAI_THINKING_MODEL",
    thinkingModelDefault: "gpt-5.2-codex",
    baseUrlEnv: "OPENAI_BASE_URL",
    baseUrlDefault: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    supportsTools: true,
    recommendedContext: "Server-side",
    memoryProfile: "Offloaded to API provider.",
    notes: [
      "Use this when you want the strongest coding agent behaviour.",
      "Model id stays configurable in .env.local so you can swap to another OpenAI coding model later."
    ]
  },
  {
    id: "anthropic-claude",
    label: "Claude API",
    providerLabel: "Aipro Claude via OpenAI-compatible",
    transport: "openai-compatible",
    execution: "remote",
    description:
      "Claude target backed by Aipro's OpenAI-compatible endpoint. This path is more reliable for tool calls than Anthropic Messages on Aipro.",
    modelEnv: "ANTHROPIC_MODEL",
    modelDefault: "claude-sonnet-4-6",
    thinkingModelEnv: "ANTHROPIC_THINKING_MODEL",
    thinkingModelDefault: "claude-sonnet-4-6",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
    baseUrlDefault: "https://vip.aipro.love/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    supportsTools: true,
    recommendedContext: "Server-side",
    memoryProfile: "Offloaded to API provider.",
    notes: [
      "The provided sk-prefixed key works against Aipro's gateway, not Anthropic's official console.",
      "For claude-sonnet-4-6 on Aipro, OpenAI-compatible chat completions is more reliable than Anthropic Messages when tools are enabled."
    ]
  },
  {
    id: "kimi-api",
    label: "Kimi API",
    providerLabel: "Moonshot",
    transport: "openai-compatible",
    execution: "remote",
    description:
      "OpenAI-compatible Moonshot target. Good fit once you want to compare Kimi against local Qwen profiles.",
    modelEnv: "KIMI_MODEL",
    modelDefault: "kimi-k2-0905-preview",
    thinkingModelEnv: "KIMI_THINKING_MODEL",
    thinkingModelDefault: "kimi-k2-0905-preview",
    baseUrlEnv: "KIMI_BASE_URL",
    baseUrlDefault: "https://api.moonshot.cn/v1",
    apiKeyEnv: "KIMI_API_KEY",
    supportsTools: true,
    recommendedContext: "Server-side",
    memoryProfile: "Offloaded to API provider.",
    notes: [
      "Kept OpenAI-compatible on purpose, so the same tool loop can be reused.",
      "You can override the default model id in .env.local."
    ]
  },
  {
    id: "glm-api",
    label: "GLM API",
    providerLabel: "Zhipu",
    transport: "openai-compatible",
    execution: "remote",
    description:
      "GLM coding target via its OpenAI-compatible endpoint. Useful if you later want a cheaper coding back-end.",
    modelEnv: "GLM_MODEL",
    modelDefault: "glm-4.7",
    thinkingModelEnv: "GLM_THINKING_MODEL",
    thinkingModelDefault: "glm-4.7",
    baseUrlEnv: "GLM_BASE_URL",
    baseUrlDefault: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnv: "GLM_API_KEY",
    supportsTools: true,
    recommendedContext: "Server-side",
    memoryProfile: "Offloaded to API provider.",
    notes: [
      "You can switch this to the coding endpoint later without changing the front-end.",
      "Model naming differs by vendor plan, so keep it env-driven."
    ]
  },
  {
    id: "qwen-api",
    label: "Qwen API",
    providerLabel: "DashScope",
    transport: "openai-compatible",
    execution: "remote",
    description:
      "DashScope OpenAI-compatible target for Qwen hosted inference. Keeps the same agent shell while moving inference off-device.",
    modelEnv: "DASHSCOPE_MODEL",
    modelDefault: "qwen-plus",
    thinkingModelEnv: "DASHSCOPE_THINKING_MODEL",
    thinkingModelDefault: "qwen-plus",
    baseUrlEnv: "DASHSCOPE_BASE_URL",
    baseUrlDefault: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    supportsTools: true,
    recommendedContext: "Server-side",
    memoryProfile: "Offloaded to API provider.",
    notes: [
      "Useful when you want Qwen semantics but do not want local memory pressure.",
      "Compatible-mode keeps migration cost low."
    ]
  }
];

export const agentToolSpecs: AgentToolSpec[] = [
  {
    name: "list_files",
    description: "List files inside the current workspace. Use this before reading or planning edits.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative directory path inside the workspace. Defaults to the workspace root."
        },
        limit: {
          type: "integer",
          description: "Maximum number of files to return. Keep it small when exploring.",
          minimum: 1,
          maximum: 200
        }
      }
    }
  },
  {
    name: "read_file",
    description: "Read a UTF-8 text file from the current workspace with optional line slicing.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path inside the workspace."
        },
        startLine: {
          type: "integer",
          description: "1-based start line.",
          minimum: 1
        },
        endLine: {
          type: "integer",
          description: "1-based end line. The tool clamps large ranges.",
          minimum: 1,
          maximum: 400
        }
      },
      required: ["path"]
    }
  },
  {
    name: "execute_command",
    description:
      "Run an allowlisted non-interactive shell command inside the workspace. Commands are classified as read, build, formatter, patcher, package-manager, misc-write, or privileged. Workspace-changing classes require an explicit confirmation step.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to run with zsh -lc."
        },
        cwd: {
          type: "string",
          description: "Optional relative working directory inside the workspace."
        },
        timeoutMs: {
          type: "integer",
          description: "Optional timeout in milliseconds. Defaults to 20000 and caps at 120000.",
          minimum: 1000,
          maximum: 120000
        },
        confirmationToken: {
          type: "string",
          description:
            "Required only after the tool returns confirmation_required for a repo-write command."
        }
      },
      required: ["command"]
    }
  },
  {
    name: "write_file",
    description:
      "Write or append UTF-8 text to a workspace file. The tool returns a diff preview and post-write verification.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path inside the workspace."
        },
        content: {
          type: "string",
          description: "Full text content to write."
        },
        mode: {
          type: "string",
          description: "overwrite, append, or error_if_exists.",
          enum: ["overwrite", "append", "error_if_exists"]
        },
        createDirectories: {
          type: "boolean",
          description: "Create missing parent directories when true."
        },
        confirmationToken: {
          type: "string",
          description:
            "Required only after the tool returns confirmation_required for protected source paths."
        }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "apply_patch",
    description:
      "Apply a unified diff patch inside the workspace. The tool returns a patch preview and per-file verification details.",
    inputSchema: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          description: "Unified diff patch text."
        },
        stripCount: {
          type: "integer",
          description: "Path strip count passed to patch -pN. Defaults to 1.",
          minimum: 0,
          maximum: 3
        },
        dryRun: {
          type: "boolean",
          description: "Run patch in dry-run mode without modifying files."
        },
        confirmationToken: {
          type: "string",
          description:
            "Required only after the tool returns confirmation_required for protected source paths."
        },
        attemptAutoRepair: {
          type: "boolean",
          description:
            "Allow the tool to generate and try a second repair patch if the first patch is rejected."
        }
      },
      required: ["patch"]
    }
  }
];

export function getAgentTarget(targetId: string) {
  return agentTargets.find((target) => target.id === targetId);
}
