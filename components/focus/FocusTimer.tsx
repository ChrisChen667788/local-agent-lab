"use client";

import { useEffect, useMemo, useState } from "react";

const minuteOptions = [25, 50] as const;

function toClock(totalSeconds: number) {
  const minute = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const second = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minute}:${second}`;
}

export function FocusTimer() {
  const [durationMinute, setDurationMinute] = useState<(typeof minuteOptions)[number]>(25);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [goal, setGoal] = useState("");

  useEffect(() => {
    setRemainingSeconds(durationMinute * 60);
    setRunning(false);
  }, [durationMinute]);

  useEffect(() => {
    if (!running) return;
    if (remainingSeconds <= 0) {
      setRunning(false);
      return;
    }

    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [running, remainingSeconds]);

  const statusText = useMemo(() => {
    if (remainingSeconds === 0) return "已完成本轮专注";
    if (running) return "专注中";
    return "待开始";
  }, [remainingSeconds, running]);

  const onReset = () => {
    setRunning(false);
    setRemainingSeconds(durationMinute * 60);
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Focus</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">专注模式</h1>
      </header>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 flex gap-2">
          {minuteOptions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDurationMinute(option)}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                durationMinute === option
                  ? "bg-ink text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {option} 分钟
            </button>
          ))}
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">本次目标</span>
          <input
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="例如：完成 1 个 PR 评审"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none transition focus:border-slate-400"
          />
        </label>

        <div className="mt-6 rounded-xl border border-border bg-slate-50 p-6 text-center">
          <p className="text-sm text-slate-500">{statusText}</p>
          <p className="mt-2 text-6xl font-semibold tracking-tight text-ink">{toClock(remainingSeconds)}</p>
          <p className="mt-3 text-sm text-slate-500">{goal ? `目标：${goal}` : "请先填写本轮目标"}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setRunning((prev) => !prev)}
            disabled={remainingSeconds === 0}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {running ? "暂停" : "开始"}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
          >
            重置
          </button>
        </div>
      </div>
    </section>
  );
}
