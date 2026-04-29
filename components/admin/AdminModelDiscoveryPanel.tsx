"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CommunityModelCandidate,
  CommunityModelInstallCheck,
  CommunityModelDiscoverySummary,
  CommunityModelInstallJob
} from "@/lib/community/types";

type AdminModelDiscoveryPanelProps = {
  locale: string;
};

type ModelDiscoveryResponse = {
  ok?: boolean;
  error?: string;
  summary?: CommunityModelDiscoverySummary;
  job?: CommunityModelInstallJob;
  opened?: {
    jobId: string;
    installDir: string;
    opened: boolean;
  };
};

function formatDateTime(value?: string) {
  if (!value) return "--";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatFootprintGb(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toFixed(value < 10 ? 1 : 0)} GB`;
}

function formatBytes(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "--";
  const gb = value / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
  const mb = value / 1024 ** 2;
  return `${mb.toFixed(mb < 100 ? 1 : 0)} MB`;
}

function recommendationClass(recommendation: CommunityModelCandidate["recommendation"]) {
  if (recommendation === "recommended") {
    return "border-emerald-400/30 bg-emerald-400/12 text-emerald-100";
  }
  if (recommendation === "risky") {
    return "border-amber-300/30 bg-amber-300/12 text-amber-100";
  }
  return "border-rose-300/30 bg-rose-400/12 text-rose-100";
}

function jobStatusClass(status: CommunityModelInstallJob["status"]) {
  if (status === "completed") return "border-emerald-400/30 bg-emerald-400/12 text-emerald-100";
  if (status === "running" || status === "queued") return "border-cyan-300/30 bg-cyan-400/12 text-cyan-100";
  if (status === "cancelled") return "border-amber-300/30 bg-amber-300/12 text-amber-100";
  return "border-rose-300/30 bg-rose-400/12 text-rose-100";
}

function checkStatusClass(status: "pass" | "warn" | "fail") {
  if (status === "pass") return "border-emerald-400/20 bg-emerald-400/10 text-emerald-100";
  if (status === "warn") return "border-amber-300/20 bg-amber-300/10 text-amber-100";
  return "border-rose-300/20 bg-rose-400/10 text-rose-100";
}

function preflightStatusClass(status?: CommunityModelCandidate["preflight"]["status"]) {
  if (status === "ready") return "border-emerald-400/30 bg-emerald-400/12 text-emerald-100";
  if (status === "risky") return "border-amber-300/30 bg-amber-300/12 text-amber-100";
  return "border-rose-300/30 bg-rose-400/12 text-rose-100";
}

function verificationStatusClass(status?: "verified" | "partial" | "missing") {
  if (status === "verified") return "border-emerald-400/30 bg-emerald-400/12 text-emerald-100";
  if (status === "partial") return "border-amber-300/30 bg-amber-300/12 text-amber-100";
  return "border-slate-300/20 bg-white/5 text-slate-200";
}

function artifactKindClass(kind: CommunityModelCandidate["artifactKind"]) {
  if (kind === "weights") return "border-cyan-300/20 bg-cyan-400/10 text-cyan-100";
  if (kind === "code") return "border-violet-300/20 bg-violet-400/10 text-violet-100";
  return "border-amber-300/20 bg-amber-300/10 text-amber-100";
}

function formatSourceLabel(source: CommunityModelCandidate["source"], isEnglish: boolean) {
  if (source === "huggingface") return "Hugging Face";
  if (source === "github") return "GitHub";
  return isEnglish ? "ModelScope" : "魔搭";
}

function formatInstallSupportLabel(
  support: CommunityModelCandidate["installSupport"],
  isEnglish: boolean
) {
  if (isEnglish) {
    if (support === "direct") return "One-click install";
    if (support === "best-effort") return "Best-effort install";
    return "Source page only";
  }
  if (support === "direct") return "可一键安装";
  if (support === "best-effort") return "可尝试安装";
  return "仅来源页";
}

function formatPreflightSummary(
  preflight: CommunityModelCandidate["preflight"] | CommunityModelInstallJob["preflight"],
  isEnglish: boolean
) {
  if (!preflight) return "--";
  if (isEnglish) return preflight.summary;
  if (preflight.status === "ready") return "预检通过，当前机器和安装目录都适合直接安装。";
  if (preflight.status === "risky") return "可以继续安装，但有检查项需要先确认，建议新手先阅读下方提示。";
  return "当前不建议安装，请先处理阻塞项，再重新校验或清理安装目录。";
}

function formatCheckLabel(check: CommunityModelInstallCheck, isEnglish: boolean) {
  if (isEnglish) return check.label;
  if (check.key === "install-support") return "安装方式";
  if (check.key === "install-dir") return "安装目录";
  if (check.key === "memory-fit") return "内存匹配";
  if (check.key === "disk-budget") return "磁盘预算";
  return check.label;
}

function formatCheckSummary(input: {
  check: CommunityModelInstallCheck;
  candidate: CommunityModelCandidate;
  hardware?: CommunityModelDiscoverySummary["hardware"];
  isEnglish: boolean;
}) {
  const { check, candidate, hardware, isEnglish } = input;
  if (isEnglish) return check.summary;
  if (check.key === "install-support") {
    if (candidate.installSupport === "direct") return "已有可靠的一键安装路径，适合直接添加到本地模型库。";
    if (candidate.installSupport === "best-effort") {
      return "可以拉取仓库，但本地权重文件是否完整仍需安装后校验。";
    }
    return "当前只有来源页，建议先打开原仓库确认安装说明。";
  }
  if (check.key === "install-dir") {
    if (check.status === "pass") return `目标目录可用：${candidate.installDir}`;
    return `目标目录已有文件：${candidate.installDir}。如需重装，请先清理安装目录。`;
  }
  if (check.key === "memory-fit") {
    const memory = hardware?.totalMemoryGb ? `${hardware.totalMemoryGb.toFixed(1)} GB` : "当前机器";
    if (check.status === "pass") return `符合 ${memory} 内存预算，适合本机尝试加载。`;
    if (check.status === "warn") return `接近 ${memory} 内存预算，建议降低上下文或优先选择量化版本。`;
    return `超过 ${memory} 内存预算，不建议在本机直接加载。`;
  }
  if (check.key === "disk-budget") {
    return `预计占用 ${formatBytes(candidate.preflight.requiredDiskBytes)}，当前可用 ${formatBytes(candidate.preflight.availableDiskBytes)}。`;
  }
  return check.summary;
}

function formatJobStatusLabel(status: CommunityModelInstallJob["status"], isEnglish: boolean) {
  if (isEnglish) return status;
  if (status === "queued") return "排队中";
  if (status === "running") return "安装中";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  return "失败";
}

export function AdminModelDiscoveryPanel({ locale }: AdminModelDiscoveryPanelProps) {
  const text = useMemo(() => {
    if (locale.startsWith("en")) {
      return {
        eyebrow: "Community model radar",
        title: "One-click model discovery and install",
        subtitle:
          "Scan Hugging Face, GitHub, and ModelScope for recently updated local-friendly models, score them against this machine, then install straight into the shared local model library.",
        refresh: "Refresh",
        scanning: "Scanning...",
        installing: "Installing...",
        queryLabel: "Search keyword",
        queryPlaceholder: "mlx / qwen / gemma / coder",
        scan: "Scan communities",
        hardware: "Hardware fit",
        installRoot: "Install root",
        memoryBudget: "Memory",
        arch: "Architecture",
        candidates: "Candidates",
        installJobs: "Install jobs",
        source: "Source",
        repoType: "Repo type",
        updatedAt: "Updated",
        installSupport: "Install support",
        installDir: "Install dir",
        footprint: "Estimated footprint",
        context: "Recommended context",
        noCandidates: "No candidates yet. Run a scan first.",
        noJobs: "No install jobs yet.",
        install: "Install",
        verifyInstall: "Verify install",
        verifying: "Verifying...",
        retryInstall: "Retry install",
        retrying: "Retrying...",
        cleanInstallDir: "Clean install dir",
        cleaning: "Cleaning...",
        openInstallDir: "Open install dir",
        opening: "Opening...",
        openSource: "Source page",
        openDocs: "Docs",
        openPaper: "Paper",
        discoveredTargets: "Discovered local targets",
        latestMessage: "Latest message",
        preflight: "Preflight",
        verification: "Verification",
        checks: "Checks",
        requiredDisk: "Required disk",
        availableDisk: "Available disk",
        rollback: "Rollback",
        rollbackDone: "Rollback completed after failure.",
        preflightReady: "Ready",
        preflightRisky: "Needs review",
        preflightBlocked: "Blocked",
        verificationVerified: "Verified",
        verificationPartial: "Files only",
        verificationMissing: "Missing",
        artifactWeights: "Weight repo",
        artifactCode: "Code repo",
        artifactDataset: "Dataset repo",
        files: "Files",
        dir: "Dir",
        present: "present",
        missing: "missing",
        recommendationRecommended: "Recommended",
        recommendationRisky: "Risky",
        recommendationNotRecommended: "Not recommended"
      };
    }
    return {
      eyebrow: "社区模型雷达",
      title: "一键发现并安装开源模型",
      subtitle:
        "扫描 Hugging Face、GitHub、魔搭社区里最近更新的本地友好模型，结合当前机器做安装建议，并直接下到共享本地模型库。",
      refresh: "刷新",
      scanning: "扫描中...",
      installing: "安装中...",
      queryLabel: "搜索关键词",
      queryPlaceholder: "mlx / qwen / gemma / coder",
      scan: "扫描社区",
      hardware: "硬件匹配",
      installRoot: "安装目录",
      memoryBudget: "内存预算",
      arch: "架构",
      candidates: "候选模型",
      installJobs: "安装作业",
      source: "来源",
      repoType: "仓库类型",
      updatedAt: "更新时间",
      installSupport: "安装支持",
      installDir: "安装目录",
      footprint: "预估占用",
      context: "建议上下文",
      noCandidates: "还没有候选模型，先跑一次扫描。",
      noJobs: "还没有安装作业。",
      install: "安装",
      verifyInstall: "校验安装",
      verifying: "校验中...",
      retryInstall: "重试安装",
      retrying: "重试中...",
      cleanInstallDir: "清理安装目录",
      cleaning: "清理中...",
      openInstallDir: "打开安装目录",
      opening: "打开中...",
      openSource: "来源页",
      openDocs: "说明页",
      openPaper: "论文",
      discoveredTargets: "发现的本地目标",
      latestMessage: "最新状态",
      preflight: "安装预检",
      verification: "安装校验",
      checks: "检查项",
      requiredDisk: "所需磁盘",
      availableDisk: "可用磁盘",
      rollback: "回滚",
      rollbackDone: "失败后已自动回滚安装目录。",
      preflightReady: "可直接安装",
      preflightRisky: "需人工确认",
      preflightBlocked: "当前阻塞",
      verificationVerified: "已验证",
      verificationPartial: "仅文件落盘",
      verificationMissing: "未找到",
      artifactWeights: "权重仓",
      artifactCode: "代码仓",
      artifactDataset: "数据集仓",
      files: "文件",
      dir: "目录",
      present: "存在",
      missing: "缺失",
      recommendationRecommended: "推荐安装",
      recommendationRisky: "有风险",
      recommendationNotRecommended: "不推荐"
    };
  }, [locale]);

  const [summary, setSummary] = useState<CommunityModelDiscoverySummary | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [query, setQuery] = useState("mlx");
  const [installingId, setInstallingId] = useState("");
  const [verifyingId, setVerifyingId] = useState("");
  const [retryingId, setRetryingId] = useState("");
  const [cleaningId, setCleaningId] = useState("");
  const [openingId, setOpeningId] = useState("");

  const loadSummary = useCallback(async () => {
    setPending(true);
    try {
      const response = await fetch("/api/admin/model-discovery", { cache: "no-store" });
      const payload = (await response.json()) as ModelDiscoveryResponse;
      if (!response.ok || !payload.summary) {
        throw new Error(payload.error || "Failed to load model discovery summary.");
      }
      setSummary(payload.summary);
      setQuery((current) => current || payload.summary?.query || "mlx");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load model discovery summary.");
      setMessageTone("error");
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!summary?.jobs.some((job) => job.status === "queued" || job.status === "running")) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadSummary();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadSummary, summary?.jobs]);

  async function runScan() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/model-discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "scan",
          query
        })
      });
      const payload = (await response.json()) as ModelDiscoveryResponse;
      if (!response.ok || !payload.summary) {
        throw new Error(payload.error || "Failed to scan community models.");
      }
      setSummary(payload.summary);
      setMessageTone("success");
      setMessage(locale.startsWith("en") ? "Community scan complete." : "社区扫描完成。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to scan community models.");
      setMessageTone("error");
    } finally {
      setPending(false);
    }
  }

  async function installCandidate(candidateId: string) {
    setInstallingId(candidateId);
    setMessage("");
    try {
      const response = await fetch("/api/admin/model-discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "install",
          candidateId
        })
      });
      const payload = (await response.json()) as ModelDiscoveryResponse;
      if (!response.ok || !payload.summary) {
        throw new Error(payload.error || "Failed to start model install.");
      }
      setSummary(payload.summary);
      setMessageTone("success");
      setMessage(locale.startsWith("en") ? "Install job started." : "安装作业已启动。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to start model install.");
      setMessageTone("error");
    } finally {
      setInstallingId("");
    }
  }

  async function verifyInstall(jobId: string) {
    setVerifyingId(jobId);
    setMessage("");
    try {
      const response = await fetch("/api/admin/model-discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify-install",
          jobId
        })
      });
      const payload = (await response.json()) as ModelDiscoveryResponse;
      if (!response.ok || !payload.summary) {
        throw new Error(payload.error || "Failed to verify model install.");
      }
      setSummary(payload.summary);
      setMessageTone("success");
      setMessage(locale.startsWith("en") ? "Install verification complete." : "安装校验完成。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to verify model install.");
      setMessageTone("error");
    } finally {
      setVerifyingId("");
    }
  }

  async function runJobAction(
    action: "retry-install" | "clean-install-dir" | "open-install-dir",
    jobId: string
  ) {
    if (action === "retry-install") setRetryingId(jobId);
    if (action === "clean-install-dir") setCleaningId(jobId);
    if (action === "open-install-dir") setOpeningId(jobId);
    setMessage("");
    try {
      const response = await fetch("/api/admin/model-discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, jobId })
      });
      const payload = (await response.json()) as ModelDiscoveryResponse;
      if (!response.ok || !payload.summary) {
        throw new Error(payload.error || "Failed to run install job action.");
      }
      setSummary(payload.summary);
      setMessageTone("success");
      setMessage(
        action === "retry-install"
          ? locale.startsWith("en")
            ? "Install retried."
            : "已重新发起安装。"
          : action === "clean-install-dir"
            ? locale.startsWith("en")
              ? "Install directory cleaned."
              : "安装目录已清理。"
            : locale.startsWith("en")
              ? "Install directory opened."
              : "已打开安装目录。"
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to run install job action.");
      setMessageTone("error");
    } finally {
      setRetryingId("");
      setCleaningId("");
      setOpeningId("");
    }
  }

  return (
    <section className="rounded-[32px] border border-white/10 bg-slate-950/70 p-5 shadow-[0_24px_80px_rgba(2,8,23,0.45)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">{text.eyebrow}</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">{text.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">{text.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadSummary()}
          disabled={pending}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {text.refresh}
        </button>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-3xl border border-cyan-400/15 bg-cyan-400/8 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">{text.hardware}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-cyan-50">
            <span className="rounded-full border border-cyan-300/20 bg-black/20 px-3 py-1.5">
              {text.memoryBudget} · {summary?.hardware.totalMemoryGb?.toFixed(1) || "--"} GB
            </span>
            <span className="rounded-full border border-cyan-300/20 bg-black/20 px-3 py-1.5">
              {text.arch} · {summary?.hardware.platform || "--"} / {summary?.hardware.arch || "--"}
            </span>
            <span className="rounded-full border border-cyan-300/20 bg-black/20 px-3 py-1.5">
              CPU · {summary?.hardware.cpuCount || "--"}
            </span>
          </div>
          <p className="mt-3 text-xs leading-6 text-cyan-50/80">
            {text.installRoot}: {summary?.installRoot || "--"}
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
          <label className="text-xs uppercase tracking-[0.18em] text-slate-400">{text.queryLabel}</label>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={text.queryPlaceholder}
              className="min-w-[220px] flex-1 rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={() => void runScan()}
              disabled={pending}
              className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? text.scanning : text.scan}
            </button>
          </div>
          {message ? (
            <p
              className={`mt-3 text-sm ${
                messageTone === "success" ? "text-emerald-200" : "text-rose-200"
              }`}
            >
              {message}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">{text.candidates}</p>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
              {summary?.candidates.length || 0}
            </span>
          </div>
          {summary?.candidates.length ? (
            <div className="mt-4 grid gap-4 2xl:grid-cols-2">
              {summary.candidates.map((candidate) => (
                <article
                  key={candidate.id}
                  className="group rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.82),rgba(2,6,23,0.9))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:border-cyan-300/20 hover:bg-slate-950/85"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-base font-semibold leading-6 text-white">{candidate.label}</p>
                      <p className="mt-1 truncate text-xs leading-5 text-slate-400">{candidate.repoId}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${artifactKindClass(candidate.artifactKind)}`}>
                          {candidate.artifactKind === "weights"
                            ? text.artifactWeights
                            : candidate.artifactKind === "code"
                              ? text.artifactCode
                              : text.artifactDataset}
                        </span>
                      </div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${recommendationClass(candidate.recommendation)}`}>
                      {candidate.recommendation === "recommended"
                        ? text.recommendationRecommended
                        : candidate.recommendation === "risky"
                          ? text.recommendationRisky
                          : text.recommendationNotRecommended}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-2 text-[11px] text-slate-300 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
                      <p className="uppercase tracking-[0.16em] text-slate-500">{text.source}</p>
                      <p className="mt-1 font-medium text-white">
                        {formatSourceLabel(candidate.source, locale.startsWith("en"))}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
                      <p className="uppercase tracking-[0.16em] text-slate-500">{text.repoType}</p>
                      <p className="mt-1 font-medium text-white">
                        {candidate.artifactKind === "weights"
                          ? text.artifactWeights
                          : candidate.artifactKind === "code"
                            ? text.artifactCode
                            : text.artifactDataset}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
                      <p className="uppercase tracking-[0.16em] text-slate-500">{text.updatedAt}</p>
                      <p className="mt-1 font-medium text-white">{formatDateTime(candidate.updatedAt)}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
                      <p className="uppercase tracking-[0.16em] text-slate-500">{text.installSupport}</p>
                      <p className="mt-1 font-medium text-white">
                        {formatInstallSupportLabel(candidate.installSupport, locale.startsWith("en"))}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
                      <p className="uppercase tracking-[0.16em] text-slate-500">{text.footprint}</p>
                      <p className="mt-1 font-medium text-white">{formatFootprintGb(candidate.estimatedFootprintGb)}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
                      <p className="uppercase tracking-[0.16em] text-slate-500">{text.context}</p>
                      <p className="mt-1 font-medium text-white">
                        {typeof candidate.recommendedContextWindow === "number"
                          ? `${Math.round(candidate.recommendedContextWindow / 1024)}K`
                          : "--"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2 sm:col-span-2">
                      <p className="uppercase tracking-[0.16em] text-slate-500">{text.installDir}</p>
                      <p className="mt-1 line-clamp-2 break-all font-medium text-white">{candidate.installDir}</p>
                    </div>
                  </div>

                  <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-200">{candidate.summary}</p>
                  <p className="mt-2 line-clamp-2 text-xs leading-6 text-slate-400">{candidate.recommendationReason}</p>

                  <div className="mt-4 rounded-3xl border border-white/10 bg-black/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {text.preflight}
                      </p>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${preflightStatusClass(candidate.preflight.status)}`}
                      >
                        {candidate.preflight.status === "ready"
                          ? text.preflightReady
                          : candidate.preflight.status === "risky"
                            ? text.preflightRisky
                            : text.preflightBlocked}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-6 text-slate-300">
                      {formatPreflightSummary(candidate.preflight, locale.startsWith("en"))}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {candidate.preflight.checks.map((check) => (
                        <div
                          key={check.key}
                          className={`min-h-[92px] rounded-2xl border px-3 py-2 text-xs ${checkStatusClass(check.status)}`}
                        >
                          <p className="font-semibold">{formatCheckLabel(check, locale.startsWith("en"))}</p>
                          <p className="mt-1 line-clamp-3 leading-5 opacity-90">
                            {formatCheckSummary({
                              check,
                              candidate,
                              hardware: summary?.hardware,
                              isEnglish: locale.startsWith("en")
                            })}
                          </p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                        {text.requiredDisk} · {formatBytes(candidate.preflight.requiredDiskBytes)}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                        {text.availableDisk} · {formatBytes(candidate.preflight.availableDiskBytes)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {candidate.parameterScale ? (
                      <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-100">
                        Scale · {candidate.parameterScale}
                      </span>
                    ) : null}
                    {candidate.quantizationLabel ? (
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-100">
                        {candidate.quantizationLabel}
                      </span>
                    ) : null}
                    {candidate.tags.slice(0, 5).map((tag) => (
                      <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void installCandidate(candidate.id)}
                      disabled={
                        Boolean(installingId) ||
                        candidate.installSupport === "source-only" ||
                        candidate.preflight.status === "blocked"
                      }
                      className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-50 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {installingId === candidate.id ? text.installing : text.install}
                    </button>
                    <a
                      href={candidate.repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                    >
                      {text.openSource}
                    </a>
                    {candidate.docsUrl ? (
                      <a
                        href={candidate.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                      >
                        {text.openDocs}
                      </a>
                    ) : null}
                    {candidate.paperUrl ? (
                      <a
                        href={candidate.paperUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                      >
                        {text.openPaper}
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{text.noCandidates}</p>
          )}
        </div>

        <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">{text.installJobs}</p>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
              {summary?.jobs.length || 0}
            </span>
          </div>
          {summary?.jobs.length ? (
            <div className="mt-4 space-y-3">
              {summary.jobs.map((job) => (
                <article key={job.id} className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{job.label}</p>
                      <p className="mt-1 break-all text-xs text-slate-400">{job.repoId}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${artifactKindClass(job.artifactKind)}`}>
                          {job.artifactKind === "weights"
                            ? text.artifactWeights
                            : job.artifactKind === "code"
                              ? text.artifactCode
                              : text.artifactDataset}
                        </span>
                      </div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${jobStatusClass(job.status)}`}>
                      {formatJobStatusLabel(job.status, locale.startsWith("en"))}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2 text-xs leading-6 text-slate-300">
                    <p>
                      <span className="text-slate-500">{text.updatedAt}</span>
                      <span className="ml-2 text-white">{formatDateTime(job.updatedAt)}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">{text.installDir}</span>
                      <span className="ml-2 break-all text-white">{job.installDir}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">{text.latestMessage}</span>
                      <span className="ml-2 text-white">{job.errorMessage || job.latestMessage || "--"}</span>
                    </p>
                    {job.preflight ? (
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            {text.preflight}
                          </p>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${preflightStatusClass(job.preflight.status)}`}
                          >
                            {job.preflight.status === "ready"
                              ? text.preflightReady
                              : job.preflight.status === "risky"
                                ? text.preflightRisky
                                : text.preflightBlocked}
                          </span>
                        </div>
                        <p className="mt-2 leading-6 text-slate-300">
                          {formatPreflightSummary(job.preflight, locale.startsWith("en"))}
                        </p>
                      </div>
                    ) : null}
                    {job.verification ? (
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            {text.verification}
                          </p>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${verificationStatusClass(job.verification.status)}`}
                          >
                            {job.verification.status === "verified"
                              ? text.verificationVerified
                              : job.verification.status === "partial"
                                ? text.verificationPartial
                                : text.verificationMissing}
                          </span>
                        </div>
                        <p className="mt-2 leading-6 text-slate-300">{job.verification.summary}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-300">
                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                            {text.files} · {job.verification.installedFileCount}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                            {text.dir} · {job.verification.installDirExists ? text.present : text.missing}
                          </span>
                        </div>
                      </div>
                    ) : null}
                    {job.rollbackPerformed ? (
                      <p className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-amber-100">
                        {text.rollback} · {text.rollbackDone}
                      </p>
                    ) : null}
                    {job.discoveredTargetIds?.length ? (
                      <div>
                        <p className="text-slate-500">{text.discoveredTargets}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {job.discoveredTargetIds.map((targetId) => (
                            <span key={targetId} className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-100">
                              {targetId}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void runJobAction("open-install-dir", job.id)}
                      disabled={openingId === job.id}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {openingId === job.id ? text.opening : text.openInstallDir}
                    </button>
                    <a
                      href={job.repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                    >
                      {text.openSource}
                    </a>
                    <button
                      type="button"
                      onClick={() => void verifyInstall(job.id)}
                      disabled={
                        verifyingId === job.id ||
                        (job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled")
                      }
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {verifyingId === job.id ? text.verifying : text.verifyInstall}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runJobAction("retry-install", job.id)}
                      disabled={retryingId === job.id || job.status === "queued" || job.status === "running"}
                      className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-50 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {retryingId === job.id ? text.retrying : text.retryInstall}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runJobAction("clean-install-dir", job.id)}
                      disabled={cleaningId === job.id || job.status === "queued" || job.status === "running"}
                      className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-[11px] font-semibold text-amber-100 transition hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {cleaningId === job.id ? text.cleaning : text.cleanInstallDir}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{text.noJobs}</p>
          )}
        </div>
      </div>
    </section>
  );
}
