"use client";

import Link from "next/link";
import { useLocale } from "@/components/layout/LocaleProvider";

const copy = {
  en: {
    badge: "Open-source local-first LLM studio",
    title: "First LLM Studio",
    subtitle:
      "Run local MLX models, remote APIs, benchmark operations, compare workflows, replay, trace review, and runtime recovery from one Apple Silicon control room.",
    introTitle: "Why builders care",
    introBody:
      "This project is for people who need more than a chat shell: local AI builders, agent teams, and evaluation engineers who want one workspace for experiments, comparisons, and operations.",
    agentCta: "Open Agent Workbench",
    adminCta: "Open Admin Dashboard",
    githubCta: "GitHub Repository",
    metricsTitle: "Current release signals",
    metricsVersion: "Current stable node",
    metric1: "DeepSeek focused regression",
    metric1Value: "26 / 26",
    metric1Body: "tool-first and thinking focus suite now passes end to end",
    metric2: "Remote regression subset",
    metric2Value: "104 / 104",
    metric2Body: "OpenAI, Claude, and provider-specific policies validated",
    metric3: "Local runtime telemetry",
    metric3Value: "Live",
    metric3Body: "CPU, RSS, GPU, shared GPU memory, energy, and storage pressure tracked in /admin",
    highlightsTitle: "What makes it useful",
    highlight1Title: "One catalog for local and remote targets",
    highlight1Body:
      "Compare MLX local models, OpenAI-compatible APIs, and Claude-compatible APIs without splitting the workflow.",
    highlight2Title: "Built for experiments that need evidence",
    highlight2Body:
      "Replay, trace review, run notes, benchmark handoff, and compare exports keep decisions auditable.",
    highlight3Title: "Operations stay inside the product",
    highlight3Body:
      "Prewarm, release, restart, health checks, model scans, and local telemetry are part of the same control surface.",
    audienceTitle: "Who it helps",
    audienceBody:
      "First LLM Studio is designed for local AI builders, agent product teams, and platform engineers who need to compare behavior, not just prompt outputs.",
    audience1Title: "Apple Silicon local AI teams",
    audience1Body: "Decide which local models are truly production-usable and keep hardware cost visible while you work.",
    audience2Title: "Agent and tooling teams",
    audience2Body: "Validate tool loops, repo grounding, replay traces, and output contracts before changing defaults.",
    audience3Title: "Benchmark and platform owners",
    audience3Body: "Run formal or focused suites, review baselines and regressions, then turn findings into repeatable operating notes.",
    bilingualTitle: "Bilingual by default",
    bilingualBody:
      "The GitHub docs, homepage messaging, and launch materials are maintained in both English and Simplified Chinese for wider open-source reach."
  },
  zh: {
    badge: "开源的本地优先 LLM 工作台",
    title: "First LLM Studio",
    subtitle:
      "把本地 MLX 模型、远端 API、benchmark 运维、Compare 对比、replay、trace review 和 runtime recovery 收到同一个 Apple Silicon 控制台里。",
    introTitle: "为什么值得关注",
    introBody:
      "这个项目面向的不只是聊天场景，而是本地 AI 开发者、Agent 团队和评测平台工程师：他们需要把实验、对比和运维放在同一个工作台里。",
    agentCta: "打开 Agent 工作台",
    adminCta: "打开后台面板",
    githubCta: "查看 GitHub 仓库",
    metricsTitle: "当前版本信号",
    metricsVersion: "当前稳定节点",
    metric1: "DeepSeek 专项回归",
    metric1Value: "26 / 26",
    metric1Body: "tool-first 与 thinking 专项套件现已全链路通过",
    metric2: "远端回归子集",
    metric2Value: "104 / 104",
    metric2Body: "OpenAI、Claude 与 provider-specific 策略已验证",
    metric3: "本地 runtime 观测",
    metric3Value: "实时",
    metric3Body: "在 /admin 中可查看 CPU、RSS、GPU、共享显存、能耗和存储压力",
    highlightsTitle: "核心价值",
    highlight1Title: "本地与远端统一 target catalog",
    highlight1Body: "在同一工作流里对比 MLX 本地模型、OpenAI-compatible API 和 Claude-compatible API。",
    highlight2Title: "实验结果带证据链",
    highlight2Body: "replay、trace review、run note、benchmark handoff 与 compare 导出，让决策可复核。",
    highlight3Title: "运维能力直接内置",
    highlight3Body: "prewarm、release、restart、自检、扫描新模型和本地 telemetry，都在同一个控制面里。",
    audienceTitle: "对哪些用户有价值",
    audienceBody:
      "First LLM Studio 适合本地 AI 开发者、Agent 产品团队和平台工程师，他们关心的不只是 prompt 回答，而是模型在真实工作流里的行为。",
    audience1Title: "Apple Silicon 本地 AI 团队",
    audience1Body: "判断哪些本地模型真的能进入日常生产流，同时把硬件开销保持可见。",
    audience2Title: "Agent 与工具链团队",
    audience2Body: "在改默认配置之前，先验证工具循环、repo grounding、replay trace 和输出契约。",
    audience3Title: "Benchmark 与平台负责人",
    audience3Body: "跑 formal 或 focused benchmark，回看 baseline 和回归，再把结论变成可复用的运行记录。",
    bilingualTitle: "默认支持中英文",
    bilingualBody:
      "GitHub README、首页介绍和首发宣传材料都维护中英文两套版本，更适合面向国际和中文开发者一起发布。"
  }
} as const;

export default function Page() {
  const { locale } = useLocale();
  const t = locale.startsWith("en") ? copy.en : copy.zh;

  return (
    <main className="min-h-[calc(100vh-65px)] bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_24%),radial-gradient(circle_at_bottom_right,#fde68a,transparent_20%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)]">
      <section className="mx-auto flex w-full max-w-[1480px] flex-col gap-12 px-6 py-12 sm:px-10 xl:px-12">
        <div className="grid gap-8 xl:grid-cols-[1.12fr_0.88fr] xl:items-stretch">
          <article className="rounded-[34px] border border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(248,250,252,0.88))] p-7 shadow-[0_32px_90px_rgba(15,23,42,0.12)] sm:p-9">
            <span className="inline-flex rounded-full border border-slate-300/80 bg-white/85 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600 shadow-sm">
              {t.badge}
            </span>
            <div className="mt-6 max-w-4xl space-y-4">
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl xl:text-6xl">
                {t.title}
              </h1>
              <p className="max-w-3xl text-base leading-8 text-slate-600 sm:text-lg">{t.subtitle}</p>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/agent"
                className="rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5"
              >
                {t.agentCta}
              </Link>
              <Link
                href="/admin"
                className="rounded-full border border-slate-300 bg-white/85 px-6 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-400 hover:bg-white"
              >
                {t.adminCta}
              </Link>
              <a
                href="https://github.com/ChrisChen667788/local-agent-lab"
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-slate-300 bg-transparent px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white/70"
              >
                {t.githubCta}
              </a>
            </div>
            <div className="mt-8 rounded-[28px] border border-slate-200/80 bg-slate-950 p-5 text-white shadow-[0_28px_80px_rgba(15,23,42,0.16)]">
              <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.24em] text-slate-400">
                <span>{t.metricsTitle}</span>
                <span>{t.metricsVersion}</span>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {[
                  { title: t.metric1, value: t.metric1Value, body: t.metric1Body, tone: "text-cyan-300" },
                  { title: t.metric2, value: t.metric2Value, body: t.metric2Body, tone: "text-emerald-300" },
                  { title: t.metric3, value: t.metric3Value, body: t.metric3Body, tone: "text-amber-300" }
                ].map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className={`text-xs uppercase tracking-[0.22em] ${item.tone}`}>{item.title}</div>
                    <div className="mt-2 text-3xl font-semibold">{item.value}</div>
                    <div className="mt-2 text-sm leading-7 text-slate-300">{item.body}</div>
                  </div>
                ))}
              </div>
            </div>
          </article>

          <article className="flex flex-col gap-5 rounded-[34px] border border-slate-200/80 bg-white/82 p-6 shadow-[0_28px_80px_rgba(15,23,42,0.1)] backdrop-blur sm:p-7">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">{t.introTitle}</div>
              <p className="mt-4 text-sm leading-8 text-slate-600 sm:text-[15px]">{t.introBody}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              {[
                { title: t.highlight1Title, body: t.highlight1Body },
                { title: t.highlight2Title, body: t.highlight2Body },
                { title: t.highlight3Title, body: t.highlight3Body }
              ].map((item) => (
                <div key={item.title} className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5">
                  <div className="text-lg font-semibold text-slate-950">{item.title}</div>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.body}</p>
                </div>
              ))}
            </div>
          </article>
        </div>

        <section className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
          <article className="rounded-[32px] border border-slate-200/80 bg-white/80 p-7 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">{t.audienceTitle}</div>
            <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-600">{t.audienceBody}</p>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {[
                { title: t.audience1Title, body: t.audience1Body },
                { title: t.audience2Title, body: t.audience2Body },
                { title: t.audience3Title, body: t.audience3Body }
              ].map((item) => (
                <div key={item.title} className="rounded-[24px] border border-slate-200/80 bg-slate-50/85 p-5">
                  <div className="text-lg font-semibold text-slate-950">{item.title}</div>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.body}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-[32px] border border-slate-900 bg-slate-900 p-7 text-white shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">{t.bilingualTitle}</div>
            <p className="mt-4 text-sm leading-8 text-slate-300">{t.bilingualBody}</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-semibold text-white">GitHub</div>
                <p className="mt-2 text-sm leading-7 text-slate-300">
                  English + Simplified Chinese README, launch notes, release messaging, and repo-facing positioning.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-semibold text-white">ModelScope</div>
                <p className="mt-2 text-sm leading-7 text-slate-300">
                  Bilingual repository packaging, launch headline, target-user framing, and community-friendly showcase copy.
                </p>
              </div>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
