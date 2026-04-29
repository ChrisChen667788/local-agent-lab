"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentTimelineEvent } from "@/lib/agent/types";

type AdminTimelinePanelProps = {
  locale: string;
};

type TimelineResponse = {
  ok?: boolean;
  error?: string;
  events?: AgentTimelineEvent[];
};

function formatDateTime(value?: string) {
  if (!value) return "--";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function AdminTimelinePanel({ locale }: AdminTimelinePanelProps) {
  const text = useMemo(() => {
    if (locale.startsWith("en")) {
      return {
        eyebrow: "Unified activity timeline",
        title: "Session / compare / benchmark timeline",
        subtitle:
          "Keep the latest workbench snapshot syncs, compare runs, benchmark runs, and fine-tune jobs on one operational rail.",
        refresh: "Refresh",
        loading: "Loading...",
        empty: "No timeline events yet.",
        session: "Session",
        compare: "Compare",
        benchmark: "Benchmark",
        finetune: "Fine-tune"
      };
    }
    return {
      eyebrow: "统一活动时间线",
      title: "Session / Compare / Benchmark 时间线",
      subtitle: "把最近的工作台快照同步、Compare 运行、Benchmark 运行和 Fine-tune 作业串到一条运维时间线上。",
      refresh: "刷新",
      loading: "加载中...",
      empty: "暂无时间线事件。",
      session: "Session",
      compare: "Compare",
      benchmark: "Benchmark",
      finetune: "Fine-tune"
    };
  }, [locale]);

  const [events, setEvents] = useState<AgentTimelineEvent[]>([]);
  const [pending, setPending] = useState(false);

  const loadTimeline = useCallback(async () => {
    setPending(true);
    try {
      const response = await fetch("/api/admin/timeline?limit=36", { cache: "no-store" });
      const payload = (await response.json()) as TimelineResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load timeline.");
      }
      setEvents(payload.events || []);
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    void loadTimeline();
    const timer = window.setInterval(() => {
      void loadTimeline();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadTimeline]);

  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">{text.eyebrow}</p>
          <h3 className="mt-2 text-xl font-semibold text-white">{text.title}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{text.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadTimeline()}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
        >
          {pending ? text.loading : text.refresh}
        </button>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-2">
        {events.length ? (
          events.map((event) => (
            <div key={event.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-slate-300">
                    {event.kind === "session"
                      ? text.session
                      : event.kind === "compare"
                        ? text.compare
                        : event.kind === "benchmark"
                          ? text.benchmark
                          : text.finetune}
                  </span>
                  <span className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${
                    event.status === "completed" || event.status === "saved"
                      ? "bg-emerald-400/10 text-emerald-100"
                      : event.status === "failed" || event.status === "conflict"
                        ? "bg-rose-400/10 text-rose-100"
                        : event.status === "started"
                          ? "bg-cyan-400/10 text-cyan-100"
                          : "bg-amber-400/10 text-amber-100"
                  }`}>
                    {event.status}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">{formatDateTime(event.at)}</p>
              </div>
              <p className="mt-3 text-sm font-semibold text-white">{event.title}</p>
              <p className="mt-2 text-xs leading-6 text-slate-300">{event.summary}</p>
              {event.targetIds?.length ? (
                <p className="mt-2 text-[11px] text-slate-500">{event.targetIds.join(" · ")}</p>
              ) : null}
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">{text.empty}</p>
        )}
      </div>
    </div>
  );
}
