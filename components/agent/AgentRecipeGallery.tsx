"use client";

import { useRef } from "react";
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
  onExportJson: () => void;
  onImportJson: (file: File) => void;
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
  onSaveCurrent,
  onExportJson,
  onImportJson,
}: AgentRecipeGalleryProps) {
  const isEn = locale.startsWith("en");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-300/80">
            {isEn ? "Studio recipe gallery" : "Studio 配方库"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold text-white">
              {isEn ? "Reusable compare setups" : "可复用的对比配方"}
            </h3>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300">
              {recipes.length} {isEn ? "recipes" : "个配方"}
            </span>
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
            {isEn
              ? "Scan, apply, and reuse compare setups without turning the center workspace into a wall of cards."
              : "用更紧凑的矩阵方式浏览、应用和复用 compare 配置，避免中央工作区被卡片墙压垮。"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={pending}
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? isEn
                ? "Refreshing..."
                : "刷新中..."
              : isEn
                ? "Refresh"
                : "刷新"}
          </button>
          <button
            type="button"
            onClick={onExportJson}
            className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-400/20"
          >
            {isEn ? "Export JSON" : "导出 JSON"}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending}
            className="rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? isEn
                ? "Importing..."
                : "导入中..."
              : isEn
                ? "Import JSON"
                : "导入 JSON"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              onImportJson(file);
              event.currentTarget.value = "";
            }}
          />
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        <div className="hidden overflow-x-auto rounded-[22px] border border-white/10 bg-slate-950/50 xl:block">
          <div className="min-w-[920px]">
            <div className="grid grid-cols-[minmax(240px,1.1fr)_minmax(220px,0.9fr)_minmax(210px,0.7fr)_170px] border-b border-white/10 bg-white/[0.03] px-4 py-3 text-[10px] uppercase tracking-[0.18em] text-slate-500">
              <span>{isEn ? "Recipe" : "配方"}</span>
              <span>{isEn ? "Controls" : "控制项"}</span>
              <span>{isEn ? "Prompt preview" : "Prompt 预览"}</span>
              <span className="text-right">{isEn ? "Actions" : "操作"}</span>
            </div>
            <div className="divide-y divide-white/10">
              {recipes.map((recipe) => {
                const recipeTags = [
                  ...recipe.tags,
                  recipe.providerProfile,
                  recipe.thinkingMode,
                ].filter(Boolean);
                const visibleTags = recipeTags.slice(0, 4);
                const hiddenTagCount = Math.max(
                  0,
                  recipeTags.length - visibleTags.length,
                );
                const isActive = activeRecipeId === recipe.id;

                return (
                  <article
                    key={recipe.id}
                    className={`grid grid-cols-[minmax(240px,1.1fr)_minmax(220px,0.9fr)_minmax(210px,0.7fr)_170px] items-center gap-3 px-4 py-4 transition ${
                      isActive
                        ? "bg-cyan-400/[0.08] shadow-[inset_3px_0_0_rgba(34,211,238,0.7)]"
                        : "hover:bg-white/[0.035]"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${
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
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                          {formatContextWindowLabel(recipe.contextWindow)}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                          {recipe.targetIds.length} {isEn ? "targets" : "目标"}
                        </span>
                      </div>
                      <h4 className="mt-2 line-clamp-2 text-base font-semibold leading-snug text-white">
                        {recipe.label}
                      </h4>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-400">
                        {recipe.description}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${
                            recipe.enableTools
                              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                              : "border-white/10 bg-white/[0.04] text-slate-400"
                          }`}
                        >
                          {recipe.enableTools
                            ? isEn
                              ? "Tools on"
                              : "工具开"
                            : isEn
                              ? "Tools off"
                              : "工具关"}
                        </span>
                        {visibleTags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300"
                          >
                            {tag}
                          </span>
                        ))}
                        {hiddenTagCount ? (
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            +{hiddenTagCount}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <p className="line-clamp-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 font-mono text-[11px] leading-5 text-slate-300">
                      {recipe.input ||
                        (isEn
                          ? "Controls-only recipe. Add prompt text after applying."
                          : "控制项配方。应用后再补 prompt。")}
                    </p>

                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => onApply(recipe.id)}
                        className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                      >
                        {isEn ? "Apply" : "应用"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRunCompare(recipe.id)}
                        disabled={executionPending}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isEn ? "Compare" : "对比"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRunBenchmark(recipe.id)}
                        disabled={executionPending}
                        className="rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isEn ? "Bench" : "评测"}
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
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid gap-3 xl:hidden">
          {recipes.map((recipe) => {
            const recipeTags = [
              ...recipe.tags,
              recipe.providerProfile,
              recipe.thinkingMode,
            ].filter(Boolean);
            const visibleTags = recipeTags.slice(0, 5);
            const hiddenTagCount = Math.max(0, recipeTags.length - 5);
            const isActive = activeRecipeId === recipe.id;

            return (
              <article
                key={`compact:${recipe.id}`}
                className={`rounded-[22px] border px-4 py-4 transition ${
                  isActive
                    ? "border-cyan-400/35 bg-cyan-400/[0.08]"
                    : "border-white/10 bg-slate-950/55 hover:bg-white/[0.04]"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${
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
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                        {formatContextWindowLabel(recipe.contextWindow)}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                        {recipe.targetIds.length} {isEn ? "targets" : "目标"}
                      </span>
                    </div>
                    <h4 className="mt-2 line-clamp-2 text-base font-semibold leading-snug text-white">
                      {recipe.label}
                    </h4>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-400">
                      {recipe.description}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onApply(recipe.id)}
                      className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                    >
                      {isEn ? "Apply" : "应用"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRunCompare(recipe.id)}
                      disabled={executionPending}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isEn ? "Compare" : "对比"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRunBenchmark(recipe.id)}
                      disabled={executionPending}
                      className="rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isEn ? "Bench" : "评测"}
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${
                      recipe.enableTools
                        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                        : "border-white/10 bg-white/[0.04] text-slate-400"
                    }`}
                  >
                    {recipe.enableTools
                      ? isEn
                        ? "Tools on"
                        : "工具开"
                      : isEn
                        ? "Tools off"
                        : "工具关"}
                  </span>
                  {visibleTags.map((tag) => (
                    <span
                      key={`${recipe.id}:${tag}`}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300"
                    >
                      {tag}
                    </span>
                  ))}
                  {hiddenTagCount ? (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      +{hiddenTagCount}
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 line-clamp-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 font-mono text-[11px] leading-5 text-slate-300">
                  {recipe.input ||
                    (isEn
                      ? "Controls-only recipe. Add prompt text after applying."
                      : "控制项配方。应用后再补 prompt。")}
                </p>
                {recipe.source === "user" ? (
                  <button
                    type="button"
                    onClick={() => onDelete(recipe.id)}
                    className="mt-3 rounded-full border border-rose-400/25 bg-rose-400/10 px-3 py-1.5 text-[11px] font-semibold text-rose-100 transition hover:bg-rose-400/20"
                  >
                    {isEn ? "Delete saved setup" : "删除已保存配方"}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>

        <div className="rounded-[22px] border border-white/10 bg-slate-950/65 p-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
            {isEn ? "Save current setup" : "保存当前配置"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {isEn
              ? `Save the visible prompt, system frame, ${selectedTargetCount} selected lane(s), and locked controls for later replay.`
              : `保存当前 prompt、系统提示词、${selectedTargetCount} 条 lane 与锁定控制项，后续可直接复用。`}
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
              rows={3}
              placeholder={isEn ? "Short description" : "简短说明"}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={onSaveCurrent}
              disabled={!draftLabel.trim() || pending}
              className="w-full rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-slate-400"
            >
              {pending
                ? isEn
                  ? "Saving..."
                  : "保存中..."
                : isEn
                  ? "Save setup"
                  : "保存成配方"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
