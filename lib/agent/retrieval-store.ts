import crypto from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { benchmarkDatasets, benchmarkMilestoneSuites } from "@/lib/agent/benchmark-datasets";
import { readManagedBenchmarkPromptSets } from "@/lib/agent/benchmark-prompt-set-store";
import {
  ensureRetrievalVectorIndex,
  searchVectorIndex
} from "@/lib/agent/retrieval-vector-store";
import type {
  AgentGroundedVerification,
  AgentKnowledgeDocument,
  AgentKnowledgeHit,
  AgentRetrievalEvidenceMode,
  AgentRetrievalScope,
  AgentRetrievalSourcePreference,
  AgentRetrievalSummary
} from "@/lib/agent/types";
import { getObservabilityPaths } from "@/lib/agent/log-store";

type KnowledgeChunkRecord = {
  id: string;
  documentId: string;
  title: string;
  source?: string;
  tags: string[];
  sectionPath: string[];
  order: number;
  content: string;
  charCount: number;
  tokenEstimate: number;
};

type StructuredBlock = {
  sectionPath: string[];
  content: string;
};

type KnowledgeBaseSnapshot = {
  documents: AgentKnowledgeDocument[];
  chunks: KnowledgeChunkRecord[];
};

type KnowledgeBaseStats = {
  documentCount: number;
  chunkCount: number;
  avgChunkChars: number;
  avgChunkTokens: number;
};

type UpsertKnowledgeDocumentInput = {
  id?: string;
  title: string;
  source?: string;
  tags?: string[];
  content: string;
};

const CHUNK_TARGET_CHARS = 720;
const CHUNK_OVERLAP_CHARS = 160;
const DEFAULT_TOP_K = 4;
const KNOWLEDGE_CITATION_PREFIX = "KB";
const CITATION_PATTERN = /\[(KB\d+)\]/gi;
const UNCERTAINTY_PATTERN =
  /(insufficient|uncertain|not enough|can't verify|cannot verify|unable to verify|evidence is insufficient|不确定|无法确认|不能确认|证据不足|信息不足|暫時無法確認|證據不足|情報不足)/i;
const BUILTIN_BENCHMARK_DOC_PREFIX = "builtin-benchmark";

function normalizeRetrievalScope(value?: AgentRetrievalScope) {
  return value === "knowledge-base" || value === "benchmark-builtins" ? value : "all";
}

function normalizeSourcePreference(value?: AgentRetrievalSourcePreference) {
  return value === "knowledge-first" || value === "benchmark-first" ? value : "balanced";
}

function normalizeEvidenceMode(value?: AgentRetrievalEvidenceMode) {
  return value === "expanded" ? "expanded" : "compact";
}

function filterChunksByScope(chunks: KnowledgeChunkRecord[], scope: AgentRetrievalScope) {
  if (scope === "knowledge-base") {
    return chunks.filter((chunk) => !chunk.documentId.startsWith(BUILTIN_BENCHMARK_DOC_PREFIX));
  }
  if (scope === "benchmark-builtins") {
    return chunks.filter((chunk) => chunk.documentId.startsWith(BUILTIN_BENCHMARK_DOC_PREFIX));
  }
  return chunks;
}

function buildSourceBreakdown(chunks: KnowledgeChunkRecord[]) {
  const counts = new Map<string, number>();
  for (const chunk of chunks) {
    const label = chunk.documentId.startsWith(BUILTIN_BENCHMARK_DOC_PREFIX)
      ? "benchmark-builtins"
      : "knowledge-base";
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

function classifyChunkSource(chunk: KnowledgeChunkRecord) {
  return chunk.documentId.startsWith(BUILTIN_BENCHMARK_DOC_PREFIX) ? "benchmark-builtins" : "knowledge-base";
}

function sourcePreferenceBias(
  chunk: KnowledgeChunkRecord,
  sourcePreference: AgentRetrievalSourcePreference
) {
  const bucket = classifyChunkSource(chunk);
  if (sourcePreference === "knowledge-first") {
    return bucket === "knowledge-base" ? 1.12 : 0.92;
  }
  if (sourcePreference === "benchmark-first") {
    return bucket === "benchmark-builtins" ? 1.12 : 0.92;
  }
  return 1;
}

function expandRetrievalQueries(query: string) {
  const normalized = query.trim();
  if (!normalized) return [];
  const variants = [normalized];
  if (isRepoPathQuestion(normalized)) {
    variants.push(`${normalized} file path`);
  }
  if (isBenchmarkDefinitionQuery(normalized)) {
    variants.push(`${normalized} benchmark dataset`);
    variants.push(`${normalized} workload definition`);
  }
  if (/(rag|grounded|citation|evidence|证据|引用)/i.test(normalized)) {
    variants.push(`${normalized} retrieval evidence`);
  }
  return Array.from(new Set(variants.map((value) => value.trim()).filter(Boolean))).slice(0, 4);
}

function ensureDataDir() {
  mkdirSync(getObservabilityPaths().dataDir, { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown) {
  ensureDataDir();
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildKnowledgePaths() {
  const paths = getObservabilityPaths();
  return {
    documentFile: paths.knowledgeDocumentFile,
    chunkFile: paths.knowledgeChunkFile,
    vectorFile: paths.knowledgeVectorIndexFile
  };
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

function normalizeTags(tags: string[] = []) {
  return Array.from(
    new Set(
      tags
        .flatMap((tag) => tag.split(","))
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function normalizeContent(content: string) {
  return content.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

function pushHeading(stack: string[], level: number, title: string) {
  const next = stack.slice(0, Math.max(0, level - 1));
  next[level - 1] = title;
  return next;
}

function extractStructuredBlocks(content: string) {
  const normalized = normalizeContent(content);
  if (!normalized) return [] as StructuredBlock[];

  const lines = normalized.split("\n");
  const blocks: StructuredBlock[] = [];
  let headingStack: string[] = [];
  let paragraphLines: string[] = [];

  function flushParagraph() {
    const text = paragraphLines.join("\n").trim();
    if (!text) {
      paragraphLines = [];
      return;
    }
    blocks.push({
      sectionPath: [...headingStack],
      content: text
    });
    paragraphLines = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      if (title) {
        headingStack = pushHeading(headingStack, level, title);
      }
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    paragraphLines.push(line);
  }
  flushParagraph();

  if (!blocks.length) {
    return [{ sectionPath: [], content: normalized }];
  }
  return blocks;
}

function chunkStructuredBlocks(blocks: StructuredBlock[]) {
  const chunks: Array<{ sectionPath: string[]; content: string }> = [];
  let currentBlocks: StructuredBlock[] = [];
  let currentChars = 0;

  const flushChunk = () => {
    if (!currentBlocks.length) return;
    const content = currentBlocks.map((block) => block.content).join("\n\n").trim();
    if (!content) {
      currentBlocks = [];
      currentChars = 0;
      return;
    }
    chunks.push({
      sectionPath: currentBlocks[0]?.sectionPath || [],
      content
    });

    const overlapBlocks: StructuredBlock[] = [];
    let overlapChars = 0;
    for (let index = currentBlocks.length - 1; index >= 0; index -= 1) {
      overlapBlocks.unshift(currentBlocks[index]);
      overlapChars += currentBlocks[index].content.length;
      if (overlapChars >= CHUNK_OVERLAP_CHARS) break;
    }
    currentBlocks = overlapBlocks;
    currentChars = overlapChars;
  };

  for (const block of blocks) {
    const blockChars = block.content.length + 2;
    if (currentBlocks.length && currentChars + blockChars > CHUNK_TARGET_CHARS) {
      flushChunk();
    }
    currentBlocks.push(block);
    currentChars += blockChars;
  }
  flushChunk();

  return chunks;
}

function buildChunkRecords(document: AgentKnowledgeDocument) {
  const structuredBlocks = extractStructuredBlocks(document.content);
  const chunks = chunkStructuredBlocks(structuredBlocks);
  return chunks.map((chunk, index) => ({
    id: `${document.id}:chunk:${index + 1}`,
    documentId: document.id,
    title: document.title,
    source: document.source,
    tags: document.tags,
    sectionPath: chunk.sectionPath,
    order: index + 1,
    content: chunk.content,
    charCount: chunk.content.length,
    tokenEstimate: estimateTokens(chunk.content)
  }));
}

function readSnapshot(): KnowledgeBaseSnapshot {
  const { documentFile, chunkFile } = buildKnowledgePaths();
  return {
    documents: readJsonFile<AgentKnowledgeDocument[]>(documentFile, []),
    chunks: readJsonFile<KnowledgeChunkRecord[]>(chunkFile, [])
  };
}

function writeSnapshot(snapshot: KnowledgeBaseSnapshot) {
  const { documentFile, chunkFile } = buildKnowledgePaths();
  writeJsonFile(documentFile, snapshot.documents);
  writeJsonFile(chunkFile, snapshot.chunks);
}

function buildAllKnowledgeChunks(snapshot: KnowledgeBaseSnapshot) {
  return snapshot.chunks.concat(buildBuiltinBenchmarkKnowledgeChunks());
}

function tokenizeLatin(text: string) {
  return text.toLowerCase().match(/[a-z0-9_]{2,}/g) || [];
}

function tokenizeCjk(text: string) {
  const groups = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) || [];
  const tokens: string[] = [];
  for (const group of groups) {
    if (group.length === 1) {
      tokens.push(group);
      continue;
    }
    for (let index = 0; index < group.length - 1; index += 1) {
      tokens.push(group.slice(index, index + 2));
    }
  }
  return tokens;
}

function tokenize(text: string) {
  return Array.from(new Set([...tokenizeLatin(text), ...tokenizeCjk(text)]));
}

function compressChunkForQuery(query: string, content: string, maxChars = 320) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;

  const queryTokens = tokenize(query).sort((a, b) => b.length - a.length);
  const lower = normalized.toLowerCase();
  let anchor = -1;
  for (const token of queryTokens) {
    anchor = lower.indexOf(token.toLowerCase());
    if (anchor !== -1) break;
  }

  if (anchor === -1) {
    return `${normalized.slice(0, maxChars)}...`;
  }

  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, anchor - half);
  const end = Math.min(normalized.length, anchor + half);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalized.length ? "..." : "";
  return `${prefix}${normalized.slice(start, end).trim()}${suffix}`;
}

function countOverlap(queryTokens: string[], candidateTokens: Set<string>) {
  let overlap = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }
  return overlap;
}

function countSubstringOccurrences(content: string, query: string) {
  if (!query) return 0;
  let start = 0;
  let count = 0;
  while (start < content.length) {
    const index = content.indexOf(query, start);
    if (index === -1) break;
    count += 1;
    start = index + query.length;
  }
  return count;
}

function buildEvidenceSpans(
  query: string,
  content: string,
  options?: {
    maxSpans?: number;
    previewChars?: number;
  }
) {
  const maxSpans = options?.maxSpans || 2;
  const previewChars = options?.previewChars || 220;
  const fragments = content
    .split(/\n+/)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
  const queryTokens = tokenize(query);

  const spans = fragments
    .map((fragment, index) => {
      const fragmentTokens = new Set(tokenize(fragment));
      const overlap = countOverlap(queryTokens, fragmentTokens);
      if (!overlap && !fragment.toLowerCase().includes(query.toLowerCase())) {
        return null;
      }
      return {
        label: `E${index + 1}`,
        preview: compressChunkForQuery(query, fragment, previewChars),
        overlap
      };
    })
    .filter((entry): entry is { label: string; preview: string; overlap: number } => Boolean(entry))
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, maxSpans)
    .map(({ label, preview }) => ({ label, preview }));

  if (spans.length) return spans;
  return [{
    label: "E1",
    preview: compressChunkForQuery(query, content, previewChars)
  }];
}

function formatCitationLabel(index: number) {
  return `[${KNOWLEDGE_CITATION_PREFIX}${index}]`;
}

const GENERAL_KNOWLEDGE_PATTERNS = [
  /^(什么是|什么叫|解释一下|请解释|介绍一下|说说|如何理解|为什么|怎么|如何|有哪些|区别是什么|有什么区别|推荐|建议)/,
  /^(what is|what's|explain|why|how|compare|difference|recommend|suggest)/i,
  /(上火|水果|蔬菜|感冒|发烧|RAG|prompt cache|agent|benchmark|幻觉|检索增强)/i,
];

const KNOWLEDGE_SPECIFIC_PATTERNS = [
  /(仓库|repo|repository|代码|文件|目录|文档|知识库|kb|引用|citation|当前项目|这个系统|上述材料|上述资料|根据知识库|根据文档|结合资料|本仓库|本项目)/i,
  /(file|files|folder|directory|repository|repo|document|docs|knowledge base|citation|codebase|this project|this repo)/i,
];

const BENCHMARK_DEFINITION_QUERY_PATTERNS = [
  /(正式里程碑评测集|milestone-formal|milestone full|milestone suite|workload|测试集|评测集|suite)/i,
  /(benchmark datasets|benchmark suite|dataset catalog|workloads)/i
];

const REPO_PATH_QUERY_PATTERNS = [
  /(仓库|repo|repository|代码|文件|目录|路由|route|store|修复点|patch|diff|实现|当前项目|当前仓库|哪个文件|哪条路由)/i,
  /(which file|which route|which store|file path|relative path|implemented where|where is the fix|what file)/i
];

function isGeneralKnowledgeQuestion(query: string) {
  const normalized = query.trim();
  if (!normalized) return false;
  if (KNOWLEDGE_SPECIFIC_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  return GENERAL_KNOWLEDGE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isBenchmarkDefinitionQuery(query: string) {
  const normalized = query.trim();
  if (!normalized) return false;
  return BENCHMARK_DEFINITION_QUERY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isRepoPathQuestion(query: string) {
  const normalized = query.trim();
  if (!normalized) return false;
  return REPO_PATH_QUERY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildKnowledgeBaseStats(snapshot: KnowledgeBaseSnapshot): KnowledgeBaseStats {
  const chunkCount = snapshot.chunks.length;
  const totalChars = snapshot.chunks.reduce((sum, chunk) => sum + chunk.charCount, 0);
  const totalTokens = snapshot.chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0);
  return {
    documentCount: snapshot.documents.length,
    chunkCount,
    avgChunkChars: chunkCount ? Number((totalChars / chunkCount).toFixed(1)) : 0,
    avgChunkTokens: chunkCount ? Number((totalTokens / chunkCount).toFixed(1)) : 0
  };
}

export function getKnowledgeBaseSnapshot() {
  const snapshot = readSnapshot();
  const { vectorFile } = buildKnowledgePaths();
  const vectorIndex = ensureRetrievalVectorIndex(
    vectorFile,
    buildAllKnowledgeChunks(snapshot).map((chunk) => ({
      chunkId: chunk.id,
      title: chunk.title,
      source: chunk.source,
      sectionPath: chunk.sectionPath,
      tags: chunk.tags,
      content: chunk.content,
      order: chunk.order,
      charCount: chunk.charCount
    }))
  );
  return {
    documents: snapshot.documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    stats: buildKnowledgeBaseStats(snapshot),
    vectorIndex: {
      embeddingModel: vectorIndex.version,
      generatedAt: vectorIndex.generatedAt,
      chunkCount: vectorIndex.chunkCount,
      dims: vectorIndex.dims
    }
  };
}

export function upsertKnowledgeDocument(input: UpsertKnowledgeDocumentInput) {
  const title = input.title.trim();
  const content = normalizeContent(input.content);
  if (!title) {
    throw new Error("title is required.");
  }
  if (!content) {
    throw new Error("content is required.");
  }

  const snapshot = readSnapshot();
  const now = new Date().toISOString();
  const existing = input.id ? snapshot.documents.find((document) => document.id === input.id) : null;
  const documentId = existing?.id || `kb-doc-${crypto.randomUUID()}`;
  const normalizedTags = normalizeTags(input.tags || []);
  const nextDocument: AgentKnowledgeDocument = {
    id: documentId,
    title,
    source: input.source?.trim() || undefined,
    tags: normalizedTags,
    content,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    chunkCount: 0,
    charCount: content.length
  };

  const nextChunks = buildChunkRecords(nextDocument);
  nextDocument.chunkCount = nextChunks.length;

  const nextDocuments = snapshot.documents
    .filter((document) => document.id !== documentId)
    .concat(nextDocument)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const otherChunks = snapshot.chunks.filter((chunk) => chunk.documentId !== documentId);
  const nextSnapshot = {
    documents: nextDocuments,
    chunks: [...otherChunks, ...nextChunks]
  };
  writeSnapshot(nextSnapshot);
  const { vectorFile } = buildKnowledgePaths();
  ensureRetrievalVectorIndex(
    vectorFile,
    buildAllKnowledgeChunks(nextSnapshot).map((chunk) => ({
      chunkId: chunk.id,
      title: chunk.title,
      source: chunk.source,
      sectionPath: chunk.sectionPath,
      tags: chunk.tags,
      content: chunk.content,
      order: chunk.order,
      charCount: chunk.charCount
    }))
  );

  return {
    document: nextDocument,
    stats: buildKnowledgeBaseStats(nextSnapshot)
  };
}

export function deleteKnowledgeDocument(documentId: string) {
  const snapshot = readSnapshot();
  const nextDocuments = snapshot.documents.filter((document) => document.id !== documentId);
  if (nextDocuments.length === snapshot.documents.length) {
    return false;
  }
  const nextChunks = snapshot.chunks.filter((chunk) => chunk.documentId !== documentId);
  const nextSnapshot = {
    documents: nextDocuments,
    chunks: nextChunks
  };
  writeSnapshot(nextSnapshot);
  const { vectorFile } = buildKnowledgePaths();
  ensureRetrievalVectorIndex(
    vectorFile,
    buildAllKnowledgeChunks(nextSnapshot).map((chunk) => ({
      chunkId: chunk.id,
      title: chunk.title,
      source: chunk.source,
      sectionPath: chunk.sectionPath,
      tags: chunk.tags,
      content: chunk.content,
      order: chunk.order,
      charCount: chunk.charCount
    }))
  );
  return true;
}

function buildSearchResult(
  chunk: KnowledgeChunkRecord,
  index: number,
  score: number,
  confidence: number,
  query: string,
  details?: {
    matchedTerms?: string[];
    evidenceSpans?: Array<{ label: string; preview: string }>;
    lexicalScore?: number;
    structuralScore?: number;
    vectorScore?: number;
    rerankScore?: number;
  }
): AgentKnowledgeHit {
  const maxChars = chunk.source === "lib/agent/benchmark-datasets.ts" ? 1400 : 320;
  const evidencePreview = details?.evidenceSpans?.[0]?.preview || compressChunkForQuery(query, chunk.content, maxChars);
  return {
    chunkId: chunk.id,
    documentId: chunk.documentId,
    title: chunk.title,
    source: chunk.source,
    sectionPath: chunk.sectionPath,
    order: chunk.order,
    content: evidencePreview,
    citationLabel: formatCitationLabel(index + 1),
    score: Number(score.toFixed(2)),
    confidence: Number(confidence.toFixed(3)),
    matchedTerms: details?.matchedTerms || [],
    evidencePreview,
    evidenceSpans: details?.evidenceSpans || [],
    scoring: {
      lexical: Number((details?.lexicalScore || 0).toFixed(2)),
      structural: Number((details?.structuralScore || 0).toFixed(2)),
      vector: Number((details?.vectorScore || 0).toFixed(2)),
      rerank: Number((details?.rerankScore || 0).toFixed(2)),
      final: Number(score.toFixed(2))
    }
  };
}

function buildBuiltinBenchmarkKnowledgeChunks() {
  const promptSetMap = new Map(
    readManagedBenchmarkPromptSets().map((entry) => [entry.id, entry])
  );

  const chunks: KnowledgeChunkRecord[] = [];

  for (const suite of benchmarkMilestoneSuites) {
    const workloadLines = suite.workloads.map((workload, index) => {
      if (workload.kind === "prompt-set") {
        const promptSet = promptSetMap.get(workload.promptSetId);
        return `${index + 1}. prompt-set ${workload.promptSetId} · ${promptSet?.label || "unknown"} · runs=${workload.runs}`;
      }
      const dataset = benchmarkDatasets.find((entry) => entry.id === workload.datasetId);
      const sampleLimit = typeof workload.sampleLimit === "number" ? ` · sampleLimit=${workload.sampleLimit}` : "";
      return `${index + 1}. dataset ${workload.datasetId} · ${dataset?.label || "unknown"} · runs=${workload.runs}${sampleLimit}`;
    });

    const content = [
      `Suite ID: ${suite.id}`,
      `Label: ${suite.label}`,
      `Description: ${suite.description}`,
      `Report tier: ${suite.reportTier}`,
      "Workloads:",
      ...workloadLines
    ].join("\n");

    chunks.push({
      id: `${BUILTIN_BENCHMARK_DOC_PREFIX}:${suite.id}:suite`,
      documentId: `${BUILTIN_BENCHMARK_DOC_PREFIX}:${suite.id}`,
      title: `${suite.label} benchmark suite`,
      source: "lib/agent/benchmark-datasets.ts",
      tags: ["benchmark", "suite", suite.id],
      sectionPath: ["Benchmark suites", suite.label],
      order: 1,
      content,
      charCount: content.length,
      tokenEstimate: estimateTokens(content)
    });
  }

  const datasetSummaryContent = [
    "Benchmark dataset catalog:",
    ...benchmarkDatasets.map(
      (dataset, index) =>
        `${index + 1}. ${dataset.id} · ${dataset.label} · ${dataset.taskCategory} · ${dataset.scoringLabel} · samples=${dataset.sampleCount}`
    )
  ].join("\n");

  chunks.push({
    id: `${BUILTIN_BENCHMARK_DOC_PREFIX}:dataset-catalog`,
    documentId: `${BUILTIN_BENCHMARK_DOC_PREFIX}:dataset-catalog`,
    title: "Benchmark dataset catalog",
    source: "lib/agent/benchmark-datasets.ts",
    tags: ["benchmark", "dataset-catalog"],
    sectionPath: ["Benchmark datasets"],
    order: 1,
    content: datasetSummaryContent,
    charCount: datasetSummaryContent.length,
    tokenEstimate: estimateTokens(datasetSummaryContent)
  });

  return chunks;
}

export function searchKnowledgeBase(
  query: string,
  topK = DEFAULT_TOP_K,
  options?: {
    scope?: AgentRetrievalScope;
    sourcePreference?: AgentRetrievalSourcePreference;
    evidenceMode?: AgentRetrievalEvidenceMode;
  }
): AgentRetrievalSummary {
  const normalizedQuery = query.trim();
  const scope = normalizeRetrievalScope(options?.scope);
  const sourcePreference = normalizeSourcePreference(options?.sourcePreference);
  const evidenceMode = normalizeEvidenceMode(options?.evidenceMode);
  const expandedQueries = expandRetrievalQueries(normalizedQuery);
  if (!normalizedQuery) {
    return {
      query: normalizedQuery,
      scope,
      sourcePreference,
      evidenceMode,
      hitCount: 0,
      lowConfidence: true,
      topScore: 0,
      usedInPrompt: false,
      strategy: "hybrid-rerank",
      candidateCount: 0,
      vectorCandidateCount: 0,
      reranked: false,
      embeddingModel: "local-hash-embedding-v1",
      expandedQueries,
      sourceBreakdown: [],
      stageNotes: [],
      results: []
    };
  }

  const snapshot = readSnapshot();
  const allChunks = filterChunksByScope(buildAllKnowledgeChunks(snapshot), scope);
  const queryTokens = Array.from(new Set(expandedQueries.flatMap((entry) => tokenize(entry))));
  const benchmarkDefinitionQuery = isBenchmarkDefinitionQuery(normalizedQuery);
  if (!queryTokens.length || !allChunks.length) {
    return {
      query: normalizedQuery,
      scope,
      sourcePreference,
      evidenceMode,
      hitCount: 0,
      lowConfidence: true,
      topScore: 0,
      usedInPrompt: false,
      strategy: "hybrid-rerank",
      candidateCount: 0,
      vectorCandidateCount: 0,
      reranked: false,
      embeddingModel: "local-hash-embedding-v1",
      expandedQueries,
      sourceBreakdown: buildSourceBreakdown(allChunks),
      stageNotes: [],
      results: []
    };
  }

  const { vectorFile } = buildKnowledgePaths();
  const vectorIndex = ensureRetrievalVectorIndex(
    vectorFile,
    allChunks.map((chunk) => ({
      chunkId: chunk.id,
      title: chunk.title,
      source: chunk.source,
      sectionPath: chunk.sectionPath,
      tags: chunk.tags,
      content: chunk.content,
      order: chunk.order,
      charCount: chunk.charCount
    }))
  );

  const candidateLimit = Math.min(allChunks.length, Math.max(topK * 4, 8));
  const lexicalEntries = allChunks
    .map((chunk) => {
      const bodyTokens = new Set(tokenize(chunk.content));
      const titleTokens = new Set(tokenize(chunk.title));
      const sectionTokens = new Set(tokenize(chunk.sectionPath.join(" ")));
      const sourceTokens = new Set(tokenize(chunk.source || ""));
      const tagTokens = new Set(tokenize(chunk.tags.join(" ")));

      const bodyOverlap = countOverlap(queryTokens, bodyTokens);
      const titleOverlap = countOverlap(queryTokens, titleTokens);
      const sectionOverlap = countOverlap(queryTokens, sectionTokens);
      const sourceOverlap = countOverlap(queryTokens, sourceTokens);
      const tagOverlap = countOverlap(queryTokens, tagTokens);
      const normalizedOverlap = bodyOverlap / Math.max(1, queryTokens.length);
      const exactPhraseBonus = chunk.content.includes(normalizedQuery) || chunk.title.includes(normalizedQuery) ? 0.35 : 0;
      const benchmarkDefinitionBonus =
        benchmarkDefinitionQuery && chunk.source === "lib/agent/benchmark-datasets.ts"
          ? 120
          : 0;
      const sourceBias = sourcePreferenceBias(chunk, sourcePreference);
      const lexicalScore =
        (
          normalizedOverlap * 100 +
          titleOverlap * 18 +
          sectionOverlap * 10 +
          sourceOverlap * 6 +
          exactPhraseBonus * 100 +
          benchmarkDefinitionBonus
        ) * sourceBias;
      const structuralScore =
        (
          titleOverlap * 14 +
          sectionOverlap * 12 +
          sourceOverlap * 4 +
          tagOverlap * 8 +
          (chunk.sectionPath.length ? 4 : 0)
        ) * sourceBias;
      const candidateScore = lexicalScore + structuralScore;
      const candidateConfidence = Math.min(
        1,
        normalizedOverlap +
          titleOverlap * 0.12 +
          sectionOverlap * 0.05 +
          tagOverlap * 0.04 +
          exactPhraseBonus +
          (benchmarkDefinitionBonus ? 0.35 : 0)
      );

      return {
        chunk,
        lexicalScore,
        structuralScore,
        candidateScore,
        candidateConfidence,
        vectorScore: 0,
        matchedTerms: queryTokens.filter((token) =>
          bodyTokens.has(token) || titleTokens.has(token) || sectionTokens.has(token) || sourceTokens.has(token) || tagTokens.has(token)
        )
      };
    })
    .sort((a, b) => b.candidateScore - a.candidateScore || a.chunk.order - b.chunk.order);

  const lexicalMap = new Map(lexicalEntries.map((entry) => [entry.chunk.id, entry]));
  const vectorScoreByChunkId = new Map<string, number>();
  for (const queryVariant of expandedQueries.length ? expandedQueries : [normalizedQuery]) {
    for (const entry of searchVectorIndex(vectorIndex, queryVariant, candidateLimit)) {
      const current = vectorScoreByChunkId.get(entry.chunkId) || 0;
      vectorScoreByChunkId.set(entry.chunkId, Math.max(current, Number((entry.score * 100).toFixed(2))));
    }
  }
  const vectorMatches = [...vectorScoreByChunkId.entries()].map(([chunkId, score]) => ({
    chunkId,
    score: score / 100
  }));
  const candidateIds = Array.from(
    new Set(
      lexicalEntries
        .filter((entry) => entry.candidateScore > 0)
        .slice(0, candidateLimit)
        .map((entry) => entry.chunk.id)
        .concat(vectorMatches.map((entry) => entry.chunkId))
    )
  );
  const candidatePool = candidateIds
    .map((chunkId) => {
      const entry = lexicalMap.get(chunkId);
      if (!entry) return null;
      const sourceBias = sourcePreferenceBias(entry.chunk, sourcePreference);
      const evidenceSpans = buildEvidenceSpans(normalizedQuery, entry.chunk.content, {
        maxSpans: evidenceMode === "expanded" ? 4 : 2,
        previewChars: evidenceMode === "expanded" ? 320 : 220
      });
      const lowerChunk = `${entry.chunk.title}\n${entry.chunk.sectionPath.join(" ")}\n${entry.chunk.content}`.toLowerCase();
      const phraseHits = countSubstringOccurrences(lowerChunk, normalizedQuery.toLowerCase());
      const sectionPhraseHit = entry.chunk.sectionPath.some((section) => section.toLowerCase().includes(normalizedQuery.toLowerCase()));
      const coverage = entry.matchedTerms.length / Math.max(1, queryTokens.length);
      const vectorScore = vectorScoreByChunkId.get(entry.chunk.id) || 0;
      const rerankScore =
        (
          coverage * 60 +
          evidenceSpans.length * 18 +
          phraseHits * 22 +
          (sectionPhraseHit ? 12 : 0) +
          vectorScore * 0.18
        ) * sourceBias;
      const finalScore =
        entry.lexicalScore * 0.45 +
        entry.structuralScore * 0.15 +
        vectorScore * 0.15 +
        rerankScore * 0.25;
      const confidence = Math.min(
        1,
        entry.candidateConfidence * 0.55 +
          coverage * 0.35 +
          Math.min(0.1, evidenceSpans.length * 0.05) +
          Math.min(0.1, vectorScore / 200)
      );

      return {
        ...entry,
        evidenceSpans,
        vectorScore,
        rerankScore,
        finalScore,
        confidence
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => b.finalScore - a.finalScore || b.confidence - a.confidence || a.chunk.order - b.chunk.order);

  const ranked = candidatePool.slice(0, Math.max(1, topK));
  const topScore = ranked[0]?.finalScore || 0;
  const lowConfidence = topScore < 34 || (ranked[0]?.confidence || 0) < 0.36;
  const stageNotes = [
    scope === "all"
      ? "scope: all retrieval sources"
      : scope === "knowledge-base"
        ? "scope: uploaded knowledge base only"
        : "scope: built-in benchmark references only",
    sourcePreference === "balanced"
      ? "source-preference: balanced"
      : sourcePreference === "knowledge-first"
        ? "source-preference: uploaded knowledge preferred"
        : "source-preference: benchmark references preferred",
    evidenceMode === "expanded"
      ? "evidence-mode: expanded multi-span review"
      : "evidence-mode: compact reviewer preview",
    expandedQueries.length > 1
      ? `query-expansion: ${expandedQueries.length} variants`
      : "query-expansion: original query only",
    "candidate-recall: lexical + title/section/source/tag signals",
    `vector-recall: ${vectorIndex.version} persisted cosine search`,
    "rerank: evidence-span coverage + phrase-hit density + vector agreement"
  ];
  if (benchmarkDefinitionQuery) {
    stageNotes.push("benchmark-definition boost applied");
  }
  const results = ranked.map((entry, index) =>
    buildSearchResult(entry.chunk, index, entry.finalScore, entry.confidence, normalizedQuery, {
      matchedTerms: entry.matchedTerms.slice(0, 8),
      evidenceSpans: entry.evidenceSpans,
      lexicalScore: entry.lexicalScore,
      structuralScore: entry.structuralScore,
      vectorScore: entry.vectorScore,
      rerankScore: entry.rerankScore
    })
  );

  return {
    query: normalizedQuery,
    scope,
    sourcePreference,
    evidenceMode,
    hitCount: results.length,
    lowConfidence,
    topScore: Number(topScore.toFixed(2)),
    usedInPrompt: results.length > 0,
    strategy: "hybrid-rerank",
    candidateCount: candidatePool.length,
    vectorCandidateCount: vectorMatches.length,
    reranked: candidatePool.length > results.length,
    embeddingModel: vectorIndex.version,
    indexGeneratedAt: vectorIndex.generatedAt,
    expandedQueries,
    sourceBreakdown: buildSourceBreakdown(allChunks),
    stageNotes,
    results
  };
}

export function applyRetrievalBypassStrategy(
  query: string,
  retrieval: AgentRetrievalSummary | null
): AgentRetrievalSummary | null {
  if (!retrieval) return retrieval;
  if (isRepoPathQuestion(query)) {
    return {
      ...retrieval,
      bypassGrounding: true,
      bypassReason: "repo-path-question"
    };
  }
  if (!isGeneralKnowledgeQuestion(query)) return retrieval;

  if (retrieval.hitCount === 0) {
    return {
      ...retrieval,
      usedInPrompt: false,
      bypassGrounding: true,
      bypassReason: "general-question-no-evidence"
    };
  }

  if (retrieval.lowConfidence) {
    return {
      ...retrieval,
      usedInPrompt: false,
      bypassGrounding: true,
      bypassReason: "general-question-low-confidence"
    };
  }

  return retrieval;
}

export function buildGroundedSystemPrompt(basePrompt: string, retrieval: AgentRetrievalSummary | null) {
  if (!retrieval) {
    return basePrompt;
  }

  if (retrieval.bypassGrounding) {
    return basePrompt;
  }

  if (!retrieval.results.length) {
    return [
      basePrompt,
      "",
      "Grounding policy:",
      "- Retrieval grounding is enabled for this turn.",
      "- No supporting evidence was retrieved from the local knowledge base.",
      "- You may still answer common or general questions from general model knowledge.",
      "- Do not fabricate knowledge-base citations when there is no retrieved evidence.",
      "- If the user asks about repository-specific, document-specific, or knowledge-base-specific facts, clearly say that no local evidence was found and separate that from any general guidance."
    ].join("\n");
  }

  const evidenceLines = retrieval.results.flatMap((result) => {
    const header = [
      `${result.citationLabel} ${result.title}`,
      result.sectionPath.length ? ` > ${result.sectionPath.join(" > ")}` : "",
      result.source ? ` · ${result.source}` : ""
    ].join("");
    return [header, result.content, ""];
  });

  return [
    basePrompt,
    "",
    "Grounding policy:",
    "- Use the retrieved evidence below when it is relevant to the question.",
    "- Cite grounded factual claims inline with the provided citation labels, for example [KB1].",
    "- Do not invent citations and do not cite labels that are not present in the retrieved evidence.",
    "- If the evidence is weak, incomplete, or only loosely related, you may still answer common questions from general model knowledge, but do not present the weak evidence as a strong factual source.",
    "- If you cannot support a repository-specific or document-specific claim with the evidence below, say so explicitly instead of presenting it as a fact.",
    "",
    retrieval.lowConfidence
      ? "Retrieval confidence is low. Prefer a general answer without forced citations unless the retrieved evidence clearly supports the claim."
      : "Retrieval confidence is acceptable. Prefer evidence-backed claims and keep citations close to those claims.",
    "",
    "Retrieved evidence:",
    ...evidenceLines
  ].join("\n");
}

function extractCitationLabels(content: string) {
  return Array.from(
    new Set(
      [...content.matchAll(CITATION_PATTERN)]
        .map((match) => match[1]?.toUpperCase())
        .filter((value): value is string => Boolean(value))
    )
  );
}

function stripCitationLabels(content: string) {
  return content.replace(CITATION_PATTERN, " ");
}

function hasUncertaintySignal(content: string) {
  return UNCERTAINTY_PATTERN.test(content);
}

function calculateLexicalGroundingScore(content: string, retrieval: AgentRetrievalSummary) {
  const answerTokens = tokenize(stripCitationLabels(content));
  if (!answerTokens.length) return 0;
  const evidenceTokens = new Set(
    retrieval.results.flatMap((result) => tokenize(`${result.title} ${result.content} ${result.sectionPath.join(" ")}`))
  );
  if (!evidenceTokens.size) return 0;
  const overlap = countOverlap(answerTokens, evidenceTokens);
  return Number((overlap / Math.max(answerTokens.length, 1)).toFixed(3));
}

function buildFallbackAnswer(retrieval: AgentRetrievalSummary | null) {
  if (!retrieval || !retrieval.results.length) {
    return "我目前无法基于知识库证据确认这个回答。当前没有检索到足够相关的依据，请缩小问题范围或补充资料后再试。";
  }

  const evidencePreview = retrieval.results
    .slice(0, 3)
    .map((result) => `- ${result.citationLabel} ${result.title}${result.sectionPath.length ? ` > ${result.sectionPath.join(" > ")}` : ""}`)
    .join("\n");

  return [
    "我目前无法基于现有检索证据给出高置信度结论。",
    retrieval.lowConfidence
      ? "当前命中的证据相关性偏低，我不应把下面内容表述成确定事实。"
      : "当前回答缺少足够明确的证据支撑，我先只返回可确认的证据范围。",
    "",
    "可用证据：",
    evidencePreview,
    "",
    "如果你愿意，可以缩小问题范围，或者补充更具体的文档后我再继续回答。"
  ].join("\n");
}

export function verifyGroundedAnswer(
  content: string,
  retrieval: AgentRetrievalSummary | null
): AgentGroundedVerification {
  if (!retrieval) {
    return {
      enforced: false,
      citationRequired: false,
      citationsPresent: false,
      verdict: "not-applicable",
      fallbackApplied: false,
      citedLabels: [],
      missingLabels: [],
      unsupportedLabels: [],
      lexicalGroundingScore: 0,
      notes: ["retrieval-disabled"]
    };
  }

  if (retrieval.bypassGrounding) {
    return {
      enforced: false,
      citationRequired: false,
      citationsPresent: false,
      verdict: "not-applicable",
      fallbackApplied: false,
      citedLabels: [],
      missingLabels: [],
      unsupportedLabels: [],
      lexicalGroundingScore: 0,
      notes: [retrieval.bypassReason || "retrieval-disabled"]
    };
  }

  const citedLabels = extractCitationLabels(content);
  const supportedLabelSet = new Set(retrieval.results.map((result) => result.citationLabel.replace(/[\[\]]/g, "").toUpperCase()));
  const unsupportedLabels = citedLabels.filter((label) => !supportedLabelSet.has(label));
  const citationsPresent = citedLabels.length > 0;
  const citationRequired = retrieval.hitCount > 0 && !retrieval.lowConfidence;
  const lexicalGroundingScore = calculateLexicalGroundingScore(content, retrieval);
  const notes: string[] = [];

  if (!retrieval.hitCount) {
    notes.push("no-evidence");
    return {
      enforced: false,
      citationRequired: false,
      citationsPresent,
      verdict: "not-applicable",
      fallbackApplied: false,
      citedLabels,
      missingLabels: [],
      unsupportedLabels,
      lexicalGroundingScore,
      notes
    };
  }

  if (unsupportedLabels.length) {
    notes.push("unsupported-citations");
  }
  if (!citationsPresent) {
    notes.push("missing-citations");
  }
  if (retrieval.lowConfidence) {
    notes.push("low-confidence");
  }
  if (lexicalGroundingScore < 0.06) {
    notes.push("weak-overlap");
  }

  let verdict: AgentGroundedVerification["verdict"] = "grounded";
  let fallbackApplied = false;
  let fallbackReason: AgentGroundedVerification["fallbackReason"] | undefined;

  if (retrieval.lowConfidence) {
    if (unsupportedLabels.length) {
      verdict = "unsupported";
      fallbackApplied = true;
      fallbackReason = "unsupported-claims";
    } else if (citationsPresent || lexicalGroundingScore >= 0.06 || hasUncertaintySignal(content)) {
      verdict = "weakly-grounded";
    } else {
      verdict = "not-applicable";
    }
  } else if (!citationsPresent) {
    verdict = lexicalGroundingScore >= 0.12 ? "weakly-grounded" : "unsupported";
    if (verdict === "unsupported") {
      fallbackApplied = true;
      fallbackReason = "missing-citations";
    }
  } else if (unsupportedLabels.length || lexicalGroundingScore < 0.03) {
    verdict = "unsupported";
    fallbackApplied = true;
    fallbackReason = "unsupported-claims";
  } else if (lexicalGroundingScore < 0.08) {
    verdict = "weakly-grounded";
  }

  return {
    enforced: true,
    citationRequired,
    citationsPresent,
    verdict,
    fallbackApplied,
    fallbackReason,
    citedLabels,
    missingLabels: citationsPresent ? [] : retrieval.results.map((result) => result.citationLabel.replace(/[\[\]]/g, "").toUpperCase()),
    unsupportedLabels,
    lexicalGroundingScore,
    notes
  };
}

export function applyGroundedResponsePolicy(
  content: string,
  retrieval: AgentRetrievalSummary | null
): { content: string; verification: AgentGroundedVerification } {
  const verification = verifyGroundedAnswer(content, retrieval);
  if (!verification.fallbackApplied) {
    return {
      content,
      verification
    };
  }

  return {
    content: buildFallbackAnswer(retrieval),
    verification
  };
}

export function listKnowledgeChunks(documentId?: string) {
  const snapshot = readSnapshot();
  return snapshot.chunks
    .filter((chunk) => (documentId ? chunk.documentId === documentId : true))
    .sort((a, b) => {
      if (a.documentId !== b.documentId) return a.documentId.localeCompare(b.documentId);
      return a.order - b.order;
    });
}
