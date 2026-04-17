"use client";

import type { AgentStudioRecipe } from "@/lib/agent/types";

type AgentRecipeGalleryProps = {
  locale: string;
  recipes: AgentStudioRecipe[];
  pending: boolean;
  executionPending: boolean;
  error: string;
  activeRecipeId: string;
  draftLabel: string;
  draftDescription: string;
  selectedTargetCount: number;
  onDraftLabelChange: (value: string) => void;
  onDraftDescriptionChange: (value: string) => void;
  onRefresh: () => void;
  onApply: (recipeId: string) => void;
  onRunCompare: (recipeId: string) => void;
  onRunBenchmark: (recipeId: string) => void;
  onDelete: (recipeId: string) => void;
  onSaveCurrent: () => void;
};

function formatContextWindowLabel(value: number) {
  return value >= 1024 ? `${Math.round(value / 1024)}K` : `${value}`;
}

export function AgentRecipeGallery({
  locale,
  recipes,
  pending,
  executionPending,
  error,
  activeRecipeId,
  draftLabel,
  draftDescription,
  selectedTargetCount,
  onDraftLabelChange,
  onDraftDescriptionChange,
  onRefresh,
  onApply,
  onRunCompare,
  onRunBenchmark,
  onDelete,
  onSaveCurrent
}: AgentRecipeGalleryProps) {
  const isEn = locale.startsWith("en");
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-300/80">
            {isEn ? "Studio recipe gallery" : "Studio 配方库"}
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">
            {isEn ? "Reusable compare setups" : "可复用的对比配方"}
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            {isEn
              ? "Start from a strong built-in recipe or save the exact compare setup we already have on screen, including prompt, schema, targets, and fairness controls."
              : "可以直接套用内置高价值配方，也可以把当前屏幕上的 prompt、schema、目标矩阵和公平性控制项保存成自己的 compare 配方。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-300">
            {recipes.length} {isEn ? "recipes" : "个配方"}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={pending}
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? (isEn ? "Refreshing…" : "刷新中…") : isEn ? "Refresh" : "刷新"}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
        <div className="space-y-3">
          {error ? (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {recipes.map((recipe) => (
              <article
                key={recipe.id}
                className={`rounded-[24px] border px-4 py-4 transition ${
                  activeRecipeId === recipe.id
                    ? "border-cyan-400/30 bg-cyan-400/10"
                    : "border-white/10 bg-black/20 hover:border-white/20"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
                          recipe.source === "builtin"
                            ? "border border-cyan-400/20 bg-cyan-400/10 text-cyan-100"
                            : "border border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                        }`}
                      >
                        {recipe.source === "builtin"
                          ? isEn
                            ? "Built in"
                            : "内置"
                          : isEn
                            ? "Saved"
                            : "已保存"}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                        {formatContextWindowLabel(recipe.contextWindow)}
                      </span>
                    </div>
                    <h4 className="mt-3 text-base font-semibold text-white">{recipe.label}</h4>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{recipe.description}</p>
                  </div>
                  <div className="text-right text-[11px] leading-5 text-slate-500">
                    <p>{recipe.targetIds.length} {isEn ? "targets" : "目标"}</p>
                    <p>{recipe.enableTools ? (isEn ? "Tools on" : "工具开") : isEn ? "Tools off" : "工具关"}</p>
                    <p>{recipe.enableRetrieval ? (isEn ? "RAG on" : "检索开") : isEn ? "RAG off" : "检索关"}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {recipe.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                      {tag}
                    </span>
                  ))}
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                    {recipe.providerProfile}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                    {recipe.thinkingMode}
                  </span>
                </div>

                <p className="mt-4 line-clamp-3 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-[13px] leading-6 text-slate-300">
                  {recipe.input || (isEn ? "This recipe focuses on reusable controls more than prompt text." : "这个配方更强调控制项复用，而不是固定 prompt。")}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onApply(recipe.id)}
                    className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                  >
                    {isEn ? "Apply recipe" : "应用配方"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRunCompare(recipe.id)}
                    disabled={executionPending}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isEn ? "Run compare" : "直接对比"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRunBenchmark(recipe.id)}
                    disabled={executionPending}
                    className="rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isEn ? "Benchmark handoff" : "送入评测"}
                  </button>
                  {recipe.source === "user" ? (
                    <button
                      type="button"
                      onClick={() => onDelete(recipe.id)}
                      className="rounded-full border border-rose-400/25 bg-rose-400/10 px-3 py-1.5 text-[11px] font-semibold text-rose-100 transition hover:bg-rose-400/20"
                    >
                      {isEn ? "Delete" : "删除"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-slate-950/65 p-4">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
            {isEn ? "Save current compare setup" : "保存当前 compare 配置"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {isEn
              ? `We will save the visible prompt, system frame, ${selectedTargetCount} selected lane(s), and every locked control so you can replay this exact setup later.`
              : `会把当前可见的 prompt、系统提示词、${selectedTargetCount} 条已选 lane，以及所有锁定控制项一起保存，后面可以直接复用。`}
          </p>
          <div className="mt-4 space-y-3">
            <input
              value={draftLabel}
              onChange={(event) => onDraftLabelChange(event.target.value)}
              placeholder={isEn ? "Recipe name" : "配方名称"}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500"
            />
            <textarea
              value={draftDescription}
              onChange={(event) => onDraftDescriptionChange(event.target.value)}
              rows={4}
              placeholder={isEn ? "Short description for teammates" : "给团队成员看的简短说明"}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={onSaveCurrent}
              disabled={!draftLabel.trim() || pending}
              className="w-full rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-slate-400"
            >
              {pending ? (isEn ? "Saving…" : "保存中…") : isEn ? "Save current setup as recipe" : "把当前配置保存成配方"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
