import type { AgentMessage } from "@/lib/agent/types";

const MULTI_STEP_PATTERNS = [
  /(首先|然后|最后|接着|再|分步骤|一步步|逐步)/,
  /(first|then|finally|step by step|break down|multi-step|plan)/i,
  /(먼저|그다음|마지막으로|단계별)/,
  /(まず|次に|最後に|段階的)/,
  /(read|inspect|compare|edit|patch|benchmark|report|analyze|retrieve|cite)/i
];

function truncate(value: string, max = 72) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

export function buildSessionMemory(messages: AgentMessage[], maxItems = 4) {
  const userPrompts = messages
    .filter((message) => message.role === "user")
    .map((message) => truncate(message.content, 96))
    .filter(Boolean)
    .slice(-maxItems);

  if (!userPrompts.length) return "";

  return userPrompts.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

export function buildTaskPlan(input: string, options: { enableTools?: boolean; enableRetrieval?: boolean }) {
  const normalized = input.trim();
  if (!normalized) return [] as string[];
  const needsPlan = normalized.length > 120 || MULTI_STEP_PATTERNS.some((pattern) => pattern.test(normalized));
  if (!needsPlan) return [] as string[];

  const steps = ["Clarify the user's goal and constraints."];
  if (options.enableRetrieval) {
    steps.push("Check the knowledge base first and identify usable evidence.");
  }
  if (options.enableTools) {
    steps.push("Inspect the workspace or run the minimum necessary tools before making claims.");
  }
  steps.push("Draft the answer or change in the smallest correct form.");
  steps.push("Call out uncertainty, risks, or missing evidence if confidence is low.");
  return steps;
}

function buildWorkspaceEvidenceGuidance(input: string, options: { enableTools?: boolean; enableRetrieval?: boolean }) {
  if (!options.enableTools) return [] as string[];

  const normalized = input.trim();
  if (!normalized) return [] as string[];

  const repoSpecificPatterns = [
    /(仓库|repo|repository|代码|文件|目录|路由|route|store|修复点|patch|diff|实现|当前项目|当前仓库|哪个文件|哪条路由)/i,
    /(file|files|folder|directory|route|store|path|implemented|implementation|fix|where|which file|codebase|repo)/i
  ];

  if (!repoSpecificPatterns.some((pattern) => pattern.test(normalized))) {
    return [] as string[];
  }

  const guidance = [
    "Workspace evidence rules:",
    "- When the user asks which file, route, store, or implementation changed something, do not answer from memory.",
    "- Use list_files first to locate the real relative paths, then use read_file to confirm the exact file before naming it.",
    "- Only cite file paths that were actually confirmed by tools in this turn.",
    "- This workspace commonly uses app/, lib/, components/, scripts/, and docs/. Do not invent src/ paths unless a tool result shows them."
  ];

  if (options.enableRetrieval) {
    guidance.push(
      "- Retrieval may help with summaries, but repository-specific file paths still need tool confirmation."
    );
  }

  return guidance;
}

export function composeOperationalSystemPrompt(
  basePrompt: string,
  memorySummary: string,
  plannerSteps: string[],
  options?: { input?: string; enableTools?: boolean; enableRetrieval?: boolean }
) {
  const sections = [basePrompt];

  if (memorySummary.trim()) {
    sections.push("", "Session memory:", memorySummary);
  }

  if (plannerSteps.length) {
    sections.push("", "Execution plan:", ...plannerSteps.map((step, index) => `${index + 1}. ${step}`));
  }

  const workspaceEvidenceGuidance = buildWorkspaceEvidenceGuidance(options?.input || "", {
    enableTools: options?.enableTools,
    enableRetrieval: options?.enableRetrieval
  });
  if (workspaceEvidenceGuidance.length) {
    sections.push("", ...workspaceEvidenceGuidance);
  }

  return sections.join("\n");
}
