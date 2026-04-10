"use client";

import { useEffect, useState } from "react";

type AgentWorkbenchComponent = (typeof import("@/components/agent/AgentWorkbench"))["AgentWorkbench"];

export function AgentPageShell() {
  const [AgentWorkbench, setAgentWorkbench] = useState<AgentWorkbenchComponent | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let idleCallbackId: number | null = null;

    const loadWorkbench = () => {
      void import("@/components/agent/AgentWorkbench").then((mod) => {
        if (!cancelled) {
          setAgentWorkbench(() => mod.AgentWorkbench);
        }
      });
    };

    const requestIdle = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (typeof requestIdle.requestIdleCallback === "function") {
      idleCallbackId = requestIdle.requestIdleCallback(loadWorkbench, { timeout: 1200 });
    } else {
      timeoutId = window.setTimeout(loadWorkbench, 180);
    }

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (idleCallbackId !== null && typeof requestIdle.cancelIdleCallback === "function") {
        requestIdle.cancelIdleCallback(idleCallbackId);
      }
    };
  }, []);

  if (!AgentWorkbench) {
    return (
      <main className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.14),_transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(249,115,22,0.14),_transparent_28%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] px-3 py-4 text-slate-100 sm:px-5 xl:px-6 2xl:px-8">
        <div className="mx-auto grid w-full max-w-[1960px] gap-5 xl:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[400px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/70 shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur">
            <div className="border-b border-white/10 px-5 py-4">
              <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-300">AGENT SHELL</p>
              <h1 className="mt-2 text-2xl font-semibold text-white">本地优先编码工作台</h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">正在加载目标模型列表与工作台布局…</p>
            </div>
            <div className="space-y-3 px-4 py-4">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <div className="h-4 w-32 rounded-full bg-white/10" />
                  <div className="mt-3 h-3 w-24 rounded-full bg-white/10" />
                  <div className="mt-4 space-y-2">
                    <div className="h-3 w-full rounded-full bg-white/10" />
                    <div className="h-3 w-5/6 rounded-full bg-white/10" />
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <div className="min-w-0 overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/75 shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur">
            <header className="border-b border-white/10 px-5 py-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="h-6 w-44 rounded-full bg-cyan-400/10" />
                    <span className="h-6 w-36 rounded-full bg-white/5" />
                    <span className="h-6 w-16 rounded-full bg-white/5" />
                  </div>
                  <div className="mt-4 h-10 w-48 rounded-2xl bg-white/10" />
                  <div className="mt-3 h-4 w-3/4 rounded-full bg-white/10" />
                </div>
                <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[360px]">
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                      <div className="h-3 w-12 rounded-full bg-white/10" />
                      <div className="mt-3 h-8 w-10 rounded-xl bg-white/10" />
                    </div>
                  ))}
                </div>
              </div>
            </header>
            <div className="border-b border-white/10 bg-black/20 px-5 py-3">
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <span key={index} className="h-8 w-28 rounded-full border border-white/10 bg-white/5" />
                ))}
              </div>
            </div>
            <div className="grid xl:grid-cols-[minmax(0,1.24fr)_400px] 2xl:grid-cols-[minmax(0,1.42fr)_460px]">
              <div className="border-b border-white/10 px-5 py-5 xl:border-b-0 xl:border-r xl:border-white/10">
                <div className="space-y-3">
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="h-11 w-full rounded-full border border-white/10 bg-white/[0.03]" />
                  ))}
                </div>
                <div className="mt-5 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="h-5 w-24 rounded-full bg-cyan-400/10" />
                  <div className="mt-4 h-48 rounded-2xl bg-black/20" />
                  <div className="mt-4 h-24 rounded-3xl bg-black/20" />
                </div>
              </div>
              <aside className="space-y-4 bg-white/[0.03] px-5 py-4">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <div className="h-3 w-24 rounded-full bg-white/10" />
                    <div className="mt-4 h-20 rounded-2xl bg-white/5" />
                  </div>
                ))}
              </aside>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return <AgentWorkbench />;
}
