"use client";

import { useEffect, useState } from "react";

type AgentWorkbenchComponent = (typeof import("@/components/agent/AgentWorkbench"))["AgentWorkbench"];

export function AgentPageShell() {
  const [AgentWorkbench, setAgentWorkbench] = useState<AgentWorkbenchComponent | null>(null);

  useEffect(() => {
    let cancelled = false;

    void import("@/components/agent/AgentWorkbench").then((mod) => {
      if (!cancelled) {
        setAgentWorkbench(() => mod.AgentWorkbench);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!AgentWorkbench) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="rounded-[28px] border border-white/10 bg-slate-950/75 px-6 py-8 text-slate-200 shadow-[0_30px_80px_rgba(2,6,23,0.55)]">
          <p className="text-sm uppercase tracking-[0.24em] text-cyan-300">Agent</p>
          <h1 className="mt-3 text-2xl font-semibold text-white">正在加载本地优先编码工作台</h1>
          <p className="mt-3 text-sm leading-7 text-slate-400">
            首屏会先返回这个轻量壳页面，工作台模块会在浏览器侧继续加载。首次进入仍可能较慢，但不会把整个页面请求卡死。
          </p>
        </div>
      </main>
    );
  }

  return <AgentWorkbench />;
}
