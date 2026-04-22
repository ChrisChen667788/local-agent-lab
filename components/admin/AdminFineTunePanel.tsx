"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentBenchmarkResponse,
  AgentCompareResponse,
  AgentFineTuneDataset,
  AgentFineTuneJob,
  AgentFineTuneDatasetFormat,
  AgentFineTuneDatasetValidation,
  AgentFineTuneSummary,
  AgentTarget
} from "@/lib/agent/types";
import {
  buildFineTuneBenchmarkHandoffPlan,
  buildFineTuneCompareHandoffPlan
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
  refreshCadenceHours: 24
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
  notes: ""
};

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

function buildCurvePath(job: AgentFineTuneJob, width = 280, height = 88) {
  const points = (job.curve || []).filter((point) => point.split === "train" || point.split === "valid");
  if (points.length < 2) return { trainPath: "", validPath: "" };

  const maxStep = Math.max(...points.map((point) => point.step), 1);
  const lossValues = points.map((point) => point.loss).filter((value) => Number.isFinite(value));
  const minLoss = Math.min(...lossValues);
  const maxLoss = Math.max(...lossValues, minLoss + 0.001);
  const toX = (step: number) => ((step - 1) / Math.max(1, maxStep - 1)) * width;
  const toY = (loss: number) => height - ((loss - minLoss) / Math.max(0.001, maxLoss - minLoss)) * height;
  const toPath = (split: "train" | "valid") =>
    points
      .filter((point) => point.split === split)
      .map((point, index) => `${index === 0 ? "M" : "L"} ${toX(point.step).toFixed(1)} ${toY(point.loss).toFixed(1)}`)
      .join(" ");

  return {
    trainPath: toPath("train"),
    validPath: toPath("valid")
  };
}

export function AdminFineTunePanel({ locale }: FineTunePanelProps) {
  const text = useMemo(() => {
    if (locale.startsWith("en")) {
      return {
        eyebrow: "Local fine-tune lab",
        title: "Fine-tune workflow slice",
        subtitle:
          "Validate a local dataset, save a repeatable recipe, and stage a fine-tune job bundle inside the current admin workflow.",
        refresh: "Refresh",
        loading: "Loading...",
        datasetTitle: "1. Dataset",
        datasetHint: "Point to a local JSONL dataset and run validation before saving it into the registry.",
        datasetLabel: "Dataset label",
        datasetPath: "Local dataset path",
        datasetFormat: "Dataset format",
        upstreamQuery: "Upstream dataset query",
        refreshCadence: "Refresh cadence (hours)",
        datasetValidate: "Validate",
        datasetSave: "Save dataset",
        datasetWatchSave: "Save watch",
        datasetWatchCheck: "Check upstream datasets",
        recipeTitle: "2. Recipe",
        recipeHint: "Keep recipe inputs explicit so compare and benchmark can reuse the exact same setup later.",
        recipeSave: "Save recipe",
        jobTitle: "3. Stage job",
        jobHint: "Stage a persisted bundle, then run the local MLX worker directly from this admin panel and watch logs plus loss curves come back.",
        stageJob: "Stage job bundle",
        startJob: "Start local worker",
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
        runtimeAttached: "Attached runtime",
        attachedAt: "Attached at",
        copied: "Copied.",
        actionOpenSuccess: "Opened in Finder.",
        saveSuccessDataset: "Dataset saved.",
        saveSuccessRecipe: "Recipe saved.",
        stageSuccess: "Fine-tune job bundle staged.",
        startSuccess: "Local fine-tune worker started.",
        cancelSuccess: "Fine-tune worker cancelled.",
        handoffBenchmarkSuccess: "Adapter benchmark handoff completed.",
        handoffCompareSuccess: "Adapter compare handoff completed.",
        handoffMissingContext: "This adapter is missing its recipe or dataset context.",
        runtimeAttachSuccess: "Adapter runtime mounted.",
        validated: "Validation complete. Review preview and warnings before saving.",
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
        dataDir: "Data dir"
      };
    }
    return {
      eyebrow: "本地微调实验台",
      title: "Fine-tune 工作流第一批切片",
      subtitle: "先把本地数据集校验、可复用配方和作业 bundle 接入现有后台，不脱离当前项目框架。",
      refresh: "刷新",
      loading: "加载中...",
      datasetTitle: "1. 数据集",
      datasetHint: "填写本地 JSONL 数据路径，先做校验，再把它保存进数据集注册表。",
      datasetLabel: "数据集名称",
      datasetPath: "本地数据路径",
      datasetFormat: "数据格式",
      upstreamQuery: "上游数据集查询词",
      refreshCadence: "刷新周期（小时）",
      datasetValidate: "校验数据集",
      datasetSave: "保存数据集",
      datasetWatchSave: "保存监听配置",
      datasetWatchCheck: "检查上游数据集",
      recipeTitle: "2. 配方",
      recipeHint: "把训练关键参数显式固化下来，后面 compare / benchmark 才能沿用同一口径。",
      recipeSave: "保存配方",
      jobTitle: "3. 作业暂存",
      jobHint: "先生成可落盘的 job bundle，再直接从后台启动本地 MLX worker，并回看日志和 loss 曲线。",
      stageJob: "暂存作业 bundle",
      startJob: "启动本地 worker",
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
      runtimeAttached: "已挂载运行时",
      attachedAt: "挂载时间",
      copied: "已复制。",
      actionOpenSuccess: "已在 Finder 中打开。",
      saveSuccessDataset: "数据集已保存。",
      saveSuccessRecipe: "配方已保存。",
      stageSuccess: "Fine-tune 作业 bundle 已暂存。",
      startSuccess: "本地 Fine-tune worker 已启动。",
      cancelSuccess: "Fine-tune worker 已取消。",
      handoffBenchmarkSuccess: "Adapter benchmark handoff 已完成。",
      handoffCompareSuccess: "Adapter compare handoff 已完成。",
      handoffMissingContext: "这个 adapter 缺少配方或数据集上下文，暂时无法 handoff。",
      runtimeAttachSuccess: "Adapter 已挂载到本地运行时。",
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
      dataDir: "数据目录"
    };
  }, [locale]);

  const [summary, setSummary] = useState<AgentFineTuneSummary | null>(null);
  const [targetCatalog, setTargetCatalog] = useState<AgentTarget[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [datasetForm, setDatasetForm] = useState(DEFAULT_DATASET_FORM);
  const [recipeForm, setRecipeForm] = useState(DEFAULT_RECIPE_FORM);
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [datasetValidation, setDatasetValidation] = useState<AgentFineTuneDatasetValidation | null>(null);
  const [datasetWatchDrafts, setDatasetWatchDrafts] = useState<
    Record<string, { upstreamQuery: string; refreshCadenceHours: number }>
  >({});
  const [actionPending, setActionPending] = useState<Record<string, boolean>>({});

  const loadSummary = useCallback(async () => {
    setPending(true);
    try {
      const response = await fetch("/api/admin/finetune", { cache: "no-store" });
      const payload = (await response.json()) as FineTuneResponse;
      if (!response.ok || !payload.summary) {
        throw new Error(payload.error || "Failed to load fine-tune summary.");
      }
      setSummary(payload.summary);
      setRecipeForm((current) => ({
        ...current,
        datasetId: current.datasetId || payload.summary?.datasets[0]?.id || "",
        baseTargetId: current.baseTargetId || payload.summary?.localTargets[0]?.id || ""
      }));
      setSelectedRecipeId((current) => current || payload.summary?.recipes[0]?.id || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load fine-tune summary.");
      setMessageTone("error");
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const loadTargetCatalog = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/targets", { cache: "no-store" });
      const payload = (await response.json()) as { targets?: AgentTarget[] };
      if (response.ok && Array.isArray(payload.targets)) {
        setTargetCatalog(payload.targets);
      }
    } catch {
      // keep the last successful target catalog
    }
  }, []);

  useEffect(() => {
    void loadTargetCatalog();
  }, [loadTargetCatalog]);

  useEffect(() => {
    if (!summary?.jobs.some((job) => job.status === "queued" || job.status === "running")) {
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
            refreshCadenceHours: dataset.refreshCadenceHours || 24
          };
        }
      });
      return next;
    });
  }, [summary?.datasets]);

  async function postAction(body: Record<string, unknown>, successMessage: string) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/finetune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
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
      setMessage(error instanceof Error ? error.message : "Fine-tune request failed.");
      setMessageTone("error");
      return null;
    } finally {
      setPending(false);
    }
  }

  async function copyValue(value?: string | null) {
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        setMessage(text.copied);
        setMessageTone("success");
      }
    } catch {
      setMessageTone("error");
      setMessage("Copy failed.");
    }
  }

  async function runSecondaryAction(actionKey: string, body: Record<string, unknown>) {
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
          adapterId
        })
      });
      const payload = (await response.json()) as FineTuneResponse & {
        targets?: AgentTarget[];
      };
      if (!response.ok || !payload.summary) {
        throw new Error(payload.error || "Adapter runtime attach failed.");
      }
      setSummary(payload.summary);
      const targetsResponse = await fetch("/api/agent/targets", { cache: "no-store" });
      const targetsPayload = (await targetsResponse.json()) as { targets?: AgentTarget[]; error?: string };
      if (!targetsResponse.ok || !Array.isArray(targetsPayload.targets)) {
        throw new Error(targetsPayload.error || "Failed to refresh target catalog after adapter attach.");
      }
      setTargetCatalog(targetsPayload.targets);
      return {
        summary: payload.summary,
        targetCatalog: targetsPayload.targets,
        attachedTargetLabel: payload.attached?.target?.label
      };
    },
    []
  );

  const attachAdapterRuntime = useCallback(
    async (adapterId: string) => {
      const actionKey = `adapter-attach:${adapterId}`;
      setActionPending((current) => ({ ...current, [actionKey]: true }));
      setMessage("");
      try {
        const result = await ensureAdapterRuntimeAttached(adapterId);
        setMessage(
          `${text.runtimeAttachSuccess}${result.attachedTargetLabel ? ` ${locale.startsWith("en") ? "Target:" : "目标："} ${result.attachedTargetLabel}` : ""}`
        );
        setMessageTone("success");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Adapter runtime attach failed.");
        setMessageTone("error");
      } finally {
        setActionPending((current) => ({ ...current, [actionKey]: false }));
      }
    },
    [ensureAdapterRuntimeAttached, locale, text.runtimeAttachSuccess]
  );

  const runAdapterBenchmarkHandoff = useCallback(
    async (adapterId: string) => {
      if (!summary) return;
      const attached = await ensureAdapterRuntimeAttached(adapterId).catch((error) => {
        setMessage(error instanceof Error ? error.message : "Adapter runtime attach failed.");
        setMessageTone("error");
        return null;
      });
      if (!attached) {
        return;
      }
      const plan = buildFineTuneBenchmarkHandoffPlan({
        adapterId,
        summary: attached.summary,
        targetCatalog: attached.targetCatalog
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
          body: JSON.stringify(plan.request)
        });
        const payload = (await response.json()) as AgentBenchmarkResponse & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Benchmark handoff failed.");
        }
        const peerSuffix = plan.referenceTargetLabel ? ` ${plan.referenceTargetLabel}` : "";
        setMessage(
          `${text.handoffBenchmarkSuccess}${peerSuffix ? ` ${locale.startsWith("en") ? "Reference:" : "参考目标："}${peerSuffix}` : ""}`
        );
        setMessageTone("success");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Benchmark handoff failed.");
        setMessageTone("error");
      } finally {
        setActionPending((current) => ({ ...current, [actionKey]: false }));
      }
    },
    [ensureAdapterRuntimeAttached, locale, summary, text.handoffBenchmarkSuccess, text.handoffMissingContext]
  );

  const runAdapterCompareHandoff = useCallback(
    async (adapterId: string) => {
      if (!summary) return;
      const attached = await ensureAdapterRuntimeAttached(adapterId).catch((error) => {
        setMessage(error instanceof Error ? error.message : "Adapter runtime attach failed.");
        setMessageTone("error");
        return null;
      });
      if (!attached) {
        return;
      }
      const plan = buildFineTuneCompareHandoffPlan({
        adapterId,
        summary: attached.summary,
        targetCatalog: attached.targetCatalog
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
            requestId: crypto.randomUUID()
          })
        });
        const payload = (await response.json()) as AgentCompareResponse & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Compare handoff failed.");
        }
        setMessage(
          `${text.handoffCompareSuccess} ${payload.results.filter((lane) => lane.ok).length}/${payload.results.length} ${locale.startsWith("en") ? "lanes returned output." : "个 lane 返回了结果。"}`
        );
        setMessageTone("success");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Compare handoff failed.");
        setMessageTone("error");
      } finally {
        setActionPending((current) => ({ ...current, [actionKey]: false }));
      }
    },
    [ensureAdapterRuntimeAttached, locale, summary, text.handoffCompareSuccess, text.handoffMissingContext]
  );

  const canSaveDataset = Boolean(datasetForm.label.trim() && datasetForm.sourcePath.trim() && datasetValidation?.ok);
  const selectedRecipe = summary?.recipes.find((recipe) => recipe.id === selectedRecipeId) || null;
  const recipeById = useMemo(
    () => new Map((summary?.recipes || []).map((recipe) => [recipe.id, recipe])),
    [summary?.recipes]
  );
  const targetById = useMemo(
    () => new Map((summary?.localTargets || []).map((target) => [target.id, target])),
    [summary?.localTargets]
  );
  const getDatasetWatchDraft = useCallback(
    (dataset: AgentFineTuneDataset) =>
      datasetWatchDrafts[dataset.id] || {
        upstreamQuery: dataset.upstreamQuery || dataset.label,
        refreshCadenceHours: dataset.refreshCadenceHours || 24
      },
    [datasetWatchDrafts]
  );

  const getJobSourceUrl = useCallback(
    (job: AgentFineTuneJob) => {
      const recipe = recipeById.get(job.recipeId);
      return recipe?.baseTargetId ? targetById.get(recipe.baseTargetId)?.sourceUrl : undefined;
    },
    [recipeById, targetById]
  );

  return (
    <div className="rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.9),rgba(2,6,23,0.94))] p-5 shadow-[0_24px_80px_rgba(2,6,23,0.45)]">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">{text.eyebrow}</p>
          <h3 className="mt-2 text-xl font-semibold text-white">{text.title}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{text.subtitle}</p>
          <p className="mt-3 text-xs text-slate-500">
            {text.dataDir}: <span className="text-slate-300">{summary?.dataDir || "--"}</span>
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
          <p className="text-sm font-semibold text-white">{text.datasetTitle}</p>
          <p className="mt-2 text-xs leading-6 text-slate-500">{text.datasetHint}</p>
          <div className="mt-4 space-y-3">
            <input
              value={datasetForm.label}
              onChange={(event) => setDatasetForm((current) => ({ ...current, label: event.target.value }))}
              placeholder={text.datasetLabel}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
            />
            <input
              value={datasetForm.sourcePath}
              onChange={(event) => setDatasetForm((current) => ({ ...current, sourcePath: event.target.value }))}
              placeholder={text.datasetPath}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
            />
            <select
              value={datasetForm.format}
              onChange={(event) => setDatasetForm((current) => ({ ...current, format: event.target.value as AgentFineTuneDatasetFormat }))}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="chat-jsonl">chat-jsonl</option>
              <option value="instruction-jsonl">instruction-jsonl</option>
            </select>
            <input
              value={datasetForm.upstreamQuery}
              onChange={(event) => setDatasetForm((current) => ({ ...current, upstreamQuery: event.target.value }))}
              placeholder={text.upstreamQuery}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
            />
            <input
              value={datasetForm.refreshCadenceHours}
              onChange={(event) =>
                setDatasetForm((current) => ({
                  ...current,
                  refreshCadenceHours: Number(event.target.value) || current.refreshCadenceHours
                }))
              }
              placeholder={text.refreshCadence}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void postAction({ action: "validate-dataset", ...datasetForm }, text.validated)}
                className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
              >
                {text.datasetValidate}
              </button>
              <button
                type="button"
                disabled={!canSaveDataset}
                onClick={async () => {
                  const payload = await postAction({ action: "save-dataset", ...datasetForm }, text.saveSuccessDataset);
                  if (payload?.summary?.datasets?.[0]) {
                    setRecipeForm((current) => ({ ...current, datasetId: payload.summary?.datasets?.[0]?.id || current.datasetId }));
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
                <span className={`rounded-full px-2.5 py-1 ${datasetValidation.ok ? "bg-emerald-400/15 text-emerald-100" : "bg-rose-400/15 text-rose-100"}`}>
                  {datasetValidation.ok ? "OK" : "FAILED"}
                </span>
                <span>{datasetValidation.format}</span>
                <span>{datasetValidation.sampleCount} samples</span>
              </div>
              {datasetValidation.preview.length ? (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{text.preview}</p>
                  <div className="mt-2 space-y-2">
                    {datasetValidation.preview.map((item) => (
                      <div key={`preview:${item.index}`} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">#{item.index}</p>
                        <p className="mt-2 text-xs leading-6 text-slate-200">{item.inputPreview}</p>
                        <p className="mt-2 text-xs leading-6 text-cyan-100">{item.outputPreview}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {datasetValidation.warnings.length ? (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200">{text.warnings}</p>
                  <ul className="mt-2 space-y-1 text-xs leading-6 text-amber-100">
                    {datasetValidation.warnings.map((warning) => (
                      <li key={warning}>- {warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {datasetValidation.errors.length ? (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-rose-200">{text.errors}</p>
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
          <p className="mt-2 text-xs leading-6 text-slate-500">{text.recipeHint}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <input
              value={recipeForm.label}
              onChange={(event) => setRecipeForm((current) => ({ ...current, label: event.target.value }))}
              placeholder={text.recipeLabel}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
            />
            <select
              value={recipeForm.datasetId}
              onChange={(event) => setRecipeForm((current) => ({ ...current, datasetId: event.target.value }))}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="">{text.datasets}</option>
              {(summary?.datasets || []).map((dataset) => (
                <option key={dataset.id} value={dataset.id}>{dataset.label}</option>
              ))}
            </select>
            <select
              value={recipeForm.baseTargetId}
              onChange={(event) => setRecipeForm((current) => ({ ...current, baseTargetId: event.target.value }))}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="">{text.baseTarget}</option>
              {(summary?.localTargets || []).map((target) => (
                <option key={target.id} value={target.id}>{target.label}</option>
              ))}
            </select>
            <input
              value={recipeForm.adapterName}
              onChange={(event) => setRecipeForm((current) => ({ ...current, adapterName: event.target.value }))}
              placeholder={text.adapterName}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                value={recipeForm.fineTuneMethod}
                onChange={(event) =>
                  setRecipeForm((current) => ({
                    ...current,
                    fineTuneMethod: event.target.value as "lora" | "dora"
                  }))
                }
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="lora">{text.fineTuneMethod} · LoRA</option>
                <option value="dora">{text.fineTuneMethod} · DoRA</option>
              </select>
              <select
                value={recipeForm.optimizer}
                onChange={(event) =>
                  setRecipeForm((current) => ({
                    ...current,
                    optimizer: event.target.value as "adam" | "adamw" | "sgd" | "adafactor"
                  }))
                }
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="adamw">{text.optimizer} · AdamW</option>
                <option value="adam">{text.optimizer} · Adam</option>
                <option value="sgd">{text.optimizer} · SGD</option>
                <option value="adafactor">{text.optimizer} · Adafactor</option>
              </select>
              <input
                value={recipeForm.sequenceLength}
                onChange={(event) => setRecipeForm((current) => ({ ...current, sequenceLength: Number(event.target.value) || current.sequenceLength }))}
                placeholder={text.sequenceLength}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                value={recipeForm.batchSize}
                onChange={(event) => setRecipeForm((current) => ({ ...current, batchSize: Number(event.target.value) || current.batchSize }))}
                placeholder={text.batchSize}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                value={recipeForm.epochs}
                onChange={(event) => setRecipeForm((current) => ({ ...current, epochs: Number(event.target.value) || current.epochs }))}
                placeholder={text.epochs}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                value={recipeForm.learningRate}
                onChange={(event) => setRecipeForm((current) => ({ ...current, learningRate: Number(event.target.value) || current.learningRate }))}
                placeholder={text.learningRate}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                value={recipeForm.numLayers}
                onChange={(event) => setRecipeForm((current) => ({ ...current, numLayers: Number(event.target.value) || current.numLayers }))}
                placeholder={text.numLayers}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                value={recipeForm.gradientAccumulationSteps}
                onChange={(event) =>
                  setRecipeForm((current) => ({
                    ...current,
                    gradientAccumulationSteps: Number(event.target.value) || current.gradientAccumulationSteps
                  }))
                }
                placeholder={text.gradientAccumulationSteps}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                value={recipeForm.loraRank}
                onChange={(event) => setRecipeForm((current) => ({ ...current, loraRank: Number(event.target.value) || current.loraRank }))}
                placeholder={text.loraRank}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                value={recipeForm.loraAlpha}
                onChange={(event) => setRecipeForm((current) => ({ ...current, loraAlpha: Number(event.target.value) || current.loraAlpha }))}
                placeholder={text.loraAlpha}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                value={recipeForm.validationSplitPct}
                onChange={(event) =>
                  setRecipeForm((current) => ({
                    ...current,
                    validationSplitPct: Number(event.target.value) || current.validationSplitPct
                  }))
                }
                placeholder={text.validationSplitPct}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                value={recipeForm.saveEverySteps}
                onChange={(event) =>
                  setRecipeForm((current) => ({
                    ...current,
                    saveEverySteps: Number(event.target.value) || 0
                  }))
                }
                placeholder={text.saveEverySteps}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                value={recipeForm.seed}
                onChange={(event) => setRecipeForm((current) => ({ ...current, seed: Number(event.target.value) || current.seed }))}
                placeholder={text.seed}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
            </div>
            <input
              value={recipeForm.benchmarkSuiteId}
              onChange={(event) => setRecipeForm((current) => ({ ...current, benchmarkSuiteId: event.target.value }))}
              placeholder={text.benchmarkSuite}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
            />
            <textarea
              value={recipeForm.notes}
              onChange={(event) => setRecipeForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder={text.notes}
              rows={3}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
            />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={recipeForm.gradientCheckpointing}
                onChange={(event) => setRecipeForm((current) => ({ ...current, gradientCheckpointing: event.target.checked }))}
              />
              {text.gradientCheckpointing}
            </label>
            <button
              type="button"
              onClick={async () => {
                const payload = await postAction({ action: "save-recipe", ...recipeForm }, text.saveSuccessRecipe);
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
          <p className="mt-2 text-xs leading-6 text-slate-500">{text.jobHint}</p>
          <div className="mt-4 space-y-3">
            <select
              value={selectedRecipeId}
              onChange={(event) => setSelectedRecipeId(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="">{text.recipes}</option>
              {(summary?.recipes || []).map((recipe) => (
                <option key={recipe.id} value={recipe.id}>{recipe.label}</option>
              ))}
            </select>
            {selectedRecipe ? (
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-xs leading-6 text-slate-300">
                <p className="font-semibold text-white">{selectedRecipe.label}</p>
                <p className="mt-2">{text.adapterName}: {selectedRecipe.adapterName}</p>
                <p>{text.benchmarkSuite}: {selectedRecipe.benchmarkSuiteId || "--"}</p>
                <p>{text.sequenceLength}: {selectedRecipe.sequenceLength}</p>
                <p>{text.fineTuneMethod}: {selectedRecipe.fineTuneMethod}</p>
                <p>{text.optimizer}: {selectedRecipe.optimizer}</p>
              </div>
            ) : null}
            <button
              type="button"
              disabled={!selectedRecipeId}
              onClick={() => void postAction({ action: "stage-job", recipeId: selectedRecipeId }, text.stageSuccess)}
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
            <p className="text-sm font-semibold text-white">{text.localTargets}</p>
            <span className="text-xs text-slate-500">{summary?.localTargets.length || 0}</span>
          </div>
          <div className="mt-3 space-y-3">
            {(summary?.localTargets || []).length ? (
              summary?.localTargets.map((target) => (
                <div key={target.id} className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3 text-xs leading-6 text-slate-300">
                  <p className="font-semibold text-white">{target.label}</p>
                  <p className="mt-1 text-slate-400">{target.modelDefault}</p>
                  <p>{target.parameterScale || "--"} · {target.quantizationLabel || "--"}</p>
                  <p>{target.recommendedContextWindow ? `${Math.round(target.recommendedContextWindow / 1024)}K` : "--"}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {target.sourceUrl ? (
                      <button
                        type="button"
                        onClick={() =>
                          void runSecondaryAction(`target-source:${target.id}`, {
                            action: "open-source-page",
                            targetId: target.id
                          })
                        }
                        className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                      >
                        {actionPending[`target-source:${target.id}`] ? text.loading : text.openSource}
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
            <span className="text-xs text-slate-500">{summary?.datasets.length || 0}</span>
          </div>
          <div className="mt-3 space-y-3">
            {(summary?.datasets || []).length ? (
              summary?.datasets.map((dataset) => (
                <div key={dataset.id} className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3 text-xs leading-6 text-slate-300">
                  <p className="font-semibold text-white">{dataset.label}</p>
                  <p className="mt-1 text-slate-400">{dataset.format} · {dataset.sampleCount} samples</p>
                  <p>{dataset.sourcePath || "--"}</p>
                  <p>{formatDateTime(dataset.updatedAt)}</p>
                  {dataset.sourcePath ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void runSecondaryAction(`dataset-open:${dataset.id}`, {
                            action: "open-path",
                            kind: "dataset-source",
                            id: dataset.id
                          })
                        }
                        className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                      >
                        {actionPending[`dataset-open:${dataset.id}`] ? text.loading : text.openDir}
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
                                refreshCadenceHours: current[dataset.id]?.refreshCadenceHours || draft.refreshCadenceHours
                              }
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
                                upstreamQuery: current[dataset.id]?.upstreamQuery || draft.upstreamQuery,
                                refreshCadenceHours: Number(event.target.value) || draft.refreshCadenceHours
                              }
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
                                  refreshCadenceHours: draft.refreshCadenceHours
                                },
                                text.datasetWatchSave
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
                                  upstreamQuery: draft.upstreamQuery
                                },
                                text.datasetWatchCheck
                              )
                            }
                            className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                          >
                            {text.datasetWatchCheck}
                          </button>
                        </div>
                        <div className="mt-3 space-y-1 text-[11px] text-slate-400">
                          <p>Last check · {formatDateTime(dataset.lastUpstreamCheckedAt)}</p>
                          <p>Next check · {formatDateTime(dataset.nextUpstreamCheckAt)}</p>
                        </div>
                        {dataset.latestUpstreamCandidates?.length ? (
                          <div className="mt-3 space-y-2">
                            {dataset.latestUpstreamCandidates.slice(0, 3).map((candidate) => (
                              <div key={candidate.id} className="rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="font-semibold text-white">{candidate.label}</p>
                                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                                    {candidate.source}
                                  </span>
                                </div>
                                <p className="mt-1 break-all text-[11px] text-slate-500">{candidate.repoId}</p>
                                <p className="mt-2 text-[11px] leading-5 text-slate-300">{candidate.summary}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <a
                                    href={candidate.repoUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-slate-100 transition hover:bg-white/10"
                                  >
                                    source
                                  </a>
                                  {candidate.docsUrl ? (
                                    <a
                                      href={candidate.docsUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-slate-100 transition hover:bg-white/10"
                                    >
                                      docs
                                    </a>
                                  ) : null}
                                  {candidate.paperUrl ? (
                                    <a
                                      href={candidate.paperUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-slate-100 transition hover:bg-white/10"
                                    >
                                      paper
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
            <span className="text-xs text-slate-500">{summary?.jobs.length || 0}</span>
          </div>
          <div className="mt-3 space-y-3">
            {(summary?.jobs || []).length ? (
              summary?.jobs.map((job) => (
                <div key={job.id} className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3 text-xs leading-6 text-slate-300">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{job.adapterName}</p>
                      <p className="mt-1 text-slate-400">{job.baseModelRef || "--"}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${
                      job.status === "completed"
                        ? "bg-emerald-400/10 text-emerald-100"
                        : job.status === "failed"
                          ? "bg-rose-400/10 text-rose-100"
                          : job.status === "running" || job.status === "queued"
                            ? "bg-cyan-400/10 text-cyan-100"
                            : "bg-amber-400/10 text-amber-100"
                    }`}>
                      {job.status}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <p>{text.progress}: {typeof job.progress?.percent === "number" ? `${job.progress.percent}%` : "--"}</p>
                    <p>{text.currentLoss}: {formatNumber(job.progress?.latestTrainLoss)}</p>
                    <p>{text.startedAt}: {formatDateTime(job.startedAt || job.createdAt)}</p>
                    <p>{text.completedAt}: {formatDateTime(job.completedAt)}</p>
                    <p>{text.heartbeat}: {formatDateTime(job.workerHeartbeatAt)}</p>
                    <p>{text.benchmarkSuite}: {job.benchmarkSuiteId || "--"}</p>
                  </div>

                  {job.curve?.length ? (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{text.trainingCurve}</p>
                        <p className="text-[11px] text-slate-500">
                          train {formatNumber(job.progress?.latestTrainLoss)} · val {formatNumber(job.progress?.latestValLoss)}
                        </p>
                      </div>
                      {(() => {
                        const { trainPath, validPath } = buildCurvePath(job);
                        return (
                          <svg viewBox="0 0 280 88" className="mt-3 h-24 w-full rounded-2xl border border-white/10 bg-slate-950/80 p-2">
                            <path d={trainPath} fill="none" stroke="rgb(34 211 238)" strokeWidth="2" />
                            <path d={validPath} fill="none" stroke="rgb(167 139 250)" strokeWidth="2" />
                          </svg>
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
                    <p>{text.bundlePath}: {job.bundlePath}</p>
                    <p>{text.outputDir}: {job.outputDir}</p>
                    <p>{text.configFile}: {job.configFile || "--"}</p>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={job.status === "queued" || job.status === "running"}
                      onClick={() => void postAction({ action: "start-job", id: job.id }, text.startSuccess)}
                      className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition enabled:hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {text.startJob}
                    </button>
                    <button
                      type="button"
                      disabled={job.status !== "queued" && job.status !== "running"}
                      onClick={() => void postAction({ action: "cancel-job", id: job.id }, text.cancelSuccess)}
                      className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-[11px] font-semibold text-rose-100 transition enabled:hover:bg-rose-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {text.cancelJob}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void runSecondaryAction(`job-output:${job.id}`, {
                          action: "open-path",
                          kind: "job-output",
                          id: job.id
                        })
                      }
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                    >
                      {actionPending[`job-output:${job.id}`] ? text.loading : text.openDir}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void runSecondaryAction(`job-bundle:${job.id}`, {
                          action: "open-path",
                          kind: "job-bundle",
                          id: job.id
                        })
                      }
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                    >
                      {actionPending[`job-bundle:${job.id}`] ? text.loading : text.openBundle}
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
                        void runSecondaryAction(`job-source:${job.id}`, {
                          action: "open-source-page",
                          id: job.id
                        })
                      }
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionPending[`job-source:${job.id}`] ? text.loading : text.openSource}
                    </button>
                  </div>

                  {job.recentLogLines?.length ? (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{text.workerLog}</p>
                      <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-300">
                        {job.recentLogLines.join("\n")}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">{text.empty}</p>
            )}
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">{text.adapters}</p>
            <span className="text-xs text-slate-500">{summary?.adapters.length || 0}</span>
          </div>
          <div className="mt-3 space-y-3">
            {(summary?.adapters || []).length ? (
              summary?.adapters.map((adapter) => (
                <div key={adapter.id} className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3 text-xs leading-6 text-slate-300">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{adapter.adapterName}</p>
                      <p className="mt-1 text-slate-400">{adapter.baseTargetLabel || "--"}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${
                      adapter.status === "ready"
                        ? "bg-emerald-400/10 text-emerald-100"
                        : adapter.status === "checkpointing"
                          ? "bg-cyan-400/10 text-cyan-100"
                          : "bg-amber-400/10 text-amber-100"
                    }`}>
                      {adapter.status}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <p>{text.checkpointCount}: {adapter.checkpointCount}</p>
                    <p>{text.latestCheckpoint}: {formatDateTime(adapter.latestCheckpointAt)}</p>
                    <p>{text.outputDir}: {adapter.outputDir}</p>
                    <p>{text.benchmarkSuite}: {adapter.benchmarkSuiteId || "--"}</p>
                    <p>{text.runtimeAttached}: {adapter.attachedTargetLabel || "--"}</p>
                    <p>{text.attachedAt}: {formatDateTime(adapter.attachedAt)}</p>
                  </div>
                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{text.adapterArtifacts}</p>
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
                      disabled={adapter.status !== "ready" || Boolean(actionPending[`adapter-attach:${adapter.id}`])}
                      onClick={() => void attachAdapterRuntime(adapter.id)}
                      className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition enabled:hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionPending[`adapter-attach:${adapter.id}`] ? text.loading : text.attachRuntime}
                    </button>
                    <button
                      type="button"
                      disabled={adapter.status !== "ready" || Boolean(actionPending[`adapter-benchmark:${adapter.id}`])}
                      onClick={() => void runAdapterBenchmarkHandoff(adapter.id)}
                      className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 transition enabled:hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionPending[`adapter-benchmark:${adapter.id}`] ? text.loading : text.sendToBenchmark}
                    </button>
                    <button
                      type="button"
                      disabled={adapter.status !== "ready" || Boolean(actionPending[`adapter-compare:${adapter.id}`])}
                      onClick={() => void runAdapterCompareHandoff(adapter.id)}
                      className="rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition enabled:hover:bg-violet-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionPending[`adapter-compare:${adapter.id}`] ? text.loading : text.sendToCompare}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void runSecondaryAction(`adapter-open:${adapter.id}`, {
                          action: "open-path",
                          kind: "adapter-output",
                          id: adapter.id
                        })
                      }
                      className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                    >
                      {actionPending[`adapter-open:${adapter.id}`] ? text.loading : text.openDir}
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
                          void runSecondaryAction(`adapter-source:${adapter.id}`, {
                            action: "open-source-page",
                            adapterId: adapter.id
                          })
                        }
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                      >
                        {actionPending[`adapter-source:${adapter.id}`] ? text.loading : text.openSource}
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
