"use client";

import { FormEvent, useEffect, useState } from "react";
import { agentTargets } from "@/lib/agent/catalog";
import type { AgentBenchmarkResponse } from "@/lib/agent/types";

const SUITE_OPTIONS = [
  { id: "daily-regression", label: "日常回归" },
  { id: "weekly-regression", label: "周级回归" },
  { id: "milestone-formal", label: "正式报告版" },
  { id: "milestone-full", label: "全量版" }
];

export function AdminRescueConsole() {
  const [targetId, setTargetId] = useState("local-qwen3-0.6b");
  const [suiteId, setSuiteId] = useState("milestone-formal");
  const [contextWindow, setContextWindow] = useState(8192);
  const [runs, setRuns] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AgentBenchmarkResponse | null>(null);

  useEffect(() => {
    setTargetId((current) =>
      agentTargets.some((target) => target.id === current) ? current : agentTargets[0]?.id || ""
    );
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setResult(null);

    try {
      const next = await fetch("/api/admin/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetIds: [targetId],
          benchmarkMode: "suite",
          suiteId,
          runs,
          contextWindow,
          maxTokens: 128,
          providerProfile: "balanced",
          thinkingMode: "standard"
        })
      });
      const data = (await next.json()) as AgentBenchmarkResponse & { error?: string };
      if (!next.ok) {
        throw new Error(data.error || "Benchmark failed");
      }
      setResult(data);
    } catch (benchmarkError) {
      setError(benchmarkError instanceof Error ? benchmarkError.message : "Benchmark failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#1c2438,_#020617_55%)] px-4 py-8 text-slate-100 sm:px-6">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <section className="rounded-[28px] border border-white/10 bg-slate-950/80 p-6 shadow-[0_30px_80px_rgba(2,6,23,0.55)]">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">Admin Rescue Console</p>
          <h1 className="mt-3 text-3xl font-semibold text-white">稳定 Benchmark 入口</h1>
          <p className="mt-3 text-sm leading-7 text-slate-400">
            这里优先保证 benchmark 能发起和拿到结果。正常后台已恢复到
            <a className="ml-2 text-cyan-300 underline" href="/admin">
              /admin
            </a>
            。
          </p>
        </section>

        <section className="rounded-[24px] border border-white/10 bg-slate-950/75 p-5">
          <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={handleSubmit}>
            <label className="text-sm text-slate-300">
              测试目标
              <select
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white"
              >
                {agentTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-300">
              评测集
              <select
                value={suiteId}
                onChange={(event) => setSuiteId(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white"
              >
                {SUITE_OPTIONS.map((suite) => (
                  <option key={suite.id} value={suite.id}>
                    {suite.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-300">
              上下文体量
              <select
                value={contextWindow}
                onChange={(event) => setContextWindow(Number(event.target.value))}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white"
              >
                {[4096, 8192, 16384, 32768].map((option) => (
                  <option key={option} value={option}>
                    {Math.floor(option / 1024)}K
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-300">
              采样次数
              <input
                type="number"
                min={1}
                max={5}
                value={runs}
                onChange={(event) => setRuns(Number(event.target.value))}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white"
              />
            </label>
            <div className="md:col-span-2 xl:col-span-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={pending}
                className="rounded-full bg-cyan-400 px-6 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "运行中..." : "开始 Benchmark"}
              </button>
              {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            </div>
          </form>
        </section>

        <section className="rounded-[24px] border border-white/10 bg-slate-950/75 p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">结果</p>
          {result ? (
            <div className="mt-4 space-y-4 text-sm text-slate-200">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Run ID</p>
                  <p className="mt-2 break-all text-sm">{result.runId || "--"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Suite</p>
                  <p className="mt-2 text-sm">{result.suiteLabel || "--"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Workloads</p>
                  <p className="mt-2 text-sm">{result.suiteWorkloadCount || 0}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">时间</p>
                  <p className="mt-2 text-sm">{result.generatedAt}</p>
                </div>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/80">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-white/5 text-slate-400">
                    <tr>
                      <th className="px-4 py-3">目标</th>
                      <th className="px-4 py-3">上下文</th>
                      <th className="px-4 py-3">成功</th>
                      <th className="px-4 py-3">首字</th>
                      <th className="px-4 py-3">总耗时</th>
                      <th className="px-4 py-3">吞吐</th>
                      <th className="px-4 py-3">通过率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((item) => (
                      <tr key={`${item.targetId}:${item.providerProfile || "na"}:${item.thinkingMode || "na"}`} className="border-t border-white/10">
                        <td className="px-4 py-3">{item.targetLabel}</td>
                        <td className="px-4 py-3">{Math.floor(item.contextWindow / 1024)}K</td>
                        <td className="px-4 py-3">
                          {item.okRuns}/{item.runs}
                        </td>
                        <td className="px-4 py-3">{item.avgFirstTokenLatencyMs.toFixed(1)} ms</td>
                        <td className="px-4 py-3">{item.avgLatencyMs.toFixed(1)} ms</td>
                        <td className="px-4 py-3">{item.avgTokenThroughputTps.toFixed(2)} tok/s</td>
                        <td className="px-4 py-3">{item.passRate == null ? "--" : `${item.passRate.toFixed(2)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">提交 benchmark 后，这里会显示简化结果汇总。</p>
          )}
        </section>
      </div>
    </main>
  );
}
