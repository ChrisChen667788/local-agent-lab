"use client";

import { useState } from "react";
import { mockSessionSummary } from "@/lib/mock-data";

function buildMarkdown() {
  return [
    "# Session Summary",
    "",
    `- Session 时长: ${mockSessionSummary.durationMinutes} 分钟`,
    `- 期间新增内容数: ${mockSessionSummary.newItems}`,
    `- 推荐深读数: ${mockSessionSummary.deepReadCount}`,
    `- 可忽略数: ${mockSessionSummary.ignorableCount}`,
    "",
    "## 建议",
    "",
    "1. 优先处理推荐深读内容，控制上下文切换。",
    "2. 将可忽略项归档，避免信息噪音。"
  ].join("\n");
}

export function SessionSummaryView() {
  const [markdown, setMarkdown] = useState("");

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Session Summary</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">会话总结</h1>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-slate-500">Session 时长</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{mockSessionSummary.durationMinutes} 分钟</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-slate-500">新增内容数</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{mockSessionSummary.newItems}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-slate-500">推荐深读数</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{mockSessionSummary.deepReadCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-slate-500">可忽略数</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{mockSessionSummary.ignorableCount}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setMarkdown(buildMarkdown())}
        className="mt-5 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        生成 Markdown 总结
      </button>

      <textarea
        value={markdown}
        readOnly
        placeholder="点击上方按钮生成总结..."
        rows={12}
        className="mt-4 w-full rounded-xl border border-border bg-card p-4 text-sm leading-6 text-slate-700 shadow-sm outline-none"
      />
    </section>
  );
}
