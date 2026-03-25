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
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="rounded-[28px] border border-white/10 bg-slate-950/75 px-6 py-8 text-slate-200 shadow-[0_30px_80px_rgba(2,6,23,0.55)]">
          <p className="text-sm uppercase tracking-[0.24em] text-cyan-300">Admin</p>
          <h1 className="mt-3 text-2xl font-semibold text-white">正在加载监控与 Benchmark 后台</h1>
          <p className="mt-3 text-sm leading-7 text-slate-400">
            后台模块会在浏览器侧继续加载。这样即使首次编译较慢，页面外壳也能先返回，避免整页无响应。
          </p>
        </div>
      </main>
    );
  }

  return <AdminDashboard />;
}
