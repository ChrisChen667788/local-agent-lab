import Link from "next/link";

export default function Page() {
  return (
    <main className="min-h-[calc(100vh-65px)] bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_28%),radial-gradient(circle_at_bottom_right,#fde68a,transparent_22%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)]">
      <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-14 px-6 py-12 sm:px-10 lg:px-12">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div className="space-y-6">
            <span className="inline-flex rounded-full border border-slate-300/80 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-600 shadow-sm">
              Local-first agent workbench
            </span>
            <div className="space-y-4">
              <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                Build, benchmark, and operate coding agents from one Apple Silicon workbench.
              </h1>
              <p className="max-w-3xl text-base leading-8 text-slate-600 sm:text-lg">
                Local Agent Lab brings local MLX runtimes, remote model targets, benchmark history,
                runtime diagnostics, replay, trace review, and knowledge import into one interface.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/agent"
                className="rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5"
              >
                Open Agent Workbench
              </Link>
              <Link
                href="/admin"
                className="rounded-full border border-slate-300 bg-white/85 px-6 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-400 hover:bg-white"
              >
                Open Admin Dashboard
              </Link>
              <a
                href="https://github.com/ChrisChen667788/local-agent-lab"
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-slate-300 bg-transparent px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white/70"
              >
                GitHub
              </a>
            </div>
          </div>

          <div className="rounded-[32px] border border-white/80 bg-slate-950 p-6 text-white shadow-[0_30px_80px_rgba(15,23,42,0.2)]">
            <div className="space-y-5">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.26em] text-slate-400">
                <span>Validated runtime profile</span>
                <span>v0.2.3</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-cyan-300">Local 32K benchmark</div>
                  <div className="mt-2 text-3xl font-semibold">426/426</div>
                  <div className="mt-1 text-sm text-slate-300">all-local milestone-full passed</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-amber-300">Mixed compare</div>
                  <div className="mt-2 text-3xl font-semibold">0 failed</div>
                  <div className="mt-1 text-sm text-slate-300">local + remote 32K compare validated</div>
                </div>
              </div>
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm leading-7 text-emerald-50">
                Local Qwen3.5 4B is the current default 4B profile. Replay, trace review, patch
                inspection, and benchmark prewarm recovery are part of the shipping workflow.
              </div>
            </div>
          </div>
        </div>

        <section className="grid gap-5 md:grid-cols-3">
          {[
            {
              title: "Run local and remote targets side by side",
              body: "Compare MLX Qwen profiles against OpenAI-compatible and Claude-compatible APIs without switching tools."
            },
            {
              title: "Understand agent behavior, not just answers",
              body: "Inspect replay traces, patch review steps, tool calls, retrieval hits, and benchmark failures in one place."
            },
            {
              title: "Benchmark with runtime ops built in",
              body: "Track context windows, prewarm stages, gateway recovery, history, and deltas while the benchmark is still running."
            }
          ].map((item) => (
            <article
              key={item.title}
              className="rounded-[28px] border border-slate-200/80 bg-white/80 p-6 shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur"
            >
              <h2 className="text-xl font-semibold text-slate-950">{item.title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">{item.body}</p>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
