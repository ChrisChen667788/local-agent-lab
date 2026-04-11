import type {
  AgentCompareLaneProgress,
  AgentCompareOutputShape,
  AgentCompareResponse,
  AgentCompareReviewSummaryDetail,
  AgentCompareReviewSummaryTone,
  AgentProviderProfile,
  AgentThinkingMode
} from "@/lib/agent/types";

type CompareLane = AgentCompareResponse["results"][number];

function formatContextWindowLabel(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return value >= 1024 ? `${Math.round(value / 1024)}K` : `${value}`;
}

function createCompareTokenSet(content: string) {
  return new Set(
    content
      .toLowerCase()
      .split(/[^a-z0-9_\u4e00-\u9fff]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function computeCompareOverlap(base: string, candidate: string) {
  const baseSet = createCompareTokenSet(base);
  const candidateSet = createCompareTokenSet(candidate);
  if (!baseSet.size && !candidateSet.size) return 1;
  const union = new Set([...baseSet, ...candidateSet]);
  let intersection = 0;
  union.forEach((token) => {
    if (baseSet.has(token) && candidateSet.has(token)) {
      intersection += 1;
    }
  });
  return union.size ? intersection / union.size : 0;
}

function extractCompareJsonKeys(content: string) {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return Object.keys(parsed).sort();
  } catch {
    return null;
  }
}

function deriveCompareSchemaStatus(base: string, candidate: string) {
  const baseJsonKeys = extractCompareJsonKeys(base);
  const candidateJsonKeys = extractCompareJsonKeys(candidate);
  if (!baseJsonKeys || !candidateJsonKeys) return "not-json";
  return JSON.stringify(baseJsonKeys) === JSON.stringify(candidateJsonKeys) ? "matched-keys" : "different-keys";
}

function formatCompareSchemaStatusForNote(status: string) {
  if (status === "matched-keys") return "matched keys";
  if (status === "different-keys") return "different keys";
  return "not JSON";
}

export function deriveCompareRecoveryConclusion(
  compareProgress: AgentCompareLaneProgress | undefined,
  lane: CompareLane
) {
  const timeline = compareProgress?.timeline || [];
  const recoveryEntries = timeline.filter((entry) => entry.phase === "recovering" || Boolean(entry.recoveryAction));
  const latestRecovery = recoveryEntries[recoveryEntries.length - 1];

  if (!timeline.length) {
    return lane.ok
      ? "No compare recovery history was recorded for this lane."
      : "This lane failed before compare recorded any recovery history.";
  }

  if (!recoveryEntries.length) {
    return lane.ok ? "Completed without any recovery action." : "Failed without a recorded recovery action.";
  }

  const recoveryCountLabel = `${recoveryEntries.length} recovery action${recoveryEntries.length === 1 ? "" : "s"}`;
  const latestAction = latestRecovery?.recoveryAction || latestRecovery?.detail || "A compare recovery action ran.";
  if (lane.ok) {
    return `Completed after ${recoveryCountLabel}. Latest action: ${latestAction}`;
  }
  return `Attempted ${recoveryCountLabel}, but the lane still ended in a non-ok state. Latest action: ${latestAction}`;
}

function compactText(value: string, maxLength = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function deriveCompareLaneTakeaway(params: {
  lane: CompareLane;
  baseLane: CompareLane | null;
  overlapBase: number;
  schemaStatus: string;
}) {
  const { lane, baseLane, overlapBase, schemaStatus } = params;
  const lengthDelta = baseLane ? lane.content.length - baseLane.content.length : 0;

  if (lane.warning) {
    return `warning surfaced: ${compactText(lane.warning, 120)}`;
  }
  if (!lane.ok) {
    return "lane did not complete cleanly";
  }
  if (schemaStatus === "different-keys") {
    return "output schema drifted from the base lane";
  }
  if (overlapBase < 0.45) {
    return `answer framing diverged strongly from the base lane (${Math.round(overlapBase * 100)}% overlap)`;
  }
  if (Math.abs(lengthDelta) >= 160) {
    return lengthDelta > 0
      ? `response was materially longer than the base lane (+${lengthDelta} chars)`
      : `response was materially shorter than the base lane (${lengthDelta} chars)`;
  }
  return "response stayed broadly aligned with the base lane";
}

function deriveCompareLaneFollowUp(params: {
  lane: CompareLane;
  recoveryConclusion: string;
  schemaStatus: string;
}) {
  const { lane, recoveryConclusion, schemaStatus } = params;
  if (!lane.ok) {
    return "rerun this lane or inspect the provider warning before using it as evidence";
  }
  if (lane.warning) {
    return "keep the warning with any shared note so reviewers do not over-trust the output";
  }
  if (schemaStatus === "different-keys") {
    return "keep the base lane as the automation reference unless this schema drift is intentional";
  }
  if (/recovery action/i.test(recoveryConclusion) || /Completed after/i.test(recoveryConclusion)) {
    return "mention the recovery history if this result becomes part of a benchmark or review note";
  }
  return "safe to reuse in a benchmark handoff or lightweight review note";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderMarkdownDocumentToHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let inCodeBlock = false;
  let codeFenceLanguage = "";
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    html.push(`<p>${formatInlineMarkdown(paragraphLines.join(" "))}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<ul>${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  const flushCodeBlock = () => {
    if (!inCodeBlock) return;
    const languageBadge = codeFenceLanguage ? `<div class="code-label">${escapeHtml(codeFenceLanguage)}</div>` : "";
    html.push(`<div class="code-block">${languageBadge}<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre></div>`);
    inCodeBlock = false;
    codeFenceLanguage = "";
    codeLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock();
      } else {
        flushParagraph();
        flushList();
        inCodeBlock = true;
        codeFenceLanguage = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine);
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(3, headingMatch[1].length);
      html.push(`<h${level}>${formatInlineMarkdown(headingMatch[2].trim())}</h${level}>`);
      continue;
    }

    const bulletMatch = line.match(/^\s*-\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      listItems.push(bulletMatch[1].trim());
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    paragraphLines.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushCodeBlock();

  if (!html.length) {
    html.push("<p>No markdown content was generated for this compare preview.</p>");
  }

  return html.join("\n");
}

export function buildMarkdownPreviewHtml(locale: string, title: string, markdown: string) {
  const renderedHtml = renderMarkdownDocumentToHtml(markdown);
  const renderedLabel = locale.startsWith("en") ? "Rendered preview" : "渲染版预览";
  const rawLabel = locale.startsWith("en") ? "Raw markdown" : "原始 Markdown";
  const eyebrow = locale.startsWith("en") ? "Compare markdown preview" : "Compare Markdown 预览";
  const copyRenderedLabel = locale.startsWith("en") ? "Copy rendered summary" : "复制渲染摘要";
  const copyRawLabel = locale.startsWith("en") ? "Copy raw markdown" : "复制原始 Markdown";
  const copiedLabel = locale.startsWith("en") ? "Rendered summary copied." : "已复制渲染摘要。";
  const rawCopiedLabel = locale.startsWith("en") ? "Raw markdown copied." : "已复制原始 Markdown。";
  const copyFailedLabel = locale.startsWith("en") ? "Copy failed. Try again." : "复制失败，请重试。";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #020617; color: #e2e8f0; }
      .shell { max-width: 1080px; margin: 0 auto; padding: 40px 24px 64px; }
      .card { border: 1px solid rgba(148,163,184,0.18); background: rgba(15,23,42,0.88); border-radius: 24px; overflow: hidden; box-shadow: 0 30px 80px rgba(2,6,23,0.45); }
      .header { padding: 24px; border-bottom: 1px solid rgba(148,163,184,0.12); background: linear-gradient(135deg, rgba(34,211,238,0.12), rgba(15,23,42,0.96)); }
      .eyebrow { font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: #67e8f9; }
      h1 { margin: 12px 0 0; font-size: 24px; line-height: 1.2; color: #f8fafc; }
      .header-copy { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
      .header-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 12px; }
      .tabs { display: inline-flex; gap: 8px; border: 1px solid rgba(148,163,184,0.14); background: rgba(15,23,42,0.55); border-radius: 999px; padding: 6px; }
      .tab-button { border: 0; cursor: pointer; border-radius: 999px; background: transparent; color: #94a3b8; padding: 10px 16px; font: 600 12px/1 ui-sans-serif, system-ui; letter-spacing: 0.06em; text-transform: uppercase; }
      .tab-button.is-active { background: rgba(34,211,238,0.14); color: #ecfeff; }
      .copy-button { border: 1px solid rgba(148,163,184,0.18); cursor: pointer; border-radius: 999px; background: rgba(34,211,238,0.12); color: #ecfeff; padding: 10px 16px; font: 600 12px/1 ui-sans-serif, system-ui; letter-spacing: 0.06em; text-transform: uppercase; }
      .copy-status { min-height: 16px; font-size: 11px; color: #94a3b8; text-align: right; }
      .body { padding: 24px; }
      .panel[hidden] { display: none; }
      .markdown { color: #dbe7f3; }
      .markdown h1, .markdown h2, .markdown h3 { margin: 0 0 14px; color: #f8fafc; line-height: 1.2; }
      .markdown h1 { font-size: 30px; }
      .markdown h2 { font-size: 22px; margin-top: 28px; }
      .markdown h3 { font-size: 17px; margin-top: 24px; letter-spacing: 0.02em; }
      .markdown p { margin: 0 0 14px; font-size: 15px; line-height: 1.85; color: #cbd5e1; }
      .markdown ul { margin: 0 0 18px; padding-left: 20px; display: grid; gap: 8px; }
      .markdown li { color: #d7e2ee; line-height: 1.8; }
      .markdown strong { color: #f8fafc; }
      .markdown code { border: 1px solid rgba(148,163,184,0.14); background: rgba(15,23,42,0.92); color: #67e8f9; border-radius: 8px; padding: 2px 6px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .code-block { margin: 18px 0; border: 1px solid rgba(148,163,184,0.16); background: rgba(2,6,23,0.78); border-radius: 18px; overflow: hidden; }
      .code-label { padding: 12px 16px 0; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #67e8f9; }
      pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; color: #cbd5e1; padding: 18px 20px 20px; }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="card">
        <div class="header">
          <div class="header-copy">
            <div>
              <div class="eyebrow">${escapeHtml(eyebrow)}</div>
              <h1>${escapeHtml(title)}</h1>
            </div>
            <div class="header-actions">
              <div class="copy-status" id="copy-status" role="status" aria-live="polite"></div>
              <button type="button" class="copy-button" id="copy-rendered">${escapeHtml(copyRenderedLabel)}</button>
              <button type="button" class="copy-button" id="copy-raw">${escapeHtml(copyRawLabel)}</button>
              <div class="tabs" role="tablist" aria-label="${escapeHtml(eyebrow)}">
                <button type="button" class="tab-button is-active" data-tab="rendered">${escapeHtml(renderedLabel)}</button>
                <button type="button" class="tab-button" data-tab="raw">${escapeHtml(rawLabel)}</button>
              </div>
            </div>
          </div>
        </div>
        <div class="body">
          <section class="panel" data-panel="rendered">
            <div class="markdown">${renderedHtml}</div>
          </section>
          <section class="panel" data-panel="raw" hidden>
            <pre>${escapeHtml(markdown)}</pre>
          </section>
        </div>
      </section>
    </main>
    <script>
      const buttons = Array.from(document.querySelectorAll("[data-tab]"));
      const panels = Array.from(document.querySelectorAll("[data-panel]"));
      const copyStatus = document.getElementById("copy-status");
      const setCopyStatus = (message) => {
        if (!copyStatus) return;
        copyStatus.textContent = message;
        window.clearTimeout(window.__comparePreviewCopyTimer || 0);
        window.__comparePreviewCopyTimer = window.setTimeout(() => {
          if (copyStatus.textContent === message) {
            copyStatus.textContent = "";
          }
        }, 2200);
      };
      const setView = (view) => {
        buttons.forEach((button) => button.classList.toggle("is-active", button.dataset.tab === view));
        panels.forEach((panel) => {
          panel.hidden = panel.dataset.panel !== view;
        });
      };
      const fallbackCopy = (text) => {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      };
      buttons.forEach((button) => {
        button.addEventListener("click", () => setView(button.dataset.tab || "rendered"));
      });
      document.getElementById("copy-rendered")?.addEventListener("click", async () => {
        const renderedPanel = document.querySelector('[data-panel="rendered"]');
        const text = (renderedPanel?.innerText || "").trim();
        if (!text) return;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            fallbackCopy(text);
          }
          setCopyStatus(${JSON.stringify(copiedLabel)});
        } catch {
          try {
            fallbackCopy(text);
            setCopyStatus(${JSON.stringify(copiedLabel)});
          } catch {
            setCopyStatus(${JSON.stringify(copyFailedLabel)});
          }
        }
      });
      document.getElementById("copy-raw")?.addEventListener("click", async () => {
        const rawPanel = document.querySelector('[data-panel="raw"] pre');
        const text = (rawPanel?.innerText || "").trim();
        if (!text) return;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            fallbackCopy(text);
          }
          setCopyStatus(${JSON.stringify(rawCopiedLabel)});
        } catch {
          try {
            fallbackCopy(text);
            setCopyStatus(${JSON.stringify(rawCopiedLabel)});
          } catch {
            setCopyStatus(${JSON.stringify(copyFailedLabel)});
          }
        }
      });
      setView("rendered");
    </script>
  </body>
</html>`;
}

export function buildCompareBenchmarkPromptParts(params: {
  input: string;
  systemPrompt: string;
  compareOutputShape: AgentCompareOutputShape;
  compareBenchmarkUseOutputContract: boolean;
}) {
  const { input, systemPrompt, compareOutputShape, compareBenchmarkUseOutputContract } = params;
  const basePrompt = [
    systemPrompt.trim() ? `System frame:\n${systemPrompt.trim()}` : "",
    input.trim() ? `Task:\n${input.trim()}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
  const contractBlock = compareBenchmarkUseOutputContract
    ? compareOutputShape === "bullet-list"
      ? "Output contract:\n- Return 4 to 6 concise bullet points.\n- Keep the answer grounded in the task."
      : compareOutputShape === "strict-json"
        ? 'Output contract:\nReturn valid JSON only using {"answer": string, "key_points": string[], "warnings": string[]}. '
        : ""
    : "";
  return {
    basePrompt,
    contractBlock,
    finalPrompt: [basePrompt, contractBlock].filter(Boolean).join("\n\n")
  };
}

export function buildCompareBenchmarkPrompt(params: {
  input: string;
  systemPrompt: string;
  compareOutputShape: AgentCompareOutputShape;
  compareBenchmarkUseOutputContract: boolean;
}) {
  return buildCompareBenchmarkPromptParts(params).finalPrompt;
}

export function buildCompareBenchmarkPromptDiff(params: {
  input: string;
  systemPrompt: string;
  compareOutputShape: AgentCompareOutputShape;
  compareBenchmarkUseOutputContract: boolean;
}) {
  const { basePrompt, contractBlock } = buildCompareBenchmarkPromptParts(params);
  if (contractBlock) {
    return [
      "# Handoff additions",
      "",
      "The benchmark handoff keeps the current system frame and task, then appends:",
      "",
      "```text",
      contractBlock,
      "```"
    ].join("\n");
  }
  return [
    "# Handoff additions",
    "",
    "No extra output contract will be appended.",
    "The benchmark handoff will send the current system frame and task only.",
    "",
    "```text",
    basePrompt || "(empty prompt)",
    "```"
  ].join("\n");
}

export function serializeCompareResultAsMarkdown(params: {
  compareResult: AgentCompareResponse;
  compareProgressByTargetId?: Record<string, AgentCompareLaneProgress>;
  compareBaseTargetId?: string;
  laneTargetIds?: string[];
  prompt: string;
  systemPrompt: string;
  contextWindow: number;
  providerProfile: AgentProviderProfile;
  thinkingMode: AgentThinkingMode;
  enableTools: boolean;
  enableRetrieval: boolean;
}) {
  const {
    compareResult,
    compareProgressByTargetId,
    compareBaseTargetId,
    laneTargetIds,
    prompt,
    systemPrompt,
    contextWindow,
    providerProfile,
    thinkingMode,
    enableTools,
    enableRetrieval
  } = params;
  const baseLane = compareResult.results.find((lane) => lane.targetId === compareBaseTargetId) || compareResult.results[0] || null;
  const exportedResults = laneTargetIds?.length
    ? compareResult.results.filter((lane) => laneTargetIds.includes(lane.targetId))
    : compareResult.results;
  const recoveryConclusions = exportedResults.map((lane) => ({
    lane,
    conclusion: deriveCompareRecoveryConclusion(compareProgressByTargetId?.[lane.targetId], lane)
  }));

  const lines = [
    exportedResults.length === 1 ? "# Compare Lane Export" : "# Compare Lab Export",
    "",
    `- Run ID: ${compareResult.runId}`,
    `- Generated At: ${compareResult.generatedAt}`,
    `- Compare Intent: ${compareResult.compareIntent}`,
    `- Output Shape: ${compareResult.compareOutputShape}`,
    `- Base Lane: ${baseLane?.targetLabel || "n/a"}`,
    `- Export Scope: ${exportedResults.length === 1 ? exportedResults[0]?.targetLabel || "single lane" : `${exportedResults.length} lanes`}`,
    `- Fairness Fingerprint: ${compareResult.fairnessFingerprint}`,
    `- Context Window: ${formatContextWindowLabel(contextWindow)}`,
    `- Provider Profile: ${providerProfile}`,
    `- Thinking Mode: ${thinkingMode}`,
    `- Tools: ${enableTools ? "on" : "off"}`,
    `- Retrieval: ${enableRetrieval ? "on" : "off"}`,
    ""
  ];

  if (compareResult.warning) {
    lines.push("## Compare Note", "", compareResult.warning, "");
  }

  if (recoveryConclusions.length) {
    lines.push("## Recovery Summary", "");
    for (const { lane, conclusion } of recoveryConclusions) {
      lines.push(`- ${lane.targetLabel}: ${conclusion}`);
    }
    lines.push("");
  }

  if (exportedResults.length === 1 && baseLane && exportedResults[0] && exportedResults[0].targetId !== baseLane.targetId) {
    const candidateLane = exportedResults[0];
    lines.push("## Base Lane Comparison Summary", "");
    lines.push(`- Base lane: ${baseLane.targetLabel} · ${baseLane.resolvedModel}`);
    lines.push(`- Candidate lane: ${candidateLane.targetLabel} · ${candidateLane.resolvedModel}`);
    lines.push(`- Overlap vs base: ${Math.round(computeCompareOverlap(baseLane.content, candidateLane.content) * 100)}%`);
    lines.push(`- Length delta vs base: ${candidateLane.content.length - baseLane.content.length}`);
    lines.push(`- Schema vs base: ${deriveCompareSchemaStatus(baseLane.content, candidateLane.content)}`);
    lines.push("");
  }

  lines.push("## Prompt", "", "```text", prompt, "```", "", "## System Prompt", "", "```text", systemPrompt, "```", "");

  for (const lane of exportedResults) {
    const overlapBase = baseLane?.content ? computeCompareOverlap(baseLane.content, lane.content) : 1;
    const schemaStatus = deriveCompareSchemaStatus(baseLane?.content || "", lane.content);
    const compareProgress = compareProgressByTargetId?.[lane.targetId];
    lines.push(`## ${lane.targetLabel}`);
    lines.push("");
    lines.push(`- Target ID: ${lane.targetId}`);
    lines.push(`- Provider: ${lane.providerLabel}`);
    lines.push(`- Execution: ${lane.execution}`);
    lines.push(`- Model: ${lane.resolvedModel}`);
    lines.push(`- Context Window: ${formatContextWindowLabel(lane.contextWindow)}`);
    lines.push(`- Status: ${lane.ok ? "ok" : "failed"}`);
    lines.push(`- Overlap vs base: ${Math.round(overlapBase * 100)}%`);
    lines.push(`- Schema vs base: ${schemaStatus}`);
    lines.push(`- Recovery conclusion: ${deriveCompareRecoveryConclusion(compareProgress, lane)}`);
    if (lane.warning) {
      lines.push(`- Warning: ${lane.warning}`);
    }
    if (lane.usage) {
      lines.push(`- Usage: prompt ${lane.usage.promptTokens}, completion ${lane.usage.completionTokens}, total ${lane.usage.totalTokens}`);
    }
    if (compareProgress?.timeline?.length) {
      lines.push("");
      lines.push("### Recovery Timeline");
      lines.push("");
      for (const entry of compareProgress.timeline) {
        lines.push(`- ${entry.at} · ${entry.phase} · ${entry.detail}`);
      }
    }
    lines.push("", "```text", lane.content || lane.warning || "—", "```", "");
  }

  return lines.join("\n");
}

export function serializeCompareResultAsCompactMarkdown(params: {
  compareResult: AgentCompareResponse;
  compareProgressByTargetId?: Record<string, AgentCompareLaneProgress>;
  compareBaseTargetId?: string;
  laneTargetIds?: string[];
  prompt: string;
  systemPrompt: string;
}) {
  const { compareResult, compareProgressByTargetId, compareBaseTargetId, laneTargetIds, prompt, systemPrompt } = params;
  const baseLane = compareResult.results.find((lane) => lane.targetId === compareBaseTargetId) || compareResult.results[0] || null;
  const exportedResults = laneTargetIds?.length
    ? compareResult.results.filter((lane) => laneTargetIds.includes(lane.targetId))
    : compareResult.results;

  const lines = [
    exportedResults.length === 1 ? "## Compare lane summary" : "## Compare run summary",
    "",
    `- Run ID: ${compareResult.runId}`,
    `- Base lane: ${baseLane?.targetLabel || "n/a"}`,
    `- Fingerprint: ${compareResult.fairnessFingerprint}`,
    `- Prompt excerpt: ${compactText(prompt, 160) || "(empty prompt)"}`,
    systemPrompt.trim() ? `- System frame: ${compactText(systemPrompt, 120)}` : ""
  ].filter(Boolean) as string[];

  lines.push("", "### Lane verdicts", "");
  for (const lane of exportedResults) {
    const overlapBase = baseLane?.content ? computeCompareOverlap(baseLane.content, lane.content) : 1;
    const schemaStatus = deriveCompareSchemaStatus(baseLane?.content || "", lane.content);
    const schemaLabel = formatCompareSchemaStatusForNote(schemaStatus);
    const recoveryConclusion = deriveCompareRecoveryConclusion(compareProgressByTargetId?.[lane.targetId], lane);
    const summary = [
      `${lane.targetLabel} — ${lane.ok ? "ok" : "failed"}`,
      `overlap ${(overlapBase * 100).toFixed(0)}%`,
      `schema ${schemaLabel.toLowerCase()}`,
      recoveryConclusion
    ].join("; ");
    lines.push(`- ${summary}`);
    if (lane.warning) {
      lines.push(`  - Warning: ${compactText(lane.warning, 160)}`);
    }
  }

  if (exportedResults.length === 1 && baseLane && exportedResults[0] && exportedResults[0].targetId !== baseLane.targetId) {
    const lane = exportedResults[0];
    lines.push(
      "",
      "### Base lane reference",
      "",
      `- ${baseLane.targetLabel} · ${baseLane.resolvedModel}`,
      `- Candidate: ${lane.targetLabel} · ${lane.resolvedModel}`,
      `- Length delta vs base: ${lane.content.length - baseLane.content.length}`
    );
  }

  if (compareResult.warning) {
    lines.push("", "### Compare note", "", `- ${compactText(compareResult.warning, 200)}`);
  }

  return lines.join("\n");
}

export function serializeCompareLaneReviewSummary(params: {
  compareResult: AgentCompareResponse;
  compareProgressByTargetId?: Record<string, AgentCompareLaneProgress>;
  compareBaseTargetId?: string;
  targetId: string;
  tone: AgentCompareReviewSummaryTone;
  detailMode: AgentCompareReviewSummaryDetail;
}) {
  const { compareResult, compareProgressByTargetId, compareBaseTargetId, targetId, tone, detailMode } = params;
  const lane = compareResult.results.find((entry) => entry.targetId === targetId);
  const baseLane = compareResult.results.find((entry) => entry.targetId === compareBaseTargetId) || compareResult.results[0] || null;
  if (!lane) return "";

  const overlapBase = baseLane?.content ? computeCompareOverlap(baseLane.content, lane.content) : 1;
  const schemaStatus = deriveCompareSchemaStatus(baseLane?.content || "", lane.content);
  const schemaLabel = formatCompareSchemaStatusForNote(schemaStatus);
  const recoveryConclusion = deriveCompareRecoveryConclusion(compareProgressByTargetId?.[lane.targetId], lane);
  const takeaway = deriveCompareLaneTakeaway({ lane, baseLane, overlapBase, schemaStatus });
  const followUp = deriveCompareLaneFollowUp({ lane, recoveryConclusion, schemaStatus });
  const outputTakeaway = compactText(lane.content || "No output captured.", 220);
  const baseLabel = baseLane?.targetLabel || "n/a";
  const overlapLabel = `${(overlapBase * 100).toFixed(0)}%`;
  const longFormContext = [
    `- Base lane: ${baseLabel}`,
    `- Overlap vs base: ${overlapLabel}`,
    `- Schema vs base: ${schemaLabel}`,
    `- Recovery: ${recoveryConclusion}`,
    lane.warning ? `- Warning: ${compactText(lane.warning, 180)}` : "",
    `- Output takeaway: ${outputTakeaway}`
  ]
    .filter(Boolean)
    .join("\n");

  if (detailMode === "strict-review") {
    if (tone === "chat") {
      return [
        `Strict review for ${lane.targetLabel}:`,
        `Status: ${lane.ok ? "ok" : "failed"}. This lane should be treated as a review artifact rather than a friendly summary.`,
        `Main delta: ${takeaway}.`,
        longFormContext,
        `- Recommendation: ${followUp}`,
        `- Reviewer note: keep this lane out of benchmark-facing examples until the warning/schema delta is understood.`
      ]
        .filter(Boolean)
        .join("\n");
    }

    return [
      `${tone === "issue" ? "Issue review" : "PR review"} — ${lane.targetLabel}`,
      `- Status: ${lane.ok ? "ok" : "failed"}`,
      `- Review stance: strict`,
      `- Main delta: ${takeaway}`,
      longFormContext,
      `- Recommendation: ${followUp}`,
      `- Risk note: do not treat this lane as interchangeable with the base lane unless the delta is explicitly accepted.`
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (detailMode === "friendly-report") {
    if (tone === "issue") {
      return [
        `Issue update — ${lane.targetLabel}`,
        `- Status: ${lane.ok ? "ok" : "failed"}`,
        `- Friendly summary: ${takeaway}`,
        longFormContext,
        `- Suggested next step: ${followUp}`
      ]
        .filter(Boolean)
        .join("\n");
    }

    if (tone === "chat") {
      return [
        `Friendly compare update for ${lane.targetLabel}:`,
        `This lane ${lane.ok ? "completed cleanly" : "did not finish cleanly"}, and the biggest difference versus ${baseLabel} is that ${takeaway}.`,
        `Here is the context we should keep with it:\n${longFormContext}`,
        `Suggested next step: ${followUp}.`
      ]
        .filter(Boolean)
        .join("\n");
    }

    return [
      `PR handoff summary — ${lane.targetLabel}`,
      `- Status: ${lane.ok ? "ok" : "failed"}`,
      `- Friendly summary: ${takeaway}`,
      longFormContext,
      `- Suggested next step: ${followUp}`
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (tone === "issue") {
    return [
      `Issue summary — ${lane.targetLabel}`,
      `- Result: ${lane.ok ? "ok" : "failed"}`,
      `- Compared against: ${baseLane?.targetLabel || "n/a"}`,
      `- Main delta: ${takeaway}`,
      `- Schema vs base: ${schemaLabel}`,
      `- Recovery: ${recoveryConclusion}`,
      lane.warning ? `- Warning: ${compactText(lane.warning, 180)}` : "",
      `- Suggested follow-up: ${followUp}`,
      `- Output takeaway: ${outputTakeaway}`
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (tone === "chat") {
    return [
      `Quick compare take on ${lane.targetLabel}:`,
      `Status: ${lane.ok ? "ok" : "failed"}; base lane ${baseLane?.targetLabel || "n/a"}; overlap ${(overlapBase * 100).toFixed(0)}%; schema ${schemaLabel}.`,
      `Biggest delta: ${takeaway}.`,
      `Recovery: ${recoveryConclusion}.`,
      lane.warning ? `Warning: ${compactText(lane.warning, 180)}.` : "",
      `Next step: ${followUp}.`,
      `Output takeaway: ${outputTakeaway}`
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `PR review note — ${lane.targetLabel}`,
    `- Status: ${lane.ok ? "ok" : "failed"}`,
    `- Base lane: ${baseLane?.targetLabel || "n/a"}`,
    `- Overlap vs base: ${(overlapBase * 100).toFixed(0)}%`,
    `- Schema vs base: ${schemaLabel}`,
    `- Main delta: ${takeaway}`,
    `- Recovery: ${recoveryConclusion}`,
    lane.warning ? `- Warning: ${compactText(lane.warning, 180)}` : "",
    `- Recommendation: ${followUp}`
  ]
    .filter(Boolean)
    .join("\n");
}
