"use client";

import { FormEvent, useMemo, useState } from "react";

type SubmitStatus = "idle" | "processing" | "success" | "error";

export function InboxForm() {
  const [url, setUrl] = useState("");
  const [rawText, setRawText] = useState("");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [message, setMessage] = useState("可粘贴 URL 或文本，提交后进入处理队列。");

  const statusClass = useMemo(() => {
    if (status === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (status === "error") return "border-rose-200 bg-rose-50 text-rose-700";
    if (status === "processing") return "border-sky-200 bg-sky-50 text-sky-700";
    return "border-slate-200 bg-slate-50 text-slate-600";
  }, [status]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!url.trim() && !rawText.trim()) {
      setStatus("error");
      setMessage("请输入 URL 或文本后再提交。");
      return;
    }

    setStatus("processing");
    setMessage("处理中，正在提取关键信息并计算价值评分...");

    window.setTimeout(() => {
      const inputCount = Number(Boolean(url.trim())) + Number(Boolean(rawText.trim()));
      setStatus("success");
      setMessage(`处理完成，已接收 ${inputCount} 条输入并进入 Feed。`);
    }, 1300);
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Inbox</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">新增信息入口</h1>
      </header>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">粘贴 URL</span>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            type="url"
            placeholder="https://..."
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none ring-0 transition focus:border-slate-400"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">粘贴纯文本</span>
          <textarea
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            rows={7}
            placeholder="把你想收集的信息贴在这里..."
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-slate-400"
          />
        </label>

        <button
          type="submit"
          disabled={status === "processing"}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {status === "processing" ? "处理中..." : "提交处理"}
        </button>
      </form>

      <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${statusClass}`}>{message}</div>
    </section>
  );
}
