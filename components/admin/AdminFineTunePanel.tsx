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
  AgentFineTuneDatasetQuality,
  AgentFineTuneDatasetFormat,
  AgentFineTuneDatasetValidation,
  AgentFineTuneOperation,
  AgentFineTuneReportExport,
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
  dataset?: AgentFineTuneDataset;
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
  report?: AgentFineTuneReportExport;
  operation?: AgentFineTuneOperation;
};

const DEFAULT_DATASET_FORM = {
  label: "",
  sourcePath: "",
  format: "chat-jsonl" as AgentFineTuneDatasetFormat,
  upstreamQuery: "",
  refreshCadenceHours: 24,
};

const DEFAULT_COMMUNITY_IMPORT_FORM = {
  label: "",
  sourceUrl: "",
  sourceLabel: "",
  format: "instruction-jsonl" as AgentFineTuneDatasetFormat,
  sampleLimit: 384,
  license: "",
  upstreamQuery: "",
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

type TrainingChartOverlaySeries = {
  jobId: string;
  label: string;
  trainPath: string;
  validPath: string;
  latestTrain?: TrainingChartPoint;
  latestValid?: TrainingChartPoint;
};

type TrainingChartHoverState = TrainingChartPoint | null;
type FineTuneJobGroupKey = "active" | "needs-review" | "completed" | "staged";
type FineTuneWorkspaceTab = "setup" | "runs" | "assets";
type FineTuneLabTab = "train" | "evaluate" | "chat" | "export";
type FineTuneTrainStage =
  | "supervised-fine-tune"
  | "continued-pretrain"
  | "preference-tuning"
  | "distillation";
type FineTuneRecipeFormState = typeof DEFAULT_RECIPE_FORM;
type FineTuneEvalMetric =
  | "loss"
  | "rouge-l"
  | "bleu"
  | "exact-match"
  | "latency";
type FineTuneEvaluateFormState = {
  datasetId: string;
  checkpointPath: string;
  maxSamples: number;
  maxNewTokens: number;
  temperature: number;
  topP: number;
  metrics: FineTuneEvalMetric[];
  savePredictions: boolean;
};
type FineTuneChatFormState = {
  adapterId: string;
  role: "user" | "assistant" | "system";
  systemPrompt: string;
  prompt: string;
  maxNewTokens: number;
  temperature: number;
  topP: number;
  skipSpecialTokens: boolean;
  renderHtmlTags: boolean;
};
type FineTuneDistillationFormState = {
  teacherTargetId: string;
  outputPath: string;
  sampleCount: number;
  maxNewTokens: number;
  temperature: number;
  topP: number;
  seedPrompt: string;
  includeReasoningTrace: boolean;
};
type FineTuneExportFormState = {
  adapterId: string;
  quantization: "none" | "q8" | "q4";
  exportFormat: "adapter-bundle" | "merged-mlx" | "gguf";
  maxShardSizeGb: number;
  outputDir: string;
  hubId: string;
  includeDatasetCard: boolean;
};

const DEFAULT_EVALUATE_FORM: FineTuneEvaluateFormState = {
  datasetId: "",
  checkpointPath: "",
  maxSamples: 64,
  maxNewTokens: 512,
  temperature: 0.2,
  topP: 0.8,
  metrics: ["loss", "rouge-l", "exact-match"],
  savePredictions: true,
};

const DEFAULT_CHAT_FORM: FineTuneChatFormState = {
  adapterId: "",
  role: "user",
  systemPrompt:
    "You are testing a fine-tuned local adapter. Answer directly and avoid exposing training metadata.",
  prompt:
    "Summarize the current fine-tune result in three concise bullets for a teammate.",
  maxNewTokens: 512,
  temperature: 0.7,
  topP: 0.9,
  skipSpecialTokens: true,
  renderHtmlTags: false,
};

const DEFAULT_DISTILLATION_FORM: FineTuneDistillationFormState = {
  teacherTargetId: "",
  outputPath: "data/fine-tune/distilled/starter-distill.jsonl",
  sampleCount: 384,
  maxNewTokens: 768,
  temperature: 0.4,
  topP: 0.85,
  seedPrompt:
    "Generate concise coding-agent supervision samples for compare, benchmark, retrieval, and local runtime recovery tasks.",
  includeReasoningTrace: false,
};

const DEFAULT_EXPORT_FORM: FineTuneExportFormState = {
  adapterId: "",
  quantization: "none",
  exportFormat: "adapter-bundle",
  maxShardSizeGb: 5,
  outputDir: "",
  hubId: "",
  includeDatasetCard: true,
};

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
    id: "openhermes-2-5-chat",
    label: {
      en: "OpenHermes 2.5 chat starter",
      zh: "OpenHermes 2.5 对话 starter",
    },
    description: {
      en: "A chat-style preset inspired by OpenHermes 2.5 formats, useful for longer multi-turn assistant warmups.",
      zh: "参考 OpenHermes 2.5 格式的对话 starter，适合更长轮次的多轮助手热身。",
    },
    bestFor: {
      en: "Beginner-friendly chat SFT after the bundled project starter is stable.",
      zh: "内置项目 starter 跑稳后，用作新手友好的聊天 SFT 升级。",
    },
    source: "Hugging Face",
    sourceUrl: "https://huggingface.co/datasets/teknium/OpenHermes-2.5",
    docsUrl: "https://huggingface.co/datasets/teknium/OpenHermes-2.5",
    localPath: "data/fine-tune/community/openhermes-2-5-chat-sample.jsonl",
    format: "chat-jsonl",
    upstreamQuery: "teknium OpenHermes 2.5 chat messages",
    sampleCount: 1000000,
    bootstrapRows: 192,
    recommendedSamples: 1500,
    recommendedEpochs: 3,
    recommendedSteps: {
      en: "Start from the bundled 192-row slice, then sample 1k-2k upstream rows once conversion is verified.",
      zh: "先用内置 192 行切片，转换验证通过后再抽 1k-2k 条上游样本。",
    },
    difficulty: {
      en: "Chat upgrade",
      zh: "对话升级",
    },
    license: "Dataset card terms, verify upstream before redistribution",
    recipeNotes: {
      en: "Good for longer chat behavior runs; keep validation split on and compare against the base adapter.",
      zh: "适合更长轮次的对话行为训练；保留验证集，并与 base adapter 做 compare。",
    },
  },
  {
    id: "openassistant-oasst1",
    label: {
      en: "OpenAssistant OASST1 starter",
      zh: "OpenAssistant OASST1 starter",
    },
    description: {
      en: "Conversation-tree assistant data with a robust local slice using community-style `conversations` rows.",
      zh: "对话树助手数据，本地切片使用社区常见的 `conversations` 行格式来验证自动转换。",
    },
    bestFor: {
      en: "Testing community chat conversion and longer assistant-style fine-tune runs.",
      zh: "适合测试社区对话数据转换，并跑更长的助手风格微调。",
    },
    source: "Hugging Face",
    sourceUrl: "https://huggingface.co/datasets/OpenAssistant/oasst1",
    docsUrl: "https://open-assistant.io/",
    localPath: "data/fine-tune/community/openassistant-oasst1-sample.jsonl",
    format: "chat-jsonl",
    upstreamQuery: "OpenAssistant oasst1 conversations assistant dataset",
    sampleCount: 84000,
    bootstrapRows: 192,
    recommendedSamples: 1200,
    recommendedEpochs: 3,
    recommendedSteps: {
      en: "Use the local slice first to confirm conversation conversion, then import a filtered 1k+ sample.",
      zh: "先用本地切片确认 conversations 转换，再导入过滤后的 1k+ 样本。",
    },
    difficulty: {
      en: "Community conversion",
      zh: "社区转换",
    },
    license: "Apache-2.0, verify dataset card",
    recipeNotes: {
      en: "Useful for validating the automatic converter because upstream rows often differ from simple messages JSONL.",
      zh: "适合验证自动转换器，因为上游行格式通常不只是简单 messages JSONL。",
    },
  },
  {
    id: "code-alpaca-20k",
    label: {
      en: "Code Alpaca 20K starter",
      zh: "Code Alpaca 20K starter",
    },
    description: {
      en: "Instruction-style code tasks for a small coding adapter baseline before using larger code datasets.",
      zh: "代码任务指令集，适合作为更大代码数据集之前的小型 coding adapter 基线。",
    },
    bestFor: {
      en: "Code explanation, small patches, and coding benchmark smoke runs.",
      zh: "适合代码解释、小补丁和 coding benchmark 冒烟。",
    },
    source: "GitHub",
    sourceUrl: "https://github.com/sahil280114/codealpaca",
    docsUrl: "https://github.com/sahil280114/codealpaca",
    localPath: "data/fine-tune/community/code-alpaca-20k-sample.jsonl",
    format: "instruction-jsonl",
    upstreamQuery: "code alpaca 20k instruction code dataset GitHub",
    sampleCount: 20000,
    bootstrapRows: 192,
    recommendedSamples: 1000,
    recommendedEpochs: 4,
    recommendedSteps: {
      en: "Start with 1k rows for local coding adapters, then benchmark code review and patch tasks.",
      zh: "本地 coding adapter 先从 1k 行开始，再跑代码审阅和补丁任务 benchmark。",
    },
    difficulty: {
      en: "Coding beginner",
      zh: "代码新手",
    },
    license: "MIT, verify upstream repository",
    recipeNotes: {
      en: "Pair it with compare lanes that ask for concrete code edits rather than generic explanations.",
      zh: "建议配合要求具体代码修改的 compare lane，而不是只看泛泛解释。",
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

function formatSignedNumber(value?: number | null, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatSignedInteger(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${Math.round(value)}`;
}

function formatSignedDurationMs(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${Math.round(value / 1000)}s`;
}

function getRunDeltaConclusionLabel(
  conclusion: string | undefined,
  isEnglish: boolean,
) {
  switch (conclusion) {
    case "improved":
      return isEnglish ? "Improved" : "整体改善";
    case "regressed":
      return isEnglish ? "Regressed" : "整体回退";
    case "mixed":
      return isEnglish ? "Mixed" : "有升有降";
    case "stable":
      return isEnglish ? "Stable" : "基本稳定";
    case "insufficient-data":
      return isEnglish ? "Insufficient data" : "数据不足";
    default:
      return "--";
  }
}

function formatSampleCount(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString();
}

function formatRatio(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toFixed(2)}x`;
}

function getFineTuneOverlayJobs(
  job: AgentFineTuneJob,
  jobs: AgentFineTuneJob[],
) {
  const adapterName = job.adapterName.trim();
  if (!adapterName) return [];
  return jobs
    .filter(
      (candidate) =>
        candidate.id !== job.id &&
        candidate.adapterName.trim() === adapterName &&
        Boolean(candidate.curve?.length),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3);
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

function estimateFineTuneSteps(
  recipe: FineTuneRecipeFormState,
  sampleCount?: number | null,
) {
  if (typeof sampleCount !== "number" || !Number.isFinite(sampleCount)) {
    return null;
  }
  const validationRatio = Math.max(
    0,
    Math.min(0.8, recipe.validationSplitPct / 100),
  );
  const trainSamples = Math.max(1, Math.round(sampleCount * (1 - validationRatio)));
  const effectiveBatch = Math.max(
    1,
    recipe.batchSize * Math.max(1, recipe.gradientAccumulationSteps),
  );
  return Math.max(1, Math.ceil(trainSamples / effectiveBatch) * recipe.epochs);
}

function buildTrainingCommandPreview({
  recipe,
  stage,
  datasetPath,
  targetModel,
  adapterName,
  estimatedSteps,
}: {
  recipe: FineTuneRecipeFormState;
  stage: FineTuneTrainStage;
  datasetPath: string;
  targetModel: string;
  adapterName: string;
  estimatedSteps: number | null;
}) {
  const command = [
    "python -m mlx_lm.lora",
    "--train",
    `--model "${targetModel || recipe.baseTargetId || "<base-model>"}"`,
    `--data "${datasetPath || recipe.datasetId || "<dataset-jsonl>"}"`,
    `--adapter-path "adapters/${adapterName || recipe.adapterName || "<adapter-name>"}"`,
    `--max-seq-length ${recipe.sequenceLength}`,
    `--batch-size ${recipe.batchSize}`,
    `--iters ${estimatedSteps || "<estimated-steps>"}`,
    `--learning-rate ${recipe.learningRate}`,
    `--lora-layers ${recipe.numLayers}`,
    `--grad-accumulation ${recipe.gradientAccumulationSteps}`,
    `--seed ${recipe.seed}`,
  ];
  if (recipe.gradientCheckpointing) {
    command.push("--grad-checkpoint");
  }
  if (stage !== "supervised-fine-tune") {
    command.push(`# stage=${stage}`);
  }
  return command.join(" \\\n  ");
}

function buildTrainingYamlPreview({
  recipe,
  stage,
  datasetPath,
  datasetLabel,
  targetModel,
  adapterName,
  estimatedSteps,
}: {
  recipe: FineTuneRecipeFormState;
  stage: FineTuneTrainStage;
  datasetPath: string;
  datasetLabel: string;
  targetModel: string;
  adapterName: string;
  estimatedSteps: number | null;
}) {
  return [
    "training:",
    `  stage: ${stage}`,
    "  backend: mlx-lm-lora",
    `  model: ${targetModel || recipe.baseTargetId || "<base-model>"}`,
    `  dataset: ${datasetPath || recipe.datasetId || "<dataset-jsonl>"}`,
    `  dataset_label: ${datasetLabel || "<dataset-label>"}`,
    `  adapter: ${adapterName || recipe.adapterName || "<adapter-name>"}`,
    `  sequence_length: ${recipe.sequenceLength}`,
    `  batch_size: ${recipe.batchSize}`,
    `  epochs: ${recipe.epochs}`,
    `  estimated_steps: ${estimatedSteps || "unknown"}`,
    `  learning_rate: ${recipe.learningRate}`,
    "lora:",
    `  method: ${recipe.fineTuneMethod}`,
    `  rank: ${recipe.loraRank}`,
    `  alpha: ${recipe.loraAlpha}`,
    `  layers: ${recipe.numLayers}`,
    "runtime:",
    `  optimizer: ${recipe.optimizer}`,
    `  gradient_accumulation_steps: ${recipe.gradientAccumulationSteps}`,
    `  gradient_checkpointing: ${recipe.gradientCheckpointing ? "true" : "false"}`,
    `  validation_split_pct: ${recipe.validationSplitPct}`,
    `  save_every_steps: ${recipe.saveEverySteps}`,
    `  seed: ${recipe.seed}`,
    `  benchmark_suite: ${recipe.benchmarkSuiteId || "none"}`,
  ].join("\n");
}

function buildDistillationCommandPreview({
  distillationForm,
  teacherModel,
  outputPath,
}: {
  distillationForm: FineTuneDistillationFormState;
  teacherModel: string;
  outputPath: string;
}) {
  return [
    "python -m first_llm_studio.distill_dataset",
    `--teacher "${teacherModel || distillationForm.teacherTargetId || "<teacher-target>"}"`,
    `--output "${outputPath || distillationForm.outputPath || "<distilled-jsonl>"}"`,
    `--samples ${distillationForm.sampleCount}`,
    `--max-new-tokens ${distillationForm.maxNewTokens}`,
    `--temperature ${distillationForm.temperature}`,
    `--top-p ${distillationForm.topP}`,
    `--seed-prompt "${distillationForm.seedPrompt.replaceAll('"', '\\"') || "<seed-prompt>"}"`,
    distillationForm.includeReasoningTrace
      ? "--include-reasoning-trace"
      : "--strip-reasoning-trace",
  ].join(" \\\n  ");
}

function buildDistillationYamlPreview({
  distillationForm,
  teacherLabel,
  teacherModel,
  outputPath,
}: {
  distillationForm: FineTuneDistillationFormState;
  teacherLabel: string;
  teacherModel: string;
  outputPath: string;
}) {
  return [
    "distillation:",
    "  backend: first-llm-studio-dataset-distiller",
    `  teacher_target: ${distillationForm.teacherTargetId || "<teacher-target>"}`,
    `  teacher_label: ${teacherLabel || "<teacher-label>"}`,
    `  teacher_model: ${teacherModel || "<teacher-model>"}`,
    `  output_path: ${outputPath || distillationForm.outputPath || "<distilled-jsonl>"}`,
    `  samples: ${distillationForm.sampleCount}`,
    `  max_new_tokens: ${distillationForm.maxNewTokens}`,
    `  temperature: ${distillationForm.temperature}`,
    `  top_p: ${distillationForm.topP}`,
    `  include_reasoning_trace: ${distillationForm.includeReasoningTrace ? "true" : "false"}`,
    "  schema:",
    "    format: instruction-jsonl",
    "    fields: [instruction, input, output, source]",
    `  seed_prompt: ${JSON.stringify(distillationForm.seedPrompt)}`,
  ].join("\n");
}

function buildEvaluateCommandPreview({
  checkpointPath,
  datasetPath,
  evaluateForm,
}: {
  checkpointPath: string;
  datasetPath: string;
  evaluateForm: FineTuneEvaluateFormState;
}) {
  return [
    "python -m first_llm_studio.eval_adapter",
    `--adapter-path "${checkpointPath || "<adapter-or-checkpoint-path>"}"`,
    `--dataset "${datasetPath || "<validation-jsonl>"}"`,
    `--max-samples ${evaluateForm.maxSamples}`,
    `--max-new-tokens ${evaluateForm.maxNewTokens}`,
    `--temperature ${evaluateForm.temperature}`,
    `--top-p ${evaluateForm.topP}`,
    `--metrics "${evaluateForm.metrics.join(",") || "loss"}"`,
    evaluateForm.savePredictions ? "--save-predictions" : "--no-save-predictions",
  ].join(" \\\n  ");
}

function buildEvaluateYamlPreview({
  checkpointPath,
  datasetPath,
  datasetLabel,
  evaluateForm,
}: {
  checkpointPath: string;
  datasetPath: string;
  datasetLabel: string;
  evaluateForm: FineTuneEvaluateFormState;
}) {
  return [
    "evaluation:",
    "  backend: local-adapter-eval",
    `  adapter_or_checkpoint: ${checkpointPath || "<adapter-or-checkpoint-path>"}`,
    `  dataset: ${datasetPath || "<validation-jsonl>"}`,
    `  dataset_label: ${datasetLabel || "<dataset-label>"}`,
    `  max_samples: ${evaluateForm.maxSamples}`,
    `  max_new_tokens: ${evaluateForm.maxNewTokens}`,
    `  temperature: ${evaluateForm.temperature}`,
    `  top_p: ${evaluateForm.topP}`,
    `  metrics: [${evaluateForm.metrics.join(", ")}]`,
    `  save_predictions: ${evaluateForm.savePredictions ? "true" : "false"}`,
  ].join("\n");
}

function buildChatAdapterCommandPreview({
  adapterPath,
  chatForm,
}: {
  adapterPath: string;
  chatForm: FineTuneChatFormState;
}) {
  return [
    "python -m first_llm_studio.chat_adapter",
    `--adapter-id "${chatForm.adapterId || "<adapter-id>"}"`,
    `--adapter-path "${adapterPath || "<adapter-output-dir>"}"`,
    `--role ${chatForm.role}`,
    `--max-new-tokens ${chatForm.maxNewTokens}`,
    `--temperature ${chatForm.temperature}`,
    `--top-p ${chatForm.topP}`,
    chatForm.skipSpecialTokens ? "--skip-special-tokens" : "--keep-special-tokens",
    chatForm.renderHtmlTags ? "--render-html-tags" : "--plain-text",
  ].join(" \\\n  ");
}

function buildExportAdapterCommandPreview({
  adapterPath,
  exportForm,
}: {
  adapterPath: string;
  exportForm: FineTuneExportFormState;
}) {
  const command = [
    "python -m first_llm_studio.export_adapter",
    `--adapter-id "${exportForm.adapterId || "<adapter-id>"}"`,
    `--adapter-path "${adapterPath || "<adapter-output-dir>"}"`,
    `--format ${exportForm.exportFormat}`,
    `--quantization ${exportForm.quantization}`,
    `--max-shard-size-gb ${exportForm.maxShardSizeGb}`,
    `--output-dir "${exportForm.outputDir || "<export-dir>"}"`,
  ];
  if (exportForm.hubId.trim()) {
    command.push(`--hub-id "${exportForm.hubId.trim()}"`);
  }
  if (exportForm.includeDatasetCard) {
    command.push("--include-dataset-card");
  }
  return command.join(" \\\n  ");
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
  overlayJobs: AgentFineTuneJob[] = [],
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
  const buildBaseline = (chartPoints: AgentFineTuneCurvePoint[]) => {
    const train = getLossBaseline(
      chartPoints.find((point) => point.split === "train")?.loss ??
        chartPoints[0]?.loss,
    );
    const valid = getLossBaseline(
      chartPoints.find((point) => point.split === "valid")?.loss ?? train,
    );
    return { train, valid };
  };
  const baselineBySplit = buildBaseline(sortedPoints);
  const overlayInputs = overlayJobs
    .map((overlayJob) => {
      const overlayPoints = (overlayJob.curve || [])
        .filter(
          (point): point is AgentFineTuneCurvePoint =>
            (point.split === "train" || point.split === "valid") &&
            Number.isFinite(point.step) &&
            Number.isFinite(point.loss),
        )
        .sort((left, right) => left.step - right.step);
      if (overlayPoints.length < 2) return null;
      return {
        job: overlayJob,
        points: overlayPoints,
        baselineBySplit: buildBaseline(overlayPoints),
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        job: AgentFineTuneJob;
        points: AgentFineTuneCurvePoint[];
        baselineBySplit: { train: number; valid: number };
      } => Boolean(entry),
    );
  const normalizeLoss = (
    point: AgentFineTuneCurvePoint,
    baseline: { train: number; valid: number },
  ) => point.loss / baseline[point.split];
  const normalizedValues = [
    ...effectivePoints.map((point) => normalizeLoss(point, baselineBySplit)),
    ...overlayInputs.flatMap((overlay) =>
      overlay.points
        .filter(
          (point) => point.step >= domainMinStep && point.step <= domainMaxStep,
        )
        .map((point) => normalizeLoss(point, overlay.baselineBySplit)),
    ),
  ];
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
    baseline: { train: number; valid: number } = baselineBySplit,
  ): TrainingChartPoint => ({
    ...point,
    rawLoss: point.loss,
    normalizedLoss: normalizeLoss(point, baseline),
    x: toX(point.step),
    y: toY(normalizeLoss(point, baseline)),
  });
  const trainPoints = effectivePoints
    .filter((point) => point.split === "train")
    .map((point) => toChartPoint(point));
  const validPoints = effectivePoints
    .filter((point) => point.split === "valid")
    .map((point) => toChartPoint(point));
  const toPath = (chartPoints: TrainingChartPoint[]) =>
    chartPoints
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
      )
      .join(" ");
  const overlaySeries: TrainingChartOverlaySeries[] = overlayInputs
    .map((overlay) => {
      const overlayEffectivePoints = overlay.points.filter(
        (point) => point.step >= domainMinStep && point.step <= domainMaxStep,
      );
      const trainOverlayPoints = overlayEffectivePoints
        .filter((point) => point.split === "train")
        .map((point) => toChartPoint(point, overlay.baselineBySplit));
      const validOverlayPoints = overlayEffectivePoints
        .filter((point) => point.split === "valid")
        .map((point) => toChartPoint(point, overlay.baselineBySplit));
      return {
        jobId: overlay.job.id,
        label: overlay.job.adapterName || overlay.job.id,
        trainPath: toPath(trainOverlayPoints),
        validPath: toPath(validOverlayPoints),
        latestTrain: trainOverlayPoints.at(-1),
        latestValid: validOverlayPoints.at(-1),
      };
    })
    .filter((series) => series.trainPath || series.validPath);
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
    overlaySeries,
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
        workspaceTabs: "Workspace",
        tabSetup: "Setup",
        tabRuns: "Runs & logs",
        tabAssets: "Assets",
        fineTuneLabTabs: "Fine-tune modes",
        fineTuneTrainTab: "Train",
        fineTuneEvaluateTab: "Evaluate & Predict",
        fineTuneChatTab: "Chat Adapter",
        fineTuneExportTab: "Export",
        fineTuneTabPlanned: "Planned",
        trainConsoleTitle: "Train control console",
        trainConsoleHint:
          "Mirror the LLaMA-Factory flow: choose a training stage, inspect the exact command/YAML, then stage or run the local worker.",
        trainStage: "Training stage",
        trainStageSft: "Supervised fine-tune",
        trainStagePretrain: "Continued pre-train",
        trainStagePreference: "Preference tuning",
        trainStageDistillation: "Distillation data",
        distillationConsoleTitle: "Distillation dataset builder",
        distillationConsoleHint:
          "Use a stronger teacher target to generate starter instruction data, then validate and fine-tune the smaller local adapter.",
        distillationTeacher: "Teacher target",
        distillationOutputPath: "Output JSONL path",
        distillationSamples: "Sample count",
        distillationSeedPrompt: "Seed prompt",
        distillationIncludeReasoning: "Keep reasoning traces",
        distillationGeneration: "Teacher generation",
        distillationRun: "Generate dataset",
        distillationRunSuccess: "Distillation starter dataset generated.",
        distillationCommandCopied: "Distillation command copied.",
        distillationYamlCopied: "Distillation YAML copied.",
        commandPreview: "Command preview",
        yamlPreview: "YAML preview",
        copyCommand: "Copy command",
        copyYaml: "Copy YAML",
        saveArgs: "Save args",
        loadArgs: "Load args",
        argsSaved: "Training args snapshot saved locally.",
        argsLoaded: "Training args snapshot loaded.",
        argsMissing: "No saved training args snapshot yet.",
        commandCopied: "Training command copied.",
        yamlCopied: "Training YAML copied.",
        estimatedSteps: "Estimated steps",
        effectiveBatch: "Effective batch",
        trainSamples: "Train samples",
        recipeGroupIdentity: "Identity",
        recipeGroupSchedule: "Schedule & memory",
        recipeGroupAdapter: "Adapter capacity",
        recipeGroupEvidence: "Evidence",
        evaluatePlaceholder:
          "Evaluation will reuse the staged checkpoint path, validation dataset, generation settings, and ROUGE-style metrics.",
        evaluateConsoleTitle: "Evaluate & Predict console",
        evaluateConsoleHint:
          "Prepare the post-training evaluation before wiring the worker: choose a validation dataset, adapter output/checkpoint, generation budget, and metrics.",
        evalDataset: "Evaluation dataset",
        evalCheckpoint: "Adapter or checkpoint path",
        evalCheckpointHelper:
          "Use a ready adapter output directory or paste a checkpoint path from a completed run.",
        evalGeneration: "Generation settings",
        evalMetrics: "Metrics",
        evalMaxSamples: "Max samples",
        evalMaxNewTokens: "Max new tokens",
        evalTemperature: "Temperature",
        evalTopP: "Top-p",
        evalSavePredictions: "Save predictions",
        evalReadiness: "Evaluation readiness",
        evalReady:
          "Ready to run evaluation and write predictions, metrics, and a report.",
        evalNeedsDataset: "Select a dataset before evaluating.",
        evalNeedsCheckpoint: "Select or paste an adapter/checkpoint path.",
        evalApiPlanned:
          "Runs locally now: creates predictions.jsonl, operation manifest, and evaluation report.",
        evalRun: "Run evaluation",
        evalRunSuccess: "Evaluation operation completed.",
        evalCommandCopied: "Evaluation command copied.",
        evalYamlCopied: "Evaluation YAML copied.",
        chatPlaceholder:
          "Adapter chat will load the selected adapter into a safe local runtime and compare replies against the base model.",
        chatConsoleTitle: "Chat Adapter sandbox",
        chatConsoleHint:
          "Prepare a controlled single-turn adapter chat before wiring the live sandbox: role, prompt, generation controls, and output cleanup.",
        chatAdapter: "Adapter",
        chatRole: "Role",
        chatSystemPrompt: "System prompt",
        chatPrompt: "Test prompt",
        chatSkipSpecialTokens: "Skip special tokens",
        chatRenderHtmlTags: "Render HTML tags",
        chatReadiness: "Chat readiness",
        chatReady: "Ready to attach this adapter and run a sandbox chat.",
        chatNeedsAdapter: "Select a ready adapter before chatting.",
        chatApiPlanned:
          "Runs locally now: writes a chat transcript, manifest, and smoke report.",
        chatRun: "Run adapter chat",
        chatRunSuccess: "Adapter chat operation completed.",
        exportPlaceholder:
          "Export will package adapter files, config, metrics, report, and optional quantized artifacts for deployment.",
        exportConsoleTitle: "Adapter export wizard",
        exportConsoleHint:
          "Prepare deployment packaging with an explicit adapter, export format, quantization level, shard budget, and optional Hub metadata.",
        exportAdapter: "Adapter",
        exportFormat: "Export format",
        exportQuantization: "Quantization",
        exportShardSize: "Max shard size (GB)",
        exportOutputDir: "Export output dir",
        exportHubId: "HF Hub ID",
        exportIncludeDatasetCard: "Include dataset/model card",
        exportReadiness: "Export readiness",
        exportReady:
          "Ready to package adapter metadata, model card, dataset card, and manifest.",
        exportNeedsAdapter: "Select a ready adapter before exporting.",
        exportApiPlanned:
          "Runs locally now: writes deployment cards, export manifest, and report.",
        exportRun: "Run export",
        exportRunSuccess: "Adapter export operation completed.",
        adapterCommandCopied: "Adapter command copied.",
        operationHistory: "Operation history",
        operationHistoryEmpty:
          "Evaluation, chat, export, and distillation operations will appear here.",
        operationArtifacts: "Artifacts",
        setupSummary:
          "Dataset intake, recipe parameters, and job staging stay in one guided flow.",
        runsSummary:
          "Active jobs, grouped history, loss curves, exported reports, and worker logs live here.",
        assetsSummary:
          "Validated datasets, local targets, and ready adapters are separated from the run console.",
        activeJobs: "Active jobs",
        completedJobs: "Completed jobs",
        failedJobs: "Needs review",
        readyAdapters: "Ready adapters",
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
        communityImportTitle: "Import community dataset URL",
        communityImportHint:
          "Paste a direct JSON, JSONL, or CSV file URL from Hugging Face, GitHub raw, or ModelScope. First LLM Studio samples, converts, saves, and validates it as project JSONL.",
        communityImportGuardDirect: "Direct file URL only",
        communityImportGuardSchema: "Auto-converts messages, instruction/output, prompt/response, and CSV rows",
        communityImportGuardLimit: "Samples up to 5k rows / 8 MB",
        communityImportGuardLicense: "Review license and private data before training",
        communityImportLabel: "Imported dataset name",
        communityImportUrl: "Source file URL",
        communityImportSourceLabel: "Source label",
        communityImportSampleLimit: "Sample limit",
        communityImportLicense: "License note",
        communityImportFormat: "Output schema",
        communityImportAction: "Import and validate",
        communityImportSuccess: "Community dataset imported and validated.",
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
        overlayRuns: "Same-adapter overlay",
        overlayRunsHint:
          "Faint lines show recent runs with the same adapter name, normalized per run.",
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
        runProofLoop: "Run proof loop",
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
        exportReport: "Export report",
        exportMarkdownReport: "Markdown report",
        exportManifestJson: "Manifest JSON",
        exportMetricsCsv: "Metrics CSV",
        latestReport: "Latest exported report",
        reportPath: "Report path",
        reportPoints: "curve points",
        reportLatestStep: "latest step",
        qualityScore: "quality score",
        licenseRisk: "license risk",
        recommendedSteps: "recommended steps",
        convertedRows: "converted rows",
        modelFit: "model fit",
        risk: "risk",
        runComparison: "Multi-run comparison",
        runsCompared: "runs compared",
        bestValLoss: "best val loss",
        latestValLoss: "latest val loss",
        runDelta: "Delta vs previous",
        previousRun: "previous run",
        deltaConclusion: "conclusion",
        trainDelta: "train latest",
        validDelta: "val latest",
        bestValidDelta: "best val",
        durationDelta: "duration",
        stepDelta: "step",
        evidenceSummary: "Evidence summary",
        evidenceTimeline: "timeline",
        evidenceCompare: "compare",
        evidenceBenchmark: "benchmark events",
        evidenceBenchmarkRuns: "benchmark runs",
        evidenceReady: "Proof evidence is attached to this report.",
        evidenceMissing:
          "No compare or benchmark evidence is linked yet. Run the proof loop before sharing this adapter.",
        copyReportPath: "Copy report path",
        openReports: "Open reports dir",
        previewReport: "Preview report",
        downloadFullBundle: "Download full bundle",
        reportExportSuccess: "Fine-tune report exported.",
        reportCopySuccess: "Fine-tune report copied.",
        handoffBenchmarkSuccess: "Adapter benchmark handoff completed.",
        handoffCompareSuccess: "Adapter compare handoff completed.",
        proofLoopSuccess:
          "Adapter proof loop completed: attach, compare, and benchmark.",
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
        jobNextStep: "Recommended next step",
        jobNextCompleted:
          "Attach the adapter, run Compare, then send the same evidence path to Benchmark before sharing.",
        jobNextFailed:
          "Rerun with the latest dataset strategy. The old bundle and logs stay intact for audit.",
        jobNextRunning:
          "Watch the normalized loss curve and worker log; export the report after completion.",
        jobNextStaged:
          "Start the local worker when dataset quality, recipe, and hardware budget look safe.",
        jobAdapterPending: "Adapter artifact is not ready yet.",
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
      workspaceTabs: "工作区",
      tabSetup: "配置",
      tabRuns: "作业与日志",
      tabAssets: "资产库",
      fineTuneLabTabs: "微调模式",
      fineTuneTrainTab: "Train",
      fineTuneEvaluateTab: "Evaluate & Predict",
      fineTuneChatTab: "Chat Adapter",
      fineTuneExportTab: "Export",
      fineTuneTabPlanned: "规划中",
      trainConsoleTitle: "训练控制台",
      trainConsoleHint:
        "对齐 LLaMA-Factory 的操作流：选择训练阶段，检查命令和 YAML，再暂存或启动本地 worker。",
      trainStage: "训练阶段",
      trainStageSft: "监督微调",
      trainStagePretrain: "继续预训练",
      trainStagePreference: "偏好优化",
      trainStageDistillation: "蒸馏数据",
      distillationConsoleTitle: "蒸馏数据构建器",
      distillationConsoleHint:
        "用更强教师目标生成 starter 指令数据，再校验并微调更小的本地 adapter。",
      distillationTeacher: "教师目标",
      distillationOutputPath: "输出 JSONL 路径",
      distillationSamples: "样本数",
      distillationSeedPrompt: "种子提示词",
      distillationIncludeReasoning: "保留 reasoning trace",
      distillationGeneration: "教师生成参数",
      distillationRun: "生成数据集",
      distillationRunSuccess: "蒸馏 starter 数据集已生成。",
      distillationCommandCopied: "蒸馏命令已复制。",
      distillationYamlCopied: "蒸馏 YAML 已复制。",
      commandPreview: "命令预览",
      yamlPreview: "YAML 预览",
      copyCommand: "复制命令",
      copyYaml: "复制 YAML",
      saveArgs: "保存参数",
      loadArgs: "载入参数",
      argsSaved: "训练参数快照已保存到本地。",
      argsLoaded: "训练参数快照已载入。",
      argsMissing: "还没有保存过训练参数快照。",
      commandCopied: "训练命令已复制。",
      yamlCopied: "训练 YAML 已复制。",
      estimatedSteps: "预估 step",
      effectiveBatch: "等效 batch",
      trainSamples: "训练样本",
      recipeGroupIdentity: "身份与数据",
      recipeGroupSchedule: "调度与内存",
      recipeGroupAdapter: "Adapter 容量",
      recipeGroupEvidence: "证据链",
      evaluatePlaceholder:
        "Evaluate 会沿用已暂存 checkpoint、验证集、生成参数和 ROUGE 类指标。",
      evaluateConsoleTitle: "Evaluate & Predict 控制台",
      evaluateConsoleHint:
        "先把训练后评估配置准备好：选择验证数据集、adapter 产物或 checkpoint、生成预算和评测指标。",
      evalDataset: "评估数据集",
      evalCheckpoint: "Adapter 或 checkpoint 路径",
      evalCheckpointHelper:
        "可选择已就绪 adapter 的产物目录，也可以粘贴已完成作业里的 checkpoint 路径。",
      evalGeneration: "生成参数",
      evalMetrics: "评估指标",
      evalMaxSamples: "最大样本数",
      evalMaxNewTokens: "最大生成长度",
      evalTemperature: "温度",
      evalTopP: "Top-p",
      evalSavePredictions: "保存预测结果",
      evalReadiness: "评估就绪度",
      evalReady: "已可运行评估，并写入预测、指标和报告。",
      evalNeedsDataset: "评估前请选择数据集。",
      evalNeedsCheckpoint: "请选择或填写 adapter / checkpoint 路径。",
      evalApiPlanned:
        "现在会本地生成 predictions.jsonl、operation manifest 和评估报告。",
      evalRun: "运行评估",
      evalRunSuccess: "评估操作已完成。",
      evalCommandCopied: "评估命令已复制。",
      evalYamlCopied: "评估 YAML 已复制。",
      chatPlaceholder:
        "Chat Adapter 会把选中的 adapter 安全挂到本地运行时，并和基础模型对话对比。",
      chatConsoleTitle: "Chat Adapter 沙盒",
      chatConsoleHint:
        "先准备受控单轮 adapter 对话配置：角色、提示词、生成参数和输出清理策略，后续直接接实时沙盒。",
      chatAdapter: "Adapter",
      chatRole: "角色",
      chatSystemPrompt: "系统提示词",
      chatPrompt: "测试提示词",
      chatSkipSpecialTokens: "跳过特殊 token",
      chatRenderHtmlTags: "渲染 HTML 标签",
      chatReadiness: "对话就绪度",
      chatReady: "可挂载 adapter 并启动沙盒对话。",
      chatNeedsAdapter: "对话前请选择一个可用 adapter。",
      chatApiPlanned:
        "现在会本地写入 chat transcript、manifest 和冒烟报告。",
      chatRun: "运行 Adapter 对话",
      chatRunSuccess: "Adapter 对话操作已完成。",
      exportPlaceholder:
        "Export 会打包 adapter 文件、配置、指标、报告，以及可选量化产物，方便部署。",
      exportConsoleTitle: "Adapter 导出向导",
      exportConsoleHint:
        "显式选择 adapter、导出格式、量化等级、分片预算和可选 Hub 元数据，为部署打包做准备。",
      exportAdapter: "Adapter",
      exportFormat: "导出格式",
      exportQuantization: "量化等级",
      exportShardSize: "最大分片大小（GB）",
      exportOutputDir: "导出目录",
      exportHubId: "HF Hub ID",
      exportIncludeDatasetCard: "包含数据集 / 模型卡",
      exportReadiness: "导出就绪度",
      exportReady: "已可打包 adapter 元数据、模型卡、数据卡和 manifest。",
      exportNeedsAdapter: "导出前请选择一个可用 adapter。",
      exportApiPlanned:
        "现在会本地写入部署卡片、导出 manifest 和报告。",
      exportRun: "运行导出",
      exportRunSuccess: "Adapter 导出操作已完成。",
      adapterCommandCopied: "Adapter 命令已复制。",
      operationHistory: "操作记录",
      operationHistoryEmpty: "评估、对话、导出和蒸馏操作会出现在这里。",
      operationArtifacts: "产物",
      setupSummary:
        "数据接入、配方参数和作业暂存放在同一条引导式流程里，减少来回跳转。",
      runsSummary:
        "运行中作业、分组历史、loss 曲线、报告导出和 worker 日志集中在这里。",
      assetsSummary:
        "已校验数据集、本地目标和可挂载 adapter 与运行控制台分离管理。",
      activeJobs: "运行中",
      completedJobs: "已完成",
      failedJobs: "需处理",
      readyAdapters: "可挂载 adapter",
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
      communityImportTitle: "导入社区数据集 URL",
      communityImportHint:
        "粘贴 Hugging Face、GitHub raw 或魔搭上的 JSON / JSONL / CSV 直链。系统会抽样、转换、保存并按项目 JSONL 自动校验。",
      communityImportGuardDirect: "只支持数据文件直链",
      communityImportGuardSchema: "自动转换 messages、instruction/output、prompt/response 和 CSV 行",
      communityImportGuardLimit: "最多抽样 5k 行 / 8 MB",
      communityImportGuardLicense: "训练前确认许可证和隐私数据",
      communityImportLabel: "导入后的数据集名称",
      communityImportUrl: "来源文件 URL",
      communityImportSourceLabel: "来源标签",
      communityImportSampleLimit: "抽样上限",
      communityImportLicense: "许可证备注",
      communityImportFormat: "输出格式",
      communityImportAction: "导入并校验",
      communityImportSuccess: "社区数据集已导入并校验。",
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
      overlayRuns: "同 adapter 叠加",
      overlayRunsHint:
        "淡线表示同名 adapter 的最近训练记录，每次 run 单独归一化。",
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
      runProofLoop: "跑完整证据链",
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
      exportReport: "导出报告",
      exportMarkdownReport: "Markdown 报告",
      exportManifestJson: "Manifest JSON",
      exportMetricsCsv: "指标 CSV",
      latestReport: "最近导出的报告",
      reportPath: "报告路径",
      reportPoints: "曲线点数",
      reportLatestStep: "最新轮次",
      qualityScore: "质量分",
      licenseRisk: "许可证风险",
      recommendedSteps: "推荐轮次",
      convertedRows: "转换行数",
      modelFit: "适配规模",
      risk: "风险",
      runComparison: "多 run 对比",
      runsCompared: "对比 run 数",
      bestValLoss: "最佳验证 loss",
      latestValLoss: "最新验证 loss",
      runDelta: "相对上一 run",
      previousRun: "上一 run",
      deltaConclusion: "结论",
      trainDelta: "训练最新",
      validDelta: "验证最新",
      bestValidDelta: "最佳验证",
      durationDelta: "耗时",
      stepDelta: "轮次",
      evidenceSummary: "证据摘要",
      evidenceTimeline: "时间线",
      evidenceCompare: "Compare",
      evidenceBenchmark: "Benchmark 事件",
      evidenceBenchmarkRuns: "Benchmark 运行",
      evidenceReady: "这份报告已经带上证据链。",
      evidenceMissing:
        "还没有关联 Compare 或 Benchmark 证据。分享 adapter 前建议先跑完整证据链。",
      copyReportPath: "复制报告路径",
      openReports: "打开报告目录",
      previewReport: "预览报告",
      downloadFullBundle: "下载完整 bundle",
      reportExportSuccess: "Fine-tune 报告已导出。",
      reportCopySuccess: "Fine-tune 报告已复制。",
      handoffBenchmarkSuccess: "Adapter benchmark handoff 已完成。",
      handoffCompareSuccess: "Adapter compare handoff 已完成。",
      proofLoopSuccess:
        "Adapter 证据链已完成：挂载、compare 和 benchmark 均已触发。",
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
      jobNextStep: "建议下一步",
      jobNextCompleted:
        "先挂载 adapter，再跑 Compare，随后沿用同一证据链送到 Benchmark，最后再分享。",
      jobNextFailed:
        "按最新数据策略重跑。旧 bundle 和日志会保留，方便追溯失败原因。",
      jobNextRunning:
        "观察归一化 loss 曲线和 worker 日志；完成后再导出报告。",
      jobNextStaged: "确认数据质量、配方和硬件预算安全后，启动本地 worker。",
      jobAdapterPending: "Adapter 产物还未就绪。",
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
  const [communityImportForm, setCommunityImportForm] = useState(
    DEFAULT_COMMUNITY_IMPORT_FORM,
  );
  const [datasetSourceMode, setDatasetSourceMode] =
    useState<DatasetSourceMode>("local");
  const [recipeForm, setRecipeForm] = useState(DEFAULT_RECIPE_FORM);
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [datasetValidation, setDatasetValidation] =
    useState<AgentFineTuneDatasetValidation | null>(null);
  const [datasetValidationQuality, setDatasetValidationQuality] =
    useState<AgentFineTuneDatasetQuality | null>(null);
  const [
    datasetValidationQualityWarnings,
    setDatasetValidationQualityWarnings,
  ] = useState<string[]>([]);
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
  const [lastReportByJobId, setLastReportByJobId] = useState<
    Record<string, AgentFineTuneReportExport>
  >({});
  const [activeWorkspaceTab, setActiveWorkspaceTab] =
    useState<FineTuneWorkspaceTab>("setup");
  const [activeFineTuneLabTab, setActiveFineTuneLabTab] =
    useState<FineTuneLabTab>("train");
  const [trainStage, setTrainStage] =
    useState<FineTuneTrainStage>("supervised-fine-tune");
  const [evaluateForm, setEvaluateForm] = useState<FineTuneEvaluateFormState>(
    DEFAULT_EVALUATE_FORM,
  );
  const [chatForm, setChatForm] =
    useState<FineTuneChatFormState>(DEFAULT_CHAT_FORM);
  const [distillationForm, setDistillationForm] =
    useState<FineTuneDistillationFormState>(DEFAULT_DISTILLATION_FORM);
  const [exportForm, setExportForm] =
    useState<FineTuneExportFormState>(DEFAULT_EXPORT_FORM);

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

  const activeJobCount =
    summary?.jobs.filter(
      (job) => job.status === "queued" || job.status === "running",
    ).length || 0;
  const completedJobCount =
    summary?.jobs.filter((job) => job.status === "completed").length || 0;
  const failedJobCount =
    summary?.jobs.filter(
      (job) => job.status === "failed" || job.status === "cancelled",
    ).length || 0;
  const readyAdapterCount =
    summary?.adapters.filter((adapter) => adapter.status === "ready").length ||
    0;
  const activeWorkspaceSummary =
    activeWorkspaceTab === "setup"
      ? text.setupSummary
      : activeWorkspaceTab === "runs"
        ? text.runsSummary
        : text.assetsSummary;
  const workspaceTabs = useMemo(
    () =>
      [
        {
          key: "setup" as const,
          label: text.tabSetup,
          count: (summary?.datasets.length || 0) + (summary?.recipes.length || 0),
        },
        {
          key: "runs" as const,
          label: text.tabRuns,
          count: summary?.jobs.length || 0,
        },
        {
          key: "assets" as const,
          label: text.tabAssets,
          count:
            (summary?.localTargets.length || 0) +
            (summary?.adapters.length || 0),
        },
      ] satisfies Array<{
        key: FineTuneWorkspaceTab;
        label: string;
        count: number;
      }>,
    [
      summary?.adapters.length,
      summary?.datasets.length,
      summary?.jobs.length,
      summary?.localTargets.length,
      summary?.recipes.length,
      text.tabAssets,
      text.tabRuns,
      text.tabSetup,
    ],
  );

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
    if (!targetCatalog.length) return;
    setDistillationForm((current) => ({
      ...current,
      teacherTargetId:
        current.teacherTargetId ||
        targetCatalog.find((target) => target.execution === "remote")?.id ||
        targetCatalog[0]?.id ||
        "",
    }));
  }, [targetCatalog]);

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

  useEffect(() => {
    if (!summary) return;
    const firstDatasetId = summary.datasets[0]?.id || "";
    const firstAdapterPath =
      summary.adapters.find((adapter) => adapter.status === "ready")
        ?.outputDir ||
      summary.jobs.find((job) => job.status === "completed")?.outputDir ||
      "";
    const firstAdapter = summary.adapters.find(
      (adapter) => adapter.status === "ready",
    );
    setEvaluateForm((current) => ({
      ...current,
      datasetId: current.datasetId || firstDatasetId,
      checkpointPath: current.checkpointPath || firstAdapterPath,
    }));
    setChatForm((current) => ({
      ...current,
      adapterId: current.adapterId || firstAdapter?.id || "",
    }));
    setExportForm((current) => ({
      ...current,
      adapterId: current.adapterId || firstAdapter?.id || "",
      outputDir:
        current.outputDir ||
        (firstAdapter?.outputDir ? `${firstAdapter.outputDir}/export` : ""),
    }));
  }, [summary]);

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
      if (payload.dataset?.quality) {
        setDatasetValidationQuality(payload.dataset.quality);
      }
      if (payload.dataset?.qualityWarnings) {
        setDatasetValidationQualityWarnings(payload.dataset.qualityWarnings);
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

  async function copyValue(
    value?: string | null,
    successMessage = text.copied,
  ) {
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

  function saveTrainingArgsSnapshot() {
    try {
      window.localStorage.setItem(
        "first-llm-studio:fine-tune-training-args",
        JSON.stringify({
          recipeForm,
          trainStage,
          savedAt: new Date().toISOString(),
        }),
      );
      setMessage(text.argsSaved);
      setMessageTone("success");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to save args.",
      );
      setMessageTone("error");
    }
  }

  function loadTrainingArgsSnapshot() {
    try {
      const raw = window.localStorage.getItem(
        "first-llm-studio:fine-tune-training-args",
      );
      if (!raw) {
        setMessage(text.argsMissing);
        setMessageTone("error");
        return;
      }
      const snapshot = JSON.parse(raw) as {
        recipeForm?: Partial<FineTuneRecipeFormState>;
        trainStage?: FineTuneTrainStage;
      };
      setRecipeForm({
        ...DEFAULT_RECIPE_FORM,
        ...snapshot.recipeForm,
      });
      if (snapshot.trainStage) {
        setTrainStage(snapshot.trainStage);
      }
      setMessage(text.argsLoaded);
      setMessageTone("success");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to load args.",
      );
      setMessageTone("error");
    }
  }

  async function exportJobReport(
    jobId: string,
    reportFormat: "markdown" | "manifest-json" | "metrics-csv",
    copyContent = false,
  ) {
    const payload = await postAction(
      {
        action: "export-report",
        id: jobId,
        reportFormat,
      },
      text.reportExportSuccess,
    );
    if (payload?.report) {
      setLastReportByJobId((current) => ({
        ...current,
        [jobId]: payload.report as AgentFineTuneReportExport,
      }));
      if (copyContent && payload.report.content) {
        await copyValue(payload.report.content, text.reportCopySuccess);
      }
    }
  }

  async function runSecondaryAction(
    actionKey: string,
    body: Record<string, unknown>,
    successMessage = text.actionOpenSuccess,
  ) {
    setActionPending((current) => ({ ...current, [actionKey]: true }));
    try {
      await postAction(body, successMessage);
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

  const runAdapterProofLoop = useCallback(
    async (adapterId: string) => {
      if (!summary) return;
      const actionKey = `adapter-proof:${adapterId}`;
      setActionPending((current) => ({ ...current, [actionKey]: true }));
      setMessage("");
      try {
        const attached = await ensureAdapterRuntimeAttached(adapterId);
        const comparePlan = buildFineTuneCompareHandoffPlan({
          adapterId,
          summary: attached.summary,
          targetCatalog: attached.targetCatalog,
        });
        const benchmarkPlan = buildFineTuneBenchmarkHandoffPlan({
          adapterId,
          summary: attached.summary,
          targetCatalog: attached.targetCatalog,
        });
        if (!comparePlan || !benchmarkPlan) {
          throw new Error(text.handoffMissingContext);
        }

        const compareResponse = await fetch("/api/agent/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...comparePlan.request,
            requestId: crypto.randomUUID(),
          }),
        });
        const comparePayload = (await compareResponse.json()) as
          | (AgentCompareResponse & { error?: string })
          | { error?: string };
        if (!compareResponse.ok) {
          throw new Error(comparePayload.error || "Compare handoff failed.");
        }

        const benchmarkResponse = await fetch("/api/admin/benchmark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(benchmarkPlan.request),
        });
        const benchmarkPayload = (await benchmarkResponse.json()) as
          | (AgentBenchmarkResponse & { error?: string })
          | { error?: string };
        if (!benchmarkResponse.ok) {
          throw new Error(
            benchmarkPayload.error || "Benchmark handoff failed.",
          );
        }

        setMessage(text.proofLoopSuccess);
        setMessageTone("success");
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Adapter proof loop failed.",
        );
        setMessageTone("error");
      } finally {
        setActionPending((current) => ({ ...current, [actionKey]: false }));
      }
    },
    [
      ensureAdapterRuntimeAttached,
      summary,
      text.handoffMissingContext,
      text.proofLoopSuccess,
    ],
  );

  const canSaveDataset = Boolean(
    datasetForm.label.trim() &&
    datasetForm.sourcePath.trim() &&
    datasetValidation?.ok,
  );
  const selectedRecipe =
    summary?.recipes.find((recipe) => recipe.id === selectedRecipeId) || null;
  const selectedRecipeDataset =
    summary?.datasets.find((dataset) => dataset.id === recipeForm.datasetId) ||
    null;
  const selectedRecipeTarget =
    summary?.localTargets.find(
      (target) => target.id === recipeForm.baseTargetId,
    ) || null;
  const estimatedTrainingSteps = useMemo(
    () => estimateFineTuneSteps(recipeForm, selectedRecipeDataset?.sampleCount),
    [
      recipeForm,
      selectedRecipeDataset?.sampleCount,
    ],
  );
  const effectiveTrainingBatch =
    recipeForm.batchSize * Math.max(1, recipeForm.gradientAccumulationSteps);
  const estimatedTrainingSamples =
    typeof selectedRecipeDataset?.sampleCount === "number"
      ? Math.max(
          1,
          Math.round(
            selectedRecipeDataset.sampleCount *
              (1 - Math.max(0, Math.min(0.8, recipeForm.validationSplitPct / 100))),
          ),
        )
      : null;
  const selectedDistillationTeacher =
    targetCatalog.find(
      (target) => target.id === distillationForm.teacherTargetId,
    ) || null;
  const distillationOutputPath =
    distillationForm.outputPath.trim() ||
    (recipeForm.adapterName
      ? `data/fine-tune/distilled/${normalizeFineTuneSlug(recipeForm.adapterName)}.jsonl`
      : DEFAULT_DISTILLATION_FORM.outputPath);
  const trainingCommandPreview = useMemo(
    () =>
      trainStage === "distillation"
        ? buildDistillationCommandPreview({
            distillationForm,
            teacherModel: selectedDistillationTeacher?.modelDefault || "",
            outputPath: distillationOutputPath,
          })
        : buildTrainingCommandPreview({
            recipe: recipeForm,
            stage: trainStage,
            datasetPath:
              selectedRecipeDataset?.sourcePath || datasetForm.sourcePath || "",
            targetModel: selectedRecipeTarget?.modelDefault || "",
            adapterName: recipeForm.adapterName,
            estimatedSteps: estimatedTrainingSteps,
          }),
    [
      datasetForm.sourcePath,
      distillationForm,
      distillationOutputPath,
      estimatedTrainingSteps,
      recipeForm,
      selectedRecipeDataset?.sourcePath,
      selectedDistillationTeacher?.modelDefault,
      selectedRecipeTarget?.modelDefault,
      trainStage,
    ],
  );
  const trainingYamlPreview = useMemo(
    () =>
      trainStage === "distillation"
        ? buildDistillationYamlPreview({
            distillationForm,
            teacherLabel: selectedDistillationTeacher?.label || "",
            teacherModel: selectedDistillationTeacher?.modelDefault || "",
            outputPath: distillationOutputPath,
          })
        : buildTrainingYamlPreview({
            recipe: recipeForm,
            stage: trainStage,
            datasetPath:
              selectedRecipeDataset?.sourcePath || datasetForm.sourcePath || "",
            datasetLabel:
              selectedRecipeDataset?.label ||
              datasetForm.label ||
              recipeForm.datasetId,
            targetModel: selectedRecipeTarget?.modelDefault || "",
            adapterName: recipeForm.adapterName,
            estimatedSteps: estimatedTrainingSteps,
          }),
    [
      datasetForm.label,
      datasetForm.sourcePath,
      distillationForm,
      distillationOutputPath,
      estimatedTrainingSteps,
      recipeForm,
      selectedRecipeDataset?.label,
      selectedRecipeDataset?.sourcePath,
      selectedDistillationTeacher?.label,
      selectedDistillationTeacher?.modelDefault,
      selectedRecipeTarget?.modelDefault,
      trainStage,
    ],
  );
  const selectedEvaluateDataset =
    summary?.datasets.find((dataset) => dataset.id === evaluateForm.datasetId) ||
    null;
  const evaluateCheckpointOptions = useMemo(() => {
    const options = new Map<string, string>();
    (summary?.adapters || []).forEach((adapter) => {
      if (adapter.outputDir) {
        options.set(
          adapter.outputDir,
          `${adapter.adapterName} · ${adapter.status}`,
        );
      }
    });
    (summary?.jobs || []).forEach((job) => {
      if (job.outputDir) {
        options.set(job.outputDir, `${job.adapterName} · ${job.status}`);
      }
    });
    return Array.from(options, ([pathValue, label]) => ({
      path: pathValue,
      label,
    }));
  }, [summary?.adapters, summary?.jobs]);
  const evaluateCommandPreview = useMemo(
    () =>
      buildEvaluateCommandPreview({
        checkpointPath: evaluateForm.checkpointPath,
        datasetPath: selectedEvaluateDataset?.sourcePath || "",
        evaluateForm,
      }),
    [evaluateForm, selectedEvaluateDataset?.sourcePath],
  );
  const evaluateYamlPreview = useMemo(
    () =>
      buildEvaluateYamlPreview({
        checkpointPath: evaluateForm.checkpointPath,
        datasetPath: selectedEvaluateDataset?.sourcePath || "",
        datasetLabel: selectedEvaluateDataset?.label || "",
        evaluateForm,
      }),
    [
      evaluateForm,
      selectedEvaluateDataset?.label,
      selectedEvaluateDataset?.sourcePath,
    ],
  );
  const selectedEvaluateAdapter =
    summary?.adapters.find(
      (adapter) => adapter.outputDir === evaluateForm.checkpointPath,
    ) ||
    summary?.adapters.find((adapter) => adapter.status === "ready") ||
    null;
  const evaluationReadiness = !evaluateForm.datasetId
    ? text.evalNeedsDataset
    : !evaluateForm.checkpointPath.trim()
      ? text.evalNeedsCheckpoint
      : text.evalReady;
  const selectedChatAdapter =
    summary?.adapters.find((adapter) => adapter.id === chatForm.adapterId) ||
    null;
  const selectedExportAdapter =
    summary?.adapters.find((adapter) => adapter.id === exportForm.adapterId) ||
    null;
  const chatAdapterCommandPreview = useMemo(
    () =>
      buildChatAdapterCommandPreview({
        adapterPath: selectedChatAdapter?.outputDir || "",
        chatForm,
      }),
    [chatForm, selectedChatAdapter?.outputDir],
  );
  const exportAdapterCommandPreview = useMemo(
    () =>
      buildExportAdapterCommandPreview({
        adapterPath: selectedExportAdapter?.outputDir || "",
        exportForm,
      }),
    [exportForm, selectedExportAdapter?.outputDir],
  );
  const chatReadiness = chatForm.adapterId
    ? text.chatReady
    : text.chatNeedsAdapter;
  const exportReadiness = exportForm.adapterId
    ? text.exportReady
    : text.exportNeedsAdapter;
  const operationHistory = summary?.operations || [];
  const toggleEvaluateMetric = useCallback((metric: FineTuneEvalMetric) => {
    setEvaluateForm((current) => {
      const nextMetrics = current.metrics.includes(metric)
        ? current.metrics.filter((item) => item !== metric)
        : [...current.metrics, metric];
      return {
        ...current,
        metrics: nextMetrics.length ? nextMetrics : ["loss"],
      };
    });
  }, []);
  const fineTuneLabTabs = useMemo(
    () =>
      [
        { key: "train" as const, label: text.fineTuneTrainTab },
        { key: "evaluate" as const, label: text.fineTuneEvaluateTab },
        { key: "chat" as const, label: text.fineTuneChatTab },
        { key: "export" as const, label: text.fineTuneExportTab },
      ] satisfies Array<{ key: FineTuneLabTab; label: string }>,
    [
      text.fineTuneChatTab,
      text.fineTuneEvaluateTab,
      text.fineTuneExportTab,
      text.fineTuneTrainTab,
    ],
  );
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
  const adapterByJobId = useMemo(
    () =>
      new Map(
        (summary?.adapters || []).map((adapter) => [adapter.jobId, adapter]),
      ),
    [summary?.adapters],
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

  const getPresetLicenseRisk = useCallback(
    (preset: CommunityDatasetPreset) => {
      const license = preset.license.toLowerCase();
      if (
        license.includes("gpl") ||
        license.includes("gated") ||
        license.includes("non-commercial") ||
        license.includes("nc")
      ) {
        return isEnglish ? "review required" : "需复核";
      }
      if (license.includes("verify") || license.includes("terms")) {
        return isEnglish ? "medium" : "中等";
      }
      return isEnglish ? "low" : "较低";
    },
    [isEnglish],
  );

  const getPresetModelFit = useCallback(
    (preset: CommunityDatasetPreset) => {
      if (preset.recommendedSamples <= 1000) {
        return isEnglish ? "0.6B-4B safe" : "0.6B-4B 安全";
      }
      if (preset.recommendedSamples <= 2000) {
        return isEnglish ? "4B preferred" : "更适合 4B";
      }
      return isEnglish ? "4B+ cautious" : "4B+ 谨慎";
    },
    [isEnglish],
  );

  const formatQualityScore = useCallback((score?: number | null) => {
    return typeof score === "number" && Number.isFinite(score)
      ? `${Math.round(score)}/100`
      : "--";
  }, []);

  const getPresetLicenseRiskLevel = useCallback(
    (
      preset: CommunityDatasetPreset,
    ): AgentFineTuneDatasetQuality["licenseRisk"] => {
      const license = preset.license.toLowerCase();
      if (
        license.includes("gpl") ||
        license.includes("gated") ||
        license.includes("non-commercial") ||
        license.includes("nc")
      ) {
        return "high";
      }
      if (license.includes("verify") || license.includes("terms")) {
        return "medium";
      }
      if (license.includes("project sample") || license.includes("cc by")) {
        return "low";
      }
      return "unknown";
    },
    [],
  );

  const getLicenseRiskLabel = useCallback(
    (risk?: AgentFineTuneDatasetQuality["licenseRisk"]) => {
      switch (risk) {
        case "low":
          return isEnglish ? "Low" : "较低";
        case "medium":
          return isEnglish ? "Medium" : "中等";
        case "high":
          return isEnglish ? "Review required" : "需复核";
        default:
          return isEnglish ? "Unknown" : "未知";
      }
    },
    [isEnglish],
  );

  const buildPresetDatasetQuality = useCallback(
    (preset: CommunityDatasetPreset): AgentFineTuneDatasetQuality => {
      const licenseRisk = getPresetLicenseRiskLevel(preset);
      const score = Math.max(
        0,
        Math.min(
          100,
          96 -
            (preset.source === "Bundled" ? 0 : 6) -
            (preset.bootstrapRows < 128 ? 10 : 0) -
            (preset.bootstrapRows < preset.recommendedSamples ? 4 : 0) -
            (licenseRisk === "high"
              ? 18
              : licenseRisk === "medium"
                ? 8
                : licenseRisk === "unknown"
                  ? 5
                  : 0),
        ),
      );
      const recommendedRange =
        preset.recommendedSamples <= 400
          ? { min: 200, max: 800 }
          : preset.recommendedSamples <= 1000
            ? { min: 600, max: 1200 }
            : preset.recommendedSamples <= 2500
              ? { min: 1000, max: 3000 }
              : { min: 1500, max: 5000 };

      return {
        score,
        licenseRisk,
        downloadedRows: preset.sampleCount,
        convertedRows: preset.bootstrapRows,
        sampledRows: preset.recommendedSamples,
        duplicateRows: 0,
        skippedRows: Math.max(0, preset.sampleCount - preset.bootstrapRows),
        piiRiskRows: 0,
        schemaConversion:
          preset.format === "chat-jsonl"
            ? "preset rows kept as messages[] chat JSONL"
            : "preset rows kept as instruction/input/output JSONL",
        recommendedSteps: {
          ...recommendedRange,
          label: getPresetRecommendedSteps(preset),
        },
      };
    },
    [getPresetLicenseRiskLevel, getPresetRecommendedSteps],
  );

  const buildPresetDatasetSaveMetadata = useCallback(
    (preset: CommunityDatasetPreset) => {
      const quality = buildPresetDatasetQuality(preset);
      const qualityWarnings = [
        `Preset source: ${preset.source}. Verify upstream license before redistribution.`,
        `Recommended training window: ${quality.recommendedSteps?.label || preset.recommendedSteps.en}.`,
        quality.licenseRisk !== "low"
          ? `License risk is ${quality.licenseRisk}; review upstream terms before publishing adapters.`
          : undefined,
      ].filter((item): item is string => Boolean(item));

      return {
        sourceType:
          preset.source === "Bundled"
            ? ("bundled-preset" as const)
            : ("community-preset" as const),
        sourceUrl: preset.sourceUrl,
        sourceLabel: `${preset.source} · ${getPresetLabel(preset)}`,
        license: preset.license,
        quality,
        qualityWarnings,
      };
    },
    [buildPresetDatasetQuality, getPresetLabel],
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
      const presetMetadata = buildPresetDatasetSaveMetadata(preset);
      setDatasetSourceMode("community");
      setDatasetValidation(null);
      setDatasetValidationQuality(presetMetadata.quality);
      setDatasetValidationQualityWarnings(presetMetadata.qualityWarnings);
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
    [
      buildPresetDatasetSaveMetadata,
      getPresetLabel,
      getPresetRecipeNotes,
      text.presetLoaded,
    ],
  );

  async function importCommunityDatasetSource() {
    const actionKey = "dataset-community-import";
    setActionPending((current) => ({ ...current, [actionKey]: true }));
    try {
      const payload = await postAction(
        {
          action: "import-community-dataset",
          label: communityImportForm.label,
          sourceUrl: communityImportForm.sourceUrl,
          sourceLabel: communityImportForm.sourceLabel,
          sampleLimit: communityImportForm.sampleLimit,
          license: communityImportForm.license,
          format: communityImportForm.format,
          upstreamQuery:
            communityImportForm.upstreamQuery ||
            communityImportForm.sourceLabel ||
            communityImportForm.label,
          refreshCadenceHours: datasetForm.refreshCadenceHours,
        },
        text.communityImportSuccess,
      );
      if (payload?.dataset) {
        setDatasetSourceMode("community");
        setDatasetValidation(payload.dataset.validation);
        setDatasetValidationQuality(payload.dataset.quality || null);
        setDatasetValidationQualityWarnings(
          payload.dataset.qualityWarnings || [],
        );
        setDatasetForm({
          label: payload.dataset.label,
          sourcePath: payload.dataset.sourcePath || "",
          format: payload.dataset.format,
          upstreamQuery:
            payload.dataset.upstreamQuery ||
            communityImportForm.upstreamQuery ||
            payload.dataset.label,
          refreshCadenceHours: payload.dataset.refreshCadenceHours || 24,
        });
        setRecipeForm((current) => ({
          ...current,
          datasetId: payload.dataset?.id || current.datasetId,
        }));
      }
    } finally {
      setActionPending((current) => ({ ...current, [actionKey]: false }));
    }
  }

  async function quickStartCommunityDatasetPreset(
    preset: CommunityDatasetPreset,
  ) {
    const actionKey = `dataset-preset-quickstart:${preset.id}`;
    const presetLabel = getPresetLabel(preset);
    const presetNotes = getPresetRecipeNotes(preset);
    const presetMetadata = buildPresetDatasetSaveMetadata(preset);
    const nextDatasetForm = {
      label: presetLabel,
      sourcePath: preset.localPath,
      format: preset.format,
      upstreamQuery: preset.upstreamQuery,
      refreshCadenceHours: 24,
    };
    setDatasetSourceMode("community");
    setDatasetValidation(null);
    setDatasetValidationQuality(presetMetadata.quality);
    setDatasetValidationQualityWarnings(presetMetadata.qualityWarnings);
    setDatasetForm(nextDatasetForm);
    setActionPending((current) => ({ ...current, [actionKey]: true }));
    try {
      const validationPayload = await postAction(
        { action: "validate-dataset", ...nextDatasetForm },
        text.validated,
      );
      if (!validationPayload?.validation?.ok) return;

      const datasetPayload = await postAction(
        {
          action: "save-dataset",
          ...nextDatasetForm,
          ...presetMetadata,
        },
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
  const recipeScheduleFields = numericRecipeFields.filter((field) =>
    [
      "sequenceLength",
      "batchSize",
      "epochs",
      "learningRate",
      "gradientAccumulationSteps",
    ].includes(field.key),
  );
  const recipeAdapterFields = numericRecipeFields.filter((field) =>
    ["numLayers", "loraRank", "loraAlpha"].includes(field.key),
  );
  const recipeEvidenceFields = numericRecipeFields.filter((field) =>
    ["validationSplitPct", "saveEverySteps", "seed"].includes(field.key),
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
          <h3 className="ui-balance mt-2 text-xl font-semibold text-white">
            {text.title}
          </h3>
          <p className="ui-pretty mt-2 max-w-3xl text-sm leading-6 text-slate-400">
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

      <div className="mt-5 rounded-[26px] border border-white/10 bg-slate-950/45 p-3">
        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-300">
              {text.workspaceTabs}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {workspaceTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveWorkspaceTab(tab.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    activeWorkspaceTab === tab.key
                      ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-50"
                      : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                  }`}
                >
                  {tab.label}
                  <span className="ml-2 rounded-full bg-black/25 px-2 py-0.5 text-[10px] text-slate-300">
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <p className="ui-pretty max-w-2xl rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-xs leading-5 text-slate-400">
            {activeWorkspaceSummary}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {[
          { label: text.activeJobs, value: activeJobCount },
          { label: text.completedJobs, value: completedJobCount },
          { label: text.failedJobs, value: failedJobCount },
          { label: text.readyAdapters, value: readyAdapterCount },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-[22px] border border-white/10 bg-white/[0.035] px-4 py-3"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              {item.label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <div
        className={`mt-5 rounded-[26px] border border-white/10 bg-white/[0.035] p-4 ${
          activeWorkspaceTab === "setup" ? "" : "hidden"
        }`}
      >
        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-300">
              {text.fineTuneLabTabs}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {fineTuneLabTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveFineTuneLabTab(tab.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    activeFineTuneLabTab === tab.key
                      ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-50"
                      : "border-white/10 bg-slate-950/60 text-slate-300 hover:bg-white/[0.08]"
                  }`}
                >
                  {tab.label}
                  {tab.key === "train" || tab.key === "evaluate" ? null : (
                    <span className="ml-2 rounded-full bg-black/25 px-2 py-0.5 text-[10px] text-slate-400">
                      {text.fineTuneTabPlanned}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                {text.estimatedSteps}
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {formatSampleCount(estimatedTrainingSteps)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                {text.effectiveBatch}
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {effectiveTrainingBatch}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                {text.trainSamples}
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {formatSampleCount(estimatedTrainingSamples)}
              </p>
            </div>
          </div>
        </div>

        {activeFineTuneLabTab === "train" ? (
          <div className="mt-4 grid gap-3 xl:grid-cols-[0.85fr_1fr_1fr]">
            <div className="rounded-3xl border border-cyan-300/15 bg-cyan-400/[0.055] p-4">
              <p className="text-sm font-semibold text-white">
                {text.trainConsoleTitle}
              </p>
              <p className="mt-2 text-xs leading-6 text-cyan-50/70">
                {text.trainConsoleHint}
              </p>
              <FieldShell
                label={text.trainStage}
                helper={
                  isEnglish
                    ? "This stage is written into the preview and staged bundle metadata."
                    : "训练阶段会写入预览和暂存 bundle 元数据。"
                }
                className="mt-4"
              >
                <select
                  value={trainStage}
                  onChange={(event) =>
                    setTrainStage(event.target.value as FineTuneTrainStage)
                  }
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none"
                >
                  <option value="supervised-fine-tune">
                    {text.trainStageSft}
                  </option>
                  <option value="continued-pretrain">
                    {text.trainStagePretrain}
                  </option>
                  <option value="preference-tuning">
                    {text.trainStagePreference}
                  </option>
                  <option value="distillation">
                    {text.trainStageDistillation}
                  </option>
                </select>
              </FieldShell>
              {trainStage === "distillation" ? (
                <div className="mt-4 rounded-3xl border border-amber-300/20 bg-amber-300/[0.06] p-3">
                  <p className="text-sm font-semibold text-amber-50">
                    {text.distillationConsoleTitle}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-100/70">
                    {text.distillationConsoleHint}
                  </p>
                  <FieldShell
                    label={text.distillationTeacher}
                    helper={
                      isEnglish
                        ? "Pick a stronger remote or local target that will generate supervision examples."
                        : "选择更强的远端或本地目标，用来生成监督样本。"
                    }
                    className="mt-3"
                  >
                    <select
                      value={distillationForm.teacherTargetId}
                      onChange={(event) =>
                        setDistillationForm((current) => ({
                          ...current,
                          teacherTargetId: event.target.value,
                        }))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none"
                    >
                      <option value="">{text.distillationTeacher}</option>
                      {targetCatalog.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.label} · {target.execution}
                        </option>
                      ))}
                    </select>
                  </FieldShell>
                  <FieldShell
                    label={text.distillationOutputPath}
                    helper={
                      isEnglish
                        ? "Generated instruction JSONL should be validated before training."
                        : "生成的 instruction JSONL 仍需先校验，再进入训练。"
                    }
                    className="mt-3"
                  >
                    <input
                      value={distillationForm.outputPath}
                      onChange={(event) =>
                        setDistillationForm((current) => ({
                          ...current,
                          outputPath: event.target.value,
                        }))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none"
                    />
                  </FieldShell>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {(
                      [
                        {
                          key: "sampleCount",
                          label: text.distillationSamples,
                          min: 16,
                          step: 16,
                        },
                        {
                          key: "maxNewTokens",
                          label: text.evalMaxNewTokens,
                          min: 64,
                          step: 64,
                        },
                        {
                          key: "temperature",
                          label: text.evalTemperature,
                          min: 0,
                          step: 0.1,
                        },
                        {
                          key: "topP",
                          label: text.evalTopP,
                          min: 0,
                          step: 0.05,
                        },
                      ] satisfies Array<{
                        key: keyof Pick<
                          FineTuneDistillationFormState,
                          "sampleCount" | "maxNewTokens" | "temperature" | "topP"
                        >;
                        label: string;
                        min: number;
                        step: number;
                      }>
                    ).map((field) => (
                      <FieldShell
                        key={field.key}
                        label={field.label}
                        helper={
                          field.key === "sampleCount"
                            ? isEnglish
                              ? "Small starter sets are safer before long training."
                              : "长轮次训练前，先用小 starter 数据更安全。"
                            : field.key === "maxNewTokens"
                              ? isEnglish
                                ? "Caps each generated supervision answer."
                                : "限制每条蒸馏答案的生成长度。"
                              : field.key === "temperature"
                                ? isEnglish
                                  ? "Lower values make synthetic data more stable."
                                  : "较低温度会让合成数据更稳定。"
                                : isEnglish
                                  ? "Nucleus sampling for teacher outputs."
                                  : "教师输出的 nucleus sampling 参数。"
                        }
                      >
                        <input
                          type="number"
                          min={field.min}
                          step={field.step}
                          value={distillationForm[field.key]}
                          onChange={(event) => {
                            const nextValue = Number(event.target.value);
                            if (!Number.isFinite(nextValue)) return;
                            setDistillationForm((current) => ({
                              ...current,
                              [field.key]: nextValue,
                            }));
                          }}
                          className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none"
                        />
                      </FieldShell>
                    ))}
                  </div>
                  <FieldShell
                    label={text.distillationSeedPrompt}
                    helper={
                      isEnglish
                        ? "Describe the behavior you want the generated dataset to teach."
                        : "描述你希望蒸馏数据教会模型的目标行为。"
                    }
                    className="mt-3"
                  >
                    <textarea
                      value={distillationForm.seedPrompt}
                      onChange={(event) =>
                        setDistillationForm((current) => ({
                          ...current,
                          seedPrompt: event.target.value,
                        }))
                      }
                      rows={4}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-xs leading-6 text-white outline-none"
                    />
                  </FieldShell>
                  <label className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs font-semibold text-amber-50">
                    <input
                      type="checkbox"
                      checked={distillationForm.includeReasoningTrace}
                      onChange={(event) =>
                        setDistillationForm((current) => ({
                          ...current,
                          includeReasoningTrace: event.target.checked,
                        }))
                      }
                    />
                    {text.distillationIncludeReasoning}
                  </label>
                  <button
                    type="button"
                    disabled={
                      !distillationForm.teacherTargetId ||
                      Boolean(actionPending["distillation-run"])
                    }
                    onClick={() =>
                      void runSecondaryAction(
                        "distillation-run",
                        {
                          action: "run-distillation",
                          teacherTargetId: distillationForm.teacherTargetId,
                          outputPath: distillationOutputPath,
                          sampleCount: distillationForm.sampleCount,
                          maxNewTokens: distillationForm.maxNewTokens,
                          temperature: distillationForm.temperature,
                          topP: distillationForm.topP,
                          seedPrompt: distillationForm.seedPrompt,
                          includeReasoningTrace:
                            distillationForm.includeReasoningTrace,
                        },
                        text.distillationRunSuccess,
                      )
                    }
                    className="mt-3 w-full rounded-2xl border border-amber-300/30 bg-amber-300/15 px-4 py-3 text-sm font-semibold text-amber-50 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {actionPending["distillation-run"]
                      ? text.loading
                      : text.distillationRun}
                  </button>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={saveTrainingArgsSnapshot}
                  className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-400/15"
                >
                  {text.saveArgs}
                </button>
                <button
                  type="button"
                  onClick={loadTrainingArgsSnapshot}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  {text.loadArgs}
                </button>
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {text.commandPreview}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void copyValue(
                      trainingCommandPreview,
                      trainStage === "distillation"
                        ? text.distillationCommandCopied
                        : text.commandCopied,
                    )
                  }
                  className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                >
                  {text.copyCommand}
                </button>
              </div>
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/25 p-3 text-[11px] leading-5 text-slate-200">
                {trainingCommandPreview}
              </pre>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {text.yamlPreview}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void copyValue(
                      trainingYamlPreview,
                      trainStage === "distillation"
                        ? text.distillationYamlCopied
                        : text.yamlCopied,
                    )
                  }
                  className="rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-400/15"
                >
                  {text.copyYaml}
                </button>
              </div>
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/25 p-3 text-[11px] leading-5 text-slate-200">
                {trainingYamlPreview}
              </pre>
            </div>
          </div>
        ) : activeFineTuneLabTab === "evaluate" ? (
          <div className="mt-4 grid gap-3 xl:grid-cols-[0.9fr_0.9fr_1.15fr]">
            <div className="rounded-3xl border border-cyan-300/15 bg-cyan-400/[0.055] p-4">
              <p className="text-sm font-semibold text-white">
                {text.evaluateConsoleTitle}
              </p>
              <p className="mt-2 text-xs leading-6 text-cyan-50/70">
                {text.evaluateConsoleHint}
              </p>
              <FieldShell
                label={text.evalDataset}
                helper={
                  isEnglish
                    ? "Use a validation or held-out dataset; saved datasets are available immediately."
                    : "建议选择验证集或留出集；已保存数据集会直接出现在这里。"
                }
                className="mt-4"
              >
                <select
                  value={evaluateForm.datasetId}
                  onChange={(event) =>
                    setEvaluateForm((current) => ({
                      ...current,
                      datasetId: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none"
                >
                  <option value="">{text.evalDataset}</option>
                  {(summary?.datasets || []).map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.label}
                    </option>
                  ))}
                </select>
              </FieldShell>
              <FieldShell
                label={text.evalCheckpoint}
                helper={text.evalCheckpointHelper}
                className="mt-4"
              >
                <select
                  value={evaluateForm.checkpointPath}
                  onChange={(event) =>
                    setEvaluateForm((current) => ({
                      ...current,
                      checkpointPath: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none"
                >
                  <option value="">{text.evalCheckpoint}</option>
                  {evaluateCheckpointOptions.map((option) => (
                    <option key={option.path} value={option.path}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  value={evaluateForm.checkpointPath}
                  onChange={(event) =>
                    setEvaluateForm((current) => ({
                      ...current,
                      checkpointPath: event.target.value,
                    }))
                  }
                  placeholder={text.evalCheckpoint}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs text-white outline-none focus:border-cyan-400/40"
                />
              </FieldShell>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <p className="text-sm font-semibold text-white">
                {text.evalGeneration}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  {
                    key: "maxSamples",
                    label: text.evalMaxSamples,
                    min: 1,
                    step: 1,
                  },
                  {
                    key: "maxNewTokens",
                    label: text.evalMaxNewTokens,
                    min: 16,
                    step: 16,
                  },
                  {
                    key: "temperature",
                    label: text.evalTemperature,
                    min: 0,
                    step: 0.1,
                  },
                  { key: "topP", label: text.evalTopP, min: 0, step: 0.05 },
                ].map((field) => (
                  <FieldShell
                    key={field.key}
                    label={field.label}
                    helper={
                      field.key === "maxSamples"
                        ? isEnglish
                          ? "Caps evaluation rows so local smoke runs stay short."
                          : "限制评估样本数，避免本地冒烟跑太久。"
                        : field.key === "maxNewTokens"
                          ? isEnglish
                            ? "Caps generated answer length for each sample."
                            : "限制每条样本的最大生成长度。"
                          : field.key === "temperature"
                            ? isEnglish
                              ? "Lower values reduce sampling noise during evaluation."
                              : "较低温度可减少评估时的采样噪声。"
                            : isEnglish
                              ? "Controls nucleus sampling; keep stable for repeatable evals."
                              : "控制 nucleus sampling；评估时建议保持稳定。"
                    }
                  >
                    <input
                      type="number"
                      min={field.min}
                      step={field.step}
                      value={
                        evaluateForm[
                          field.key as keyof Pick<
                            FineTuneEvaluateFormState,
                            | "maxSamples"
                            | "maxNewTokens"
                            | "temperature"
                            | "topP"
                          >
                        ]
                      }
                      onChange={(event) => {
                        const nextValue = Number(event.target.value);
                        if (!Number.isFinite(nextValue)) return;
                        setEvaluateForm((current) => ({
                          ...current,
                          [field.key]: nextValue,
                        }));
                      }}
                      className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                    />
                  </FieldShell>
                ))}
              </div>
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {text.evalMetrics}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(
                    [
                      "loss",
                      "rouge-l",
                      "bleu",
                      "exact-match",
                      "latency",
                    ] as FineTuneEvalMetric[]
                  ).map((metric) => (
                    <button
                      key={metric}
                      type="button"
                      onClick={() => toggleEvaluateMetric(metric)}
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition ${
                        evaluateForm.metrics.includes(metric)
                          ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-50"
                          : "border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/[0.08]"
                      }`}
                    >
                      {metric}
                    </button>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <input
                    type="checkbox"
                    checked={evaluateForm.savePredictions}
                    onChange={(event) =>
                      setEvaluateForm((current) => ({
                        ...current,
                        savePredictions: event.target.checked,
                      }))
                    }
                  />
                  {text.evalSavePredictions}
                </label>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {text.evalReadiness}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  {evaluationReadiness}
                </p>
                <p className="mt-2 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
                  {text.evalApiPlanned}
                </p>
                <button
                  type="button"
                  disabled={
                    !evaluateForm.datasetId ||
                    !evaluateForm.checkpointPath.trim() ||
                    !selectedEvaluateAdapter?.id ||
                    Boolean(actionPending["evaluation-run"])
                  }
                  onClick={() => {
                    const adapterId = selectedEvaluateAdapter?.id;
                    if (!adapterId) return;
                    void runSecondaryAction(
                      "evaluation-run",
                      {
                        action: "run-evaluation",
                        adapterId,
                        datasetId: evaluateForm.datasetId,
                        checkpointPath: evaluateForm.checkpointPath,
                        maxSamples: evaluateForm.maxSamples,
                        maxNewTokens: evaluateForm.maxNewTokens,
                        temperature: evaluateForm.temperature,
                        topP: evaluateForm.topP,
                        metrics: evaluateForm.metrics,
                        savePredictions: evaluateForm.savePredictions,
                      },
                      text.evalRunSuccess,
                    );
                  }}
                  className="mt-3 w-full rounded-2xl border border-cyan-300/35 bg-cyan-400/15 px-4 py-3 text-sm font-semibold text-cyan-50 transition enabled:hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {actionPending["evaluation-run"]
                    ? text.loading
                    : text.evalRun}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {text.commandPreview}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void copyValue(evaluateCommandPreview, text.evalCommandCopied)
                  }
                  className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                >
                  {text.copyCommand}
                </button>
              </div>
              <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/25 p-3 text-[11px] leading-5 text-slate-200">
                {evaluateCommandPreview}
              </pre>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {text.yamlPreview}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void copyValue(evaluateYamlPreview, text.evalYamlCopied)
                  }
                  className="rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-400/15"
                >
                  {text.copyYaml}
                </button>
              </div>
              <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/25 p-3 text-[11px] leading-5 text-slate-200">
                {evaluateYamlPreview}
              </pre>
            </div>
          </div>
        ) : activeFineTuneLabTab === "chat" ? (
          <div className="mt-4 grid gap-3 xl:grid-cols-[0.9fr_1.15fr_1fr]">
            <div className="rounded-3xl border border-cyan-300/15 bg-cyan-400/[0.055] p-4">
              <p className="text-sm font-semibold text-white">
                {text.chatConsoleTitle}
              </p>
              <p className="mt-2 text-xs leading-6 text-cyan-50/70">
                {text.chatConsoleHint}
              </p>
              <FieldShell
                label={text.chatAdapter}
                helper={
                  isEnglish
                    ? "Ready adapters can be attached to the local runtime for a controlled single-turn test."
                    : "可用 adapter 后续可挂载到本地运行时，进行受控单轮测试。"
                }
                className="mt-4"
              >
                <select
                  value={chatForm.adapterId}
                  onChange={(event) =>
                    setChatForm((current) => ({
                      ...current,
                      adapterId: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none"
                >
                  <option value="">{text.chatAdapter}</option>
                  {(summary?.adapters || []).map((adapter) => (
                    <option key={adapter.id} value={adapter.id}>
                      {adapter.adapterName} · {adapter.status}
                    </option>
                  ))}
                </select>
              </FieldShell>
              <FieldShell
                label={text.chatRole}
                helper={
                  isEnglish
                    ? "Role is useful when reproducing dataset-style prompts."
                    : "角色用于复现数据集里的对话格式。"
                }
                className="mt-4"
              >
                <select
                  value={chatForm.role}
                  onChange={(event) =>
                    setChatForm((current) => ({
                      ...current,
                      role: event.target.value as FineTuneChatFormState["role"],
                    }))
                  }
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none"
                >
                  <option value="user">user</option>
                  <option value="assistant">assistant</option>
                  <option value="system">system</option>
                </select>
              </FieldShell>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <FieldShell
                label={text.chatSystemPrompt}
                helper={
                  isEnglish
                    ? "Keep this short so the adapter behavior stays visible."
                    : "保持简短，避免系统提示词盖过 adapter 本身行为。"
                }
              >
                <textarea
                  value={chatForm.systemPrompt}
                  onChange={(event) =>
                    setChatForm((current) => ({
                      ...current,
                      systemPrompt: event.target.value,
                    }))
                  }
                  rows={4}
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs leading-6 text-white outline-none focus:border-cyan-400/40"
                />
              </FieldShell>
              <FieldShell
                label={text.chatPrompt}
                helper={
                  isEnglish
                    ? "Use a short prompt that should expose whether the adapter learned the intended behavior."
                    : "建议用能暴露 adapter 行为变化的短提示词。"
                }
                className="mt-3"
              >
                <textarea
                  value={chatForm.prompt}
                  onChange={(event) =>
                    setChatForm((current) => ({
                      ...current,
                      prompt: event.target.value,
                    }))
                  }
                  rows={5}
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs leading-6 text-white outline-none focus:border-cyan-400/40"
                />
              </FieldShell>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    key: "maxNewTokens",
                    label: text.evalMaxNewTokens,
                    min: 16,
                    step: 16,
                  },
                  {
                    key: "temperature",
                    label: text.evalTemperature,
                    min: 0,
                    step: 0.1,
                  },
                  { key: "topP", label: text.evalTopP, min: 0, step: 0.05 },
                ].map((field) => (
                  <FieldShell
                    key={field.key}
                    label={field.label}
                    helper={
                      field.key === "maxNewTokens"
                        ? isEnglish
                          ? "Caps answer length in the sandbox."
                          : "限制沙盒回答长度。"
                        : field.key === "temperature"
                          ? isEnglish
                            ? "Higher values make behavior differences easier to spot."
                            : "温度越高，行为差异越容易显现。"
                          : isEnglish
                            ? "Nucleus sampling value for the sandbox call."
                            : "沙盒调用的 nucleus sampling 参数。"
                    }
                  >
                    <input
                      type="number"
                      min={field.min}
                      step={field.step}
                      value={
                        chatForm[
                          field.key as keyof Pick<
                            FineTuneChatFormState,
                            "maxNewTokens" | "temperature" | "topP"
                          >
                        ]
                      }
                      onChange={(event) => {
                        const nextValue = Number(event.target.value);
                        if (!Number.isFinite(nextValue)) return;
                        setChatForm((current) => ({
                          ...current,
                          [field.key]: nextValue,
                        }));
                      }}
                      className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                    />
                  </FieldShell>
                ))}
              </div>
              <div className="mt-4 grid gap-2">
                {[
                  {
                    key: "skipSpecialTokens",
                    label: text.chatSkipSpecialTokens,
                    checked: chatForm.skipSpecialTokens,
                  },
                  {
                    key: "renderHtmlTags",
                    label: text.chatRenderHtmlTags,
                    checked: chatForm.renderHtmlTags,
                  },
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-semibold text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(event) =>
                        setChatForm((current) => ({
                          ...current,
                          [item.key]: event.target.checked,
                        }))
                      }
                    />
                    {item.label}
                  </label>
                ))}
              </div>
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {text.chatReadiness}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  {chatReadiness}
                </p>
                <p className="mt-2 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
                  {text.chatApiPlanned}
                </p>
                <button
                  type="button"
                  disabled={
                    !chatForm.adapterId ||
                    !chatForm.prompt.trim() ||
                    Boolean(actionPending["chat-adapter-run"])
                  }
                  onClick={() =>
                    void runSecondaryAction(
                      "chat-adapter-run",
                      {
                        action: "run-chat-adapter",
                        adapterId: chatForm.adapterId,
                        role: chatForm.role,
                        systemPrompt: chatForm.systemPrompt,
                        prompt: chatForm.prompt,
                        maxNewTokens: chatForm.maxNewTokens,
                        temperature: chatForm.temperature,
                        topP: chatForm.topP,
                        skipSpecialTokens: chatForm.skipSpecialTokens,
                        renderHtmlTags: chatForm.renderHtmlTags,
                      },
                      text.chatRunSuccess,
                    )
                  }
                  className="mt-3 w-full rounded-2xl border border-cyan-300/35 bg-cyan-400/15 px-4 py-3 text-sm font-semibold text-cyan-50 transition enabled:hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {actionPending["chat-adapter-run"]
                    ? text.loading
                    : text.chatRun}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {text.commandPreview}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void copyValue(
                      chatAdapterCommandPreview,
                      text.adapterCommandCopied,
                    )
                  }
                  className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                >
                  {text.copyCommand}
                </button>
              </div>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/25 p-3 text-[11px] leading-5 text-slate-200">
                {chatAdapterCommandPreview}
              </pre>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 xl:grid-cols-[0.9fr_0.9fr_1.15fr]">
            <div className="rounded-3xl border border-cyan-300/15 bg-cyan-400/[0.055] p-4">
              <p className="text-sm font-semibold text-white">
                {text.exportConsoleTitle}
              </p>
              <p className="mt-2 text-xs leading-6 text-cyan-50/70">
                {text.exportConsoleHint}
              </p>
              <FieldShell
                label={text.exportAdapter}
                helper={
                  isEnglish
                    ? "Pick the adapter artifact to package for deployment."
                    : "选择要打包部署的 adapter 产物。"
                }
                className="mt-4"
              >
                <select
                  value={exportForm.adapterId}
                  onChange={(event) =>
                    setExportForm((current) => ({
                      ...current,
                      adapterId: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none"
                >
                  <option value="">{text.exportAdapter}</option>
                  {(summary?.adapters || []).map((adapter) => (
                    <option key={adapter.id} value={adapter.id}>
                      {adapter.adapterName} · {adapter.status}
                    </option>
                  ))}
                </select>
              </FieldShell>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldShell
                  label={text.exportFormat}
                  helper={
                    isEnglish
                      ? "Adapter bundle is safest; merged/gguf are deployment-oriented follow-ups."
                      : "Adapter bundle 最安全；merged / gguf 偏部署导出。"
                  }
                >
                  <select
                    value={exportForm.exportFormat}
                    onChange={(event) =>
                      setExportForm((current) => ({
                        ...current,
                        exportFormat:
                          event.target
                            .value as FineTuneExportFormState["exportFormat"],
                      }))
                    }
                    className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                  >
                    <option value="adapter-bundle">adapter-bundle</option>
                    <option value="merged-mlx">merged-mlx</option>
                    <option value="gguf">gguf</option>
                  </select>
                </FieldShell>
                <FieldShell
                  label={text.exportQuantization}
                  helper={
                    isEnglish
                      ? "Keep none for lossless adapter bundles; q8/q4 for smaller deployables."
                      : "无损 adapter bundle 选 none；q8/q4 用于更小部署产物。"
                  }
                >
                  <select
                    value={exportForm.quantization}
                    onChange={(event) =>
                      setExportForm((current) => ({
                        ...current,
                        quantization:
                          event.target
                            .value as FineTuneExportFormState["quantization"],
                      }))
                    }
                    className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                  >
                    <option value="none">none</option>
                    <option value="q8">q8</option>
                    <option value="q4">q4</option>
                  </select>
                </FieldShell>
                <FieldShell
                  label={text.exportShardSize}
                  helper={
                    isEnglish
                      ? "Large merged exports can be split for upload and sync."
                      : "较大的合并导出可按分片大小拆分，便于上传同步。"
                  }
                >
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={exportForm.maxShardSizeGb}
                    onChange={(event) => {
                      const nextValue = Number(event.target.value);
                      if (!Number.isFinite(nextValue)) return;
                      setExportForm((current) => ({
                        ...current,
                        maxShardSizeGb: nextValue,
                      }));
                    }}
                    className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                  />
                </FieldShell>
                <FieldShell
                  label={text.exportHubId}
                  helper={
                    isEnglish
                      ? "Optional repository id if this export will be published later."
                      : "如果后续要发布到 Hub，可先填可选仓库 ID。"
                  }
                >
                  <input
                    value={exportForm.hubId}
                    onChange={(event) =>
                      setExportForm((current) => ({
                        ...current,
                        hubId: event.target.value,
                      }))
                    }
                    placeholder="username/model-name"
                    className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                  />
                </FieldShell>
              </div>
              <FieldShell
                label={text.exportOutputDir}
                helper={
                  isEnglish
                    ? "Defaults to an export folder next to the adapter output."
                    : "默认导出到 adapter 产物旁边的 export 文件夹。"
                }
                className="mt-3"
              >
                <input
                  value={exportForm.outputDir}
                  onChange={(event) =>
                    setExportForm((current) => ({
                      ...current,
                      outputDir: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                />
              </FieldShell>
              <label className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-semibold text-slate-200">
                <input
                  type="checkbox"
                  checked={exportForm.includeDatasetCard}
                  onChange={(event) =>
                    setExportForm((current) => ({
                      ...current,
                      includeDatasetCard: event.target.checked,
                    }))
                  }
                />
                {text.exportIncludeDatasetCard}
              </label>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {text.exportReadiness}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  {exportReadiness}
                </p>
                <p className="mt-2 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
                  {text.exportApiPlanned}
                </p>
                <button
                  type="button"
                  disabled={
                    !exportForm.adapterId ||
                    Boolean(actionPending["export-adapter-run"])
                  }
                  onClick={() =>
                    void runSecondaryAction(
                      "export-adapter-run",
                      {
                        action: "run-export-adapter",
                        adapterId: exportForm.adapterId,
                        exportFormat: exportForm.exportFormat,
                        quantization: exportForm.quantization,
                        maxShardSizeGb: exportForm.maxShardSizeGb,
                        outputDir: exportForm.outputDir,
                        hubId: exportForm.hubId,
                        includeDatasetCard: exportForm.includeDatasetCard,
                      },
                      text.exportRunSuccess,
                    )
                  }
                  className="mt-3 w-full rounded-2xl border border-cyan-300/35 bg-cyan-400/15 px-4 py-3 text-sm font-semibold text-cyan-50 transition enabled:hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {actionPending["export-adapter-run"]
                    ? text.loading
                    : text.exportRun}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {text.commandPreview}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void copyValue(
                      exportAdapterCommandPreview,
                      text.adapterCommandCopied,
                    )
                  }
                  className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                >
                  {text.copyCommand}
                </button>
              </div>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/25 p-3 text-[11px] leading-5 text-slate-200">
                {exportAdapterCommandPreview}
              </pre>
            </div>
          </div>
        )}
      </div>

      <div
        className={`mt-5 grid gap-4 xl:grid-cols-[minmax(360px,1fr)_minmax(420px,1.12fr)] 2xl:grid-cols-[minmax(380px,1.02fr)_minmax(460px,1.18fr)_minmax(340px,0.84fr)] ${
          activeWorkspaceTab === "setup" && activeFineTuneLabTab === "train"
            ? ""
            : "hidden"
        }`}
      >
        <div className="min-w-0 rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
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
                <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {text.communityImportTitle}
                      </p>
                      <p className="mt-1 max-w-xl text-xs leading-5 text-slate-400">
                        {text.communityImportHint}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {[
                          text.communityImportGuardDirect,
                          text.communityImportGuardSchema,
                          text.communityImportGuardLimit,
                          text.communityImportGuardLicense,
                        ].map((item) => (
                          <span
                            key={item}
                            className="rounded-full border border-cyan-300/15 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-50/80"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={
                        !communityImportForm.label.trim() ||
                        !communityImportForm.sourceUrl.trim() ||
                        Boolean(actionPending["dataset-community-import"])
                      }
                      onClick={() => void importCommunityDatasetSource()}
                      className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition enabled:hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionPending["dataset-community-import"]
                        ? text.loading
                        : text.communityImportAction}
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    <input
                      value={communityImportForm.label}
                      onChange={(event) =>
                        setCommunityImportForm((current) => ({
                          ...current,
                          label: event.target.value,
                        }))
                      }
                      placeholder={text.communityImportLabel}
                      className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/40"
                    />
                    <input
                      value={communityImportForm.sourceLabel}
                      onChange={(event) =>
                        setCommunityImportForm((current) => ({
                          ...current,
                          sourceLabel: event.target.value,
                        }))
                      }
                      placeholder={text.communityImportSourceLabel}
                      className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/40"
                    />
                    <input
                      value={communityImportForm.sourceUrl}
                      onChange={(event) =>
                        setCommunityImportForm((current) => ({
                          ...current,
                          sourceUrl: event.target.value,
                        }))
                      }
                      placeholder={text.communityImportUrl}
                      className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/40 lg:col-span-2"
                    />
                    <select
                      value={communityImportForm.format}
                      onChange={(event) =>
                        setCommunityImportForm((current) => ({
                          ...current,
                          format: event.target
                            .value as AgentFineTuneDatasetFormat,
                        }))
                      }
                      className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/40"
                    >
                      <option value="instruction-jsonl">
                        {text.communityImportFormat}: instruction-jsonl
                      </option>
                      <option value="chat-jsonl">
                        {text.communityImportFormat}: chat-jsonl
                      </option>
                    </select>
                    <input
                      type="number"
                      min={32}
                      max={5000}
                      value={communityImportForm.sampleLimit}
                      onChange={(event) =>
                        setCommunityImportForm((current) => ({
                          ...current,
                          sampleLimit: Number(event.target.value) || 384,
                        }))
                      }
                      placeholder={text.communityImportSampleLimit}
                      className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/40"
                    />
                    <input
                      value={communityImportForm.license}
                      onChange={(event) =>
                        setCommunityImportForm((current) => ({
                          ...current,
                          license: event.target.value,
                        }))
                      }
                      placeholder={text.communityImportLicense}
                      className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/40 lg:col-span-2"
                    />
                  </div>
                </div>
                <div className="mt-3 grid max-h-[640px] gap-3 overflow-auto pr-1">
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
                            <span className="rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.06] px-3 py-2">
                              {text.modelFit}:{" "}
                              <span className="text-cyan-100">
                                {getPresetModelFit(preset)}
                              </span>
                            </span>
                            <span className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2">
                              {text.risk}:{" "}
                              <span className="text-amber-100">
                                {getPresetLicenseRisk(preset)}
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
                onClick={() => {
                  const matchingPreset = COMMUNITY_DATASET_PRESETS.find(
                    (preset) =>
                      preset.localPath === datasetForm.sourcePath &&
                      preset.format === datasetForm.format,
                  );
                  const presetMetadata = matchingPreset
                    ? buildPresetDatasetSaveMetadata(matchingPreset)
                    : null;
                  setDatasetValidationQuality(
                    presetMetadata?.quality || null,
                  );
                  setDatasetValidationQualityWarnings(
                    presetMetadata?.qualityWarnings || [],
                  );
                  void postAction(
                    { action: "validate-dataset", ...datasetForm },
                    text.validated,
                  );
                }}
                className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
              >
                {text.datasetValidate}
              </button>
              <button
                type="button"
                disabled={!canSaveDataset}
                onClick={async () => {
                  const matchingPreset = COMMUNITY_DATASET_PRESETS.find(
                    (preset) =>
                      preset.localPath === datasetForm.sourcePath &&
                      preset.format === datasetForm.format,
                  );
                  const presetMetadata = matchingPreset
                    ? buildPresetDatasetSaveMetadata(matchingPreset)
                    : null;
                  const payload = await postAction(
                    {
                      action: "save-dataset",
                      ...datasetForm,
                      ...(presetMetadata || {}),
                    },
                    text.saveSuccessDataset,
                  );
                  setDatasetValidationQualityWarnings(
                    payload?.dataset?.qualityWarnings ||
                      presetMetadata?.qualityWarnings ||
                      [],
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

          {datasetValidation || datasetValidationQuality ? (
            <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-slate-950/70 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span
                  className={`rounded-full px-2.5 py-1 ${
                    datasetValidation
                      ? datasetValidation.ok
                        ? "bg-emerald-400/15 text-emerald-100"
                        : "bg-rose-400/15 text-rose-100"
                      : "bg-cyan-400/15 text-cyan-100"
                  }`}
                >
                  {datasetValidation
                    ? datasetValidation.ok
                      ? "OK"
                      : "FAILED"
                    : isEnglish
                      ? "QUALITY PREFLIGHT"
                      : "质量预检"}
                </span>
                <span>{datasetValidation?.format || datasetForm.format}</span>
                <span>
                  {formatSampleCount(
                    datasetValidation?.sampleCount ||
                      datasetValidationQuality?.sampledRows ||
                      datasetValidationQuality?.convertedRows ||
                      datasetValidationQuality?.downloadedRows,
                  )}{" "}
                  samples
                </span>
                {!datasetValidation ? (
                  <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-amber-100">
                    {isEnglish ? "Validate before saving" : "保存前请先校验"}
                  </span>
                ) : null}
              </div>
              {datasetValidationQuality ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.06] px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/80">
                      {text.qualityScore}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-white">
                      {formatQualityScore(datasetValidationQuality.score)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                      {text.licenseRisk}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-white">
                      {getLicenseRiskLabel(
                        datasetValidationQuality.licenseRisk,
                      )}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                      {text.convertedRows}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-100">
                      {formatSampleCount(
                        datasetValidationQuality.convertedRows ||
                          datasetValidation?.sampleCount,
                      )}{" "}
                      /{" "}
                      {formatSampleCount(
                        datasetValidationQuality.downloadedRows ||
                          datasetValidation?.sampleCount,
                      )}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                      {text.recommendedSteps}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-100">
                      {datasetValidationQuality.recommendedSteps
                        ? `${datasetValidationQuality.recommendedSteps.min}-${datasetValidationQuality.recommendedSteps.max}`
                        : "--"}
                    </p>
                  </div>
                  {datasetValidationQuality.schemaConversion ? (
                    <p className="sm:col-span-2 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs leading-5 text-slate-400">
                      {datasetValidationQuality.schemaConversion}
                    </p>
                  ) : null}
                  {datasetValidationQualityWarnings.length ? (
                    <div className="sm:col-span-2 rounded-2xl border border-amber-300/15 bg-amber-300/[0.055] px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-100/70">
                        {text.warnings}
                      </p>
                      <ul className="mt-1 space-y-1 text-xs leading-5 text-amber-100">
                        {datasetValidationQualityWarnings.map((warning) => (
                          <li key={warning}>- {warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {datasetValidationQuality.piiRiskRows ||
                  datasetValidationQuality.duplicateRows ? (
                    <p className="sm:col-span-2 rounded-2xl border border-amber-400/15 bg-amber-400/[0.06] px-3 py-2 text-xs leading-5 text-amber-100">
                      {isEnglish
                        ? `PII risk rows: ${datasetValidationQuality.piiRiskRows || 0}; duplicate rows: ${datasetValidationQuality.duplicateRows || 0}.`
                        : `疑似隐私行：${datasetValidationQuality.piiRiskRows || 0}；重复行：${datasetValidationQuality.duplicateRows || 0}。`}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {datasetValidation?.preview.length ? (
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
              {datasetValidation?.warnings.length ? (
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
              {datasetValidation?.errors.length ? (
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

        <div className="min-w-0 rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <p className="text-sm font-semibold text-white">{text.recipeTitle}</p>
          <p className="mt-2 text-xs leading-6 text-slate-500">
            {text.recipeHint}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-2">
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
            {[
              {
                label: text.recipeGroupSchedule,
                fields: recipeScheduleFields,
              },
              {
                label: text.recipeGroupAdapter,
                fields: recipeAdapterFields,
              },
              {
                label: text.recipeGroupEvidence,
                fields: recipeEvidenceFields,
              },
            ].map((group) => (
              <div
                key={group.label}
                className="rounded-3xl border border-white/10 bg-slate-950/45 p-3 sm:col-span-2"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/80">
                  {group.label}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {group.fields.map((field) => (
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
                </div>
              </div>
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
              className="sm:col-span-2"
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
            <label className="rounded-2xl border border-white/10 bg-slate-950/50 p-3 text-sm text-slate-300 sm:col-span-2">
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
              className="rounded-full border border-violet-400/30 bg-violet-400/10 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:bg-violet-400/15 sm:col-span-2"
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

      <div
        className={`mt-5 grid gap-4 ${
          activeWorkspaceTab === "runs"
            ? "xl:grid-cols-1"
            : "xl:grid-cols-[0.95fr_1.2fr_1fr]"
        } ${activeWorkspaceTab === "setup" ? "hidden" : ""}`}
      >
        <div
          className={`rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${
            activeWorkspaceTab === "assets" ? "" : "hidden"
          }`}
        >
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
          <div className="mt-4 rounded-[24px] border border-cyan-300/15 bg-cyan-400/[0.045] p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">
                {text.operationHistory}
              </p>
              <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-50">
                {operationHistory.length}
              </span>
            </div>
            <div className="mt-3 space-y-3">
              {operationHistory.length ? (
                operationHistory.slice(0, 8).map((operation) => (
                  <div
                    key={operation.id}
                    className="rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-xs leading-6 text-slate-300"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-white">
                            {operation.title}
                          </p>
                          <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                            {operation.kind}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {formatDateTime(operation.updatedAt)}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                          operation.status === "completed"
                            ? "bg-emerald-400/10 text-emerald-100"
                            : "bg-rose-400/10 text-rose-100"
                        }`}
                      >
                        {operation.status}
                      </span>
                    </div>
                    <p className="mt-2 text-slate-300">{operation.summary}</p>
                    {operation.metrics &&
                    Object.keys(operation.metrics).length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {Object.entries(operation.metrics)
                          .slice(0, 8)
                          .map(([metricKey, metricValue]) => (
                            <span
                              key={`${operation.id}:${metricKey}`}
                              className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-300"
                            >
                              {metricKey}: {String(metricValue ?? "--")}
                            </span>
                          ))}
                      </div>
                    ) : null}
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                        {text.operationArtifacts}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {operation.artifacts.length ? (
                          operation.artifacts.map((artifact) => (
                            <button
                              key={`${operation.id}:${artifact.filePath}`}
                              type="button"
                              onClick={() =>
                                void copyValue(artifact.filePath, text.copied)
                              }
                              className="max-w-full truncate rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-left text-[10px] font-semibold text-cyan-50 transition hover:bg-cyan-300/15"
                              title={artifact.filePath}
                            >
                              {artifact.label}
                            </button>
                          ))
                        ) : (
                          <span className="text-[11px] text-slate-500">
                            --
                          </span>
                        )}
                      </div>
                    </div>
                    {operation.errorMessage ? (
                      <p className="mt-2 rounded-xl border border-rose-400/20 bg-rose-400/10 px-2.5 py-2 text-[11px] text-rose-100">
                        {operation.errorMessage}
                      </p>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-500">
                  {text.operationHistoryEmpty}
                </p>
              )}
            </div>
          </div>
        </div>

        <div
          className={`rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${
            activeWorkspaceTab === "assets" ? "" : "hidden"
          }`}
        >
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
                  {dataset.quality ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <span className="rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.06] px-3 py-2">
                        {text.qualityScore}:{" "}
                        <span className="font-semibold text-cyan-100">
                          {formatQualityScore(dataset.quality.score)}
                        </span>
                      </span>
                      <span className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2">
                        {text.licenseRisk}:{" "}
                        <span className="font-semibold text-amber-100">
                          {dataset.quality.licenseRisk}
                        </span>
                      </span>
                      <span className="rounded-2xl border border-emerald-300/15 bg-emerald-400/[0.06] px-3 py-2">
                        {text.recommendedSteps}:{" "}
                        <span className="font-semibold text-emerald-100">
                          {dataset.quality.recommendedSteps
                            ? `${dataset.quality.recommendedSteps.min}-${dataset.quality.recommendedSteps.max}`
                            : "--"}
                        </span>
                      </span>
                      <span className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 sm:col-span-3">
                        {text.convertedRows}:{" "}
                        <span className="text-slate-200">
                          {dataset.quality.convertedRows ?? "--"} /{" "}
                          {dataset.quality.downloadedRows ?? "--"}
                        </span>
                        <span className="ml-2 text-slate-500">
                          dup {dataset.quality.duplicateRows ?? 0} · pii{" "}
                          {dataset.quality.piiRiskRows ?? 0}
                        </span>
                      </span>
                    </div>
                  ) : null}
                  {dataset.qualityWarnings?.length ? (
                    <ul className="mt-2 space-y-1 rounded-2xl border border-amber-300/15 bg-amber-300/[0.055] px-3 py-2 text-[11px] leading-5 text-amber-100">
                      {dataset.qualityWarnings.map((warning) => (
                        <li key={warning}>- {warning}</li>
                      ))}
                    </ul>
                  ) : null}
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
                                        {formatSampleCount(
                                          candidate.sampleCount,
                                        )}
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

        <div
          className={`rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${
            activeWorkspaceTab === "runs" ? "" : "hidden"
          }`}
        >
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
                          const latestReport = lastReportByJobId[job.id];
                          const adapterForJob = adapterByJobId.get(job.id);
                          const canUseAdapterActions =
                            adapterForJob?.status === "ready";
                          const jobNextStepCopy =
                            job.status === "completed"
                              ? text.jobNextCompleted
                              : job.status === "failed" ||
                                  job.status === "cancelled"
                                ? text.jobNextFailed
                                : job.status === "queued" ||
                                    job.status === "running"
                                  ? text.jobNextRunning
                                  : text.jobNextStaged;
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
                                    const overlayJobs = getFineTuneOverlayJobs(
                                      job,
                                      summary?.jobs || [],
                                    );
                                    const chart = buildTrainingChart(
                                      job,
                                      chartRange,
                                      overlayJobs,
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
                                        {chart.overlaySeries.length ? (
                                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-semibold text-slate-200">
                                              {text.overlayRuns}:{" "}
                                              {chart.overlaySeries.length}
                                            </span>
                                            {chart.overlaySeries
                                              .slice(0, 3)
                                              .map((series) => (
                                                <span
                                                  key={`overlay-label:${series.jobId}`}
                                                  className="max-w-[180px] truncate rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-slate-300"
                                                  title={series.label}
                                                >
                                                  {series.label}
                                                </span>
                                              ))}
                                            <span>{text.overlayRunsHint}</span>
                                          </div>
                                        ) : null}
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
                                            {chart.overlaySeries.map(
                                              (series, index) => (
                                                <g
                                                  key={`overlay:${series.jobId}`}
                                                  opacity={0.34 - index * 0.06}
                                                >
                                                  {series.trainPath ? (
                                                    <path
                                                      d={series.trainPath}
                                                      fill="none"
                                                      stroke="rgb(34 211 238)"
                                                      strokeWidth="1.6"
                                                      strokeLinecap="round"
                                                      strokeLinejoin="round"
                                                      strokeDasharray="5 6"
                                                    />
                                                  ) : null}
                                                  {series.validPath ? (
                                                    <path
                                                      d={series.validPath}
                                                      fill="none"
                                                      stroke="rgb(167 139 250)"
                                                      strokeWidth="1.6"
                                                      strokeLinecap="round"
                                                      strokeLinejoin="round"
                                                      strokeDasharray="2 6"
                                                    />
                                                  ) : null}
                                                </g>
                                              ),
                                            )}
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

                              <div className="mt-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.055] px-3 py-3 text-[11px] leading-5 text-cyan-50/80">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-50/55">
                                      {text.jobNextStep}
                                    </p>
                                    <p className="mt-1 max-w-3xl text-cyan-50/80">
                                      {jobNextStepCopy}
                                    </p>
                                  </div>
                                  {job.status === "completed" ? (
                                    <span className="rounded-full border border-cyan-200/15 bg-cyan-200/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-50">
                                      {adapterForJob?.adapterName ||
                                        text.jobAdapterPending}
                                    </span>
                                  ) : null}
                                </div>
                                {job.status === "completed" ? (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {canUseAdapterActions && adapterForJob ? (
                                      <>
                                        <button
                                          type="button"
                                          disabled={Boolean(
                                            actionPending[
                                              `adapter-attach:${adapterForJob.id}`
                                            ],
                                          )}
                                          onClick={() =>
                                            void attachAdapterRuntime(
                                              adapterForJob.id,
                                            )
                                          }
                                          className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition enabled:hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                          {actionPending[
                                            `adapter-attach:${adapterForJob.id}`
                                          ]
                                            ? text.loading
                                            : text.attachRuntime}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={Boolean(
                                            actionPending[
                                              `adapter-compare:${adapterForJob.id}`
                                            ],
                                          )}
                                          onClick={() =>
                                            void runAdapterCompareHandoff(
                                              adapterForJob.id,
                                            )
                                          }
                                          className="rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition enabled:hover:bg-violet-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                          {actionPending[
                                            `adapter-compare:${adapterForJob.id}`
                                          ]
                                            ? text.loading
                                            : text.sendToCompare}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={Boolean(
                                            actionPending[
                                              `adapter-benchmark:${adapterForJob.id}`
                                            ],
                                          )}
                                          onClick={() =>
                                            void runAdapterBenchmarkHandoff(
                                              adapterForJob.id,
                                            )
                                          }
                                          className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 transition enabled:hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                          {actionPending[
                                            `adapter-benchmark:${adapterForJob.id}`
                                          ]
                                            ? text.loading
                                            : text.sendToBenchmark}
                                        </button>
                                      </>
                                    ) : (
                                      <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-[11px] font-semibold text-amber-100">
                                        {text.jobAdapterPending}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void exportJobReport(job.id, "markdown")
                                      }
                                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                                    >
                                      {text.exportMarkdownReport}
                                    </button>
                                  </div>
                                ) : null}
                              </div>

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
                                <button
                                  type="button"
                                  onClick={() =>
                                    void exportJobReport(
                                      job.id,
                                      "markdown",
                                      true,
                                    )
                                  }
                                  className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-400/15"
                                >
                                  {text.exportMarkdownReport}
                                </button>
                                <a
                                  href={`/api/admin/finetune?action=preview-report&id=${encodeURIComponent(job.id)}&reportFormat=markdown`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                                >
                                  {text.previewReport}
                                </a>
                                <a
                                  href={`/api/admin/finetune?action=download-bundle&id=${encodeURIComponent(job.id)}`}
                                  className="rounded-full border border-violet-300/25 bg-violet-300/10 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-300/15"
                                >
                                  {text.downloadFullBundle}
                                </a>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void exportJobReport(
                                      job.id,
                                      "manifest-json",
                                    )
                                  }
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                                >
                                  {text.exportManifestJson}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void exportJobReport(job.id, "metrics-csv")
                                  }
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                                >
                                  {text.exportMetricsCsv}
                                </button>
                              </div>

                              {latestReport ? (
                                <div className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-3 text-[11px] leading-5 text-emerald-50">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="font-semibold text-emerald-100">
                                        {text.latestReport} ·{" "}
                                        {latestReport.format}
                                      </p>
                                      <p className="mt-1 break-all text-emerald-50/75">
                                        {text.reportPath}:{" "}
                                        {latestReport.filePath}
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <a
                                        href={`/api/admin/finetune?action=preview-report&id=${encodeURIComponent(job.id)}&reportFormat=${latestReport.format}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="rounded-full border border-emerald-200/20 bg-emerald-200/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-50 transition hover:bg-emerald-200/15"
                                      >
                                        {text.previewReport}
                                      </a>
                                      <a
                                        href={`/api/admin/finetune?action=download-bundle&id=${encodeURIComponent(job.id)}`}
                                        className="rounded-full border border-violet-200/25 bg-violet-200/10 px-2.5 py-1 text-[10px] font-semibold text-violet-50 transition hover:bg-violet-200/15"
                                      >
                                        {text.downloadFullBundle}
                                      </a>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void copyValue(
                                            latestReport.filePath,
                                            text.copied,
                                          )
                                        }
                                        className="rounded-full border border-emerald-200/20 bg-emerald-200/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-50 transition hover:bg-emerald-200/15"
                                      >
                                        {text.copyReportPath}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void runSecondaryAction(
                                            `job-reports:${job.id}`,
                                            {
                                              action: "open-path",
                                              kind: "job-reports",
                                              id: job.id,
                                            },
                                          )
                                        }
                                        className="rounded-full border border-emerald-200/20 bg-emerald-200/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-50 transition hover:bg-emerald-200/15"
                                      >
                                        {actionPending[`job-reports:${job.id}`]
                                          ? text.loading
                                          : text.openReports}
                                      </button>
                                    </div>
                                  </div>
                                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em] text-emerald-50/70">
                                      <span className="rounded-full border border-emerald-200/20 bg-emerald-200/10 px-2 py-0.5">
                                        {text.reportPoints}:{" "}
                                      {latestReport.metricsSummary.pointCount}
                                    </span>
                                    <span className="rounded-full border border-emerald-200/20 bg-emerald-200/10 px-2 py-0.5">
                                      {text.reportLatestStep}:{" "}
                                      {latestReport.metricsSummary.latestStep ??
                                          "--"}
                                      </span>
                                    </div>
                                    {latestReport.runComparison ? (
                                      <div className="mt-3 rounded-2xl border border-cyan-200/15 bg-cyan-300/[0.06] p-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-50/70">
                                            {text.runComparison}
                                          </p>
                                          <span className="rounded-full border border-cyan-200/15 bg-cyan-200/10 px-2 py-0.5 text-[10px] text-cyan-50/70">
                                            {latestReport.runComparison.adapterName}
                                          </span>
                                        </div>
                                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                          <div className="rounded-xl border border-cyan-200/15 bg-black/15 px-2 py-2">
                                            <p className="text-[9px] uppercase tracking-[0.16em] text-cyan-50/50">
                                              {text.runsCompared}
                                            </p>
                                            <p className="mt-1 text-sm font-semibold text-cyan-50">
                                              {latestReport.runComparison.runCount}
                                            </p>
                                          </div>
                                          <div className="rounded-xl border border-cyan-200/15 bg-black/15 px-2 py-2">
                                            <p className="text-[9px] uppercase tracking-[0.16em] text-cyan-50/50">
                                              {text.bestValLoss}
                                            </p>
                                            <p className="mt-1 text-sm font-semibold text-cyan-50">
                                              {typeof latestReport.runComparison
                                                .bestValidationLoss === "number"
                                                ? latestReport.runComparison.bestValidationLoss.toFixed(
                                                    4,
                                                  )
                                                : "--"}
                                            </p>
                                          </div>
                                          <div className="rounded-xl border border-cyan-200/15 bg-black/15 px-2 py-2">
                                            <p className="text-[9px] uppercase tracking-[0.16em] text-cyan-50/50">
                                              {text.latestValLoss}
                                            </p>
                                            <p className="mt-1 text-sm font-semibold text-cyan-50">
                                              {typeof latestReport.runComparison
                                                .latestValidationLoss === "number"
                                                ? latestReport.runComparison.latestValidationLoss.toFixed(
                                                    4,
                                                  )
                                                : "--"}
                                            </p>
                                          </div>
                                        </div>
                                        {latestReport.runComparison
                                          .deltaToPrevious ? (
                                          <div className="mt-3 rounded-xl border border-cyan-200/15 bg-black/20 px-3 py-3">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                              <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-50/50">
                                                {text.runDelta}
                                              </p>
                                              <span className="rounded-full border border-cyan-200/15 bg-cyan-200/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-50">
                                                {text.deltaConclusion}:{" "}
                                                {getRunDeltaConclusionLabel(
                                                  latestReport.runComparison
                                                    .deltaToPrevious.conclusion,
                                                  isEnglish,
                                                )}
                                              </span>
                                            </div>
                                            <p className="mt-2 break-all text-[10px] text-cyan-50/60">
                                              {text.previousRun}:{" "}
                                              {
                                                latestReport.runComparison
                                                  .deltaToPrevious.previousJobId
                                              }
                                            </p>
                                            <div className="mt-2 grid gap-2 sm:grid-cols-5">
                                              {[
                                                {
                                                  label: text.trainDelta,
                                                  value: formatSignedNumber(
                                                    latestReport.runComparison
                                                      .deltaToPrevious
                                                      .trainLatestDelta,
                                                    4,
                                                  ),
                                                },
                                                {
                                                  label: text.validDelta,
                                                  value: formatSignedNumber(
                                                    latestReport.runComparison
                                                      .deltaToPrevious
                                                      .validLatestDelta,
                                                    4,
                                                  ),
                                                },
                                                {
                                                  label: text.bestValidDelta,
                                                  value: formatSignedNumber(
                                                    latestReport.runComparison
                                                      .deltaToPrevious
                                                      .validBestDelta,
                                                    4,
                                                  ),
                                                },
                                                {
                                                  label: text.durationDelta,
                                                  value: formatSignedDurationMs(
                                                    latestReport.runComparison
                                                      .deltaToPrevious
                                                      .durationMsDelta,
                                                  ),
                                                },
                                                {
                                                  label: text.stepDelta,
                                                  value: formatSignedInteger(
                                                    latestReport.runComparison
                                                      .deltaToPrevious
                                                      .latestStepDelta,
                                                  ),
                                                },
                                              ].map((item) => (
                                                <div
                                                  key={item.label}
                                                  className="rounded-lg border border-cyan-200/10 bg-cyan-200/[0.04] px-2 py-1.5"
                                                >
                                                  <p className="text-[8px] uppercase tracking-[0.14em] text-cyan-50/45">
                                                    {item.label}
                                                  </p>
                                                  <p className="mt-1 font-semibold text-cyan-50">
                                                    {item.value}
                                                  </p>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : null}
                                    {latestReport.evidence ? (
                                      <div className="mt-3 rounded-2xl border border-emerald-200/15 bg-black/15 p-3">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-50/70">
                                          {text.evidenceSummary}
                                        </p>
                                        <span className="rounded-full border border-emerald-200/15 bg-emerald-200/10 px-2 py-0.5 text-[10px] text-emerald-50/70">
                                          {latestReport.evidence.compareEvents
                                            .length ||
                                          latestReport.evidence.benchmarkRuns
                                            .length
                                            ? text.evidenceReady
                                            : text.evidenceMissing}
                                        </span>
                                      </div>
                                      <div className="mt-2 grid gap-2 sm:grid-cols-4">
                                        {[
                                          {
                                            label: text.evidenceTimeline,
                                            value:
                                              latestReport.evidence
                                                .timelineEvents.length,
                                          },
                                          {
                                            label: text.evidenceCompare,
                                            value:
                                              latestReport.evidence
                                                .compareEvents.length,
                                          },
                                          {
                                            label: text.evidenceBenchmark,
                                            value:
                                              latestReport.evidence
                                                .benchmarkEvents.length,
                                          },
                                          {
                                            label: text.evidenceBenchmarkRuns,
                                            value:
                                              latestReport.evidence
                                                .benchmarkRuns.length,
                                          },
                                        ].map((item) => (
                                          <div
                                            key={item.label}
                                            className="rounded-xl border border-emerald-200/15 bg-emerald-200/[0.06] px-2 py-2"
                                          >
                                            <p className="text-[9px] uppercase tracking-[0.16em] text-emerald-50/50">
                                              {item.label}
                                            </p>
                                            <p className="mt-1 text-sm font-semibold text-emerald-50">
                                              {item.value}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              {job.recentLogLines?.length ? (
                                <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                                    {text.workerLog}
                                  </p>
                                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950/70 p-3 text-[11px] leading-5 text-slate-300">
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

        <div
          className={`rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${
            activeWorkspaceTab === "assets" ? "" : "hidden"
          }`}
        >
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
                      disabled={
                        adapter.status !== "ready" ||
                        Boolean(actionPending[`adapter-proof:${adapter.id}`])
                      }
                      onClick={() => void runAdapterProofLoop(adapter.id)}
                      className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1.5 text-[11px] font-semibold text-sky-100 transition enabled:hover:bg-sky-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionPending[`adapter-proof:${adapter.id}`]
                        ? text.loading
                        : text.runProofLoop}
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
