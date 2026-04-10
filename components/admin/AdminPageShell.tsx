"use client";

import { useEffect, useState } from "react";

type AdminDashboardComponent = (typeof import("@/components/admin/AdminDashboard"))["AdminDashboard"];

export function AdminPageShell() {
  const [AdminDashboard, setAdminDashboard] = useState<AdminDashboardComponent | null>(null);

  useEffect(() => {
    let cancelled = false;

    void import("@/components/admin/AdminDashboard").then((mod) => {
      if (!cancelled) {
        setAdminDashboard(() => mod.AdminDashboard);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!AdminDashboard) {
    return (
      <main className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.14),_transparent_26%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] px-3 py-4 text-slate-100 sm:px-5 xl:px-6 2xl:px-8">
        <div className="mx-auto w-full max-w-[1960px] space-y-4">
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px_220px_220px_220px]">
              <div className="space-y-4">
                <div className="h-12 rounded-2xl bg-black/20" />
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="h-4 w-52 rounded-full bg-white/10" />
                  <div className="mt-4 space-y-2">
                    {[0, 1, 2, 3, 4].map((index) => (
                      <div key={index} className="h-10 rounded-full bg-slate-950/70" />
                    ))}
                  </div>
                </div>
              </div>
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="space-y-4">
                  <div className="h-12 rounded-2xl bg-black/20" />
                  <div className="h-12 rounded-2xl bg-black/20" />
                  <div className="h-12 rounded-2xl bg-black/20" />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-slate-950/75 p-5 shadow-[0_30px_80px_rgba(2,6,23,0.55)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">后台</p>
                <h1 className="mt-2 text-3xl font-semibold text-white">监控与 Benchmark 后台</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">正在加载 Benchmark 表单、进度、历史与运行时面板…</p>
              </div>
              <div className="flex flex-wrap gap-3">
                {[0, 1, 2, 3].map((index) => (
                  <span key={index} className="h-10 w-28 rounded-full border border-white/10 bg-black/25" />
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 px-4 py-4">
            <div className="h-4 w-32 rounded-full bg-cyan-400/20" />
            <div className="mt-4 h-2 rounded-full bg-white/10" />
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-16 rounded-2xl bg-white/[0.04]" />
              ))}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <div className="h-4 w-32 rounded-full bg-white/10" />
              <div className="mt-4 h-64 rounded-2xl bg-black/20" />
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <div className="h-4 w-32 rounded-full bg-white/10" />
              <div className="mt-4 h-64 rounded-2xl bg-black/20" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return <AdminDashboard />;
}
