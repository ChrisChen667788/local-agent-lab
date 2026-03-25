import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-12 text-center sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">内容不存在</h1>
      <p className="mt-2 text-sm text-slate-500">该条目可能已被移除，或当前版本只保留 Agent 与后台主入口。</p>
      <Link
        href="/agent"
        className="mt-5 inline-block rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        返回 Agent
      </Link>
    </section>
  );
}
