import type {
  AgentCompareRequest,
  AgentFineTuneAdapterArtifact,
  AgentFineTuneDataset,
  AgentFineTuneRecipe,
  AgentFineTuneSummary,
  AgentProviderProfile,
  AgentTarget,
  AgentThinkingMode
} from "@/lib/agent/types";

type HandoffContext = {
  adapter: AgentFineTuneAdapterArtifact;
  recipe: AgentFineTuneRecipe;
  dataset: AgentFineTuneDataset | null;
};

type FineTuneBenchmarkRequest = {
  targetIds: string[];
  benchmarkMode: "prompt" | "suite";
  prompt?: string;
  suiteId?: string;
  runNote: string;
  runs: number;
  contextWindow: number;
  providerProfile: AgentProviderProfile;
  thinkingMode: AgentThinkingMode;
};

export type FineTuneCompareHandoffPlan = {
  request: AgentCompareRequest;
  referenceTargetId?: string;
  referenceTargetLabel?: string;
  promptPreview: string;
};

export type FineTuneBenchmarkHandoffPlan = {
  request: FineTuneBenchmarkRequest;
  referenceTargetId?: string;
  referenceTargetLabel?: string;
  promptPreview: string;
};

const REMOTE_REFERENCE_TARGET_PRIORITY = [
  "gpt-5.4",
  "claude-api",
  "deepseek-api",
  "openai-codex"
];

function normalizeHandoffContextWindow(sequenceLength: number) {
  if (sequenceLength <= 4096) return 4096;
  if (sequenceLength <= 8192) return 8192;
  if (sequenceLength <= 16384) return 16384;
  return 32768;
}

function createRepresentativePrompt(context: HandoffContext) {
  const preview = context.dataset?.validation.preview?.[0];
  if (preview?.inputPreview?.trim()) {
    return preview.inputPreview.trim();
  }

  const datasetLabel = context.dataset?.label || "the current fine-tune dataset";
  return [
    "Read the release note snippet below and produce a compact operator-facing summary.",
    "",
    "Requirements:",
    "1. Return exactly three bullets.",
    "2. Bullet 1: what changed.",
    "3. Bullet 2: the main regression risk.",
    "4. Bullet 3: the next validation step.",
    "5. Keep each bullet concise.",
    "6. Do not mention training, prompt setup, or internal reasoning.",
    "",
    `Context source: ${datasetLabel}`,
    `Adapter: ${context.adapter.adapterName}`,
    `Base target: ${context.adapter.baseTargetLabel || context.recipe.baseTargetId}`
  ].join("\n\n");
}

function buildRunNote(context: HandoffContext, referenceTarget?: AgentTarget | null) {
  const representativePrompt = createRepresentativePrompt(context);
  return [
    `Fine-tune adapter handoff: ${context.adapter.adapterName}`,
    `Base target: ${context.adapter.baseTargetLabel || context.recipe.baseTargetId}`,
    context.adapter.attachedTargetLabel ? `Attached runtime target: ${context.adapter.attachedTargetLabel}` : "",
    context.dataset ? `Dataset: ${context.dataset.label}` : "",
    context.dataset?.sourcePath ? `Dataset path: ${context.dataset.sourcePath}` : "",
    context.recipe.benchmarkSuiteId ? `Benchmark suite: ${context.recipe.benchmarkSuiteId}` : "",
    `Recipe method: ${context.recipe.fineTuneMethod}`,
    `Sequence length: ${context.recipe.sequenceLength}`,
    `Output dir: ${context.adapter.outputDir}`,
    referenceTarget ? `Reference target: ${referenceTarget.label}` : "",
    "",
    "Representative prompt:",
    representativePrompt
  ]
    .filter(Boolean)
    .join("\n");
}

function loadRiskRank(target: AgentTarget) {
  switch (target.loadGuardrailLevel) {
    case "safe":
      return 0;
    case "caution":
      return 1;
    case "blocked":
      return 3;
    default:
      return 2;
  }
}

function parameterScaleRank(target: AgentTarget) {
  const matched = target.parameterScale?.match(/(\d+(?:\.\d+)?)/);
  if (!matched) return Number.POSITIVE_INFINITY;
  const value = Number(matched[1]);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function pickReferenceTarget(baseTargetId: string, targets: AgentTarget[]) {
  const candidates = targets.filter((target) => target.id !== baseTargetId);
  const localCandidates = candidates
    .filter((target) => target.execution === "local" && target.loadGuardrailLevel !== "blocked")
    .sort((left, right) => {
      const riskDelta = loadRiskRank(left) - loadRiskRank(right);
      if (riskDelta !== 0) return riskDelta;
      return parameterScaleRank(left) - parameterScaleRank(right);
    });
  if (localCandidates.length) {
    return localCandidates[0];
  }

  for (const targetId of REMOTE_REFERENCE_TARGET_PRIORITY) {
    const matched = candidates.find((target) => target.id === targetId);
    if (matched) return matched;
  }

  return candidates[0] || null;
}

export function resolveFineTuneAdapterContext(
  adapterId: string,
  summary: AgentFineTuneSummary
): HandoffContext | null {
  const adapter = summary.adapters.find((entry) => entry.id === adapterId);
  if (!adapter) return null;
  const recipe = summary.jobs.find((entry) => entry.id === adapter.jobId)
    ? summary.recipes.find((entry) => entry.id === summary.jobs.find((job) => job.id === adapter.jobId)?.recipeId)
    : null;
  if (!recipe) return null;
  const dataset = summary.datasets.find((entry) => entry.id === recipe.datasetId) || null;
  return { adapter, recipe, dataset };
}

export function buildFineTuneBenchmarkHandoffPlan(input: {
  adapterId: string;
  summary: AgentFineTuneSummary;
  targetCatalog: AgentTarget[];
}): FineTuneBenchmarkHandoffPlan | null {
  const context = resolveFineTuneAdapterContext(input.adapterId, input.summary);
  if (!context) return null;

  const adapterTarget = context.adapter.attachedTargetId
    ? input.targetCatalog.find((target) => target.id === context.adapter.attachedTargetId)
    : null;
  const baseTarget = input.targetCatalog.find((target) => target.id === context.recipe.baseTargetId) || null;
  const referenceTarget = baseTarget || pickReferenceTarget(context.recipe.baseTargetId, input.targetCatalog);
  const targetIds = Array.from(
    new Set(
      [adapterTarget?.id || context.recipe.baseTargetId, referenceTarget?.id].filter(
        (value): value is string => Boolean(value)
      )
    )
  );
  const promptPreview = createRepresentativePrompt(context);
  const request: FineTuneBenchmarkRequest = {
    targetIds,
    benchmarkMode: context.recipe.benchmarkSuiteId ? "suite" : "prompt",
    runNote: buildRunNote(context, referenceTarget),
    runs: 1,
    contextWindow: normalizeHandoffContextWindow(context.recipe.sequenceLength),
    providerProfile: "balanced",
    thinkingMode: "standard"
  };

  if (context.recipe.benchmarkSuiteId) {
    request.suiteId = context.recipe.benchmarkSuiteId;
  } else {
    request.prompt = promptPreview;
  }

  return {
    request,
    referenceTargetId: referenceTarget?.id,
    referenceTargetLabel: referenceTarget?.label,
    promptPreview
  };
}

export function buildFineTuneCompareHandoffPlan(input: {
  adapterId: string;
  summary: AgentFineTuneSummary;
  targetCatalog: AgentTarget[];
}): FineTuneCompareHandoffPlan | null {
  const context = resolveFineTuneAdapterContext(input.adapterId, input.summary);
  if (!context) return null;

  const adapterTarget = context.adapter.attachedTargetId
    ? input.targetCatalog.find((target) => target.id === context.adapter.attachedTargetId)
    : null;
  const baseTarget = input.targetCatalog.find((target) => target.id === context.recipe.baseTargetId) || null;
  const referenceTarget = baseTarget || pickReferenceTarget(context.recipe.baseTargetId, input.targetCatalog);
  const promptPreview = createRepresentativePrompt(context);
  const request: AgentCompareRequest = {
    targetIds: Array.from(
      new Set(
        [adapterTarget?.id || context.recipe.baseTargetId, referenceTarget?.id].filter(
          (value): value is string => Boolean(value)
        )
      )
    ),
    input: promptPreview,
    messages: [],
    systemPrompt:
      "Run this as a post-fine-tune smoke check. Return only the final answer, keep it concise, do not narrate internal reasoning, and do not mention the training setup, prompt contract, or evaluation harness unless the user explicitly asks for them.",
    compareIntent: "model-vs-model",
    compareOutputShape: "freeform",
    enableTools: false,
    enableRetrieval: false,
    contextWindow: normalizeHandoffContextWindow(context.recipe.sequenceLength),
    providerProfile: "balanced",
    thinkingMode: "standard",
    plannerEnabled: false
  };

  return {
    request,
    referenceTargetId: referenceTarget?.id,
    referenceTargetLabel: referenceTarget?.label,
    promptPreview
  };
}
