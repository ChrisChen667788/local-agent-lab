"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentTimelineEvent,
  AgentTimelineEventKind,
  AgentTimelineEventStatus,
} from "@/lib/agent/types";

type AdminTimelinePanelProps = {
  locale: string;
};

type TimelineResponse = {
  ok?: boolean;
  error?: string;
  events?: AgentTimelineEvent[];
};

type KindFilter = "all" | AgentTimelineEventKind;
type StatusFilter = "all" | "active" | "success" | "failed";

const KIND_FILTERS: KindFilter[] = [
  "all",
  "session",
  "compare",
  "benchmark",
  "finetune",
];
const STATUS_FILTERS: StatusFilter[] = ["all", "active", "success", "failed"];

function formatDateTime(value?: string) {
  if (!value) return "--";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function statusMatchesFilter(
  status: AgentTimelineEventStatus,
  filter: StatusFilter,
) {
  if (filter === "all") return true;
  if (filter === "active") return status === "started";
  if (filter === "success") return status === "completed" || status === "saved";
  return status === "failed" || status === "cancelled" || status === "conflict";
}

function statusTone(status: AgentTimelineEventStatus) {
  if (status === "completed" || status === "saved") {
    return "bg-emerald-400/10 text-emerald-100";
  }
  if (status === "failed" || status === "conflict") {
    return "bg-rose-400/10 text-rose-100";
  }
  if (status === "started") return "bg-cyan-400/10 text-cyan-100";
  return "bg-amber-400/10 text-amber-100";
}

function metadataChips(metadata?: AgentTimelineEvent["metadata"]) {
  if (!metadata) return [] as string[];
  const preferred = [
    "source",
    "sourceType",
    "adapterName",
    "datasetLabel",
    "benchmarkMode",
    "suiteId",
    "suiteLabel",
    "profileBatchScope",
    "targetCount",
    "laneCount",
    "okLanes",
    "sampleCount",
    "totalSteps",
    "runId",
  ];
  const chips: string[] = [];
  for (const key of preferred) {
    const value = metadata[key];
    if (value === undefined || value === null || value === "") continue;
    chips.push(`${key}: ${String(value)}`);
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (chips.length >= 8) break;
    if (preferred.includes(key)) continue;
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string" && value.length > 80) continue;
    chips.push(`${key}: ${String(value)}`);
  }
  return chips.slice(0, 8);
}

export function AdminTimelinePanel({ locale }: AdminTimelinePanelProps) {
  const text = useMemo(() => {
    if (locale.startsWith("en")) {
      return {
        eyebrow: "Unified activity timeline",
        title: "Session / compare / benchmark / fine-tune timeline",
        subtitle:
          "Keep workbench snapshots, compare runs, benchmark evidence, and fine-tune jobs on one operational rail.",
        refresh: "Refresh",
        loading: "Loading...",
        empty: "No timeline events match the current filters.",
        all: "All",
        active: "Active",
        success: "Success",
        failed: "Needs review",
        session: "Session",
        compare: "Compare",
        benchmark: "Benchmark",
        finetune: "Fine-tune",
        targets: "Targets",
        metadata: "Run metadata",
      };
    }
    return {
      eyebrow: "统一活动时间线",
      title: "Session / Compare / Benchmark / Fine-tune 时间线",
      subtitle:
        "把工作台快照、Compare 运行、Benchmark 证据和 Fine-tune 作业串成一条可追踪的运维时间线。",
      refresh: "刷新",
      loading: "加载中...",
      empty: "当前筛选下暂无时间线事件。",
      all: "全部",
      active: "运行中",
      success: "成功",
      failed: "需处理",
      session: "Session",
      compare: "Compare",
      benchmark: "Benchmark",
      finetune: "Fine-tune",
      targets: "目标",
      metadata: "运行元数据",
    };
  }, [locale]);

  const [events, setEvents] = useState<AgentTimelineEvent[]>([]);
  const [pending, setPending] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const loadTimeline = useCallback(async () => {
    setPending(true);
    try {
      const response = await fetch("/api/admin/timeline?limit=72", {
        cache: "no-store",
      });
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

  const filteredEvents = useMemo(
    () =>
      events.filter((event) => {
        const kindOk = kindFilter === "all" || event.kind === kindFilter;
        return kindOk && statusMatchesFilter(event.status, statusFilter);
      }),
    [events, kindFilter, statusFilter],
  );

  const kindLabel = useCallback(
    (kind: KindFilter) => {
      if (kind === "all") return text.all;
      return text[kind];
    },
    [text],
  );

  const statusLabel = useCallback(
    (status: StatusFilter) => {
      if (status === "all") return text.all;
      return text[status];
    },
    [text],
  );

  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">
            {text.eyebrow}
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">{text.title}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            {text.subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadTimeline()}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
        >
          {pending ? text.loading : text.refresh}
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {KIND_FILTERS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setKindFilter(kind)}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                kindFilter === kind
                  ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-50"
                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {kindLabel(kind)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                statusFilter === status
                  ? "border-violet-300/40 bg-violet-400/15 text-violet-50"
                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {statusLabel(status)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-2">
        {filteredEvents.length ? (
          filteredEvents.map((event) => {
            const chips = metadataChips(event.metadata);
            return (
              <div
                key={event.id}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-slate-300">
                      {text[event.kind]}
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${statusTone(
                        event.status,
                      )}`}
                    >
                      {event.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {formatDateTime(event.at)}
                  </p>
                </div>
                <p className="mt-3 text-sm font-semibold text-white">
                  {event.title}
                </p>
                <p className="mt-2 text-xs leading-6 text-slate-300">
                  {event.summary}
                </p>
                {event.targetIds?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
                      {text.targets}: {event.targetIds.length}
                    </span>
                    {event.targetIds.slice(0, 3).map((targetId) => (
                      <span
                        key={targetId}
                        className="max-w-[220px] truncate rounded-full border border-white/10 bg-white/5 px-2 py-0.5"
                      >
                        {targetId}
                      </span>
                    ))}
                  </div>
                ) : null}
                {chips.length ? (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                      {text.metadata}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {chips.map((chip) => (
                        <span
                          key={chip}
                          className="max-w-full truncate rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-slate-300"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="text-sm text-slate-500">{text.empty}</p>
        )}
      </div>
    </div>
  );
}
