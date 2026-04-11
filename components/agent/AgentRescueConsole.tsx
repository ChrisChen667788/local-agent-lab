"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { agentTargets as builtinAgentTargets } from "@/lib/agent/catalog";
import type {
  AgentChatResponse,
  AgentProviderProfile,
  AgentRuntimePrewarmResponse,
  AgentRuntimeStatus,
  AgentThinkingMode
} from "@/lib/agent/types";

const CONTEXT_OPTIONS = [4096, 8192, 16384, 32768];

export function AgentRescueConsole() {
  const [availableTargets, setAvailableTargets] = useState(builtinAgentTargets);
  const agentTargets = availableTargets;
  const localTargets = useMemo(() => agentTargets.filter((target) => target.execution === "local"), [agentTargets]);
  const [targetId, setTargetId] = useState(localTargets[1]?.id || localTargets[0]?.id || agentTargets[0]?.id || "");
  const [input, setInput] = useState("请用一句中文解释什么是本地编码 Agent。");
  const [enableRetrieval, setEnableRetrieval] = useState(false);
  const [contextWindow, setContextWindow] = useState(32768);
  const [pending, setPending] = useState(false);
  const [runtime, setRuntime] = useState<AgentRuntimeStatus | null>(null);
  const [response, setResponse] = useState<AgentChatResponse | null>(null);
  const [error, setError] = useState("");
  const [prewarmMessage, setPrewarmMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadAvailableTargets() {
      try {
        const response = await fetch("/api/agent/targets", { cache: "no-store" });
        const payload = (await response.json()) as { targets?: typeof builtinAgentTargets };
        if (!response.ok || cancelled || !Array.isArray(payload.targets) || !payload.targets.length) return;
        setAvailableTargets(payload.targets);
      } catch {
        // keep builtin targets when sync fails
      }
    }

    void loadAvailableTargets();
    const timer = window.setInterval(() => {
      void loadAvailableTargets();
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function loadRuntime(currentTargetId = targetId) {
    try {
      const next = await fetch(
        `/api/agent/runtime?targetId=${encodeURIComponent(currentTargetId)}&thinkingMode=standard`,
        { cache: "no-store" }
      );
      const data = (await next.json()) as AgentRuntimeStatus & { error?: string };
      if (!next.ok) {
        throw new Error(data.error || "Runtime load failed");
      }
      setRuntime(data);
    } catch (runtimeError) {
      setRuntime(null);
      setError(runtimeError instanceof Error ? runtimeError.message : "Runtime load failed");
    }
  }

  useEffect(() => {
    if (!targetId) return;
    void loadRuntime(targetId);
  }, [targetId]);

  useEffect(() => {
    setTargetId((current) => (agentTargets.some((target) => target.id === current) ? current : localTargets[0]?.id || agentTargets[0]?.id || ""));
  }, [agentTargets, localTargets]);

  async function handlePrewarm() {
    if (!targetId) return;
    setPrewarmMessage("正在预热本地模型...");
    try {
      const next = await fetch("/api/agent/runtime/prewarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId })
      });
      const data = (await next.json()) as AgentRuntimePrewarmResponse & { error?: string };
      if (!next.ok || !data.ok) {
        throw new Error(data.error || data.message || "Prewarm failed");
      }
      setPrewarmMessage(data.message);
      await loadRuntime(targetId);
    } catch (prewarmError) {
      setPrewarmMessage(prewarmError instanceof Error ? prewarmError.message : "Prewarm failed");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim() || !targetId) return;

    setPending(true);
    setError("");
    setResponse(null);

    try {
      const next = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId,
          input,
          messages: [],
          enableTools: false,
          enableRetrieval,
          contextWindow,
          providerProfile: "balanced" satisfies AgentProviderProfile,
          thinkingMode: "standard" satisfies AgentThinkingMode
        })
      });
      const data = (await next.json()) as AgentChatResponse & { error?: string };
      if (!next.ok) {
        throw new Error(data.error || "Chat failed");
      }
      setResponse(data);
      await loadRuntime(targetId);
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "Chat failed");
    } finally {
      setPending(false);
    }
  }

  const selectedTarget = agentTargets.find((target) => target.id === targetId) || agentTargets[0];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#10203f,_#020617_55%)] px-4 py-8 text-slate-100 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="rounded-[28px] border border-white/10 bg-slate-950/80 p-6 shadow-[0_30px_80px_rgba(2,6,23,0.55)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">Agent Rescue Console</p>
              <h1 className="mt-3 text-3xl font-semibold text-white">稳定入口</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
                这里优先保证本地与远端模型可用。正常工作台已恢复到
                <a className="ml-2 text-cyan-300 underline" href="/agent">
                  /agent
                </a>
                。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadRuntime(targetId)}
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-300 hover:text-white"
            >
              刷新运行时
            </button>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4 rounded-[24px] border border-white/10 bg-slate-950/75 p-5">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">目标模型</p>
              <select
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
                className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300"
              >
                {agentTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">上下文体量</p>
              <select
                value={contextWindow}
                onChange={(event) => setContextWindow(Number(event.target.value))}
                className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300"
              >
                {CONTEXT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {Math.floor(option / 1024)}K
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={enableRetrieval}
                onChange={(event) => setEnableRetrieval(event.target.checked)}
              />
              检索增强
            </label>

            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-300">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">当前运行态</p>
              <div className="mt-3 space-y-2">
                <p>目标: {selectedTarget?.label}</p>
                <p>已加载别名: {runtime?.loadedAlias || "--"}</p>
                <p>队列: {runtime?.queueDepth ?? 0}</p>
                <p>活跃请求: {runtime?.activeRequests ?? 0}</p>
                <p>消息: {runtime?.message || "--"}</p>
              </div>
              {selectedTarget?.execution === "local" ? (
                <button
                  type="button"
                  onClick={() => void handlePrewarm()}
                  className="mt-4 rounded-full border border-cyan-400/40 px-4 py-2 text-sm text-cyan-200 transition hover:border-cyan-300 hover:text-white"
                >
                  预热模型
                </button>
              ) : null}
              {prewarmMessage ? <p className="mt-3 text-xs text-slate-400">{prewarmMessage}</p> : null}
            </div>
          </aside>

          <section className="rounded-[24px] border border-white/10 bg-slate-950/75 p-5">
            <form className="space-y-4" onSubmit={handleSubmit}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={8}
                className="w-full rounded-[24px] border border-white/10 bg-slate-950 px-5 py-4 text-sm leading-7 text-white outline-none transition focus:border-cyan-300"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-full bg-cyan-400 px-6 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending ? "请求中..." : "发送"}
                </button>
                {error ? <p className="text-sm text-rose-300">{error}</p> : null}
              </div>
            </form>

            <div className="mt-6 rounded-[24px] border border-white/10 bg-slate-950/70 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">响应</p>
              {response ? (
                <div className="mt-4 space-y-4 text-sm leading-7 text-slate-200">
                  <div className="grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                    <p>Provider: {response.providerLabel}</p>
                    <p>Model: {response.resolvedModel}</p>
                    <p>Profile: {response.providerProfile || "--"}</p>
                    <p>Thinking: {response.thinkingMode || "--"}</p>
                    <p>本地降级: {response.localFallbackUsed ? `${response.localFallbackTargetLabel || "已触发"} · ${response.localFallbackReason || ""}` : "未触发"}</p>
                    <p>提示: {response.warning || "--"}</p>
                  </div>
                  <pre className="whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-sm leading-7 text-slate-100">
                    {response.content || "(空响应)"}
                  </pre>
                  {response.retrieval ? (
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-xs leading-6 text-slate-200">
                      <p>检索命中: {response.retrieval.hitCount}</p>
                      <p>低置信度: {response.retrieval.lowConfidence ? "是" : "否"}</p>
                      <p>旁路 grounding: {response.retrieval.bypassGrounding ? response.retrieval.bypassReason || "是" : "否"}</p>
                    </div>
                  ) : null}
                  {response.verification ? (
                    <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-xs leading-6 text-slate-200">
                      <p>验证结论: {response.verification.verdict}</p>
                      <p>fallback: {response.verification.fallbackApplied ? response.verification.fallbackReason || "yes" : "no"}</p>
                      <p>notes: {response.verification.notes.join(", ") || "--"}</p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-400">发送问题后，这里会显示真实返回结果。</p>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
