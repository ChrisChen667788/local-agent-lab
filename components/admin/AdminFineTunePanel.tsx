"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  AgentBenchmarkResponse,
  AgentCompareResponse,
  AgentFineTuneCurvePoint,
  AgentFineTuneDataset,
  AgentFineTuneJob,
  AgentFineTuneDatasetFormat,
  AgentFineTuneDatasetValidation,
  AgentFineTuneSummary,
  AgentFineTuneUpstreamDatasetCandidate,
  AgentTarget,
} from "@/lib/agent/types";
import {
  buildFineTuneBenchmarkHandoffPlan,
  buildFineTuneCompareHandoffPlan,
} from "@/lib/finetune/handoff";

type FineTunePanelProps = {
  locale: string;
};

type FineTuneResponse = {
  ok?: boolean;
  error?: string;
  summary?: AgentFineTuneSummary;
  validation?: AgentFineTuneDatasetValidation;
  attached?: {
    target?: {
      id: string;
      label: string;
    };
  };
  detached?: {
    attachment?: {
      alias: string;
      label: string;
    };
    releasedRuntime?: boolean;
    releasedAlias?: string | null;
  };
  opened?: {
    opened: boolean;
    path?: string;
    sourceUrl?: string;
  };
};

const DEFAULT_DATASET_FORM = {
  label: "",
  sourcePath: "",
  format: "chat-jsonl" as AgentFineTuneDatasetFormat,
  upstreamQuery: "",
  refreshCadenceHours: 24,
};

const DEFAULT_RECIPE_FORM = {
  label: "",
  datasetId: "",
  baseTargetId: "",
  adapterName: "",
  sequenceLength: 8192,
  batchSize: 4,
  epochs: 3,
  learningRate: 0.0002,
  fineTuneMethod: "lora" as "lora" | "dora",
  optimizer: "adamw" as "adam" | "adamw" | "sgd" | "adafactor",
  numLayers: 16,
  gradientAccumulationSteps: 1,
  loraRank: 16,
  loraAlpha: 32,
  gradientCheckpointing: true,
  validationSplitPct: 10,
  saveEverySteps: 0,
  seed: 42,
  benchmarkSuiteId: "milestone-formal",
  notes: "",
};

type DatasetSourceMode = "local" | "community";

type NumericRecipeFieldKey =
  | "sequenceLength"
  | "batchSize"
  | "epochs"
  | "learningRate"
  | "numLayers"
  | "gradientAccumulationSteps"
  | "loraRank"
  | "loraAlpha"
  | "validationSplitPct"
  | "saveEverySteps"
  | "seed";

type CommunityDatasetPreset = {
  id: string;
  label: {
    en: string;
    zh: string;
  };
  description: {
    en: string;
    zh: string;
  };
  bestFor: {
    en: string;
    zh: string;
  };
  source: "Bundled" | "Hugging Face" | "ModelScope" | "GitHub";
  sourceUrl: string;
  docsUrl?: string;
  paperUrl?: string;
  localPath: string;
  format: AgentFineTuneDatasetFormat;
  upstreamQuery: string;
  sampleCount: number;
  bootstrapRows: number;
  recommendedSamples: number;
  recommendedEpochs: number;
  recommendedSteps: {
    en: string;
    zh: string;
  };
  difficulty: {
    en: string;
    zh: string;
  };
  license: string;
  recipeNotes: {
    en: string;
    zh: string;
  };
};

type TrainingChartRangePreset = "all" | "first-300" | "last-300" | "last-100";

type TrainingChartPoint = AgentFineTuneCurvePoint & {
  rawLoss: number;
  normalizedLoss: number;
  x: number;
  y: number;
};

type TrainingChartHoverState = TrainingChartPoint | null;
type FineTuneJobGroupKey = "active" | "needs-review" | "completed" | "staged";

const TRAINING_CHART_RANGE_PRESETS: TrainingChartRangePreset[] = [
  "all",
  "first-300",
  "last-300",
  "last-100",
];

const COMMUNITY_DATASET_PRESETS: CommunityDatasetPreset[] = [
  {
    id: "first-llm-studio-starter-960",
    label: {
      en: "First LLM Studio long-run 960",
      zh: "First LLM Studio 长轮次 960",
    },
    description: {
      en: "A bundled long-run starter for 800-1,000 optimizer steps, covering compare, benchmark, runtime, retrieval, fine-tune, model discovery, provider, and release workflows.",
      zh: "内置长轮次 starter，适合 800-1,000 个优化 step，覆盖 compare、benchmark、运行时、检索、微调、模型发现、provider 和发布工作流。",
    },
    bestFor: {
      en: "Default long-run beginner path when 8-row smoke data is too small and external community data still needs conversion.",
      zh: "当 8 行 smoke 数据太小、外部社区数据又还要转换时，作为默认长轮次新手路径。",
    },
    source: "Bundled",
    sourceUrl: "https://github.com/ChrisChen667788/local-agent-lab",
    docsUrl: "https://github.com/ChrisChen667788/local-agent-lab",
    localPath: "data/fine-tune/first-llm-studio-starter-960.jsonl",
    format: "instruction-jsonl",
    upstreamQuery:
      "first llm studio local agent compare benchmark fine tune long run starter",
    sampleCount: 960,
    bootstrapRows: 960,
    recommendedSamples: 960,
    recommendedEpochs: 4,
    recommendedSteps: {
      en: "About 960 optimizer steps with batch 4, grad accumulation 1, and 10% validation split.",
      zh: "batch 4、梯度累积 1、10% 验证集时，约 960 个优化 step。",
    },
    difficulty: {
      en: "Best default",
      zh: "最佳默认",
    },
    license: "Project sample data",
    recipeNotes: {
      en: "Use this for the first satisfying long local run. It is large enough for hundreds to 1k steps without requiring external dataset conversion.",
      zh: "第一次想认真跑长轮次本地微调时优先用它。样本量足够支撑数百到约 1k step，且不需要外部数据转换。",
    },
  },
  {
    id: "first-llm-studio-starter-384",
    label: {
      en: "First LLM Studio starter 384",
      zh: "First LLM Studio 新手默认 384",
    },
    description: {
      en: "A bundled, project-shaped SFT starter with compare, benchmark, runtime, retrieval, model discovery, release, and fine-tune support replies.",
      zh: "内置的项目语境 SFT starter，覆盖 compare、benchmark、运行时、检索、模型发现、发布和微调状态回复。",
    },
    bestFor: {
      en: "Default beginner path: safe local LoRA practice on 0.6B or 4B models with enough rows for hundreds of steps.",
      zh: "默认新手路径：适合 0.6B 或 4B 本地模型做安全 LoRA 体验，样本量足够支撑数百 step。",
    },
    source: "Bundled",
    sourceUrl: "https://github.com/ChrisChen667788/local-agent-lab",
    docsUrl: "https://github.com/ChrisChen667788/local-agent-lab",
    localPath: "data/fine-tune/first-llm-studio-starter-384.jsonl",
    format: "instruction-jsonl",
    upstreamQuery:
      "first llm studio local agent compare benchmark fine tune starter",
    sampleCount: 384,
    bootstrapRows: 384,
    recommendedSamples: 384,
    recommendedEpochs: 12,
    recommendedSteps: {
      en: "About 1k optimizer steps with batch 4, grad accumulation 1, and 10% validation split.",
      zh: "batch 4、梯度累积 1、10% 验证集时，约 1k 个优化 step。",
    },
    difficulty: {
      en: "Beginner default",
      zh: "新手默认",
    },
    license: "Project sample data",
    recipeNotes: {
      en: "Default local starter: use this before pulling large public datasets. It teaches product-specific answer style and avoids brittle community formats.",
      zh: "默认本地 starter：先用它体验，再拉大型公开数据集。它训练项目特定回复风格，并规避社区数据格式不稳定问题。",
    },
  },
  {
    id: "alpaca-cleaned-52k",
    label: {
      en: "Alpaca cleaned 52K",
      zh: "Alpaca cleaned 52K",
    },
    description: {
      en: "Classic instruction/output SFT data with broad task coverage and a simple schema that is easy to sample down locally.",
      zh: "经典 instruction/output SFT 数据，任务覆盖广、结构简单，适合本地抽样后训练。",
    },
    bestFor: {
      en: "General instruction following baselines and first external dataset imports.",
      zh: "适合通用指令跟随基线，以及第一次导入外部数据集。",
    },
    source: "Hugging Face",
    sourceUrl: "https://huggingface.co/datasets/yahma/alpaca-cleaned",
    docsUrl: "https://github.com/tatsu-lab/stanford_alpaca",
    paperUrl: "https://crfm.stanford.edu/2023/03/13/alpaca.html",
    localPath: "data/fine-tune/community/alpaca-cleaned-sample.jsonl",
    format: "instruction-jsonl",
    upstreamQuery: "yahma alpaca-cleaned instruction output",
    sampleCount: 51800,
    bootstrapRows: 192,
    recommendedSamples: 1000,
    recommendedEpochs: 4,
    recommendedSteps: {
      en: "Sample 1k to 2k rows first; 4 epochs is usually enough for a local smoke adapter.",
      zh: "先抽样 1k 到 2k 行；本地 smoke adapter 通常 4 个 epoch 足够。",
    },
    difficulty: {
      en: "Beginner external",
      zh: "新手外部集",
    },
    license: "CC BY 4.0, verify upstream before commercial use",
    recipeNotes: {
      en: "Use an extracted local sample before training. Keep validation split enabled because Alpaca-style rows are broad and mixed.",
      zh: "训练前先抽成本地小样本。因为 Alpaca 风格任务较杂，建议保留验证集。",
    },
  },
  {
    id: "belle-cn-instruction",
    label: {
      en: "BELLE Chinese instruction",
      zh: "BELLE 中文指令集",
    },
    description: {
      en: "Large Chinese instruction-tuning family from BELLE, better aligned with Chinese UI copy and assistant replies.",
      zh: "BELLE 系列中文指令微调数据，更贴近中文 UI、助手回复和新手解释场景。",
    },
    bestFor: {
      en: "Chinese assistant tone, beginner explanations, and local product-support adapters.",
      zh: "适合中文助手语气、新手解释和本地产品支持类 adapter。",
    },
    source: "Hugging Face",
    sourceUrl: "https://huggingface.co/datasets/BelleGroup/train_1M_CN",
    docsUrl: "https://github.com/LianjiaTech/BELLE",
    localPath: "data/fine-tune/community/belle-cn-sample.jsonl",
    format: "instruction-jsonl",
    upstreamQuery: "BelleGroup train_1M_CN Chinese instruction tuning",
    sampleCount: 917000,
    bootstrapRows: 192,
    recommendedSamples: 2000,
    recommendedEpochs: 3,
    recommendedSteps: {
      en: "Sample 1k to 3k rows for local runs; use lower epochs because the source is large and repetitive.",
      zh: "本地先抽样 1k 到 3k 行；源数据较大且可能重复，epoch 不宜过高。",
    },
    difficulty: {
      en: "Chinese beginner",
      zh: "中文新手",
    },
    license: "GPL-3.0, verify upstream terms",
    recipeNotes: {
      en: "Good next step after the bundled starter when the user wants stronger Chinese instruction behavior.",
      zh: "当用户想增强中文指令跟随能力时，这是内置 starter 之后的合适升级。",
    },
  },
  {
    id: "ultrachat-200k",
    label: {
      en: "UltraChat 200K",
      zh: "UltraChat 200K",
    },
    description: {
      en: "High-coverage chat data for multi-turn assistant style; useful after the basic instruction path is working.",
      zh: "覆盖面更广的多轮对话数据，适合在基础指令路径跑通后增强聊天风格。",
    },
    bestFor: {
      en: "Conversation quality, long-form answers, and assistant tone comparisons.",
      zh: "适合对话质量、长文回答和助手语气对比。",
    },
    source: "Hugging Face",
    sourceUrl: "https://huggingface.co/datasets/HuggingFaceH4/ultrachat_200k",
    docsUrl: "https://huggingface.co/datasets/HuggingFaceH4/ultrachat_200k",
    localPath: "data/fine-tune/community/ultrachat-200k-sample.jsonl",
    format: "chat-jsonl",
    upstreamQuery: "HuggingFaceH4 ultrachat_200k chat sft",
    sampleCount: 208000,
    bootstrapRows: 160,
    recommendedSamples: 1000,
    recommendedEpochs: 2,
    recommendedSteps: {
      en: "Start with 500 to 1k conversations; keep epochs low to avoid overfitting generic chat style.",
      zh: "先抽 500 到 1k 条对话；epoch 保持较低，避免过拟合泛化聊天风格。",
    },
    difficulty: {
      en: "Intermediate chat",
      zh: "进阶对话",
    },
    license: "MIT, verify card before redistribution",
    recipeNotes: {
      en: "Use when the adapter should sound more conversational than the project-specific starter.",
      zh: "当 adapter 需要比项目 starter 更偏自然对话时使用。",
    },
  },
  {
    id: "magicoder-oss-instruct-75k",
    label: {
      en: "Magicoder OSS-Instruct 75K",
      zh: "Magicoder 代码指令 75K",
    },
    description: {
      en: "Code-focused instruction data generated from open-source code contexts, useful for coding assistant adapters.",
      zh: "面向开源代码上下文生成的代码指令数据，适合编码助手 adapter。",
    },
    bestFor: {
      en: "Code review, patch explanation, and coding workflow compare lanes.",
      zh: "适合代码审阅、补丁解释和编码工作流对比 lane。",
    },
    source: "Hugging Face",
    sourceUrl:
      "https://huggingface.co/datasets/ise-uiuc/Magicoder-OSS-Instruct-75K",
    docsUrl: "https://github.com/ise-uiuc/magicoder",
    paperUrl: "https://arxiv.org/abs/2312.02120",
    localPath: "data/fine-tune/community/magicoder-oss-instruct-sample.jsonl",
    format: "instruction-jsonl",
    upstreamQuery: "Magicoder OSS-Instruct 75K code instruction dataset",
    sampleCount: 75000,
    bootstrapRows: 192,
    recommendedSamples: 1500,
    recommendedEpochs: 3,
    recommendedSteps: {
      en: "Sample 1k to 2k rows for local coding adapters; combine with project-specific review rows.",
      zh: "本地代码 adapter 先抽 1k 到 2k 行；建议和项目内代码审阅样本混合。",
    },
    difficulty: {
      en: "Coding adapter",
      zh: "代码 adapter",
    },
    license: "MIT, verify dataset card",
    recipeNotes: {
      en: "Use for coding-specific adapters, not as the first general assistant dataset.",
      zh: "适合代码专项 adapter，不建议作为第一个通用助手数据集。",
    },
  },
  {
    id: "xlam-function-calling-60k",
    label: {
      en: "xLAM function calling 60K",
      zh: "xLAM 函数调用 60K",
    },
    description: {
      en: "Function-calling data for tool selection and JSON argument generation; useful once basic LoRA runs are stable.",
      zh: "函数调用数据，训练工具选择和 JSON 参数生成；适合基础 LoRA 跑稳后使用。",
    },
    bestFor: {
      en: "Tool-first lanes, OpenAI-compatible provider behavior, and structured tool output checks.",
      zh: "适合 tool-first lane、OpenAI-compatible provider 行为和结构化工具输出检查。",
    },
    source: "Hugging Face",
    sourceUrl:
      "https://huggingface.co/datasets/Salesforce/xlam-function-calling-60k",
    docsUrl: "https://www.salesforceairesearch.com/opensource/xlam",
    paperUrl: "https://arxiv.org/abs/2406.18518",
    localPath: "data/fine-tune/community/xlam-function-calling-sample.jsonl",
    format: "chat-jsonl",
    upstreamQuery: "Salesforce xLAM function calling 60k tool use dataset",
    sampleCount: 60000,
    bootstrapRows: 160,
    recommendedSamples: 1000,
    recommendedEpochs: 3,
    recommendedSteps: {
      en: "Convert a small slice into the project's tool schema first; do not train directly before validating JSON fields.",
      zh: "先把小样本转换成项目工具 schema；校验 JSON 字段前不要直接训练。",
    },
    difficulty: {
      en: "Advanced tool use",
      zh: "进阶工具调用",
    },
    license: "CC BY 4.0, gated terms require acceptance",
    recipeNotes: {
      en: "Use only after tool schema conversion. Best paired with compare lanes that check function-call structure.",
      zh: "必须先做工具 schema 转换；最好配合检查 function-call 结构的 compare lane。",
    },
  },
  {
    id: "coig-modelscope-cn",
    label: {
      en: "COIG Chinese instruction catalog",
      zh: "COIG 中文指令目录",
    },
    description: {
      en: "Chinese open instruction datasets are useful discovery sources on ModelScope, especially for domestic mirrors and Chinese tasks.",
      zh: "中文开源指令数据适合作为魔搭社区发现源，尤其方便国内镜像和中文任务。",
    },
    bestFor: {
      en: "Finding Chinese SFT candidates and keeping scheduled upstream refresh checks useful.",
      zh: "适合发现中文 SFT 候选，并让定期上游检查更有价值。",
    },
    source: "ModelScope",
    sourceUrl:
      "https://www.modelscope.cn/datasets?name=COIG%20instruction%20tuning",
    docsUrl: "https://github.com/BAAI-Zlab/COIG",
    paperUrl: "https://arxiv.org/abs/2304.07987",
    localPath: "data/fine-tune/community/coig-cn-sample.jsonl",
    format: "instruction-jsonl",
    upstreamQuery: "COIG Chinese instruction tuning ModelScope",
    sampleCount: 190000,
    bootstrapRows: 192,
    recommendedSamples: 1500,
    recommendedEpochs: 3,
    recommendedSteps: {
      en: "Use as a discovery preset first; import a validated slice before local training.",
      zh: "先作为发现预设使用；训练前导入并校验一个本地切片。",
    },
    difficulty: {
      en: "Chinese discovery",
      zh: "中文发现源",
    },
    license: "Research/community use, verify upstream terms",
    recipeNotes: {
      en: "Useful for scheduled community discovery; convert and deduplicate before using it as the active dataset.",
      zh: "适合定期社区发现；作为训练集前需要转换、去重并抽样。",
    },
  },
];

function formatDateTime(value?: string) {
  if (!value) return "--";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatNumber(value?: number | null, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toFixed(digits);
}

function formatSampleCount(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString();
}

function formatRatio(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toFixed(2)}x`;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeFineTuneSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function getJobProgressPercent(job: AgentFineTuneJob) {
  if (job.status === "completed") return 100;
  if (typeof job.progress?.percent === "number")
    return clampPercent(job.progress.percent);
  const currentStep = job.progress?.currentStep;
  const totalSteps = job.progress?.totalSteps;
  if (
    typeof currentStep === "number" &&
    typeof totalSteps === "number" &&
    totalSteps > 0
  ) {
    return clampPercent((currentStep / totalSteps) * 100);
  }
  return 0;
}

function getJobStatusMeta(job: AgentFineTuneJob) {
  switch (job.status) {
    case "completed":
      return {
        label: "completed",
        dot: "bg-emerald-300",
        badge: "bg-emerald-400/10 text-emerald-100",
        bar: "from-emerald-300 to-cyan-300",
      };
    case "failed":
      return {
        label: "failed",
        dot: "bg-rose-300",
        badge: "bg-rose-400/10 text-rose-100",
        bar: "from-rose-300 to-amber-300",
      };
    case "running":
    case "queued":
      return {
        label: job.status,
        dot: "bg-cyan-300",
        badge: "bg-cyan-400/10 text-cyan-100",
        bar: "from-cyan-300 to-violet-300",
      };
    case "cancelled":
      return {
        label: "cancelled",
        dot: "bg-slate-400",
        badge: "bg-slate-400/10 text-slate-100",
        bar: "from-slate-400 to-slate-500",
      };
    default:
      return {
        label: job.status,
        dot: "bg-amber-300",
        badge: "bg-amber-400/10 text-amber-100",
        bar: "from-amber-300 to-cyan-300",
      };
  }
}

function getLossBaseline(loss?: number) {
  if (typeof loss === "number" && Number.isFinite(loss) && loss > 0)
    return loss;
  return 1;
}

function buildTrainingChart(
  job: AgentFineTuneJob,
  range: TrainingChartRangePreset = "all",
) {
  const width = 360;
  const height = 180;
  const plot = {
    left: 42,
    right: 14,
    top: 18,
    bottom: 34,
  };
  const points = (job.curve || []).filter(
    (point): point is AgentFineTuneCurvePoint =>
      (point.split === "train" || point.split === "valid") &&
      Number.isFinite(point.step) &&
      Number.isFinite(point.loss),
  );
  if (points.length < 2) {
    return null;
  }

  const sortedPoints = [...points].sort(
    (left, right) => left.step - right.step,
  );
  const minStep = sortedPoints[0]?.step ?? 0;
  const maxStep = sortedPoints.at(-1)?.step ?? 0;
  const stepWindow = (() => {
    if (range === "first-300") {
      return {
        visibleStartStep: minStep,
        visibleEndStep: Math.min(maxStep, minStep + 300),
      };
    }
    if (range === "last-300") {
      return {
        visibleStartStep: Math.max(minStep, maxStep - 300),
        visibleEndStep: maxStep,
      };
    }
    if (range === "last-100") {
      return {
        visibleStartStep: Math.max(minStep, maxStep - 100),
        visibleEndStep: maxStep,
      };
    }
    return {
      visibleStartStep: minStep,
      visibleEndStep: maxStep,
    };
  })();
  const visiblePoints = sortedPoints.filter(
    (point) =>
      point.step >= stepWindow.visibleStartStep &&
      point.step <= stepWindow.visibleEndStep,
  );
  const effectivePoints =
    visiblePoints.length >= 2 ? visiblePoints : sortedPoints;
  const effectiveMinStep = effectivePoints[0]?.step ?? minStep;
  const effectiveMaxStep = effectivePoints.at(-1)?.step ?? maxStep;
  const domainMinStep = Math.floor(effectiveMinStep / 100) * 100;
  const domainMaxStep = Math.max(
    domainMinStep + 100,
    Math.ceil(effectiveMaxStep / 100) * 100,
  );
  const firstTrainLoss = getLossBaseline(
    sortedPoints.find((point) => point.split === "train")?.loss ??
      sortedPoints[0]?.loss,
  );
  const firstValidLoss = getLossBaseline(
    sortedPoints.find((point) => point.split === "valid")?.loss ??
      firstTrainLoss,
  );
  const baselineBySplit = {
    train: firstTrainLoss,
    valid: firstValidLoss,
  };
  const normalizedValues = sortedPoints.map(
    (point) => point.loss / baselineBySplit[point.split],
  );
  const minNormalizedLoss = Math.min(...normalizedValues);
  const maxNormalizedLoss = Math.max(
    ...normalizedValues,
    minNormalizedLoss + 0.001,
  );
  const padding = Math.max(
    0.04,
    (maxNormalizedLoss - minNormalizedLoss) * 0.12,
  );
  const minLoss = Math.max(0, minNormalizedLoss - padding);
  const maxLoss = Math.max(1, maxNormalizedLoss + padding);
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const stepDomainSpan = Math.max(100, domainMaxStep - domainMinStep);
  const toX = (step: number) =>
    plot.left +
    ((Math.max(domainMinStep, Math.min(step, domainMaxStep)) - domainMinStep) /
      stepDomainSpan) *
      plotWidth;
  const toY = (normalizedLoss: number) =>
    plot.top +
    (1 - (normalizedLoss - minLoss) / Math.max(0.001, maxLoss - minLoss)) *
      plotHeight;
  const toChartPoint = (
    point: AgentFineTuneCurvePoint,
  ): TrainingChartPoint => ({
    ...point,
    rawLoss: point.loss,
    normalizedLoss: point.loss / baselineBySplit[point.split],
    x: toX(point.step),
    y: toY(point.loss / baselineBySplit[point.split]),
  });
  const trainPoints = effectivePoints
    .filter((point) => point.split === "train")
    .map(toChartPoint);
  const validPoints = effectivePoints
    .filter((point) => point.split === "valid")
    .map(toChartPoint);
  const toPath = (chartPoints: TrainingChartPoint[]) =>
    chartPoints
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
      )
      .join(" ");
  const yTicks = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const value = maxLoss - (maxLoss - minLoss) * ratio;
    return {
      value,
      y: plot.top + plotHeight * ratio,
    };
  });
  const xTicks = Array.from(
    { length: Math.floor((domainMaxStep - domainMinStep) / 100) + 1 },
    (_, index) => domainMinStep + index * 100,
  ).map((step) => ({
    step,
    x: toX(step),
  }));

  return {
    width,
    height,
    plot,
    plotWidth,
    plotHeight,
    domainMinStep,
    domainMaxStep,
    visibleStartStep: effectiveMinStep,
    visibleEndStep: effectiveMaxStep,
    trainPath: toPath(trainPoints),
    validPath: toPath(validPoints),
    trainPoints,
    validPoints,
    yTicks,
    xTicks,
    latestTrain: trainPoints.at(-1),
    latestValid: validPoints.at(-1),
    firstTrain: trainPoints[0],
    firstValid: validPoints[0],
    baselineBySplit,
  };
}

function FieldShell({
  label,
  helper,
  children,
  className = "",
}: {
  label: string;
  helper: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
        {label}
      </span>
      <span className="mt-1 block text-[11px] leading-5 text-slate-500">
        {helper}
      </span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

export function AdminFineTunePanel({ locale }: FineTunePanelProps) {
  const isEnglish = locale.startsWith("en");
  const text = useMemo(() => {
    if (isEnglish) {
      return {
        eyebrow: "Local fine-tune lab",
        title: "Fine-tune workflow slice",
        subtitle:
          "Validate a local dataset, save a repeatable recipe, and stage a fine-tune job bundle inside the current admin workflow.",
        refresh: "Refresh",
        loading: "Loading...",
        datasetTitle: "1. Dataset",
        datasetHint:
          "Point to a local JSONL dataset and run validation before saving it into the registry.",
        datasetLabel: "Dataset label",
        datasetPath: "Local dataset path",
        datasetFormat: "Dataset format",
        upstreamQuery: "Upstream dataset query",
        refreshCadence: "Refresh cadence (hours)",
        datasetValidate: "Validate",
        datasetSave: "Save dataset",
        datasetWatchSave: "Save watch",
        datasetWatchCheck: "Check upstream datasets",
        datasetSourceLocal: "Local file",
        datasetSourceCommunity: "Community presets",
        communityDatasetTitle: "Common open-source starters",
        communityDatasetHint:
          "Use a curated starter dataset now, then keep the upstream query for Hugging Face, ModelScope, or GitHub refresh checks.",
        loadPreset: "Load preset",
        quickStartPreset: "Quick start",
        bestFor: "Best for",
        sourcePage: "Source page",
        docsPage: "Docs",
        paperPage: "Paper",
        recommendedPlan: "Suggested run",
        difficulty: "Difficulty",
        license: "License",
        starterRows: "Rows",
        upstreamRows: "Upstream rows",
        lastUpdated: "Updated",
        candidateImportNote:
          "Candidate only: sample, convert to JSONL, dedupe, then validate before training.",
        copyImportPlan: "Copy import plan",
        importPlanCopied: "Dataset import plan copied.",
        presetLoaded: "Dataset preset loaded. Validate it before saving.",
        presetQuickStartSuccess: "Preset saved with a recommended recipe.",
        presetQuickStartMissingTarget:
          "Preset dataset was saved, but no local fine-tune target is available for recipe creation.",
        recipeTitle: "2. Recipe",
        recipeHint:
          "Keep recipe inputs explicit so compare and benchmark can reuse the exact same setup later.",
        recipeSave: "Save recipe",
        jobTitle: "3. Stage job",
        jobHint:
          "Stage a persisted bundle, then run the local MLX worker directly from this admin panel and watch logs plus loss curves come back.",
        stageJob: "Stage job bundle",
        startJob: "Start local worker",
        rerunJob: "Rerun with latest data strategy",
        cancelJob: "Cancel worker",
        datasets: "Datasets",
        recipes: "Recipes",
        jobs: "Jobs",
        adapters: "Adapters",
        warnings: "Warnings",
        errors: "Errors",
        preview: "Preview",
        localTargets: "Local fine-tune targets",
        empty: "Nothing saved yet.",
        bundlePath: "Bundle path",
        outputDir: "Output dir",
        benchmarkSuite: "Benchmark suite",
        gradientCheckpointing: "Gradient checkpointing",
        notes: "Notes",
        adapterName: "Adapter name",
        baseTarget: "Base target",
        progress: "Progress",
        workerLog: "Worker log",
        adapterArtifacts: "Adapter artifacts",
        checkpointCount: "Checkpoints",
        latestCheckpoint: "Latest checkpoint",
        trainingCurve: "Training curve",
        chartRange: "Zoom range",
        chartRangeAll: "All",
        chartRangeFirst300: "First 300",
        chartRangeLast300: "Last 300",
        chartRangeLast100: "Last 100",
        chartWindow: "Visible window",
        chartStep: "Step",
        chartSplitTrain: "Train",
        chartSplitValid: "Val",
        lossAxis: "relative loss",
        stepAxis: "steps (100 / tick)",
        lossDelta: "relative delta",
        rawLoss: "raw loss",
        normalizedLossHint: "normalized to each split's first point = 1.00",
        currentLoss: "Current loss",
        heartbeat: "Heartbeat",
        startedAt: "Started",
        completedAt: "Completed",
        configFile: "Config file",
        openDir: "Open dir",
        openBundle: "Open bundle",
        openSource: "Open source page",
        copyPath: "Copy path",
        sendToBenchmark: "Send to benchmark",
        sendToCompare: "Send to compare",
        attachRuntime: "Attach runtime",
        detachRuntime: "Detach runtime",
        runtimeAttached: "Attached runtime",
        attachedAt: "Attached at",
        copied: "Copied.",
        actionOpenSuccess: "Opened in Finder.",
        saveSuccessDataset: "Dataset saved.",
        saveSuccessRecipe: "Recipe saved.",
        stageSuccess: "Fine-tune job bundle staged.",
        startSuccess: "Local fine-tune worker started.",
        rerunSuccess:
          "Fine-tune job rerun started with the latest dataset strategy.",
        cancelSuccess: "Fine-tune worker cancelled.",
        handoffBenchmarkSuccess: "Adapter benchmark handoff completed.",
        handoffCompareSuccess: "Adapter compare handoff completed.",
        handoffMissingContext:
          "This adapter is missing its recipe or dataset context.",
        runtimeAttachSuccess: "Adapter runtime mounted.",
        runtimeDetachSuccess: "Adapter runtime detached.",
        validated:
          "Validation complete. Review preview and warnings before saving.",
        noValidation: "Run dataset validation first.",
        recipeLabel: "Recipe label",
        sequenceLength: "Sequence length",
        batchSize: "Batch size",
        epochs: "Epochs",
        learningRate: "Learning rate",
        fineTuneMethod: "Fine-tune method",
        optimizer: "Optimizer",
        numLayers: "Trainable layers",
        gradientAccumulationSteps: "Grad accumulation",
        loraRank: "LoRA rank",
        loraAlpha: "LoRA alpha",
        validationSplitPct: "Validation split %",
        saveEverySteps: "Save every N steps",
        seed: "Seed",
        jobGroupActive: "Active",
        jobGroupNeedsReview: "Needs review",
        jobGroupCompleted: "Completed",
        jobGroupStaged: "Staged",
        jobGroupCollapsed: "Collapsed",
        jobGroupExpanded: "Expanded",
        jobGroupRerunHint:
          "Failed or cancelled jobs can be rerun as a new job using the latest dataset preparation strategy.",
        jobGroupLatestRun: "Latest",
        rerunLatestFailed: "Rerun latest failed",
        dataDir: "Data dir",
      };
    }
    return {
      eyebrow: "本地微调实验台",
      title: "Fine-tune 工作流第一批切片",
      subtitle:
        "先把本地数据集校验、可复用配方和作业 bundle 接入现有后台，不脱离当前项目框架。",
      refresh: "刷新",
      loading: "加载中...",
      datasetTitle: "1. 数据集",
      datasetHint:
        "填写本地 JSONL 数据路径，先做校验，再把它保存进数据集注册表。",
      datasetLabel: "数据集名称",
      datasetPath: "本地数据路径",
      datasetFormat: "数据格式",
      upstreamQuery: "上游数据集查询词",
      refreshCadence: "刷新周期（小时）",
      datasetValidate: "校验数据集",
      datasetSave: "保存数据集",
      datasetWatchSave: "保存监听配置",
      datasetWatchCheck: "检查上游数据集",
      datasetSourceLocal: "本地文件",
      datasetSourceCommunity: "社区预设",
      communityDatasetTitle: "常用开源社区入门数据集",
      communityDatasetHint:
        "先加载一份可直接校验的 starter 数据集，同时保留 Hugging Face、魔搭或 GitHub 的上游检索词，方便后续定期更新。",
      loadPreset: "加载预设",
      quickStartPreset: "快速开始",
      bestFor: "适合场景",
      sourcePage: "来源页",
      docsPage: "说明页",
      paperPage: "论文",
      recommendedPlan: "推荐跑法",
      difficulty: "难度",
      license: "许可证",
      starterRows: "样本量",
      upstreamRows: "上游样本",
      lastUpdated: "更新时间",
      candidateImportNote:
        "候选源只代表可追踪来源：训练前仍需要抽样、转成 JSONL、去重并校验。",
      copyImportPlan: "复制导入计划",
      importPlanCopied: "数据集导入计划已复制。",
      presetLoaded: "数据集预设已加载，请先校验再保存。",
      presetQuickStartSuccess: "预设数据集和推荐配方已保存。",
      presetQuickStartMissingTarget:
        "预设数据集已保存，但当前没有可用于创建配方的本地微调目标。",
      recipeTitle: "2. 配方",
      recipeHint:
        "把训练关键参数显式固化下来，后面 compare / benchmark 才能沿用同一口径。",
      recipeSave: "保存配方",
      jobTitle: "3. 作业暂存",
      jobHint:
        "先生成可落盘的 job bundle，再直接从后台启动本地 MLX worker，并回看日志和 loss 曲线。",
      stageJob: "暂存作业 bundle",
      startJob: "启动本地 worker",
      rerunJob: "按新数据策略重跑",
      cancelJob: "取消 worker",
      datasets: "数据集",
      recipes: "配方",
      jobs: "作业",
      adapters: "Adapter 产物",
      warnings: "警告",
      errors: "错误",
      preview: "预览",
      localTargets: "本地可微调目标",
      empty: "暂无记录。",
      bundlePath: "Bundle 路径",
      outputDir: "产物目录",
      benchmarkSuite: "Benchmark 套件",
      gradientCheckpointing: "梯度检查点",
      notes: "备注",
      adapterName: "Adapter 名称",
      baseTarget: "基础模型",
      progress: "进度",
      workerLog: "Worker 日志",
      adapterArtifacts: "Adapter 产物",
      checkpointCount: "Checkpoint 数量",
      latestCheckpoint: "最近 checkpoint",
      trainingCurve: "训练曲线",
      chartRange: "区间缩放",
      chartRangeAll: "全量",
      chartRangeFirst300: "前 300 轮",
      chartRangeLast300: "后 300 轮",
      chartRangeLast100: "后 100 轮",
      chartWindow: "当前视窗",
      chartStep: "轮次",
      chartSplitTrain: "训练",
      chartSplitValid: "验证",
      lossAxis: "相对 loss",
      stepAxis: "训练轮次（每格 100）",
      lossDelta: "相对变化",
      rawLoss: "原始 loss",
      normalizedLossHint: "按每条曲线首个点归一化为 1.00",
      currentLoss: "当前损失",
      heartbeat: "心跳",
      startedAt: "开始时间",
      completedAt: "完成时间",
      configFile: "配置文件",
      openDir: "打开目录",
      openBundle: "打开 bundle",
      openSource: "打开来源页",
      copyPath: "复制路径",
      sendToBenchmark: "送到 benchmark",
      sendToCompare: "送到 compare",
      attachRuntime: "挂载到运行时",
      detachRuntime: "从运行时卸载",
      runtimeAttached: "已挂载运行时",
      attachedAt: "挂载时间",
      copied: "已复制。",
      actionOpenSuccess: "已在 Finder 中打开。",
      saveSuccessDataset: "数据集已保存。",
      saveSuccessRecipe: "配方已保存。",
      stageSuccess: "Fine-tune 作业 bundle 已暂存。",
      startSuccess: "本地 Fine-tune worker 已启动。",
      rerunSuccess: "已使用最新数据准备策略创建并启动新作业。",
      cancelSuccess: "Fine-tune worker 已取消。",
      handoffBenchmarkSuccess: "Adapter benchmark handoff 已完成。",
      handoffCompareSuccess: "Adapter compare handoff 已完成。",
      handoffMissingContext:
        "这个 adapter 缺少配方或数据集上下文，暂时无法 handoff。",
      runtimeAttachSuccess: "Adapter 已挂载到本地运行时。",
      runtimeDetachSuccess: "Adapter 已从本地运行时卸载。",
      validated: "数据校验完成，可以先检查样例预览和警告再保存。",
      noValidation: "请先做一次数据集校验。",
      recipeLabel: "配方名称",
      sequenceLength: "序列长度",
      batchSize: "批大小",
      epochs: "Epoch 数",
      learningRate: "学习率",
      fineTuneMethod: "微调方法",
      optimizer: "优化器",
      numLayers: "训练层数",
      gradientAccumulationSteps: "梯度累积",
      loraRank: "LoRA Rank",
      loraAlpha: "LoRA Alpha",
      validationSplitPct: "验证集占比",
      saveEverySteps: "每隔 N 步保存",
      seed: "随机种子",
      jobGroupActive: "运行中",
      jobGroupNeedsReview: "需要处理",
      jobGroupCompleted: "已完成",
      jobGroupStaged: "已暂存",
      jobGroupCollapsed: "已折叠",
      jobGroupExpanded: "已展开",
      jobGroupRerunHint:
        "失败或取消的旧作业会按最新数据准备策略创建新作业重跑，不覆盖旧日志。",
      jobGroupLatestRun: "最近",
      rerunLatestFailed: "重跑最近失败项",
      dataDir: "数据目录",
    };
  }, [isEnglish]);

  const recipeHelp = useMemo(() => {
    if (isEnglish) {
      return {
        label:
          "A reusable name for this training recipe, shown later in jobs and handoff records.",
        datasetId:
          "Choose the validated dataset that will be split into train and validation samples.",
        baseTargetId:
          "The local model that receives the adapter. Pick the smallest safe target for smoke runs.",
        adapterName:
          "Output adapter folder and runtime alias. Use a short, versioned name.",
        fineTuneMethod:
          "LoRA is the default low-memory adapter method; DoRA is experimental and heavier.",
        optimizer:
          "AdamW is the stable default for adapter fine-tuning; only change when comparing recipes.",
        sequenceLength:
          "Maximum tokens per training sample. Higher values need more memory.",
        batchSize:
          "Samples processed per step. Lower it if memory pressure rises.",
        epochs:
          "How many full passes over the dataset. Starter datasets usually need only a few epochs.",
        learningRate:
          "Update size for adapter weights. Too high can make loss unstable.",
        numLayers:
          "How many transformer layers participate in training. More layers cost more memory.",
        gradientAccumulationSteps:
          "Accumulates gradients across mini steps to simulate a larger batch.",
        loraRank:
          "Adapter capacity. Higher rank can learn more but grows adapter size and memory use.",
        loraAlpha:
          "LoRA scaling factor. Usually keep near 2x rank for a stable first pass.",
        validationSplitPct:
          "Percent of samples held out for validation so the curve can catch overfitting.",
        saveEverySteps:
          "Checkpoint cadence. Set 0 to save only final outputs in short smoke runs.",
        seed: "Keeps data split and synthetic worker curve repeatable across runs.",
        benchmarkSuiteId:
          "Benchmark suite to attach after training so adapter results stay comparable.",
        notes:
          "Human context for why this recipe exists and what behavior it should improve.",
        gradientCheckpointing:
          "Trades compute for lower memory use. Keep enabled on Apple Silicon.",
      };
    }
    return {
      label: "这条训练配方的可复用名称，后续作业和 handoff 记录都会显示它。",
      datasetId: "选择已经校验过的数据集，训练时会自动拆成训练集和验证集。",
      baseTargetId:
        "adapter 要挂载到的本地基础模型。新手 smoke 建议先选最小安全模型。",
      adapterName: "输出 adapter 文件夹和运行时别名，建议用短名称并带版本。",
      fineTuneMethod: "LoRA 是默认低内存微调方法；DoRA 更实验，资源消耗更高。",
      optimizer:
        "AdamW 是 adapter 微调的稳定默认值，只有做配方对比时才建议修改。",
      sequenceLength: "单条训练样本最多保留的 token 数；越大越吃内存。",
      batchSize: "每一步处理的样本数；如果内存压力高，优先调小这个值。",
      epochs: "完整遍历数据集的轮数；starter 数据集一般只需要少量轮次。",
      learningRate: "adapter 权重更新幅度；过高会让 loss 抖动或发散。",
      numLayers:
        "参与训练的 Transformer 层数；层数越多，显存/共享内存压力越大。",
      gradientAccumulationSteps:
        "多次小 batch 累积梯度，用更低显存模拟更大 batch。",
      loraRank: "adapter 容量；rank 越高可学习内容越多，但文件和内存也会变大。",
      loraAlpha: "LoRA 缩放系数；首次训练通常保持在 rank 的 2 倍附近。",
      validationSplitPct: "留作验证集的样本比例，用来观察是否过拟合。",
      saveEverySteps: "checkpoint 保存间隔；短 smoke 可设 0，只保存最终产物。",
      seed: "固定数据拆分和模拟曲线，方便复现实验结果。",
      benchmarkSuiteId:
        "训练后要关联的 benchmark 套件，让 adapter 回归结果可追踪。",
      notes: "记录这条配方要解决什么行为问题，方便以后复盘。",
      gradientCheckpointing:
        "用额外计算换更低内存占用，Apple Silicon 上建议保持开启。",
    };
  }, [isEnglish]);

  const [summary, setSummary] = useState<AgentFineTuneSummary | null>(null);
  const [targetCatalog, setTargetCatalog] = useState<AgentTarget[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">(
    "success",
  );
  const [datasetForm, setDatasetForm] = useState(DEFAULT_DATASET_FORM);
  const [datasetSourceMode, setDatasetSourceMode] =
    useState<DatasetSourceMode>("local");
  const [recipeForm, setRecipeForm] = useState(DEFAULT_RECIPE_FORM);
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [datasetValidation, setDatasetValidation] =
    useState<AgentFineTuneDatasetValidation | null>(null);
  const [datasetWatchDrafts, setDatasetWatchDrafts] = useState<
    Record<string, { upstreamQuery: string; refreshCadenceHours: number }>
  >({});
  const [actionPending, setActionPending] = useState<Record<string, boolean>>(
    {},
  );
  const [collapsedJobGroups, setCollapsedJobGroups] = useState<
    Record<FineTuneJobGroupKey, boolean>
  >({
    active: false,
    "needs-review": false,
    completed: true,
    staged: true,
  });
  const [chartRangeByJobId, setChartRangeByJobId] = useState<
    Record<string, TrainingChartRangePreset>
  >({});
  const [chartHoverByJobId, setChartHoverByJobId] = useState<
    Record<string, TrainingChartHoverState>
  >({});

  const getChartRangeLabel = useCallback(
    (range: TrainingChartRangePreset) => {
      switch (range) {
        case "first-300":
          return text.chartRangeFirst300;
        case "last-300":
          return text.chartRangeLast300;
        case "last-100":
          return text.chartRangeLast100;
        default:
          return text.chartRangeAll;
      }
    },
    [
      text.chartRangeAll,
      text.chartRangeFirst300,
      text.chartRangeLast100,
      text.chartRangeLast300,
    ],
  );

  const jobGroups = useMemo<
    Array<{ key: FineTuneJobGroupKey; label: string; jobs: AgentFineTuneJob[] }>
  >(() => {
    const jobs = summary?.jobs || [];
    return [
      {
        key: "active",
        label: text.jobGroupActive,
        jobs: jobs.filter(
          (job) => job.status === "queued" || job.status === "running",
        ),
      },
      {
        key: "needs-review",
        label: text.jobGroupNeedsReview,
        jobs: jobs.filter(
          (job) => job.status === "failed" || job.status === "cancelled",
        ),
      },
      {
        key: "completed",
        label: text.jobGroupCompleted,
        jobs: jobs.filter((job) => job.status === "completed"),
      },
      {
        key: "staged",
        label: text.jobGroupStaged,
        jobs: jobs.filter(
          (job) => job.status === "staged" || job.status === "draft",
        ),
      },
    ];
  }, [
    summary?.jobs,
    text.jobGroupActive,
    text.jobGroupCompleted,
    text.jobGroupNeedsReview,
    text.jobGroupStaged,
  ]);

  const loadSummary = useCallback(async () => {
    setPending(true);
    try {
      const response = await fetch("/api/admin/finetune", {
        cache: "no-store",
      });
      const payload = (await response.json()) as FineTuneResponse;
      if (!response.ok || !payload.summary) {
        throw new Error(payload.error || "Failed to load fine-tune summary.");
      }
      setSummary(payload.summary);
      setRecipeForm((current) => ({
        ...current,
        datasetId: current.datasetId || payload.summary?.datasets[0]?.id || "",
        baseTargetId:
          current.baseTargetId || payload.summary?.localTargets[0]?.id || "",
      }));
      setSelectedRecipeId(
        (current) => current || payload.summary?.recipes[0]?.id || "",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to load fine-tune summary.",
      );
      setMessageTone("error");
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const loadTargetCatalog = useCallback(async (strict = false) => {
    try {
      const response = await fetch("/api/agent/targets", { cache: "no-store" });
      const payload = (await response.json()) as {
        targets?: AgentTarget[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(payload.targets)) {
        throw new Error(payload.error || "Failed to refresh target catalog.");
      }
      setTargetCatalog(payload.targets);
      return payload.targets;
    } catch (error) {
      if (strict) {
        throw error;
      }
      return [] as AgentTarget[];
    }
  }, []);

  useEffect(() => {
    void loadTargetCatalog();
  }, [loadTargetCatalog]);

  useEffect(() => {
    if (
      !summary?.jobs.some(
        (job) => job.status === "queued" || job.status === "running",
      )
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadSummary();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [loadSummary, summary?.jobs]);

  useEffect(() => {
    if (!summary?.datasets?.length) return;
    setDatasetWatchDrafts((current) => {
      const next = { ...current };
      summary.datasets.forEach((dataset) => {
        if (!next[dataset.id]) {
          next[dataset.id] = {
            upstreamQuery: dataset.upstreamQuery || dataset.label,
            refreshCadenceHours: dataset.refreshCadenceHours || 24,
          };
        }
      });
      return next;
    });
  }, [summary?.datasets]);

  async function postAction(
    body: Record<string, unknown>,
    successMessage: string,
  ) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/finetune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as FineTuneResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Fine-tune request failed.");
      }
      if (payload.summary) {
        setSummary(payload.summary);
      }
      if (payload.validation) {
        setDatasetValidation(payload.validation);
      }
      setMessage(successMessage);
      setMessageTone("success");
      return payload;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Fine-tune request failed.",
      );
      setMessageTone("error");
      return null;
    } finally {
      setPending(false);
    }
  }

  async function copyValue(value?: string | null, successMessage = text.copied) {
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        setMessage(successMessage);
        setMessageTone("success");
      }
    } catch {
      setMessageTone("error");
      setMessage("Copy failed.");
    }
  }

  async function runSecondaryAction(
    actionKey: string,
    body: Record<string, unknown>,
  ) {
    setActionPending((current) => ({ ...current, [actionKey]: true }));
    try {
      await postAction(body, text.actionOpenSuccess);
    } finally {
      setActionPending((current) => ({ ...current, [actionKey]: false }));
    }
  }

  const ensureAdapterRuntimeAttached = useCallback(
    async (adapterId: string) => {
      const response = await fetch("/api/admin/finetune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "attach-runtime",
          adapterId,
        }),
      });
      const payload = (await response.json()) as FineTuneResponse & {
        targets?: AgentTarget[];
      };
      if (!response.ok || !payload.summary) {
        throw new Error(payload.error || "Adapter runtime attach failed.");
      }
      setSummary(payload.summary);
      const targets = await loadTargetCatalog(true);
      return {
        summary: payload.summary,
        targetCatalog: targets,
        attachedTargetLabel: payload.attached?.target?.label,
      };
    },
    [loadTargetCatalog],
  );

  const attachAdapterRuntime = useCallback(
    async (adapterId: string) => {
      const actionKey = `adapter-attach:${adapterId}`;
      setActionPending((current) => ({ ...current, [actionKey]: true }));
      setMessage("");
      try {
        const result = await ensureAdapterRuntimeAttached(adapterId);
        setMessage(
          `${text.runtimeAttachSuccess}${result.attachedTargetLabel ? ` ${locale.startsWith("en") ? "Target:" : "目标："} ${result.attachedTargetLabel}` : ""}`,
        );
        setMessageTone("success");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Adapter runtime attach failed.",
        );
        setMessageTone("error");
      } finally {
        setActionPending((current) => ({ ...current, [actionKey]: false }));
      }
    },
    [ensureAdapterRuntimeAttached, locale, text.runtimeAttachSuccess],
  );

  const detachAdapterRuntime = useCallback(
    async (adapterId: string) => {
      const actionKey = `adapter-detach:${adapterId}`;
      setActionPending((current) => ({ ...current, [actionKey]: true }));
      setMessage("");
      try {
        const response = await fetch("/api/admin/finetune", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "detach-runtime",
            adapterId,
          }),
        });
        const payload = (await response.json()) as FineTuneResponse;
        if (!response.ok || !payload.summary) {
          throw new Error(payload.error || "Adapter runtime detach failed.");
        }
        setSummary(payload.summary);
        await loadTargetCatalog(true);
        setMessage(
          `${text.runtimeDetachSuccess}${payload.detached?.releasedRuntime ? ` ${locale.startsWith("en") ? "Loaded model released." : "已同步释放当前加载模型。"} ` : ""}${
            payload.detached?.attachment?.label
              ? `${locale.startsWith("en") ? "Target:" : "目标："} ${payload.detached.attachment.label}`
              : ""
          }`,
        );
        setMessageTone("success");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Adapter runtime detach failed.",
        );
        setMessageTone("error");
      } finally {
        setActionPending((current) => ({ ...current, [actionKey]: false }));
      }
    },
    [loadTargetCatalog, locale, text.runtimeDetachSuccess],
  );

  const runAdapterBenchmarkHandoff = useCallback(
    async (adapterId: string) => {
      if (!summary) return;
      const attached = await ensureAdapterRuntimeAttached(adapterId).catch(
        (error) => {
          setMessage(
            error instanceof Error
              ? error.message
              : "Adapter runtime attach failed.",
          );
          setMessageTone("error");
          return null;
        },
      );
      if (!attached) {
        return;
      }
      const plan = buildFineTuneBenchmarkHandoffPlan({
        adapterId,
        summary: attached.summary,
        targetCatalog: attached.targetCatalog,
      });
      if (!plan) {
        setMessage(text.handoffMissingContext);
        setMessageTone("error");
        return;
      }

      const actionKey = `adapter-benchmark:${adapterId}`;
      setActionPending((current) => ({ ...current, [actionKey]: true }));
      setMessage("");
      try {
        const response = await fetch("/api/admin/benchmark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(plan.request),
        });
        const payload = (await response.json()) as AgentBenchmarkResponse & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "Benchmark handoff failed.");
        }
        const peerSuffix = plan.referenceTargetLabel
          ? ` ${plan.referenceTargetLabel}`
          : "";
        setMessage(
          `${text.handoffBenchmarkSuccess}${peerSuffix ? ` ${locale.startsWith("en") ? "Reference:" : "参考目标："}${peerSuffix}` : ""}`,
        );
        setMessageTone("success");
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Benchmark handoff failed.",
        );
        setMessageTone("error");
      } finally {
        setActionPending((current) => ({ ...current, [actionKey]: false }));
      }
    },
    [
      ensureAdapterRuntimeAttached,
      locale,
      summary,
      text.handoffBenchmarkSuccess,
      text.handoffMissingContext,
    ],
  );

  const runAdapterCompareHandoff = useCallback(
    async (adapterId: string) => {
      if (!summary) return;
      const attached = await ensureAdapterRuntimeAttached(adapterId).catch(
        (error) => {
          setMessage(
            error instanceof Error
              ? error.message
              : "Adapter runtime attach failed.",
          );
          setMessageTone("error");
          return null;
        },
      );
      if (!attached) {
        return;
      }
      const plan = buildFineTuneCompareHandoffPlan({
        adapterId,
        summary: attached.summary,
        targetCatalog: attached.targetCatalog,
      });
      if (!plan) {
        setMessage(text.handoffMissingContext);
        setMessageTone("error");
        return;
      }

      const actionKey = `adapter-compare:${adapterId}`;
      setActionPending((current) => ({ ...current, [actionKey]: true }));
      setMessage("");
      try {
        const response = await fetch("/api/agent/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...plan.request,
            requestId: crypto.randomUUID(),
          }),
        });
        const payload = (await response.json()) as AgentCompareResponse & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "Compare handoff failed.");
        }
        setMessage(
          `${text.handoffCompareSuccess} ${payload.results.filter((lane) => lane.ok).length}/${payload.results.length} ${locale.startsWith("en") ? "lanes returned output." : "个 lane 返回了结果。"}`,
        );
        setMessageTone("success");
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Compare handoff failed.",
        );
        setMessageTone("error");
      } finally {
        setActionPending((current) => ({ ...current, [actionKey]: false }));
      }
    },
    [
      ensureAdapterRuntimeAttached,
      locale,
      summary,
      text.handoffCompareSuccess,
      text.handoffMissingContext,
    ],
  );

  const canSaveDataset = Boolean(
    datasetForm.label.trim() &&
    datasetForm.sourcePath.trim() &&
    datasetValidation?.ok,
  );
  const selectedRecipe =
    summary?.recipes.find((recipe) => recipe.id === selectedRecipeId) || null;
  const recipeById = useMemo(
    () =>
      new Map((summary?.recipes || []).map((recipe) => [recipe.id, recipe])),
    [summary?.recipes],
  );
  const targetById = useMemo(
    () =>
      new Map(
        (summary?.localTargets || []).map((target) => [target.id, target]),
      ),
    [summary?.localTargets],
  );
  const getDatasetWatchDraft = useCallback(
    (dataset: AgentFineTuneDataset) =>
      datasetWatchDrafts[dataset.id] || {
        upstreamQuery: dataset.upstreamQuery || dataset.label,
        refreshCadenceHours: dataset.refreshCadenceHours || 24,
      },
    [datasetWatchDrafts],
  );

  const getJobSourceUrl = useCallback(
    (job: AgentFineTuneJob) => {
      const recipe = recipeById.get(job.recipeId);
      return recipe?.baseTargetId
        ? targetById.get(recipe.baseTargetId)?.sourceUrl
        : undefined;
    },
    [recipeById, targetById],
  );

  const getPresetLabel = useCallback(
    (preset: CommunityDatasetPreset) =>
      isEnglish ? preset.label.en : preset.label.zh,
    [isEnglish],
  );

  const getPresetDescription = useCallback(
    (preset: CommunityDatasetPreset) =>
      isEnglish ? preset.description.en : preset.description.zh,
    [isEnglish],
  );

  const getPresetBestFor = useCallback(
    (preset: CommunityDatasetPreset) =>
      isEnglish ? preset.bestFor.en : preset.bestFor.zh,
    [isEnglish],
  );

  const getPresetRecommendedSteps = useCallback(
    (preset: CommunityDatasetPreset) =>
      isEnglish ? preset.recommendedSteps.en : preset.recommendedSteps.zh,
    [isEnglish],
  );

  const getPresetDifficulty = useCallback(
    (preset: CommunityDatasetPreset) =>
      isEnglish ? preset.difficulty.en : preset.difficulty.zh,
    [isEnglish],
  );

  const getPresetRecipeNotes = useCallback(
    (preset: CommunityDatasetPreset) =>
      isEnglish ? preset.recipeNotes.en : preset.recipeNotes.zh,
    [isEnglish],
  );

  const buildDatasetCandidateImportPlan = useCallback(
    (
      dataset: AgentFineTuneDataset,
      candidate: AgentFineTuneUpstreamDatasetCandidate,
    ) => {
      const slug = normalizeFineTuneSlug(
        `${candidate.source}-${candidate.repoId}`,
      );
      const outputPath = `data/fine-tune/community/${slug || "community-dataset"}-sample.jsonl`;
      const format = dataset.format || "instruction-jsonl";
      if (isEnglish) {
        return [
          `# Fine-tune Dataset Import Plan`,
          ``,
          `- Active dataset registry: ${dataset.label}`,
          `- Candidate source: ${candidate.source}`,
          `- Repository: ${candidate.repoId}`,
          `- Source page: ${candidate.repoUrl}`,
          candidate.docsUrl ? `- Docs: ${candidate.docsUrl}` : undefined,
          candidate.paperUrl ? `- Paper: ${candidate.paperUrl}` : undefined,
          `- Upstream rows: ${formatSampleCount(candidate.sampleCount)}`,
          `- Last updated: ${formatDateTime(candidate.updatedAt)}`,
          `- Target local file: ${outputPath}`,
          `- Target format: ${format}`,
          ``,
          `## Required steps before training`,
          `1. Download or export a small starter slice first. Keep 128-512 rows for smoke tests and 1k-5k rows for longer local LoRA runs.`,
          `2. Convert rows to ${format}. Keep one instruction/response or messages array per line.`,
          `3. Remove duplicate prompts, empty answers, license-incompatible rows, and rows that expose secrets or private data.`,
          `4. Run dataset validation in First LLM Studio and save the dataset only after warnings are reviewed.`,
          `5. Start with batch size 1-4, validation split 10%, and save checkpoints every 100-200 steps for long runs.`,
        ]
          .filter(Boolean)
          .join("\n");
      }
      return [
        `# 微调数据集导入计划`,
        ``,
        `- 当前数据集注册项：${dataset.label}`,
        `- 候选来源：${candidate.source}`,
        `- 仓库：${candidate.repoId}`,
        `- 来源页：${candidate.repoUrl}`,
        candidate.docsUrl ? `- 说明页：${candidate.docsUrl}` : undefined,
        candidate.paperUrl ? `- 论文：${candidate.paperUrl}` : undefined,
        `- 上游样本：${formatSampleCount(candidate.sampleCount)}`,
        `- 更新时间：${formatDateTime(candidate.updatedAt)}`,
        `- 建议落地文件：${outputPath}`,
        `- 目标格式：${format}`,
        ``,
        `## 训练前必须完成`,
        `1. 先下载或导出小样本切片；smoke 建议 128-512 条，数百到上千步本地 LoRA 建议 1k-5k 条。`,
        `2. 转换为 ${format}；每行保留一条 instruction/output 或 messages 数组。`,
        `3. 去掉重复 prompt、空回复、许可证不兼容样本，以及任何密钥、隐私或个人数据。`,
        `4. 回到 First LLM Studio 跑数据集校验，确认 warning 后再保存。`,
        `5. 长轮次训练先用 batch size 1-4、验证集 10%，并每 100-200 step 保存 checkpoint。`,
      ]
        .filter(Boolean)
        .join("\n");
    },
    [isEnglish],
  );

  const applyCommunityDatasetPreset = useCallback(
    (preset: CommunityDatasetPreset) => {
      setDatasetSourceMode("community");
      setDatasetValidation(null);
      setDatasetForm({
        label: getPresetLabel(preset),
        sourcePath: preset.localPath,
        format: preset.format,
        upstreamQuery: preset.upstreamQuery,
        refreshCadenceHours: 24,
      });
      setRecipeForm((current) => ({
        ...current,
        epochs: preset.recommendedEpochs,
        batchSize: Math.min(current.batchSize || 4, 4),
        gradientAccumulationSteps: 1,
        validationSplitPct: 10,
        notes: getPresetRecipeNotes(preset),
      }));
      setMessage(text.presetLoaded);
      setMessageTone("success");
    },
    [getPresetLabel, getPresetRecipeNotes, text.presetLoaded],
  );

  async function quickStartCommunityDatasetPreset(
    preset: CommunityDatasetPreset,
  ) {
    const actionKey = `dataset-preset-quickstart:${preset.id}`;
    const presetLabel = getPresetLabel(preset);
    const presetNotes = getPresetRecipeNotes(preset);
    const nextDatasetForm = {
      label: presetLabel,
      sourcePath: preset.localPath,
      format: preset.format,
      upstreamQuery: preset.upstreamQuery,
      refreshCadenceHours: 24,
    };
    setDatasetSourceMode("community");
    setDatasetValidation(null);
    setDatasetForm(nextDatasetForm);
    setActionPending((current) => ({ ...current, [actionKey]: true }));
    try {
      const validationPayload = await postAction(
        { action: "validate-dataset", ...nextDatasetForm },
        text.validated,
      );
      if (!validationPayload?.validation?.ok) return;

      const datasetPayload = await postAction(
        { action: "save-dataset", ...nextDatasetForm },
        text.saveSuccessDataset,
      );
      if (!datasetPayload?.summary) return;
      const savedDataset = datasetPayload.summary.datasets?.find(
        (dataset) =>
          dataset.sourcePath === nextDatasetForm.sourcePath ||
          dataset.label === nextDatasetForm.label,
      );
      if (!savedDataset) return;

      const baseTargetId =
        recipeForm.baseTargetId ||
        datasetPayload.summary.localTargets?.[0]?.id ||
        "";
      const adapterSlug = normalizeFineTuneSlug(preset.id);
      const nextRecipeForm = {
        ...recipeForm,
        label: `${presetLabel} recipe`,
        datasetId: savedDataset.id,
        baseTargetId,
        adapterName:
          recipeForm.adapterName.trim() ||
          `${adapterSlug}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
        epochs: preset.recommendedEpochs,
        batchSize: Math.min(recipeForm.batchSize || 4, 4),
        gradientAccumulationSteps: 1,
        validationSplitPct: 10,
        notes: presetNotes,
      };
      setRecipeForm(nextRecipeForm);

      if (!baseTargetId) {
        setMessage(text.presetQuickStartMissingTarget);
        setMessageTone("error");
        return;
      }

      const recipePayload = await postAction(
        { action: "save-recipe", ...nextRecipeForm },
        text.presetQuickStartSuccess,
      );
      const nextRecipeId = recipePayload?.summary?.recipes?.[0]?.id;
      if (typeof nextRecipeId === "string" && nextRecipeId) {
        setSelectedRecipeId(nextRecipeId);
      }
    } finally {
      setActionPending((current) => ({ ...current, [actionKey]: false }));
    }
  }

  const numericRecipeFields = useMemo(
    () =>
      [
        {
          key: "sequenceLength",
          label: text.sequenceLength,
          helper: recipeHelp.sequenceLength,
          step: 1,
        },
        {
          key: "batchSize",
          label: text.batchSize,
          helper: recipeHelp.batchSize,
          step: 1,
        },
        {
          key: "epochs",
          label: text.epochs,
          helper: recipeHelp.epochs,
          step: 1,
        },
        {
          key: "learningRate",
          label: text.learningRate,
          helper: recipeHelp.learningRate,
          step: 0.00001,
        },
        {
          key: "numLayers",
          label: text.numLayers,
          helper: recipeHelp.numLayers,
          step: 1,
        },
        {
          key: "gradientAccumulationSteps",
          label: text.gradientAccumulationSteps,
          helper: recipeHelp.gradientAccumulationSteps,
          step: 1,
        },
        {
          key: "loraRank",
          label: text.loraRank,
          helper: recipeHelp.loraRank,
          step: 1,
        },
        {
          key: "loraAlpha",
          label: text.loraAlpha,
          helper: recipeHelp.loraAlpha,
          step: 1,
        },
        {
          key: "validationSplitPct",
          label: text.validationSplitPct,
          helper: recipeHelp.validationSplitPct,
          step: 1,
        },
        {
          key: "saveEverySteps",
          label: text.saveEverySteps,
          helper: recipeHelp.saveEverySteps,
          step: 1,
        },
        { key: "seed", label: text.seed, helper: recipeHelp.seed, step: 1 },
      ] satisfies Array<{
        key: NumericRecipeFieldKey;
        label: string;
        helper: string;
        step: number;
      }>,
    [recipeHelp, text],
  );

  const updateRecipeNumber = useCallback(
    (key: NumericRecipeFieldKey, value: string) => {
      const nextValue = Number(value);
      setRecipeForm((current) => ({
        ...current,
        [key]: Number.isFinite(nextValue) ? nextValue : current[key],
      }));
    },
    [],
  );

  return (
    <div className="rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.9),rgba(2,6,23,0.94))] p-5 shadow-[0_24px_80px_rgba(2,6,23,0.45)]">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">
            {text.eyebrow}
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">
            {text.title}
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            {text.subtitle}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            {text.dataDir}:{" "}
            <span className="text-slate-300">{summary?.dataDir || "--"}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSummary()}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
        >
          {pending ? text.loading : text.refresh}
        </button>
      </div>

      {message ? (
        <div
          className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
            messageTone === "error"
              ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
              : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
          }`}
        >
          {message}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
        <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <p className="text-sm font-semibold text-white">
            {text.datasetTitle}
          </p>
          <p className="mt-2 text-xs leading-6 text-slate-500">
            {text.datasetHint}
          </p>
          <div className="mt-4 space-y-3">
            <div className="flex rounded-full border border-white/10 bg-slate-950/60 p-1">
              {(["local", "community"] as DatasetSourceMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDatasetSourceMode(mode)}
                  className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold transition ${
                    datasetSourceMode === mode
                      ? "bg-cyan-400/15 text-cyan-100"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`}
                >
                  {mode === "local"
                    ? text.datasetSourceLocal
                    : text.datasetSourceCommunity}
                </button>
              ))}
            </div>

            {datasetSourceMode === "community" ? (
              <div className="rounded-3xl border border-cyan-400/20 bg-cyan-400/[0.055] p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-cyan-50">
                      {text.communityDatasetTitle}
                    </p>
                    <p className="mt-1 max-w-xl text-xs leading-5 text-cyan-100/70">
                      {text.communityDatasetHint}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3">
                  {COMMUNITY_DATASET_PRESETS.map((preset) => (
                    <div
                      key={preset.id}
                      className="rounded-2xl border border-white/10 bg-slate-950/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {getPresetLabel(preset)}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-400">
                            {getPresetDescription(preset)}
                          </p>
                        </div>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                          {preset.source}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-[11px] leading-5 text-slate-400">
                        <p>
                          {text.bestFor}:{" "}
                          <span className="text-slate-300">
                            {getPresetBestFor(preset)}
                          </span>
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <span className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                            {text.difficulty}:{" "}
                            <span className="text-slate-200">
                              {getPresetDifficulty(preset)}
                            </span>
                          </span>
                          <span className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                            {text.starterRows}:{" "}
                            <span className="text-slate-200">
                              {preset.bootstrapRows} local /{" "}
                              {preset.sampleCount.toLocaleString()} upstream
                            </span>
                          </span>
                          <span className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                            {text.recommendedPlan}:{" "}
                            <span className="text-slate-200">
                              {preset.recommendedEpochs} epochs ·{" "}
                              {preset.recommendedSamples.toLocaleString()} rows
                            </span>
                          </span>
                          <span className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                            {text.license}:{" "}
                            <span className="text-slate-200">
                              {preset.license}
                            </span>
                          </span>
                        </div>
                        <p>
                          {getPresetRecommendedSteps(preset)} · {preset.format}{" "}
                          · {preset.localPath}
                        </p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => applyCommunityDatasetPreset(preset)}
                          className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                        >
                          {text.loadPreset}
                        </button>
                        <button
                          type="button"
                          disabled={
                            actionPending[
                              `dataset-preset-quickstart:${preset.id}`
                            ]
                          }
                          onClick={() =>
                            void quickStartCommunityDatasetPreset(preset)
                          }
                          className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 transition enabled:hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {text.quickStartPreset}
                        </button>
                        <a
                          href={preset.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                        >
                          {text.sourcePage}
                        </a>
                        {preset.docsUrl ? (
                          <a
                            href={preset.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                          >
                            {text.docsPage}
                          </a>
                        ) : null}
                        {preset.paperUrl ? (
                          <a
                            href={preset.paperUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                          >
                            {text.paperPage}
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <FieldShell
              label={text.datasetLabel}
              helper={
                isEnglish
                  ? "Name shown in recipe selection and job history."
                  : "显示在配方选择和作业历史里的数据集名称。"
              }
            >
              <input
                value={datasetForm.label}
                onChange={(event) =>
                  setDatasetForm((current) => ({
                    ...current,
                    label: event.target.value,
                  }))
                }
                placeholder={text.datasetLabel}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
            </FieldShell>
            <FieldShell
              label={text.datasetPath}
              helper={
                isEnglish
                  ? "Local JSONL path. Community presets fill this with a bundled starter file."
                  : "本地 JSONL 路径；社区预设会自动填入内置 starter 文件。"
              }
            >
              <input
                value={datasetForm.sourcePath}
                onChange={(event) =>
                  setDatasetForm((current) => ({
                    ...current,
                    sourcePath: event.target.value,
                  }))
                }
                placeholder={text.datasetPath}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
            </FieldShell>
            <FieldShell
              label={text.datasetFormat}
              helper={
                isEnglish
                  ? "Use chat-jsonl for messages arrays; instruction-jsonl for instruction/output rows."
                  : "messages 数组用 chat-jsonl；instruction/output 行用 instruction-jsonl。"
              }
            >
              <select
                value={datasetForm.format}
                onChange={(event) =>
                  setDatasetForm((current) => ({
                    ...current,
                    format: event.target.value as AgentFineTuneDatasetFormat,
                  }))
                }
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="chat-jsonl">chat-jsonl</option>
                <option value="instruction-jsonl">instruction-jsonl</option>
              </select>
            </FieldShell>
            <FieldShell
              label={text.upstreamQuery}
              helper={
                isEnglish
                  ? "Query used for scheduled community dataset discovery."
                  : "用于定期检查开源社区是否有新微调数据集。"
              }
            >
              <input
                value={datasetForm.upstreamQuery}
                onChange={(event) =>
                  setDatasetForm((current) => ({
                    ...current,
                    upstreamQuery: event.target.value,
                  }))
                }
                placeholder={text.upstreamQuery}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
            </FieldShell>
            <FieldShell
              label={text.refreshCadence}
              helper={
                isEnglish
                  ? "How often the admin watcher should refresh upstream candidates."
                  : "后台监听器多久刷新一次上游候选数据集。"
              }
            >
              <input
                value={datasetForm.refreshCadenceHours}
                onChange={(event) =>
                  setDatasetForm((current) => ({
                    ...current,
                    refreshCadenceHours:
                      Number(event.target.value) || current.refreshCadenceHours,
                  }))
                }
                placeholder={text.refreshCadence}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
            </FieldShell>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() =>
                  void postAction(
                    { action: "validate-dataset", ...datasetForm },
                    text.validated,
                  )
                }
                className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
              >
                {text.datasetValidate}
              </button>
              <button
                type="button"
                disabled={!canSaveDataset}
                onClick={async () => {
                  const payload = await postAction(
                    { action: "save-dataset", ...datasetForm },
                    text.saveSuccessDataset,
                  );
                  if (payload?.summary?.datasets?.[0]) {
                    setRecipeForm((current) => ({
                      ...current,
                      datasetId:
                        payload.summary?.datasets?.[0]?.id || current.datasetId,
                    }));
                  }
                }}
                className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition enabled:hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {text.datasetSave}
              </button>
            </div>
          </div>

          {datasetValidation ? (
            <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-slate-950/70 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span
                  className={`rounded-full px-2.5 py-1 ${datasetValidation.ok ? "bg-emerald-400/15 text-emerald-100" : "bg-rose-400/15 text-rose-100"}`}
                >
                  {datasetValidation.ok ? "OK" : "FAILED"}
                </span>
                <span>{datasetValidation.format}</span>
                <span>{datasetValidation.sampleCount} samples</span>
              </div>
              {datasetValidation.preview.length ? (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                    {text.preview}
                  </p>
                  <div className="mt-2 space-y-2">
                    {datasetValidation.preview.map((item) => (
                      <div
                        key={`preview:${item.index}`}
                        className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3"
                      >
                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                          #{item.index}
                        </p>
                        <p className="mt-2 text-xs leading-6 text-slate-200">
                          {item.inputPreview}
                        </p>
                        <p className="mt-2 text-xs leading-6 text-cyan-100">
                          {item.outputPreview}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {datasetValidation.warnings.length ? (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200">
                    {text.warnings}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs leading-6 text-amber-100">
                    {datasetValidation.warnings.map((warning) => (
                      <li key={warning}>- {warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {datasetValidation.errors.length ? (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-rose-200">
                    {text.errors}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs leading-6 text-rose-100">
                    {datasetValidation.errors.map((error) => (
                      <li key={error}>- {error}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <p className="text-sm font-semibold text-white">{text.recipeTitle}</p>
          <p className="mt-2 text-xs leading-6 text-slate-500">
            {text.recipeHint}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <FieldShell label={text.recipeLabel} helper={recipeHelp.label}>
              <input
                value={recipeForm.label}
                onChange={(event) =>
                  setRecipeForm((current) => ({
                    ...current,
                    label: event.target.value,
                  }))
                }
                placeholder={text.recipeLabel}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
            </FieldShell>
            <FieldShell label={text.datasets} helper={recipeHelp.datasetId}>
              <select
                value={recipeForm.datasetId}
                onChange={(event) =>
                  setRecipeForm((current) => ({
                    ...current,
                    datasetId: event.target.value,
                  }))
                }
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="">{text.datasets}</option>
                {(summary?.datasets || []).map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.label}
                  </option>
                ))}
              </select>
            </FieldShell>
            <FieldShell
              label={text.baseTarget}
              helper={recipeHelp.baseTargetId}
            >
              <select
                value={recipeForm.baseTargetId}
                onChange={(event) =>
                  setRecipeForm((current) => ({
                    ...current,
                    baseTargetId: event.target.value,
                  }))
                }
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="">{text.baseTarget}</option>
                {(summary?.localTargets || []).map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label}
                  </option>
                ))}
              </select>
            </FieldShell>
            <FieldShell
              label={text.adapterName}
              helper={recipeHelp.adapterName}
            >
              <input
                value={recipeForm.adapterName}
                onChange={(event) =>
                  setRecipeForm((current) => ({
                    ...current,
                    adapterName: event.target.value,
                  }))
                }
                placeholder={text.adapterName}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
            </FieldShell>
            <FieldShell
              label={text.fineTuneMethod}
              helper={recipeHelp.fineTuneMethod}
            >
              <select
                value={recipeForm.fineTuneMethod}
                onChange={(event) =>
                  setRecipeForm((current) => ({
                    ...current,
                    fineTuneMethod: event.target.value as "lora" | "dora",
                  }))
                }
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="lora">{text.fineTuneMethod} · LoRA</option>
                <option value="dora">{text.fineTuneMethod} · DoRA</option>
              </select>
            </FieldShell>
            <FieldShell label={text.optimizer} helper={recipeHelp.optimizer}>
              <select
                value={recipeForm.optimizer}
                onChange={(event) =>
                  setRecipeForm((current) => ({
                    ...current,
                    optimizer: event.target.value as
                      | "adam"
                      | "adamw"
                      | "sgd"
                      | "adafactor",
                  }))
                }
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="adamw">{text.optimizer} · AdamW</option>
                <option value="adam">{text.optimizer} · Adam</option>
                <option value="sgd">{text.optimizer} · SGD</option>
                <option value="adafactor">{text.optimizer} · Adafactor</option>
              </select>
            </FieldShell>
            {numericRecipeFields.map((field) => (
              <FieldShell
                key={field.key}
                label={field.label}
                helper={field.helper}
              >
                <input
                  type="number"
                  step={field.step}
                  value={recipeForm[field.key]}
                  onChange={(event) =>
                    updateRecipeNumber(field.key, event.target.value)
                  }
                  placeholder={field.label}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
                />
              </FieldShell>
            ))}
            <FieldShell
              label={text.benchmarkSuite}
              helper={recipeHelp.benchmarkSuiteId}
            >
              <input
                value={recipeForm.benchmarkSuiteId}
                onChange={(event) =>
                  setRecipeForm((current) => ({
                    ...current,
                    benchmarkSuiteId: event.target.value,
                  }))
                }
                placeholder={text.benchmarkSuite}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
            </FieldShell>
            <FieldShell
              label={text.notes}
              helper={recipeHelp.notes}
              className="sm:col-span-2 xl:col-span-1"
            >
              <textarea
                value={recipeForm.notes}
                onChange={(event) =>
                  setRecipeForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                placeholder={text.notes}
                rows={3}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
            </FieldShell>
            <label className="rounded-2xl border border-white/10 bg-slate-950/50 p-3 text-sm text-slate-300 sm:col-span-2 xl:col-span-1">
              <span className="flex items-center gap-2 font-semibold text-slate-100">
                <input
                  type="checkbox"
                  checked={recipeForm.gradientCheckpointing}
                  onChange={(event) =>
                    setRecipeForm((current) => ({
                      ...current,
                      gradientCheckpointing: event.target.checked,
                    }))
                  }
                />
                {text.gradientCheckpointing}
              </span>
              <span className="mt-1 block text-[11px] leading-5 text-slate-500">
                {recipeHelp.gradientCheckpointing}
              </span>
            </label>
            <button
              type="button"
              onClick={async () => {
                const payload = await postAction(
                  { action: "save-recipe", ...recipeForm },
                  text.saveSuccessRecipe,
                );
                const nextRecipeId = payload?.summary?.recipes?.[0]?.id;
                if (typeof nextRecipeId === "string" && nextRecipeId) {
                  setSelectedRecipeId(nextRecipeId);
                }
              }}
              className="rounded-full border border-violet-400/30 bg-violet-400/10 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:bg-violet-400/15"
            >
              {text.recipeSave}
            </button>
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <p className="text-sm font-semibold text-white">{text.jobTitle}</p>
          <p className="mt-2 text-xs leading-6 text-slate-500">
            {text.jobHint}
          </p>
          <div className="mt-4 space-y-3">
            <select
              value={selectedRecipeId}
              onChange={(event) => setSelectedRecipeId(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="">{text.recipes}</option>
              {(summary?.recipes || []).map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.label}
                </option>
              ))}
            </select>
            {selectedRecipe ? (
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-xs leading-6 text-slate-300">
                <p className="font-semibold text-white">
                  {selectedRecipe.label}
                </p>
                <p className="mt-2">
                  {text.adapterName}: {selectedRecipe.adapterName}
                </p>
                <p>
                  {text.benchmarkSuite}:{" "}
                  {selectedRecipe.benchmarkSuiteId || "--"}
                </p>
                <p>
                  {text.sequenceLength}: {selectedRecipe.sequenceLength}
                </p>
                <p>
                  {text.fineTuneMethod}: {selectedRecipe.fineTuneMethod}
                </p>
                <p>
                  {text.optimizer}: {selectedRecipe.optimizer}
                </p>
              </div>
            ) : null}
            <button
              type="button"
              disabled={!selectedRecipeId}
              onClick={() =>
                void postAction(
                  { action: "stage-job", recipeId: selectedRecipeId },
                  text.stageSuccess,
                )
              }
              className="rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-100 transition enabled:hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {text.stageJob}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_1fr_1.1fr]">
        <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">
              {text.localTargets}
            </p>
            <span className="text-xs text-slate-500">
              {summary?.localTargets.length || 0}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {(summary?.localTargets || []).length ? (
              summary?.localTargets.map((target) => (
                <div
                  key={target.id}
                  className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3 text-xs leading-6 text-slate-300"
                >
                  <p className="font-semibold text-white">{target.label}</p>
                  <p className="mt-1 text-slate-400">{target.modelDefault}</p>
                  <p>
                    {target.parameterScale || "--"} ·{" "}
                    {target.quantizationLabel || "--"}
                  </p>
                  <p>
                    {target.recommendedContextWindow
                      ? `${Math.round(target.recommendedContextWindow / 1024)}K`
                      : "--"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {target.sourceUrl ? (
                      <button
                        type="button"
                        onClick={() =>
                          void runSecondaryAction(
                            `target-source:${target.id}`,
                            {
                              action: "open-source-page",
                              targetId: target.id,
                            },
                          )
                        }
                        className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                      >
                        {actionPending[`target-source:${target.id}`]
                          ? text.loading
                          : text.openSource}
                      </button>
                    ) : null}
                    {target.sourcePath ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void copyValue(target.sourcePath)}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                        >
                          {text.copyPath}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">{text.empty}</p>
            )}
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">{text.datasets}</p>
            <span className="text-xs text-slate-500">
              {summary?.datasets.length || 0}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {(summary?.datasets || []).length ? (
              summary?.datasets.map((dataset) => (
                <div
                  key={dataset.id}
                  className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3 text-xs leading-6 text-slate-300"
                >
                  <p className="font-semibold text-white">{dataset.label}</p>
                  <p className="mt-1 text-slate-400">
                    {dataset.format} · {dataset.sampleCount} samples
                  </p>
                  <p>{dataset.sourcePath || "--"}</p>
                  <p>{formatDateTime(dataset.updatedAt)}</p>
                  {dataset.sourcePath ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void runSecondaryAction(
                            `dataset-open:${dataset.id}`,
                            {
                              action: "open-path",
                              kind: "dataset-source",
                              id: dataset.id,
                            },
                          )
                        }
                        className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                      >
                        {actionPending[`dataset-open:${dataset.id}`]
                          ? text.loading
                          : text.openDir}
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyValue(dataset.sourcePath)}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                      >
                        {text.copyPath}
                      </button>
                    </div>
                  ) : null}

                  {(() => {
                    const draft = getDatasetWatchDraft(dataset);
                    return (
                      <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                        <input
                          value={draft.upstreamQuery}
                          onChange={(event) =>
                            setDatasetWatchDrafts((current) => ({
                              ...current,
                              [dataset.id]: {
                                upstreamQuery: event.target.value,
                                refreshCadenceHours:
                                  current[dataset.id]?.refreshCadenceHours ||
                                  draft.refreshCadenceHours,
                              },
                            }))
                          }
                          placeholder={text.upstreamQuery}
                          className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none"
                        />
                        <input
                          value={draft.refreshCadenceHours}
                          onChange={(event) =>
                            setDatasetWatchDrafts((current) => ({
                              ...current,
                              [dataset.id]: {
                                upstreamQuery:
                                  current[dataset.id]?.upstreamQuery ||
                                  draft.upstreamQuery,
                                refreshCadenceHours:
                                  Number(event.target.value) ||
                                  draft.refreshCadenceHours,
                              },
                            }))
                          }
                          placeholder={text.refreshCadence}
                          className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none"
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void postAction(
                                {
                                  action: "save-dataset-watch",
                                  datasetId: dataset.id,
                                  upstreamQuery: draft.upstreamQuery,
                                  refreshCadenceHours:
                                    draft.refreshCadenceHours,
                                },
                                text.datasetWatchSave,
                              )
                            }
                            className="rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-400/15"
                          >
                            {text.datasetWatchSave}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void postAction(
                                {
                                  action: "check-upstream-datasets",
                                  datasetId: dataset.id,
                                  upstreamQuery: draft.upstreamQuery,
                                },
                                text.datasetWatchCheck,
                              )
                            }
                            className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                          >
                            {text.datasetWatchCheck}
                          </button>
                        </div>
                        <div className="mt-3 space-y-1 text-[11px] text-slate-400">
                          <p>
                            Last check ·{" "}
                            {formatDateTime(dataset.lastUpstreamCheckedAt)}
                          </p>
                          <p>
                            Next check ·{" "}
                            {formatDateTime(dataset.nextUpstreamCheckAt)}
                          </p>
                        </div>
                        {dataset.latestUpstreamCandidates?.length ? (
                          <div className="mt-3 space-y-2">
                            {dataset.latestUpstreamCandidates
                              .slice(0, 3)
                              .map((candidate) => (
                                <div
                                  key={candidate.id}
                                  className="rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="min-w-0 font-semibold text-white">
                                      {candidate.label}
                                    </p>
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                                      {candidate.source}
                                    </span>
                                  </div>
                                  <p className="mt-1 break-all text-[11px] text-slate-500">
                                    {candidate.repoId}
                                  </p>
                                  <p className="mt-2 text-[11px] leading-5 text-slate-300">
                                    {candidate.summary}
                                  </p>
                                  <div className="mt-2 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-2">
                                    <span className="rounded-xl border border-white/10 bg-white/[0.035] px-2.5 py-2">
                                      {text.upstreamRows}:{" "}
                                      <span className="text-slate-200">
                                        {formatSampleCount(candidate.sampleCount)}
                                      </span>
                                    </span>
                                    <span className="rounded-xl border border-white/10 bg-white/[0.035] px-2.5 py-2">
                                      {text.lastUpdated}:{" "}
                                      <span className="text-slate-200">
                                        {formatDateTime(candidate.updatedAt)}
                                      </span>
                                    </span>
                                  </div>
                                  {candidate.tags.length ? (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {candidate.tags.slice(0, 5).map((tag) => (
                                        <span
                                          key={tag}
                                          className="rounded-full border border-white/10 bg-white/[0.035] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-400"
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
                                  <p className="mt-2 rounded-xl border border-amber-300/15 bg-amber-300/[0.06] px-2.5 py-2 text-[11px] leading-5 text-amber-100/85">
                                    {text.candidateImportNote}
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void copyValue(
                                          buildDatasetCandidateImportPlan(
                                            dataset,
                                            candidate,
                                          ),
                                          text.importPlanCopied,
                                        )
                                      }
                                      className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-100 transition hover:bg-emerald-400/15"
                                    >
                                      {text.copyImportPlan}
                                    </button>
                                    <a
                                      href={candidate.repoUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-slate-100 transition hover:bg-white/10"
                                    >
                                      {text.sourcePage}
                                    </a>
                                    {candidate.docsUrl ? (
                                      <a
                                        href={candidate.docsUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-slate-100 transition hover:bg-white/10"
                                      >
                                        {text.docsPage}
                                      </a>
                                    ) : null}
                                    {candidate.paperUrl ? (
                                      <a
                                        href={candidate.paperUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-slate-100 transition hover:bg-white/10"
                                      >
                                        {text.paperPage}
                                      </a>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">{text.empty}</p>
            )}
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">{text.jobs}</p>
            <span className="text-xs text-slate-500">
              {summary?.jobs.length || 0}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {(summary?.jobs || []).length ? (
              jobGroups.map((group) => {
                if (!group.jobs.length) return null;
                const groupCollapsed = collapsedJobGroups[group.key];
                const latestJob = group.jobs[0];
                return (
                  <section
                    key={group.key}
                    className="rounded-[24px] border border-white/10 bg-black/15 p-3"
                  >
                    <div className="flex w-full items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedJobGroups((current) => ({
                            ...current,
                            [group.key]: !current[group.key],
                          }))
                        }
                        className="min-w-0 flex-1 text-left"
                        aria-expanded={!groupCollapsed}
                      >
                        <span>
                          <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                            {group.label}
                          </span>
                          <span className="mt-1 block text-[11px] text-slate-500">
                            {text.jobGroupLatestRun}:{" "}
                            {latestJob?.adapterName || "--"}
                            {group.key === "needs-review"
                              ? ` · ${text.jobGroupRerunHint}`
                              : ""}
                          </span>
                        </span>
                      </button>
                      <span className="flex shrink-0 items-center gap-2">
                        {group.key === "needs-review" && latestJob ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              void postAction(
                                { action: "rerun-job", id: latestJob.id },
                                text.rerunSuccess,
                              )
                            }
                            className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold text-amber-100 transition enabled:hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {text.rerunLatestFailed}
                          </button>
                        ) : null}
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] text-slate-400">
                          {group.jobs.length}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                          {groupCollapsed
                            ? text.jobGroupCollapsed
                            : text.jobGroupExpanded}
                        </span>
                      </span>
                    </div>
                    {!groupCollapsed ? (
                      <div className="mt-3 space-y-3">
                        {group.jobs.map((job) => {
                          const progressPercent = getJobProgressPercent(job);
                          const statusMeta = getJobStatusMeta(job);
                          const currentStep = job.progress?.currentStep ?? 0;
                          const totalSteps = job.progress?.totalSteps ?? 0;
                          const canStart =
                            job.status !== "queued" && job.status !== "running";
                          return (
                            <div
                              key={job.id}
                              className="rounded-[22px] border border-white/10 bg-slate-950/70 px-4 py-4 text-xs leading-6 text-slate-300"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`h-2.5 w-2.5 rounded-full ${statusMeta.dot}`}
                                    />
                                    <p className="font-semibold text-white">
                                      {job.adapterName}
                                    </p>
                                  </div>
                                  <p className="mt-1 break-all text-slate-400">
                                    {job.baseModelRef || "--"}
                                  </p>
                                </div>
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${statusMeta.badge}`}
                                >
                                  {statusMeta.label}
                                </span>
                              </div>

                              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                                      {text.progress}
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-white">
                                      {progressPercent}%{" "}
                                      {totalSteps
                                        ? `· ${currentStep}/${totalSteps}`
                                        : ""}
                                    </p>
                                  </div>
                                  <div className="text-right text-[11px] text-slate-400">
                                    <p>
                                      {text.currentLoss}:{" "}
                                      {formatNumber(
                                        job.progress?.latestTrainLoss,
                                      )}
                                    </p>
                                    <p>
                                      {text.benchmarkSuite}:{" "}
                                      {job.benchmarkSuiteId || "--"}
                                    </p>
                                  </div>
                                </div>
                                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                                  <div
                                    className={`h-full rounded-full bg-gradient-to-r ${statusMeta.bar} transition-all duration-500`}
                                    style={{ width: `${progressPercent}%` }}
                                  />
                                </div>
                              </div>

                              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                <p>
                                  {text.startedAt}:{" "}
                                  {formatDateTime(
                                    job.startedAt || job.createdAt,
                                  )}
                                </p>
                                <p>
                                  {text.completedAt}:{" "}
                                  {formatDateTime(job.completedAt)}
                                </p>
                                <p>
                                  {text.heartbeat}:{" "}
                                  {formatDateTime(job.workerHeartbeatAt)}
                                </p>
                              </div>

                              {job.curve?.length ? (
                                <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                                        {text.trainingCurve}
                                      </p>
                                      <p className="mt-2 text-xs leading-6 text-slate-400">
                                        {text.normalizedLossHint}
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] text-slate-500">
                                      <span>
                                        {text.rawLoss}: train{" "}
                                        {formatNumber(
                                          job.progress?.latestTrainLoss,
                                        )}{" "}
                                        · val{" "}
                                        {formatNumber(
                                          job.progress?.latestValLoss,
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                  {(() => {
                                    const chartRange =
                                      chartRangeByJobId[job.id] || "all";
                                    const chart = buildTrainingChart(
                                      job,
                                      chartRange,
                                    );
                                    if (!chart) return null;
                                    const hoverPoint =
                                      chartHoverByJobId[job.id];
                                    const visibleHoverPoint =
                                      hoverPoint &&
                                      hoverPoint.step >=
                                        chart.visibleStartStep &&
                                      hoverPoint.step <= chart.visibleEndStep
                                        ? hoverPoint
                                        : null;
                                    return (
                                      <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/80 p-3">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                                              {text.chartRange}
                                            </span>
                                            <div className="inline-flex flex-wrap rounded-full border border-white/10 bg-white/[0.04] p-1">
                                              {TRAINING_CHART_RANGE_PRESETS.map(
                                                (range) => (
                                                  <button
                                                    key={`${job.id}:${range}`}
                                                    type="button"
                                                    onClick={() => {
                                                      setChartRangeByJobId(
                                                        (current) => ({
                                                          ...current,
                                                          [job.id]: range,
                                                        }),
                                                      );
                                                      setChartHoverByJobId(
                                                        (current) => ({
                                                          ...current,
                                                          [job.id]: null,
                                                        }),
                                                      );
                                                    }}
                                                    className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                                                      chartRange === range
                                                        ? "bg-cyan-400/15 text-cyan-100"
                                                        : "text-slate-300 hover:bg-white/[0.08]"
                                                    }`}
                                                  >
                                                    {getChartRangeLabel(range)}
                                                  </button>
                                                ),
                                              )}
                                            </div>
                                          </div>
                                          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-slate-300">
                                            {text.chartWindow}:{" "}
                                            {chart.visibleStartStep} -{" "}
                                            {chart.visibleEndStep}
                                          </div>
                                        </div>
                                        <div className="relative mt-3 rounded-2xl border border-white/10 bg-slate-950/90 p-3">
                                          {visibleHoverPoint ? (
                                            <div
                                              className="pointer-events-none absolute z-20 min-w-[160px] rounded-2xl border border-white/10 bg-slate-950/96 px-3 py-3 text-[11px] leading-5 text-slate-100 shadow-[0_18px_48px_rgba(2,6,23,0.45)]"
                                              style={{
                                                left: `${(visibleHoverPoint.x / chart.width) * 100}%`,
                                                top: `${(visibleHoverPoint.y / chart.height) * 100}%`,
                                                transform:
                                                  visibleHoverPoint.x >
                                                  chart.width * 0.72
                                                    ? "translate(-104%, -112%)"
                                                    : "translate(10px, -112%)",
                                              }}
                                            >
                                              <p
                                                className={`font-semibold ${
                                                  visibleHoverPoint.split ===
                                                  "train"
                                                    ? "text-cyan-100"
                                                    : "text-violet-100"
                                                }`}
                                              >
                                                {visibleHoverPoint.split ===
                                                "train"
                                                  ? text.chartSplitTrain
                                                  : text.chartSplitValid}
                                              </p>
                                              <div className="mt-2 space-y-1 text-slate-300">
                                                <p>
                                                  {text.chartStep}:{" "}
                                                  {visibleHoverPoint.step}
                                                </p>
                                                <p>
                                                  {text.lossAxis}:{" "}
                                                  {formatRatio(
                                                    visibleHoverPoint.normalizedLoss,
                                                  )}
                                                </p>
                                                <p>
                                                  {text.rawLoss}:{" "}
                                                  {formatNumber(
                                                    visibleHoverPoint.rawLoss,
                                                  )}
                                                </p>
                                              </div>
                                            </div>
                                          ) : null}
                                          <svg
                                            viewBox={`0 0 ${chart.width} ${chart.height}`}
                                            className="h-52 w-full"
                                          >
                                            <defs>
                                              <linearGradient
                                                id={`train-fill-${job.id}`}
                                                x1="0"
                                                x2="0"
                                                y1="0"
                                                y2="1"
                                              >
                                                <stop
                                                  offset="0%"
                                                  stopColor="rgb(34 211 238)"
                                                  stopOpacity="0.22"
                                                />
                                                <stop
                                                  offset="100%"
                                                  stopColor="rgb(34 211 238)"
                                                  stopOpacity="0"
                                                />
                                              </linearGradient>
                                            </defs>
                                            <rect
                                              x={chart.plot.left}
                                              y={chart.plot.top}
                                              width={chart.plotWidth}
                                              height={chart.plotHeight}
                                              rx="10"
                                              fill="rgba(2,6,23,0.72)"
                                              stroke="rgba(255,255,255,0.08)"
                                            />
                                            {chart.yTicks.map((tick) => (
                                              <g key={`y:${tick.value}`}>
                                                <line
                                                  x1={chart.plot.left}
                                                  x2={
                                                    chart.width -
                                                    chart.plot.right
                                                  }
                                                  y1={tick.y}
                                                  y2={tick.y}
                                                  stroke="rgba(148,163,184,0.16)"
                                                  strokeDasharray="3 5"
                                                />
                                                <text
                                                  x={chart.plot.left - 8}
                                                  y={tick.y + 3}
                                                  textAnchor="end"
                                                  className="fill-slate-500 text-[9px]"
                                                >
                                                  {formatRatio(tick.value)}
                                                </text>
                                              </g>
                                            ))}
                                            {chart.xTicks.map((tick) => (
                                              <g key={`x:${tick.step}`}>
                                                <line
                                                  x1={tick.x}
                                                  x2={tick.x}
                                                  y1={chart.plot.top}
                                                  y2={
                                                    chart.plot.top +
                                                    chart.plotHeight
                                                  }
                                                  stroke="rgba(148,163,184,0.1)"
                                                />
                                                <text
                                                  x={tick.x}
                                                  y={
                                                    chart.plot.top +
                                                    chart.plotHeight +
                                                    20
                                                  }
                                                  textAnchor="middle"
                                                  className="fill-slate-500 text-[9px]"
                                                >
                                                  {tick.step}
                                                </text>
                                              </g>
                                            ))}
                                            <text
                                              x={chart.plot.left}
                                              y={chart.height - 4}
                                              className="fill-slate-500 text-[9px]"
                                            >
                                              {text.stepAxis}
                                            </text>
                                            <text
                                              x="9"
                                              y={chart.plot.top + 6}
                                              transform={`rotate(-90 9 ${chart.plot.top + 6})`}
                                              className="fill-slate-500 text-[9px]"
                                            >
                                              {text.lossAxis}
                                            </text>
                                            {visibleHoverPoint ? (
                                              <line
                                                x1={visibleHoverPoint.x}
                                                x2={visibleHoverPoint.x}
                                                y1={chart.plot.top}
                                                y2={
                                                  chart.plot.top +
                                                  chart.plotHeight
                                                }
                                                stroke="rgba(148,163,184,0.35)"
                                                strokeDasharray="4 4"
                                              />
                                            ) : null}
                                            <path
                                              d={chart.trainPath}
                                              fill="none"
                                              stroke="rgb(34 211 238)"
                                              strokeWidth="2.4"
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                            />
                                            <path
                                              d={chart.validPath}
                                              fill="none"
                                              stroke="rgb(167 139 250)"
                                              strokeWidth="2.4"
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                            />
                                            {chart.trainPoints.map((point) => (
                                              <g
                                                key={`train:${point.step}:${point.loss}`}
                                              >
                                                <circle
                                                  cx={point.x}
                                                  cy={point.y}
                                                  r="3.2"
                                                  fill="rgb(34 211 238)"
                                                />
                                                <circle
                                                  cx={point.x}
                                                  cy={point.y}
                                                  r="10"
                                                  fill="transparent"
                                                  tabIndex={0}
                                                  onMouseEnter={() =>
                                                    setChartHoverByJobId(
                                                      (current) => ({
                                                        ...current,
                                                        [job.id]: point,
                                                      }),
                                                    )
                                                  }
                                                  onFocus={() =>
                                                    setChartHoverByJobId(
                                                      (current) => ({
                                                        ...current,
                                                        [job.id]: point,
                                                      }),
                                                    )
                                                  }
                                                  onMouseLeave={() =>
                                                    setChartHoverByJobId(
                                                      (current) => ({
                                                        ...current,
                                                        [job.id]: null,
                                                      }),
                                                    )
                                                  }
                                                  onBlur={() =>
                                                    setChartHoverByJobId(
                                                      (current) => ({
                                                        ...current,
                                                        [job.id]: null,
                                                      }),
                                                    )
                                                  }
                                                />
                                              </g>
                                            ))}
                                            {chart.validPoints.map((point) => (
                                              <g
                                                key={`valid:${point.step}:${point.loss}`}
                                              >
                                                <circle
                                                  cx={point.x}
                                                  cy={point.y}
                                                  r="3.2"
                                                  fill="rgb(167 139 250)"
                                                />
                                                <circle
                                                  cx={point.x}
                                                  cy={point.y}
                                                  r="10"
                                                  fill="transparent"
                                                  tabIndex={0}
                                                  onMouseEnter={() =>
                                                    setChartHoverByJobId(
                                                      (current) => ({
                                                        ...current,
                                                        [job.id]: point,
                                                      }),
                                                    )
                                                  }
                                                  onFocus={() =>
                                                    setChartHoverByJobId(
                                                      (current) => ({
                                                        ...current,
                                                        [job.id]: point,
                                                      }),
                                                    )
                                                  }
                                                  onMouseLeave={() =>
                                                    setChartHoverByJobId(
                                                      (current) => ({
                                                        ...current,
                                                        [job.id]: null,
                                                      }),
                                                    )
                                                  }
                                                  onBlur={() =>
                                                    setChartHoverByJobId(
                                                      (current) => ({
                                                        ...current,
                                                        [job.id]: null,
                                                      }),
                                                    )
                                                  }
                                                />
                                              </g>
                                            ))}
                                            {chart.latestTrain ? (
                                              <text
                                                x={Math.min(
                                                  chart.latestTrain.x + 6,
                                                  chart.width - 74,
                                                )}
                                                y={chart.latestTrain.y - 6}
                                                className="fill-cyan-100 text-[9px]"
                                              >
                                                train{" "}
                                                {formatRatio(
                                                  chart.latestTrain
                                                    .normalizedLoss,
                                                )}
                                              </text>
                                            ) : null}
                                            {chart.latestValid ? (
                                              <text
                                                x={Math.min(
                                                  chart.latestValid.x + 6,
                                                  chart.width - 66,
                                                )}
                                                y={chart.latestValid.y + 14}
                                                className="fill-violet-100 text-[9px]"
                                              >
                                                val{" "}
                                                {formatRatio(
                                                  chart.latestValid
                                                    .normalizedLoss,
                                                )}
                                              </text>
                                            ) : null}
                                          </svg>
                                          <div className="mt-2 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-2">
                                            <p>
                                              train {text.lossDelta}:{" "}
                                              <span className="text-cyan-100">
                                                {chart.firstTrain &&
                                                chart.latestTrain
                                                  ? `${formatRatio(chart.firstTrain.normalizedLoss)} -> ${formatRatio(chart.latestTrain.normalizedLoss)}`
                                                  : "--"}
                                              </span>
                                              <span className="ml-2 text-slate-500">
                                                ({text.rawLoss}:{" "}
                                                {chart.firstTrain &&
                                                chart.latestTrain
                                                  ? `${formatNumber(chart.firstTrain.rawLoss)} -> ${formatNumber(chart.latestTrain.rawLoss)}`
                                                  : "--"}
                                                )
                                              </span>
                                            </p>
                                            <p>
                                              val {text.lossDelta}:{" "}
                                              <span className="text-violet-100">
                                                {chart.firstValid &&
                                                chart.latestValid
                                                  ? `${formatRatio(chart.firstValid.normalizedLoss)} -> ${formatRatio(chart.latestValid.normalizedLoss)}`
                                                  : "--"}
                                              </span>
                                              <span className="ml-2 text-slate-500">
                                                ({text.rawLoss}:{" "}
                                                {chart.firstValid &&
                                                chart.latestValid
                                                  ? `${formatNumber(chart.firstValid.rawLoss)} -> ${formatNumber(chart.latestValid.rawLoss)}`
                                                  : "--"}
                                                )
                                              </span>
                                            </p>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              ) : null}

                              {job.latestMessage ? (
                                <p className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-200">
                                  {job.latestMessage}
                                </p>
                              ) : null}

                              <div className="mt-3 grid gap-2 text-[11px] text-slate-400">
                                <p>
                                  {text.bundlePath}: {job.bundlePath}
                                </p>
                                <p>
                                  {text.outputDir}: {job.outputDir}
                                </p>
                                <p>
                                  {text.configFile}: {job.configFile || "--"}
                                </p>
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={!canStart}
                                  onClick={() =>
                                    void postAction(
                                      { action: "start-job", id: job.id },
                                      text.startSuccess,
                                    )
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition enabled:hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <svg
                                    viewBox="0 0 12 12"
                                    aria-hidden="true"
                                    className="h-3 w-3 fill-current"
                                  >
                                    <path d="M3 1.8v8.4L9.8 6 3 1.8Z" />
                                  </svg>
                                  {text.startJob}
                                </button>
                                {job.status === "failed" ||
                                job.status === "cancelled" ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void postAction(
                                        { action: "rerun-job", id: job.id },
                                        text.rerunSuccess,
                                      )
                                    }
                                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-[11px] font-semibold text-amber-100 transition hover:bg-amber-300/15"
                                  >
                                    <svg
                                      viewBox="0 0 12 12"
                                      aria-hidden="true"
                                      className="h-3 w-3 fill-current"
                                    >
                                      <path d="M6 1.2a4.8 4.8 0 1 1-4.28 2.62l.97.52A3.7 3.7 0 1 0 6 2.3H4.55V1.2H6Zm-2.9.05v3.4H.4l2.7-3.4Z" />
                                    </svg>
                                    {text.rerunJob}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  disabled={
                                    job.status !== "queued" &&
                                    job.status !== "running"
                                  }
                                  onClick={() =>
                                    void postAction(
                                      { action: "cancel-job", id: job.id },
                                      text.cancelSuccess,
                                    )
                                  }
                                  className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-[11px] font-semibold text-rose-100 transition enabled:hover:bg-rose-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {text.cancelJob}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void runSecondaryAction(
                                      `job-output:${job.id}`,
                                      {
                                        action: "open-path",
                                        kind: "job-output",
                                        id: job.id,
                                      },
                                    )
                                  }
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                                >
                                  {actionPending[`job-output:${job.id}`]
                                    ? text.loading
                                    : text.openDir}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void runSecondaryAction(
                                      `job-bundle:${job.id}`,
                                      {
                                        action: "open-path",
                                        kind: "job-bundle",
                                        id: job.id,
                                      },
                                    )
                                  }
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                                >
                                  {actionPending[`job-bundle:${job.id}`]
                                    ? text.loading
                                    : text.openBundle}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void copyValue(job.outputDir)}
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                                >
                                  {text.copyPath}
                                </button>
                                <button
                                  type="button"
                                  disabled={!getJobSourceUrl(job)}
                                  onClick={() =>
                                    void runSecondaryAction(
                                      `job-source:${job.id}`,
                                      {
                                        action: "open-source-page",
                                        id: job.id,
                                      },
                                    )
                                  }
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {actionPending[`job-source:${job.id}`]
                                    ? text.loading
                                    : text.openSource}
                                </button>
                              </div>

                              {job.recentLogLines?.length ? (
                                <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                                    {text.workerLog}
                                  </p>
                                  <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-300">
                                    {job.recentLogLines.join("\n")}
                                  </pre>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </section>
                );
              })
            ) : (
              <p className="text-sm text-slate-500">{text.empty}</p>
            )}
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">{text.adapters}</p>
            <span className="text-xs text-slate-500">
              {summary?.adapters.length || 0}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {(summary?.adapters || []).length ? (
              summary?.adapters.map((adapter) => (
                <div
                  key={adapter.id}
                  className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3 text-xs leading-6 text-slate-300"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">
                        {adapter.adapterName}
                      </p>
                      <p className="mt-1 text-slate-400">
                        {adapter.baseTargetLabel || "--"}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${
                        adapter.status === "ready"
                          ? "bg-emerald-400/10 text-emerald-100"
                          : adapter.status === "checkpointing"
                            ? "bg-cyan-400/10 text-cyan-100"
                            : "bg-amber-400/10 text-amber-100"
                      }`}
                    >
                      {adapter.status}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <p>
                      {text.checkpointCount}: {adapter.checkpointCount}
                    </p>
                    <p>
                      {text.latestCheckpoint}:{" "}
                      {formatDateTime(adapter.latestCheckpointAt)}
                    </p>
                    <p>
                      {text.outputDir}: {adapter.outputDir}
                    </p>
                    <p>
                      {text.benchmarkSuite}: {adapter.benchmarkSuiteId || "--"}
                    </p>
                    <p>
                      {text.runtimeAttached}:{" "}
                      {adapter.attachedTargetLabel || "--"}
                    </p>
                    <p>
                      {text.attachedAt}: {formatDateTime(adapter.attachedAt)}
                    </p>
                  </div>
                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                      {text.adapterArtifacts}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {adapter.files.length ? (
                        adapter.files.slice(0, 10).map((file) => (
                          <span
                            key={`${adapter.id}:${file}`}
                            className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-200"
                          >
                            {file}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-slate-500">--</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={
                        adapter.status !== "ready" ||
                        Boolean(actionPending[`adapter-attach:${adapter.id}`])
                      }
                      onClick={() => void attachAdapterRuntime(adapter.id)}
                      className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition enabled:hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionPending[`adapter-attach:${adapter.id}`]
                        ? text.loading
                        : text.attachRuntime}
                    </button>
                    {adapter.attachedTargetId ? (
                      <button
                        type="button"
                        disabled={Boolean(
                          actionPending[`adapter-detach:${adapter.id}`],
                        )}
                        onClick={() => void detachAdapterRuntime(adapter.id)}
                        className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[11px] font-semibold text-amber-100 transition enabled:hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {actionPending[`adapter-detach:${adapter.id}`]
                          ? text.loading
                          : text.detachRuntime}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={
                        adapter.status !== "ready" ||
                        Boolean(
                          actionPending[`adapter-benchmark:${adapter.id}`],
                        )
                      }
                      onClick={() =>
                        void runAdapterBenchmarkHandoff(adapter.id)
                      }
                      className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 transition enabled:hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionPending[`adapter-benchmark:${adapter.id}`]
                        ? text.loading
                        : text.sendToBenchmark}
                    </button>
                    <button
                      type="button"
                      disabled={
                        adapter.status !== "ready" ||
                        Boolean(actionPending[`adapter-compare:${adapter.id}`])
                      }
                      onClick={() => void runAdapterCompareHandoff(adapter.id)}
                      className="rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition enabled:hover:bg-violet-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionPending[`adapter-compare:${adapter.id}`]
                        ? text.loading
                        : text.sendToCompare}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void runSecondaryAction(`adapter-open:${adapter.id}`, {
                          action: "open-path",
                          kind: "adapter-output",
                          id: adapter.id,
                        })
                      }
                      className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                    >
                      {actionPending[`adapter-open:${adapter.id}`]
                        ? text.loading
                        : text.openDir}
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyValue(adapter.outputDir)}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                    >
                      {text.copyPath}
                    </button>
                    {adapter.sourceUrl ? (
                      <button
                        type="button"
                        onClick={() =>
                          void runSecondaryAction(
                            `adapter-source:${adapter.id}`,
                            {
                              action: "open-source-page",
                              adapterId: adapter.id,
                            },
                          )
                        }
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                      >
                        {actionPending[`adapter-source:${adapter.id}`]
                          ? text.loading
                          : text.openSource}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">{text.empty}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
