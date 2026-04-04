import Link from "next/link";

export default function Page() {
  return (
    <main className="min-h-[calc(100vh-65px)] bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_28%),radial-gradient(circle_at_bottom_right,#fde68a,transparent_22%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)]">
      <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-14 px-6 py-12 sm:px-10 lg:px-12">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div className="space-y-6">
            <span className="inline-flex rounded-full border border-slate-300/80 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-600 shadow-sm">
              Open-source local-first agent workbench
            </span>
            <div className="space-y-4">
              <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                Ship local and remote coding agents from one Apple Silicon control room.
              </h1>
              <p className="max-w-3xl text-base leading-8 text-slate-600 sm:text-lg">
                Local Agent Lab brings MLX local runtimes, remote model targets, benchmark ops,
                replay, trace review, gateway recovery, and knowledge import into one place so we
                can compare behavior instead of guessing at it.
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
                <span>Release receipts</span>
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
                Default local 4B is now Qwen3.5 4B. The shipped workflow includes replay, patch
                review, benchmark progress recovery, and local prewarm diagnostics.
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
              title: "Inspect why the agent behaved that way",
              body: "Trace replay, patch review, tool calls, retrieval hits, and file-level evidence in one interface."
            },
            {
              title: "Benchmark with runtime operations built in",
              body: "Track context budgets, prewarm phases, recovery actions, history, and deltas while the run is still live."
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

        <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
          <article className="rounded-[28px] border border-slate-200/80 bg-white/80 p-6 shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">What it replaces</div>
            <ul className="mt-5 space-y-3 text-sm leading-7 text-slate-600">
              <li>Separate local model playgrounds, benchmark spreadsheets, and runtime shell scripts</li>
              <li>Ad hoc debugging when a run hangs between model prewarm, gateway recovery, and tool execution</li>
              <li>Side-by-side local versus remote evaluation done with mismatched context settings</li>
            </ul>
          </article>
          <article className="rounded-[28px] border border-slate-900 bg-slate-900 p-6 text-white shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Who it helps</div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-lg font-semibold">Agent builders</div>
                <p className="mt-2 text-sm leading-7 text-slate-300">
                  Validate patch flows, repo grounding, and tool behavior before shipping new defaults.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-lg font-semibold">Local AI teams</div>
                <p className="mt-2 text-sm leading-7 text-slate-300">
                  Compare MLX models against hosted APIs under aligned context and benchmark settings.
                </p>
              </div>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
