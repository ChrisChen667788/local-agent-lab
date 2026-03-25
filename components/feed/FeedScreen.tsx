"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getActionLabel, mockFeedItems } from "@/lib/mock-data";

type UserAction = "like" | "ignore" | "save";

const actionStyles: Record<UserAction, string> = {
  like: "bg-emerald-600 text-white hover:bg-emerald-700",
  ignore: "bg-slate-200 text-slate-700 hover:bg-slate-300",
  save: "bg-sky-100 text-sky-700 hover:bg-sky-200"
};

export function FeedScreen() {
  const [index, setIndex] = useState(0);
  const [lastAction, setLastAction] = useState<UserAction | null>(null);
  const current = mockFeedItems[index];

  const actionText = useMemo(() => {
    if (!lastAction) return "等待你的选择";
    if (lastAction === "like") return "已 Like，并切换到下一条";
    if (lastAction === "ignore") return "已 Ignore，并切换到下一条";
    return "已保存，稍后可深读";
  }, [lastAction]);

  const gotoNext = () => {
    setIndex((prev) => (prev + 1) % mockFeedItems.length);
  };

  const onAction = (action: UserAction) => {
    setLastAction(action);
    if (action !== "save") gotoNext();
  };

  return (
    <section className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-5xl items-center px-4 py-6 sm:px-6">
      <article className="w-full rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Feed</p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">Anti-fomo 首页</h1>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
            {index + 1} / {mockFeedItems.length}
          </div>
        </header>

        <div className="mb-4">
          <h2 className="text-xl font-semibold leading-tight text-ink">{current.title}</h2>
          <p className="mt-2 text-sm text-muted">来源：{current.source}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {current.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-700">3 行摘要</p>
          <p className="clamp-3 mt-2 text-sm leading-6 text-slate-700">{current.shortSummary}</p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted">价值评分</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{current.valueScore} / 100</p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted">建议动作</p>
            <p className="mt-1 text-lg font-medium text-accent">
              {getActionLabel(current.suggestedAction)}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => onAction("like")}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${actionStyles.like}`}
          >
            Like
          </button>
          <button
            type="button"
            onClick={() => onAction("ignore")}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${actionStyles.ignore}`}
          >
            Ignore
          </button>
          <button
            type="button"
            onClick={() => onAction("save")}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${actionStyles.save}`}
          >
            Save
          </button>
          <Link
            href={`/item/${current.id}`}
            className="rounded-lg bg-ink px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Open Detail
          </Link>
        </div>

        <p className="mt-4 text-sm text-slate-500">{actionText}</p>
      </article>
    </section>
  );
}
