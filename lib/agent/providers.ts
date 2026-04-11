import { agentToolSpecs } from "@/lib/agent/catalog";
import {
  ensureLocalGatewayAvailableDetailed,
  probeLocalGateway,
  restartLocalGateway
} from "@/lib/agent/local-gateway";
import { getServerAgentTarget } from "@/lib/agent/server-targets";
import { runWorkspaceTool } from "@/lib/agent/server-tools";
import type {
  AgentChatRequest,
  AgentMessage,
  AgentThinkingMode,
  AgentProviderProfile,
  AgentToolRun,
  AgentUsage,
  OpenAICompatibleToolCall,
  ProviderReply,
  ResolvedTarget
} from "@/lib/agent/types";
import { existsSync, readFileSync } from "fs";
import path from "path";

let localEnvCache: Record<string, string> | null = null;
const MAX_REMOTE_TOOL_STEPS = 6;
const LOCAL_GATEWAY_REQUEST_TIMEOUT_MS = 150000;
const LOCAL_GATEWAY_WARMUP_WAIT_MS = 300000;
const LOCAL_4B_DOWNGRADE_LOADING_THRESHOLD_MS = 120000;
const LOCAL_COMPARISON_4B_TARGET_IDS = new Set(["local-qwen3-4b-4bit", "local-qwen35-4b-4bit"]);
const LOCAL_GATEWAY_LOADING_RESPONSE_RE = /still loading|loading\./i;
const LOCAL_META_REASONING_RE = /^(好的|好，|首先|我需要|我先|让我|讓我|用户让我|用戶讓我|The user|First, I need|I need to|Let me|I'll need to)/i;
const STRICT_JSON_PATTERNS = [
  /(只输出|只返回|必须返回|返回格式必须是|不要输出其他内容|不要解释).{0,24}json/i,
  /(only output|return only|must return|response format must be|do not output anything else|no explanation).{0,24}json/i,
  /```json/i,
  /\bjson\b/i
];
const JSON_TOOL_CALL_PATTERNS = [
  /(只输出|仅输出|只返回|only output|return only).{0,18}(json).{0,18}(工具调用|tool call)/i,
  /\b(weather\.get_current|repo\.read_file|task\.schedule)\b/i
];
const SINGLE_LINE_PATTERNS = [/(只输出一行|single line|one line)/i, /\bDONE\b/i];
const BULLET_ONLY_PATTERNS = [/(3 条 bullet|3 bullets|bulletCount|bullet)/i];
const TOOL_INTENT_PATTERNS = [
  /(^|\b)(repo|repository|file|files|folder|directory|directories|code|patch|diff|command|shell|terminal|run|execute|edit|write|read|inspect|list|fix|implement|search|grep|rg|mkdir|npm|pnpm|yarn|git|tool|apply_patch|write_file|execute_command|list_files|read_file|prettier|format)(\b|$)/i,
  /(仓库|代[码碼]|文件|目录|目錄|补丁|補丁|命令|终端|終端|执行|執行|运行|運行|修改|读取|讀取|检查|檢查|列出|修复|修復|实现|實作|搜索|搜尋|脚本|腳本|格式化|比较|比較|对比|對比)/,
  /(저장소|코드|파일|디렉터리|패치|명령|실행|수정|읽기|검사|목록|구현|검색|포맷)/,
  /(リポジトリ|コード|ファイル|ディレクトリ|パッチ|コマンド|実行|修正|読み取り|確認|一覧|実装|検索|整形|比較)/
];
const CONTINUATION_PATTERNS = [/(继续|繼續|next step|continue|proceed)/i, /(다음 단계|계속)/, /(次へ|続けて)/];
const REPO_EVIDENCE_REQUIRED_PATTERNS = [
  /(哪个文件|哪条路由|哪个 route|哪个 store|修复点|实现在哪|文件路径|route 文件|store 文件|相对路径)/i,
  /(which file|which route|which store|file path|relative path|implemented where|where is the fix|what file)/i
];

function loadLocalEnv() {
  if (localEnvCache) return localEnvCache;

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
      const value = rawValue.replace(/^['"]|['"]$/g, "");
      values[key] = value;
    }
  }

  localEnvCache = values;
  return values;
}

export function clearProviderEnvCache() {
  localEnvCache = null;
}

function readEnv(name: string | undefined, fallback: string) {
  if (!name) return fallback;
  const localEnv = loadLocalEnv();
  return localEnv[name] || process.env[name] || fallback;
}

export function resolveTarget(targetId: string): ResolvedTarget {
  return resolveTargetWithMode(targetId, "standard");
}

export function resolveTargetWithMode(
  targetId: string,
  thinkingMode: AgentThinkingMode = "standard"
): ResolvedTarget {
  const target = getServerAgentTarget(targetId);
  if (!target) {
    throw new Error(`Unknown target: ${targetId}`);
  }

  const resolvedBaseUrl = readEnv(target.baseUrlEnv, target.baseUrlDefault).replace(/\/$/, "");
  const modelEnv = thinkingMode === "thinking" ? target.thinkingModelEnv || target.modelEnv : target.modelEnv;
  const modelDefault =
    thinkingMode === "thinking" ? target.thinkingModelDefault || target.modelDefault : target.modelDefault;
  const resolvedModel =
    target.id === "deepseek-api" && thinkingMode === "thinking"
      ? readEnv(target.modelEnv, target.modelDefault)
      : readEnv(modelEnv, modelDefault);
  const resolvedApiKey = target.apiKeyEnv ? readEnv(target.apiKeyEnv, "") : undefined;

  if (target.apiKeyEnv && !resolvedApiKey) {
    throw new Error(`Missing ${target.apiKeyEnv}. Add it to .env.local before using ${target.label}.`);
  }

  return {
    ...target,
    resolvedApiKey,
    resolvedBaseUrl,
    resolvedModel
  };
}

export function isThinkingModelConfigured(targetId: string) {
  const target = getServerAgentTarget(targetId);
  if (!target?.thinkingModelEnv) return false;
  return Boolean(readEnv(target.thinkingModelEnv, target.thinkingModelDefault || ""));
}

function estimateTokens(text: string) {
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

export function buildContextMessages(messages: AgentMessage[], input: string, contextWindow = 8192) {
  const budget = Math.max(1024, Math.min(contextWindow, 32768));
  const nextMessages = [...messages, { role: "user" as const, content: input }];
  const selected: AgentMessage[] = [];
  let spent = 0;

  for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
    const message = nextMessages[index];
    const messageCost = estimateTokens(message.content) + 8;
    if (selected.length > 0 && spent + messageCost > budget) {
      break;
    }
    selected.unshift(message);
    spent += messageCost;
  }

  return selected;
}

export function buildProviderMessages(messages: AgentMessage[], input: string, contextWindow?: number) {
  return buildContextMessages(messages, input, contextWindow).slice(-10);
}

export function normalizeProviderProfile(
  profile?: AgentProviderProfile | string | null
): AgentProviderProfile {
  return profile === "speed" || profile === "tool-first" ? profile : "balanced";
}

export function normalizeThinkingMode(
  mode?: AgentThinkingMode | string | null
): AgentThinkingMode {
  return mode === "thinking" ? "thinking" : "standard";
}

export function resolveEffectiveProviderProfile(
  requestedProfile: AgentProviderProfile,
  thinkingMode: AgentThinkingMode,
  input: string,
  messages: AgentMessage[]
) {
  if (thinkingMode === "thinking") {
    return "tool-first" as const;
  }
  if (requestedProfile !== "balanced") {
    return requestedProfile;
  }
  const trimmed = input.trim();
  const shortPrompt = trimmed.length > 0 && trimmed.length <= 60;
  const noHistory = messages.length === 0;
  const noToolIntent = !TOOL_INTENT_PATTERNS.some((pattern) => pattern.test(trimmed));
  return shortPrompt && noHistory && noToolIntent ? "speed" : requestedProfile;
}

export function suggestMaxTokens(
  execution: "local" | "remote",
  enableTools: boolean,
  input: string,
  providerProfile: AgentProviderProfile = "balanced"
) {
  const inputLength = input.trim().length;
  const strictJsonRequested = expectsStrictJsonOutput(input);
  if (execution === "local") {
    if (enableTools) {
      return strictJsonRequested ? 384 : 256;
    }
    if (strictJsonRequested) {
      return inputLength > 4000 ? 512 : 384;
    }
    return inputLength > 4000 ? 256 : 192;
  }
  if (providerProfile === "speed") {
    if (enableTools) {
      return inputLength <= 80 ? 224 : 320;
    }
    return inputLength <= 80 ? 96 : 144;
  }
  if (providerProfile === "tool-first") {
    if (enableTools) {
      return inputLength <= 80 ? 512 : 768;
    }
    return inputLength <= 80 ? 160 : 256;
  }
  if (enableTools) {
    return inputLength <= 80 ? 384 : 512;
  }
  return inputLength <= 80 ? 128 : 192;
}

export function isDeepSeekCompatibleTarget(target: ResolvedTarget) {
  return target.id === "deepseek-api" || /deepseek/i.test(target.resolvedModel);
}

export type OpenAICompatibleProviderFamily =
  | "openai"
  | "deepseek"
  | "claude-compatible"
  | "moonshot"
  | "zhipu"
  | "dashscope"
  | "generic";

export function getOpenAICompatibleProviderFamily(target: ResolvedTarget): OpenAICompatibleProviderFamily {
  const baseUrl = target.resolvedBaseUrl.toLowerCase();
  const model = target.resolvedModel.toLowerCase();
  if (target.id === "openai-gpt54" || baseUrl.includes("api.openai.com") || /\bgpt-|o\d|o[34]\b/.test(model)) {
    return "openai";
  }
  if (target.id === "deepseek-api" || baseUrl.includes("deepseek.com") || model.includes("deepseek")) {
    return "deepseek";
  }
  if (target.id === "anthropic-claude" || model.includes("claude")) {
    return "claude-compatible";
  }
  if (target.id === "kimi-api" || baseUrl.includes("moonshot.cn") || model.includes("kimi")) {
    return "moonshot";
  }
  if (target.id === "glm-api" || baseUrl.includes("bigmodel.cn") || model.includes("glm")) {
    return "zhipu";
  }
  if (target.id === "qwen-api" || baseUrl.includes("dashscope.aliyuncs.com") || model.includes("qwen")) {
    return "dashscope";
  }
  return "generic";
}

function isOpenAICompatibleRemoteTarget(target: ResolvedTarget) {
  return target.execution === "remote" && target.transport === "openai-compatible";
}

function expectsJsonToolCallOutput(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return false;
  return JSON_TOOL_CALL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function expectsSingleLineOutput(input: string) {
  return SINGLE_LINE_PATTERNS.some((pattern) => pattern.test(input));
}

function expectsBulletOnlyOutput(input: string) {
  return BULLET_ONLY_PATTERNS.some((pattern) => pattern.test(input));
}

export function buildProviderOutputContract(systemPrompt: string, options: {
  target: ResolvedTarget;
  input: string;
  enableTools: boolean;
  thinkingMode?: AgentThinkingMode;
}) {
  const { target, input, enableTools, thinkingMode = "standard" } = options;
  const lines: string[] = [];
  const strictJsonRequested = expectsStrictJsonOutput(input);
  const jsonToolCallRequested = expectsJsonToolCallOutput(input);
  const providerFamily = getOpenAICompatibleProviderFamily(target);

  if (strictJsonRequested) {
    lines.push("- Return valid JSON only.");
    lines.push("- Do not wrap JSON in markdown fences.");
    lines.push("- Do not add prose before or after the JSON payload.");
  }

  if (jsonToolCallRequested) {
    lines.push("- Return exactly one compact JSON object with top-level keys `name` and `arguments`.");
    lines.push("- Use the key `arguments`; never use `parameters`, `args`, or markdown code fences.");
    lines.push("- Keep argument values machine-readable and API-friendly.");
  }

  if (expectsSingleLineOutput(input)) {
    lines.push("- Return one visible line only.");
  }

  if (expectsBulletOnlyOutput(input)) {
    lines.push("- If the task asks for bullet items, emit only the requested bullet lines.");
  }

  if (isOpenAICompatibleRemoteTarget(target) && (strictJsonRequested || jsonToolCallRequested)) {
    lines.push("- Prefer one final machine-readable payload over explanatory lead-in text.");
    lines.push("- Keep the visible answer parseable even if the provider performs hidden reasoning first.");
  }

  if (isOpenAICompatibleRemoteTarget(target) && enableTools) {
    lines.push("- If tools are enabled, do not narrate the tool choice before emitting the structured result.");
  }

  if (isDeepSeekCompatibleTarget(target) && thinkingMode === "thinking") {
    lines.push("- Always produce a final visible answer in `content`; do not stop after reasoning alone.");
  }

  if ((providerFamily === "moonshot" || providerFamily === "zhipu" || providerFamily === "dashscope") && strictJsonRequested) {
    lines.push("- Keep keys stable and avoid optional prose fields that would break downstream regression parsing.");
  }

  if ((providerFamily === "moonshot" || providerFamily === "zhipu" || providerFamily === "dashscope") && jsonToolCallRequested) {
    lines.push("- Return the tool object directly; avoid extra explanation, markdown, or roleplay around the tool payload.");
  }

  if (!lines.length) {
    return systemPrompt;
  }

  return [
    systemPrompt,
    "",
    "Provider output contract:",
    ...lines
  ].join("\n");
}

export function buildOpenAICompatibleRequestShape(options: {
  target: ResolvedTarget;
  input: string;
  enableTools: boolean;
  thinkingMode?: AgentThinkingMode;
}) {
  const { target, input, enableTools, thinkingMode = "standard" } = options;
  const bodyExtras: Record<string, unknown> = {};
  let model = target.resolvedModel;
  const strictJsonRequested = expectsStrictJsonOutput(input);
  const jsonToolCallRequested = expectsJsonToolCallOutput(input);

  if (target.execution === "local") {
    const extraBody = buildLocalChatTemplateExtraBody(target, thinkingMode);
    if (extraBody) {
      bodyExtras.extra_body = extraBody;
    }
  }

  if (isDeepSeekCompatibleTarget(target) && thinkingMode === "thinking") {
    model = readEnv(target.modelEnv, target.modelDefault);
    bodyExtras.thinking = { type: "enabled" };
  }

  if (
    !enableTools &&
    isOpenAICompatibleRemoteTarget(target) &&
    (strictJsonRequested || jsonToolCallRequested)
  ) {
    bodyExtras.response_format = { type: "json_object" };
  }

  return {
    model,
    bodyExtras
  };
}

export function resolveSuggestedMaxTokens(options: {
  target: ResolvedTarget;
  enableTools: boolean;
  input: string;
  providerProfile?: AgentProviderProfile;
  thinkingMode?: AgentThinkingMode;
  requestedMaxTokens?: number;
}) {
  const {
    target,
    enableTools,
    input,
    providerProfile = "balanced",
    thinkingMode = "standard",
    requestedMaxTokens
  } = options;

  const suggested = suggestMaxTokens(target.execution, enableTools, input, providerProfile);
  const strictJsonRequested = expectsStrictJsonOutput(input);
  const jsonToolCallRequested = expectsJsonToolCallOutput(input);
  const providerFamily = getOpenAICompatibleProviderFamily(target);
  let nextMaxTokens =
    typeof requestedMaxTokens === "number" ? Math.min(requestedMaxTokens, suggested) : suggested;

  if (isDeepSeekCompatibleTarget(target) && thinkingMode === "thinking") {
    let deepSeekReasoningFloor = 1024;
    if (providerProfile === "tool-first") {
      deepSeekReasoningFloor = 2048;
    }
    if (strictJsonRequested) {
      deepSeekReasoningFloor = Math.max(deepSeekReasoningFloor, 2048);
    }
    if (enableTools) {
      deepSeekReasoningFloor = Math.max(deepSeekReasoningFloor, 3072);
    }
    nextMaxTokens = Math.max(nextMaxTokens, deepSeekReasoningFloor);
  }

  if (
    isOpenAICompatibleRemoteTarget(target) &&
    providerFamily !== "deepseek" &&
    providerFamily !== "claude-compatible"
  ) {
    let providerSpecificFloor = 0;
    if (thinkingMode === "thinking") {
      providerSpecificFloor = 1536;
    }
    if (providerProfile === "tool-first") {
      providerSpecificFloor = Math.max(providerSpecificFloor, 1024);
    }
    if (strictJsonRequested || jsonToolCallRequested) {
      providerSpecificFloor = Math.max(providerSpecificFloor, thinkingMode === "thinking" ? 2048 : 1280);
    }
    if (enableTools) {
      providerSpecificFloor = Math.max(providerSpecificFloor, thinkingMode === "thinking" ? 2048 : 1408);
    }
    if (providerSpecificFloor > 0) {
      nextMaxTokens = Math.max(nextMaxTokens, providerSpecificFloor);
    }
  }

  return nextMaxTokens;
}

function extractTextFromContent(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (!entry || typeof entry !== "object") return "";
        const value = (entry as { text?: unknown }).text;
        return typeof value === "string" ? value : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractReasoningContent(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function sanitizeAssistantContent(content: string) {
  const sanitized = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();
  return sanitized || content.trim();
}

export function expectsStrictJsonOutput(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return false;
  return STRICT_JSON_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function stripCodeFences(value: string) {
  return value
    .replace(/^```[a-zA-Z0-9_-]*\s*/u, "")
    .replace(/```$/u, "")
    .trim();
}

function extractJsonCandidate(value: string) {
  const normalized = stripCodeFences(value);
  const braceStart = normalized.indexOf("{");
  const braceEnd = normalized.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
    return normalized.slice(braceStart, braceEnd + 1);
  }
  const bracketStart = normalized.indexOf("[");
  const bracketEnd = normalized.lastIndexOf("]");
  if (bracketStart !== -1 && bracketEnd !== -1 && bracketEnd > bracketStart) {
    return normalized.slice(bracketStart, bracketEnd + 1);
  }
  return null;
}

export function normalizeStructuredAnswerOutput(content: string, input: string) {
  const sanitized = sanitizeAssistantContent(content);
  if (!expectsStrictJsonOutput(input)) {
    return sanitized;
  }

  const normalized = stripCodeFences(sanitized);
  for (const candidate of [normalized, extractJsonCandidate(normalized)]) {
    if (!candidate) continue;
    try {
      return JSON.stringify(JSON.parse(candidate), null, 2);
    } catch {
      // Keep trying fallbacks.
    }
  }

  return normalized;
}

export function shouldUseToolLoop(
  input: string,
  messages: AgentMessage[],
  providerProfile: AgentProviderProfile = "balanced"
) {
  const normalizedInput = input.trim();
  if (!normalizedInput) return false;

  if (providerProfile === "tool-first") {
    return true;
  }

  if (TOOL_INTENT_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return true;
  }

  if (providerProfile === "speed") {
    return false;
  }

  if (!messages.length) {
    return false;
  }

  const recentContext = messages.slice(-4).map((message) => message.content).join("\n");
  return CONTINUATION_PATTERNS.some((pattern) => pattern.test(normalizedInput)) &&
    TOOL_INTENT_PATTERNS.some((pattern) => pattern.test(recentContext));
}

function requiresWorkspaceToolEvidence(input: string) {
  const normalizedInput = input.trim();
  if (!normalizedInput) return false;
  return REPO_EVIDENCE_REQUIRED_PATTERNS.some((pattern) => pattern.test(normalizedInput));
}

function shouldPreferSimpleLocalFallback(
  request: AgentChatRequest,
  providerProfile: AgentProviderProfile
) {
  if (request.enableTools || request.enableRetrieval) {
    return false;
  }
  if (request.messages.length > 0) {
    return false;
  }
  if (providerProfile === "tool-first") {
    return false;
  }
  const trimmed = request.input.trim();
  if (!trimmed || trimmed.length > 120) {
    return false;
  }
  if (TOOL_INTENT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return false;
  }
  return true;
}

function safeJsonParse(value: string) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function shouldRetryProviderCall(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /(429|500|502|503|504|timed out|timeout|connection|network|temporarily|empty)/i.test(message);
}

function mergeWarnings(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ").trim() || undefined;
}

function applyLocalAnswerDiscipline(
  systemPrompt: string,
  execution: "local" | "remote",
  input: string
) {
  if (execution !== "local") {
    return systemPrompt;
  }

  const jsonOnlyInstructions = expectsStrictJsonOutput(input)
    ? [
        "- If the user requires JSON, return valid JSON only.",
        "- Do not wrap JSON in markdown fences.",
        "- Finish all required keys before ending the response."
      ]
    : [];

  return [
    systemPrompt,
    "",
    "Local answer discipline:",
    "- Respond directly to the user with the final answer.",
    "- Do not narrate your internal reasoning process.",
    "- Do not say phrases like '用户问的是' or '我需要先'.",
    "- Keep simple answers short and concrete.",
    ...jsonOnlyInstructions
  ].join("\n");
}

function looksLikeLocalMetaReasoning(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return LOCAL_META_REASONING_RE.test(trimmed);
}

async function repairLocalDirectAnswer(
  target: ResolvedTarget,
  systemPrompt: string,
  request: AgentChatRequest,
  contextWindow: number | undefined,
  thinkingMode: AgentThinkingMode = "standard"
) {
  return callOpenAICompatible(
    target,
    [
      systemPrompt,
      "",
      "Direct answer override:",
      "- You already have enough context to answer the user.",
      "- Reply directly to the user.",
      "- Do not describe the user, your plan, or your reasoning.",
      "- Avoid phrases like '用户让我', '我需要先', 'The user asks', or 'First, I need'.",
      "- Keep the answer concise."
    ].join("\n"),
    request.messages,
    request.input,
    false,
    contextWindow,
    "speed",
    thinkingMode
  );
}

async function withSingleRecovery(
  runner: () => Promise<ProviderReply>,
  options: { execution: "local" | "remote"; fallback?: () => Promise<ProviderReply> }
) {
  try {
    const first = await runner();
    if (first.content.trim() || first.toolRuns.length || first.warning) {
      return first;
    }
    if (!options.fallback) {
      return {
        ...first,
        warning: "Empty provider response. No automatic recovery path was configured."
      };
    }
    const recovered = await options.fallback();
    return {
      ...recovered,
      warning: recovered.warning || "Recovered after an empty first response."
    };
  } catch (error) {
    if (!options.fallback || !shouldRetryProviderCall(error) || options.execution === "local") {
      throw error;
    }
    const recovered = await options.fallback();
    return {
      ...recovered,
      warning: recovered.warning || "Recovered after one automatic retry."
    };
  }
}

function buildOpenAITools() {
  return agentToolSpecs.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}

async function executeToolCalls(toolCalls: OpenAICompatibleToolCall[]) {
  const runs: AgentToolRun[] = [];
  for (const toolCall of toolCalls) {
    runs.push(await runWorkspaceTool(toolCall.name, toolCall.arguments));
  }
  return runs;
}

function normalizeUsage(usage: unknown): AgentUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const value = usage as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  const promptTokens = typeof value.prompt_tokens === "number" ? value.prompt_tokens : 0;
  const completionTokens =
    typeof value.completion_tokens === "number" ? value.completion_tokens : 0;
  const totalTokens = typeof value.total_tokens === "number" ? value.total_tokens : promptTokens + completionTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens
  };
}

function buildLocalChatTemplateExtraBody(
  target: ResolvedTarget,
  thinkingMode: AgentThinkingMode
) {
  if (target.execution !== "local") {
    return undefined;
  }
  if (target.id !== "local-qwen35-4b-4bit") {
    return undefined;
  }
  return {
    chat_template_kwargs: {
      enable_thinking: thinkingMode === "thinking"
    }
  };
}

async function fetchWithAbortTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAICompatible(
  target: ResolvedTarget,
  systemPrompt: string,
  messages: AgentMessage[],
  input: string,
  enableTools: boolean,
  contextWindow?: number,
  providerProfile: AgentProviderProfile = "balanced",
  thinkingMode: AgentThinkingMode = "standard"
): Promise<ProviderReply> {
  let warning: string | undefined;
  if (target.execution === "local") {
    const firstReady = await probeLocalGateway(target.resolvedBaseUrl, 1500);
    if (!firstReady) {
      const ensured = await ensureLocalGatewayAvailableDetailed(target.resolvedBaseUrl, {
        waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS
      });
      if (!ensured.ok) {
        throw new Error(`Local runtime is offline: ${ensured.reason}`);
      }
      const secondReady = await probeLocalGateway(target.resolvedBaseUrl, 5000);
      if (!secondReady) {
        throw new Error("Local runtime did not become ready after ensure.");
      }
    }

    try {
      const healthResponse = await fetch(
        `${target.resolvedBaseUrl.replace(/\/v1$/, "")}/health`,
        { cache: "no-store" }
      );
      if (healthResponse.ok) {
        const health = (await healthResponse.json()) as {
          loading_alias?: string | null;
          loading_elapsed_ms?: number | null;
        };
        const otherAliasBlocking =
          health.loading_alias &&
          health.loading_alias !== target.id &&
          typeof health.loading_elapsed_ms === "number" &&
          health.loading_elapsed_ms >= LOCAL_4B_DOWNGRADE_LOADING_THRESHOLD_MS;
        if (otherAliasBlocking) {
          const restarted = await restartLocalGateway(target.resolvedBaseUrl, {
            waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS
          });
          if (restarted) {
            warning = mergeWarnings(
              warning,
              `Recovered after restarting a local gateway blocked on ${health.loading_alias}.`
            );
          }
        }
      }
    } catch {
      // Let the main request path handle local runtime errors.
    }
  }
  const effectiveSystemPrompt = buildProviderOutputContract(systemPrompt, {
    target,
    input,
    enableTools,
    thinkingMode
  });
  const requestMessages: Array<Record<string, unknown>> = [
    { role: "system", content: effectiveSystemPrompt },
    ...buildProviderMessages(messages, input, contextWindow).map((message) => ({
      role: message.role,
      content: message.content
    }))
  ];
  const headers = {
    "Content-Type": "application/json",
    ...(target.resolvedApiKey ? { Authorization: `Bearer ${target.resolvedApiKey}` } : {})
  };
  const toolRuns: AgentToolRun[] = [];
  let currentMessages: Array<Record<string, unknown>> = requestMessages;
  let latestUsage: AgentUsage | undefined;

  for (let step = 0; step < MAX_REMOTE_TOOL_STEPS; step += 1) {
    const defaultMaxTokens = resolveSuggestedMaxTokens({
      target,
      enableTools,
      input,
      providerProfile,
      thinkingMode
    });
    const requestShape = buildOpenAICompatibleRequestShape({
      target,
      input,
      enableTools,
      thinkingMode
    });
    const body: Record<string, unknown> = {
      model: requestShape.model,
      messages: currentMessages,
      max_tokens: defaultMaxTokens
    };
    if (Object.keys(requestShape.bodyExtras).length) {
      Object.assign(body, requestShape.bodyExtras);
    }

    if (enableTools && target.supportsTools) {
      body.tools = buildOpenAITools();
      body.tool_choice = step === 0 && requiresWorkspaceToolEvidence(input) ? "required" : "auto";
    }

    const sendRequest = () =>
      fetchWithAbortTimeout(`${target.resolvedBaseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      }, target.execution === "local" ? LOCAL_GATEWAY_REQUEST_TIMEOUT_MS : 45000);

    let response: Response;
    try {
      response = await sendRequest();
    } catch (error) {
      if (target.execution !== "local") {
        throw error;
      }
      const stillReachable = await probeLocalGateway(target.resolvedBaseUrl, 5000);
      if (stillReachable) {
        response = await sendRequest();
        warning = mergeWarnings(warning, "Recovered after retrying a slow local gateway request.");
      } else {
        const ensured = await ensureLocalGatewayAvailableDetailed(target.resolvedBaseUrl, {
          waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS
        });
        const readyAfterEnsure = ensured.ok && (await probeLocalGateway(target.resolvedBaseUrl, 5000));
        if (!readyAfterEnsure) {
          const restarted = await restartLocalGateway(target.resolvedBaseUrl, {
            waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS
          });
          if (!restarted || !(await probeLocalGateway(target.resolvedBaseUrl, 5000))) {
            throw new Error("Local runtime is offline and request retry failed.");
          }
          warning = mergeWarnings(warning, "Recovered after restarting the local gateway.");
        } else {
          warning = mergeWarnings(warning, "Recovered after waiting for the local gateway to finish starting.");
        }
        response = await sendRequest();
      }
    }

    if (!response.ok && target.execution === "local") {
      const initialStatus = response.status;
      const errorText = await response.text();
      const recoverableStatus =
        [409, 500, 502, 503, 504].includes(initialStatus) &&
        (initialStatus !== 409 || LOCAL_GATEWAY_LOADING_RESPONSE_RE.test(errorText));
      if (recoverableStatus) {
        const restarted = await restartLocalGateway(target.resolvedBaseUrl, {
          waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS
        });
        if (restarted) {
          const readyAfterRestart = await probeLocalGateway(target.resolvedBaseUrl, 5000);
          if (readyAfterRestart) {
            response = await sendRequest();
            warning = mergeWarnings(
              warning,
              initialStatus === 409
                ? "Recovered after restarting a local gateway that was blocked on model loading."
                : "Recovered after restarting the local gateway."
            );
          }
        }
      }
      if (!response.ok) {
        const finalErrorText = await response.text();
        throw new Error(
          `Provider request failed (${response.status}): ${finalErrorText || errorText}`
        );
      }
    }

    const data = (await response.json()) as {
      tool_runs?: AgentToolRun[];
      warning?: string;
      usage?: unknown;
      choices?: Array<{
        message?: {
          content?: unknown;
          reasoning_content?: unknown;
          tool_calls?: Array<{
            id?: string;
            function?: {
              name?: string;
              arguments?: string;
            };
          }>;
        };
      }>;
    };

    warning = data.warning || warning;
    latestUsage = normalizeUsage(data.usage) || latestUsage;
    const assistantMessage = data.choices?.[0]?.message;
    const content = sanitizeAssistantContent(extractTextFromContent(assistantMessage?.content));
    const reasoningContent = extractReasoningContent(assistantMessage?.reasoning_content);
    const toolCalls =
      assistantMessage?.tool_calls?.map((toolCall) => ({
        id: toolCall.id || crypto.randomUUID(),
        name: toolCall.function?.name || "unknown_tool",
        arguments: safeJsonParse(toolCall.function?.arguments || "{}")
      })) || [];

    if (!toolCalls.length) {
      return {
        content,
        toolCalls: [],
        toolRuns: [...toolRuns, ...(data.tool_runs || [])],
        usage: latestUsage,
        warning,
        resolvedModel: requestShape.model
      };
    }

    const stepRuns = await executeToolCalls(toolCalls);
    toolRuns.push(...stepRuns);

    currentMessages = [
      ...currentMessages,
      {
        role: "assistant",
        content,
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
        tool_calls: toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments)
          }
        }))
      },
      ...stepRuns.map((run, index) => ({
        role: "tool",
        tool_call_id: toolCalls[index]?.id,
        content: run.output
      }))
    ];
  }

  return {
    content: "",
    toolCalls: [],
    toolRuns,
    usage: latestUsage,
    resolvedModel: target.resolvedModel,
    warning:
      warning ||
      `Tool loop stopped after ${MAX_REMOTE_TOOL_STEPS} steps. Narrow the task or inspect the latest tool output.`
  };
}

function buildAnthropicTools() {
  return agentToolSpecs.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema
  }));
}

async function callAnthropic(
  target: ResolvedTarget,
  systemPrompt: string,
  messages: AgentMessage[],
  input: string,
  enableTools: boolean,
  contextWindow?: number,
  providerProfile: AgentProviderProfile = "balanced"
): Promise<ProviderReply> {
  const requestMessages: Array<Record<string, unknown>> = buildProviderMessages(messages, input, contextWindow).map((message) => ({
    role: message.role,
    content: message.content
  }));

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01"
  };

  if (target.resolvedApiKey) {
    headers["x-api-key"] = target.resolvedApiKey;
  }
  const toolRuns: AgentToolRun[] = [];
  let currentMessages: Array<Record<string, unknown>> = requestMessages;
  let warning: string | undefined;

  for (let step = 0; step < MAX_REMOTE_TOOL_STEPS; step += 1) {
    const body: Record<string, unknown> = {
      model: target.resolvedModel,
      system: systemPrompt,
      messages: currentMessages,
      max_tokens: resolveSuggestedMaxTokens({
        target,
        enableTools,
        input,
        providerProfile
      })
    };

    if (enableTools && target.supportsTools) {
      body.tools = buildAnthropicTools();
    }

    const response = await fetch(`${target.resolvedBaseUrl}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Provider request failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      content?: Array<
        | {
            type?: "text";
            text?: string;
          }
        | {
            type?: "tool_use";
            id?: string;
            name?: string;
            input?: Record<string, unknown>;
          }
      >;
    };

    const blocks = data.content || [];
    const textBlocks = blocks.filter(
      (block): block is { type?: "text"; text?: string } =>
        block.type === "text" && typeof block.text === "string"
    );
    const toolUseBlocks = blocks.filter(
      (
        block
      ): block is { type: "tool_use"; id: string; name: string; input?: Record<string, unknown> } =>
        block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string"
    );
    const content = sanitizeAssistantContent(textBlocks.map((block) => block.text).join("\n"));
    const toolCalls = toolUseBlocks.map((block) => ({
      id: block.id,
      name: block.name,
      arguments: block.input || {}
    }));

    if (!toolCalls.length) {
      return {
        content,
        toolCalls: [],
        toolRuns,
        warning:
          warning ||
          (enableTools && !content.trim()
            ? "The Claude-compatible endpoint returned no text or tool blocks. This provider may not expose Anthropic tool use reliably; disable tools for Claude or use the local gateway / an OpenAI-compatible target."
            : undefined)
      };
    }

    const stepRuns = await executeToolCalls(toolCalls);
    toolRuns.push(...stepRuns);

    currentMessages = [
      ...currentMessages,
      {
        role: "assistant",
        content: blocks
      },
      {
        role: "user",
        content: stepRuns.map((run, index) => ({
          type: "tool_result",
          tool_use_id: toolCalls[index]?.id,
          content: run.output
        }))
      }
    ];
  }

  return {
    content: "",
    toolCalls: [],
    toolRuns,
    warning: `Tool loop stopped after ${MAX_REMOTE_TOOL_STEPS} steps. Narrow the task or inspect the latest tool output.`
  };
}

export async function runAgentRequest(request: AgentChatRequest, systemPrompt: string) {
  const thinkingMode = normalizeThinkingMode(request.thinkingMode);
  const target = resolveTargetWithMode(request.targetId, thinkingMode);
  const effectiveSystemPrompt = applyLocalAnswerDiscipline(systemPrompt, target.execution, request.input);
  const thinkingFallbackToStandard = thinkingMode === "thinking" && !isThinkingModelConfigured(request.targetId);
  const providerProfile = resolveEffectiveProviderProfile(
    normalizeProviderProfile(request.providerProfile),
    thinkingMode,
    request.input,
    request.messages
  );
  const enableTools =
    Boolean(request.enableTools) &&
    target.supportsTools &&
    shouldUseToolLoop(request.input, request.messages, providerProfile);
  const warning =
    request.enableTools && !target.supportsTools
      ? "The selected local target is running in chat-first mode. Switch to a remote provider if you want workspace tools."
      : undefined;

  const localFallbackTarget =
    !request.disableLocalFallback &&
    target.execution === "local" && LOCAL_COMPARISON_4B_TARGET_IDS.has(target.id)
      ? resolveTargetWithMode("local-qwen3-0.6b", "standard")
      : null;

  const runForTarget = (candidateTarget: ResolvedTarget, candidateProfile: AgentProviderProfile) =>
    candidateTarget.transport === "anthropic"
      ? callAnthropic(
          candidateTarget,
          effectiveSystemPrompt,
          request.messages,
          request.input,
          enableTools,
          request.contextWindow,
          candidateProfile
        )
      : callOpenAICompatible(
          candidateTarget,
          effectiveSystemPrompt,
          request.messages,
          request.input,
          enableTools,
          request.contextWindow,
          candidateProfile,
          thinkingMode
        );

  const primaryRunner = () => runForTarget(target, providerProfile);

  const fallbackProfile = providerProfile === "speed" ? "balanced" : providerProfile;
  const fallbackRunner =
    target.execution === "remote"
      ? () =>
          runForTarget(target, fallbackProfile)
      : undefined;

  let reply: ProviderReply;
  let resolvedModel = target.resolvedModel;
  let localFallbackUsed = false;
  let localFallbackTargetId: string | undefined;
  let localFallbackTargetLabel: string | undefined;
  let localFallbackReason: string | undefined;

  if (localFallbackTarget && target.execution === "local") {
    const preferSimpleLocalFallback = shouldPreferSimpleLocalFallback(request, providerProfile);
    try {
      const healthResponse = await fetch(
        `${target.resolvedBaseUrl.replace(/\/v1$/, "")}/health`,
        { cache: "no-store" }
      );
      if (healthResponse.ok) {
        const health = (await healthResponse.json()) as {
          loading_alias?: string | null;
          loaded_alias?: string | null;
          loading_elapsed_ms?: number | null;
          loading_error?: string | null;
          runtime_import_error?: string | null;
        };
        const loadingTooLong =
          health.loading_alias === target.id &&
          typeof health.loading_elapsed_ms === "number" &&
          health.loading_elapsed_ms >= LOCAL_4B_DOWNGRADE_LOADING_THRESHOLD_MS;
        const unhealthyRuntime = Boolean(health.loading_error || health.runtime_import_error);
        const simpleLocalRoute =
          preferSimpleLocalFallback &&
          health.loading_alias === target.id;
        if (simpleLocalRoute || loadingTooLong || unhealthyRuntime) {
          let downgradedReply: ProviderReply | null = null;
          if (!simpleLocalRoute) {
            await restartLocalGateway(target.resolvedBaseUrl, {
              waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS
            }).catch(() => false);
          }
          try {
            downgradedReply = await runForTarget(localFallbackTarget, "speed");
          } catch {
            await restartLocalGateway(target.resolvedBaseUrl, {
              waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS
            }).catch(() => false);
            downgradedReply = await runForTarget(localFallbackTarget, "speed");
          }
          return {
            content: sanitizeAssistantContent(downgradedReply.content),
            providerLabel: target.providerLabel,
            targetLabel: target.label,
            resolvedModel: localFallbackTarget.resolvedModel,
            resolvedBaseUrl: target.resolvedBaseUrl,
            providerProfile,
            thinkingMode,
            thinkingFallbackToStandard,
            localFallbackUsed: true,
            localFallbackTargetId: localFallbackTarget.id,
            localFallbackTargetLabel: localFallbackTarget.label,
            localFallbackReason: simpleLocalRoute
              ? "simple-local-route"
              : loadingTooLong
              ? "primary-local-still-loading"
              : "primary-local-health-warning",
            toolRuns: downgradedReply.toolRuns,
            execution: target.execution,
            usage: downgradedReply.usage,
            warning: mergeWarnings(
              downgradedReply.warning,
              simpleLocalRoute
                ? `Automatic local downgrade applied: ${target.label} is still cold-loading, so this short request was served by ${localFallbackTarget.label}.`
                : loadingTooLong
                ? `Automatic local downgrade applied: ${target.label} is still loading, so the request was served by ${localFallbackTarget.label}.`
                : `Automatic local downgrade applied: ${target.label} reported a local runtime warning, so the request was served by ${localFallbackTarget.label}.`
            )
          };
        }
      }
    } catch {
      // Fall through to the primary runner and let the normal recovery path handle failures.
    }
  }

  try {
    reply = await withSingleRecovery(primaryRunner, {
      execution: target.execution,
      fallback: fallbackRunner
    });

    if (
      localFallbackTarget &&
      !reply.content.trim() &&
      !reply.toolRuns.length
    ) {
      await restartLocalGateway(target.resolvedBaseUrl, { waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS }).catch(() => false);
      const downgradedReply = await runForTarget(localFallbackTarget, "speed");
      reply = {
        ...downgradedReply,
        warning: mergeWarnings(
          downgradedReply.warning,
          `Automatic local downgrade applied: ${target.label} -> ${localFallbackTarget.label} because the primary local model returned no visible answer.`
        )
      };
      resolvedModel = localFallbackTarget.resolvedModel;
      localFallbackUsed = true;
      localFallbackTargetId = localFallbackTarget.id;
      localFallbackTargetLabel = localFallbackTarget.label;
      localFallbackReason = "empty-visible-answer";
    }
  } catch (error) {
    if (!localFallbackTarget) {
      throw error;
    }

    await restartLocalGateway(target.resolvedBaseUrl, { waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS }).catch(() => false);
    const downgradedReply = await runForTarget(localFallbackTarget, "speed");
    reply = {
      ...downgradedReply,
      warning: mergeWarnings(
        downgradedReply.warning,
        `Automatic local downgrade applied: ${target.label} -> ${localFallbackTarget.label} after primary local failure: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    };
    resolvedModel = localFallbackTarget.resolvedModel;
    localFallbackUsed = true;
    localFallbackTargetId = localFallbackTarget.id;
    localFallbackTargetLabel = localFallbackTarget.label;
    localFallbackReason = "primary-local-failure";
  }

  let finalContent = normalizeStructuredAnswerOutput(reply.content, request.input);
  resolvedModel = reply.resolvedModel || resolvedModel;
  if (target.execution === "local" && looksLikeLocalMetaReasoning(finalContent)) {
    const repairTarget =
      localFallbackUsed && localFallbackTargetId === localFallbackTarget?.id
        ? localFallbackTarget
        : target;
    if (repairTarget) {
      try {
        const repairedReply = await repairLocalDirectAnswer(
          repairTarget,
          effectiveSystemPrompt,
          request,
          request.contextWindow,
          thinkingMode
        );
        const repairedContent = normalizeStructuredAnswerOutput(repairedReply.content, request.input);
        if (repairedContent.trim() && !looksLikeLocalMetaReasoning(repairedContent)) {
          reply = {
            ...reply,
            content: repairedContent,
            usage: repairedReply.usage || reply.usage,
            warning: mergeWarnings(reply.warning, "Repaired after local meta-reasoning output.")
          };
          finalContent = repairedContent;
        }
      } catch {
        // Keep the first local answer if the repair attempt fails.
      }
    }
  }

  return {
    content: finalContent,
    providerLabel: target.providerLabel,
    targetLabel: target.label,
    resolvedModel,
    resolvedBaseUrl: target.resolvedBaseUrl,
    providerProfile,
    thinkingMode,
    thinkingFallbackToStandard,
    localFallbackUsed,
    localFallbackTargetId,
    localFallbackTargetLabel,
    localFallbackReason,
    toolRuns: reply.toolRuns,
    execution: target.execution,
    usage: reply.usage,
    warning: reply.warning || warning
  };
}
