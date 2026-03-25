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

export function composeOperationalSystemPrompt(
  basePrompt: string,
  memorySummary: string,
  plannerSteps: string[]
) {
  const sections = [basePrompt];

  if (memorySummary.trim()) {
    sections.push("", "Session memory:", memorySummary);
  }

  if (plannerSteps.length) {
    sections.push("", "Execution plan:", ...plannerSteps.map((step, index) => `${index + 1}. ${step}`));
  }

  return sections.join("\n");
}
