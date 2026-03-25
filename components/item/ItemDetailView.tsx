"use client";

import Link from "next/link";
import { useState } from "react";
import type { FeedItem } from "@/lib/types";

type ItemAction = "like" | "ignore" | "save";

export function ItemDetailView({ item }: { item: FeedItem }) {
  const [action, setAction] = useState<ItemAction | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessMessage, setReprocessMessage] = useState("当前版本为最新处理结果。");

  const onReprocess = () => {
    setReprocessing(true);
    setReprocessMessage("重新处理中...");

    window.setTimeout(() => {
      setReprocessing(false);
      setReprocessMessage("已重新处理完成，摘要与评分已刷新。");
    }, 1400);
  };

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Item Detail</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">{item.title}</h1>
        <a
          href={item.link}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-sm text-sky-700 underline-offset-4 hover:underline"
        >
          原始链接
        </a>
      </header>

      <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <section>
          <h2 className="text-sm font-semibold text-slate-700">短摘要</h2>
          <p className="mt-1 text-sm leading-6 text-slate-700">{item.shortSummary}</p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-slate-700">长摘要</h2>
          <p className="mt-1 text-sm leading-6 text-slate-700">{item.longSummary}</p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-slate-700">标签</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
              >
                #{tag}
              </span>
            ))}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted">建议动作</p>
            <p className="mt-1 text-lg font-medium text-accent">
              {item.suggestedAction === "deep_read"
                ? "建议深读"
                : item.suggestedAction === "skim"
                  ? "建议快览"
                  : "建议忽略"}
            </p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted">价值评分</p>
            <p className="mt-1 text-lg font-medium text-ink">{item.valueScore} / 100</p>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-slate-700">用户操作</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAction("like")}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Like
            </button>
            <button
              type="button"
              onClick={() => setAction("ignore")}
              className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
            >
              Ignore
            </button>
            <button
              type="button"
              onClick={() => setAction("save")}
              className="rounded-lg bg-sky-100 px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-200"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onReprocess}
              disabled={reprocessing}
              className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {reprocessing ? "处理中..." : "重新处理"}
            </button>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {action ? `最近操作：${action}` : "你还没有执行操作。"}
          </p>
          <p className="mt-1 text-sm text-slate-500">{reprocessMessage}</p>
        </section>
      </div>

      <Link
        href="/"
        className="mt-4 inline-block text-sm text-slate-600 underline-offset-4 hover:underline"
      >
        返回 Feed
      </Link>
    </section>
  );
}
